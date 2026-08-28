import { Injectable } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { MoveStockDto, QueryStockDto, QueryStockHistoryDto, RecordStockMovementDto } from './dto/stock-movement.dto';
import { StockReservationService } from './stock-reservation.service';

export interface InternalMovementInput {
  productId: string;
  warehouseId: string | null;
  type: StockMovementType;
  qtyDelta: number;
  comment?: string;
  sourceType?: string;
  sourceId?: string;
  /** Stock-reservation spec (simplified, 2026-08-19): when this increase is traceable to a specific customer order (e.g. a purchase created via "Надіслати заявку постачальнику"), that order's outstanding need is topped up first — see `applyMovement`'s own comment. */
  preferredOrderId?: string;
}

/**
 * Structured stock ledger (Phase 3 §6's replacement for the old free-text
 * History sheet's stock-quantity half). Every method here is the SINGLE
 * path by which `warehouse_stock.qty` and `products.qty` are ever mutated
 * — no other module writes to those columns directly, so this is the one
 * place the "materialize every warehouse's allocation explicitly,
 * including the old implicit default-warehouse remainder" decision
 * (Phase 1 §6.6 / Phase 3 §6) actually gets enforced. Other modules
 * (Production, Procurement, BOM consumption) call `recordMovement`
 * internally with the appropriate `sourceType`/`sourceId` rather than
 * touching WarehouseStock themselves.
 *
 * Atomicity: every write here uses Prisma's atomic `increment` (a real SQL
 * `qty = qty + delta`), never "read qty, compute in JS, write back" — the
 * latter is a classic lost-update race under concurrent requests. Multiple
 * writes within one call (WarehouseStock + StockMovement + Product.qty)
 * are already atomic as a side effect of TenantScopeInterceptor wrapping
 * the whole request in one transaction (see PrismaService's header
 * comment) — no additional `$transaction` needed here.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockReservationService: StockReservationService,
  ) {}

  async recordMovement(user: RequestUser, dto: RecordStockMovementDto) {
    return this.applyMovement(user, {
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      type: dto.type as StockMovementType,
      qtyDelta: dto.qtyDelta,
      comment: dto.comment,
    });
  }

  /**
   * A move is modeled as two linked movements (out of source, into
   * destination) sharing the same `sourceType`/`sourceId` pair so they can
   * be correlated later — there's no single-row "transfer" concept in the
   * ledger, matching how the old system's warehouse-to-warehouse transfer
   * was always really two allocation changes (Phase 1 §6.6).
   */
  async move(user: RequestUser, dto: MoveStockDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new CodedBadRequestException('STOCK_MOVE_SAME_WAREHOUSE', 'fromWarehouseId and toWarehouseId must differ.');
    }
    if (dto.qty <= 0) {
      throw new CodedBadRequestException('STOCK_QTY_MUST_BE_POSITIVE', 'qty must be positive.');
    }

    const correlationId = randomUUID();

    const outMovement = await this.applyMovement(user, {
      productId: dto.productId,
      warehouseId: dto.fromWarehouseId,
      type: 'MOVE',
      qtyDelta: -dto.qty,
      comment: dto.comment,
      sourceType: 'StockTransfer',
      sourceId: correlationId,
    });
    const inMovement = await this.applyMovement(user, {
      productId: dto.productId,
      warehouseId: dto.toWarehouseId,
      type: 'MOVE',
      qtyDelta: dto.qty,
      comment: dto.comment,
      sourceType: 'StockTransfer',
      sourceId: correlationId,
    });

    return { correlationId, out: outMovement, in: inMovement };
  }

  /**
   * Internal entry point for other modules (Production/BOM consumption,
   * Procurement receiving) — same atomicity guarantee, just without the
   * DTO validation layer, since the caller is trusted application code,
   * not raw user input.
   */
  async applyMovement(user: RequestUser, input: InternalMovementInput) {
    // WarehouseStock requires a concrete warehouse (schema: warehouseId is
    // required there, unlike on StockMovement itself, which allows null for
    // a movement not tied to a specific warehouse — Phase 3 schema note).
    // When no warehouse is given, we still ledger the movement and keep
    // Product.qty in sync, we just skip the per-warehouse allocation step.
    let qtyAfterInWarehouse: number | null = null;
    if (input.warehouseId) {
      const stock = await this.prisma.tenant.warehouseStock.upsert({
        where: {
          companyId_productId_warehouseId: {
            companyId: user.companyId,
            productId: input.productId,
            warehouseId: input.warehouseId,
          },
        },
        create: {
          productId: input.productId,
          warehouseId: input.warehouseId,
          qty: input.qtyDelta,
        } as any,
        update: { qty: { increment: input.qtyDelta } },
      });
      qtyAfterInWarehouse = Number(stock.qty);
    }

    const movement = await this.prisma.tenant.stockMovement.create({
      data: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        type: input.type,
        qtyDelta: input.qtyDelta,
        qtyAfter: qtyAfterInWarehouse ?? input.qtyDelta,
        comment: input.comment,
        actorUserId: user.userId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      } as any,
    });

    // Product.qty is a denormalized cache of SUM(warehouse_stock.qty)
    // across all warehouses (Phase 3 note on Product.qty) — kept in sync
    // here, atomically, in the same request transaction, rather than
    // computed on every read.
    await this.prisma.tenant.product.update({
      where: { id: input.productId },
      data: { qty: { increment: input.qtyDelta } },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: `stock.${input.type.toLowerCase()}`,
      entityType: 'StockMovement',
      entityId: movement.id,
      after: movement,
    });

    // Stock-reservation spec (simplified, 2026-08-19): "не вистачає для
    // резервації" transitions to "зарезервовано" the moment stock actually
    // increases — whether that's a purchase receipt or a plain manual
    // addition, both post here with a positive qtyDelta. This is the single
    // place every stock mutation in the app goes through (this file's own
    // header comment), so it's also the single place this auto-fill needs
    // to live — no separate per-caller wiring.
    if (input.warehouseId && input.qtyDelta > 0) {
      await this.stockReservationService.topUp(user, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        qtyAvailable: input.qtyDelta,
        preferredOrderId: input.preferredOrderId,
      });
    }

    return movement;
  }

  /**
   * Adds a computed `availableQty` (= qty - reservedQty, stock-reservation
   * spec §4) alongside the raw stored `qty`/`reservedQty` on every row —
   * `reservedQty` is itself a stored, atomically-maintained denormalized
   * counter (see WarehouseStock's own schema comment for why), but
   * `availableQty` is trivial arithmetic, computed fresh here rather than
   * also stored. `globalShortageQty` ("Не вистачає для резервації", red on
   * the warehouse page) is the company-wide sum of every active order's
   * outstanding need for this product — attached only to the row for the
   * actual default warehouse (where every reservation in this app lives),
   * zero elsewhere.
   */
  async getLevels(user: RequestUser, query: QueryStockDto) {
    const where: Record<string, any> = {};
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    const defaultWarehouseId = await this.resolveDefaultWarehouseId();
    const shortageByProduct = defaultWarehouseId ? await this.stockReservationService.getGlobalShortageByProduct(user, defaultWarehouseId) : new Map<string, number>();
    const shortageFor = (productId: string, warehouseId: string) => (warehouseId === defaultWarehouseId ? (shortageByProduct.get(productId) ?? 0).toString() : '0');

    const existing = (await this.prisma.tenant.warehouseStock.findMany({ where, orderBy: [{ productId: 'asc' }] })).map((s) => ({
      ...s,
      availableQty: (Number(s.qty) - Number(s.reservedQty)).toString(),
      globalShortageQty: shortageFor(s.productId, s.warehouseId),
    }));

    // A WarehouseStock row is only ever materialized reactively, by
    // recordMovement's upsert (see this file's header comment) — a product
    // that has never had a single movement (e.g. just created in Catalog)
    // has no row anywhere and would otherwise be silently absent from the
    // "all warehouses" / main-warehouse view instead of showing up with
    // qty 0. Synthesize a zero row for every such product, but ONLY for
    // that aggregate/main view — attributing it to the default warehouse.
    //
    // A specific NON-default warehouse (a satellite location, a van, a
    // showroom — anything the user created themselves) must show only
    // products that actually have a real WarehouseStock row there. Without
    // this guard, browsing any such warehouse synthesized a zero row for
    // literally every product in the whole catalog, making an empty
    // warehouse look like it held everything the main warehouse does —
    // reported directly by a user (2026-08-28): "той склад теж показує
    // все, а не тільки те, що ми туди додали."
    if (query.warehouseId && query.warehouseId !== defaultWarehouseId) {
      return existing;
    }

    const targetWarehouseId = query.warehouseId ?? defaultWarehouseId;
    if (!targetWarehouseId) return existing;

    const productWhere: Record<string, any> = { deletedAt: null };
    if (query.productId) productWhere.id = query.productId;
    const products = await this.prisma.tenant.product.findMany({ where: productWhere, select: { id: true } });

    const existingProductIds = new Set(existing.map((s) => s.productId));
    const now = new Date();
    const synthetic = products
      .filter((p) => !existingProductIds.has(p.id))
      .map((p) => ({
        id: `virtual:${p.id}:${targetWarehouseId}`,
        companyId: user.companyId,
        productId: p.id,
        warehouseId: targetWarehouseId,
        qty: '0',
        reservedQty: '0',
        availableQty: '0',
        globalShortageQty: shortageFor(p.id, targetWarehouseId),
        createdAt: now,
        updatedAt: now,
      }));

    return [...existing, ...synthetic].sort((a, b) => a.productId.localeCompare(b.productId));
  }

  private async resolveDefaultWarehouseId(): Promise<string | null> {
    const def = await this.prisma.tenant.warehouse.findFirst({ where: { deletedAt: null, isDefault: true } });
    if (def) return def.id;
    const first = await this.prisma.tenant.warehouse.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return first?.id ?? null;
  }

  async getHistory(user: RequestUser, query: QueryStockHistoryDto) {
    const where: Record<string, any> = {};
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.tenant.stockMovement.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }
}
