import { Injectable } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { MoveStockDto, QueryStockDto, QueryStockHistoryDto, RecordStockMovementDto } from './dto/stock-movement.dto';

export interface InternalMovementInput {
  productId: string;
  warehouseId: string | null;
  type: StockMovementType;
  qtyDelta: number;
  comment?: string;
  sourceType?: string;
  sourceId?: string;
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

    return movement;
  }

  /**
   * Adds a computed `availableQty` (= qty - reservedQty, stock-reservation
   * spec §4/§17) alongside the raw stored `qty`/`reservedQty` on every row —
   * `reservedQty` is itself a stored, atomically-maintained denormalized
   * counter (see WarehouseStock's own schema comment for why), but
   * `availableQty` is trivial arithmetic, computed fresh here rather than
   * also stored.
   */
  async getLevels(user: RequestUser, query: QueryStockDto) {
    const where: Record<string, any> = {};
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    const existing = (await this.prisma.tenant.warehouseStock.findMany({ where, orderBy: [{ productId: 'asc' }] })).map((s) => ({
      ...s,
      availableQty: (Number(s.qty) - Number(s.reservedQty)).toString(),
    }));

    // A WarehouseStock row is only ever materialized reactively, by
    // recordMovement's upsert (see this file's header comment) — a product
    // that has never had a single movement (e.g. just created in Catalog)
    // has no row anywhere and would otherwise be silently absent from this
    // list instead of showing up with qty 0. Synthesize a zero row for
    // every such product, attributed to whichever warehouse is being
    // browsed (the explicit filter, or the company's default warehouse
    // when browsing "all warehouses").
    const targetWarehouseId = query.warehouseId ?? (await this.resolveDefaultWarehouseId());
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
