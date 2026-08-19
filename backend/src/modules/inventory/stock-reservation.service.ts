import { Injectable } from '@nestjs/common';
import { Prisma, StockReservationSource } from '@prisma/client';
import { CodedConflictException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ReservationTarget {
  productId: string;
  warehouseId: string;
  customerOrderId: string;
  customerOrderItemId: string;
  source: StockReservationSource;
}

export interface ReservationGrant {
  /** How much was actually reserved by this call — may be less than requested when capped against available stock (§8: a supplier delivering more than needed never over-reserves). */
  grantedQty: number;
  /** requested - granted. Zero for a fully-satisfied request. */
  shortfallQty: number;
}

export interface AvailabilitySummary {
  physical: number;
  reserved: number;
  available: number;
}

export interface ReservationBreakdownLine {
  customerOrderId: string;
  customerOrderItemId: string;
  orderNumber: string | null;
  clientName: string;
  source: StockReservationSource;
  qty: number;
}

/**
 * Owns the ONE hard invariant the 2026-08-19 stock-reservation spec (§16)
 * requires under concurrency: total ACTIVE reservations against a
 * (product, warehouse) must never exceed its physical stock. Every method
 * here that grows a reservation goes through `grantReservation`'s single
 * atomic conditional UPDATE — never a "read available, compute in JS,
 * write back" round trip, which would reopen the exact lost-update race
 * `StockService#applyMovement`'s own header comment already documents
 * avoiding for physical stock. Every request already runs inside one
 * Postgres transaction (TenantScopeInterceptor), so this atomic UPDATE's
 * implicit row lock is what actually serializes two concurrent requests
 * trying to reserve the same stock — the second one simply sees the
 * first's committed `reservedQty` once it can proceed.
 *
 * Deliberately lives in InventoryModule (not SalesModule, which owns the
 * order-facing orchestration in MaterialProvisioningService) because
 * ProcurementModule and ProductionModule both already depend on
 * InventoryModule for StockService — reservation mechanics needed to be
 * reachable from all three (Sales/Procurement/Production) without
 * introducing a new module-dependency cycle. See stock-reservations spec
 * report for the full module-graph reasoning.
 */
@Injectable()
export class StockReservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getAvailability(user: RequestUser, productId: string, warehouseId: string): Promise<AvailabilitySummary> {
    const stock = await this.prisma.tenant.warehouseStock.findUnique({
      where: { companyId_productId_warehouseId: { companyId: user.companyId, productId, warehouseId } },
    });
    const physical = Number(stock?.qty ?? 0);
    const reserved = Number(stock?.reservedQty ?? 0);
    return { physical, reserved, available: physical - reserved };
  }

  /** Sum of this specific order line's own active reservations (both sources) against a product/warehouse — what §4/§12 call "Зарезервовано під це замовлення." */
  async getReservedForOrderItem(user: RequestUser, customerOrderItemId: string, productId: string, warehouseId: string): Promise<{ fromStock: number; fromPurchase: number }> {
    const rows = await this.prisma.tenant.stockReservation.findMany({
      where: { customerOrderItemId, productId, warehouseId },
    });
    let fromStock = 0;
    let fromPurchase = 0;
    for (const r of rows) {
      if (r.source === 'STOCK') fromStock += Number(r.qty);
      else fromPurchase += Number(r.qty);
    }
    return { fromStock, fromPurchase };
  }

  /** §17 drill-down: "Зарезервовано: 65" → №1001 — 20, №1002 — 30, ... — every ACTIVE reservation against this (product, warehouse), joined with the order it belongs to. */
  async getBreakdown(user: RequestUser, productId: string, warehouseId: string): Promise<ReservationBreakdownLine[]> {
    const rows = await this.prisma.tenant.stockReservation.findMany({
      where: { productId, warehouseId, qty: { gt: 0 } },
      orderBy: { createdAt: 'asc' },
    });
    if (rows.length === 0) return [];
    const orderIds = Array.from(new Set(rows.map((r) => r.customerOrderId)));
    const orders = await this.prisma.tenant.customerOrder.findMany({ where: { id: { in: orderIds } } });
    const orderById = new Map(orders.map((o) => [o.id, o]));
    return rows.map((r) => ({
      customerOrderId: r.customerOrderId,
      customerOrderItemId: r.customerOrderItemId,
      orderNumber: orderById.get(r.customerOrderId)?.orderNumber ?? null,
      clientName: orderById.get(r.customerOrderId)?.clientName ?? r.customerOrderId,
      source: r.source,
      qty: Number(r.qty),
    }));
  }

  /**
   * The one atomic primitive every reservation-growth path funnels through.
   * Grants up to `requestedQty` against whatever is currently available
   * (physical - already-reserved), in a single conditional UPDATE — never
   * more than that, and never blocks: a request for more than what's
   * available simply comes back with a smaller `grantedQty` and a nonzero
   * `shortfallQty` for the caller to act on (throw for a strict caller,
   * silently accept the cap for a receiving caller — see `reserveFromStock`
   * vs `reserveFromReceipt` below).
   */
  private async grantReservation(user: RequestUser, target: ReservationTarget, requestedQty: number): Promise<ReservationGrant> {
    if (requestedQty <= 0) return { grantedQty: 0, shortfallQty: 0 };

    const rows = await this.prisma.tenant.$queryRaw<Array<{ reservedQtyBefore: Prisma.Decimal; reservedQtyAfter: Prisma.Decimal }>>(
      Prisma.sql`
        WITH locked AS (
          SELECT "reservedQty", qty
          FROM warehouse_stock
          WHERE "companyId" = ${user.companyId}::uuid AND "productId" = ${target.productId}::uuid AND "warehouseId" = ${target.warehouseId}::uuid
          FOR UPDATE
        )
        UPDATE warehouse_stock
        SET "reservedQty" = warehouse_stock."reservedQty" + LEAST(${requestedQty}::decimal(14,3), GREATEST(locked.qty - locked."reservedQty", 0)),
            "updatedAt" = now()
        FROM locked
        WHERE warehouse_stock."companyId" = ${user.companyId}::uuid AND warehouse_stock."productId" = ${target.productId}::uuid AND warehouse_stock."warehouseId" = ${target.warehouseId}::uuid
        RETURNING locked."reservedQty" AS "reservedQtyBefore", warehouse_stock."reservedQty" AS "reservedQtyAfter"
      `,
    );

    const grantedQty = rows.length > 0 ? Number(rows[0].reservedQtyAfter) - Number(rows[0].reservedQtyBefore) : 0;
    const shortfallQty = requestedQty - grantedQty;
    if (grantedQty <= 0) return { grantedQty: 0, shortfallQty: requestedQty };

    await this.prisma.tenant.stockReservation.upsert({
      where: {
        customerOrderItemId_productId_warehouseId_source: {
          customerOrderItemId: target.customerOrderItemId,
          productId: target.productId,
          warehouseId: target.warehouseId,
          source: target.source,
        },
      },
      create: {
        productId: target.productId,
        warehouseId: target.warehouseId,
        customerOrderId: target.customerOrderId,
        customerOrderItemId: target.customerOrderItemId,
        source: target.source,
        qty: grantedQty,
        createdById: user.userId,
      } as any,
      update: { qty: { increment: grantedQty } },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'stock_reservation.granted',
      entityType: 'StockReservation',
      entityId: target.customerOrderItemId,
      after: { ...target, requestedQty, grantedQty, shortfallQty },
    });

    return { grantedQty, shortfallQty };
  }

  /**
   * §2/§3: the user explicitly chose to take `qty` from existing physical
   * stock for this order line — strict, throws if the full amount isn't
   * available (§16: the backend must validate, not just trust the
   * frontend). `extra.available` lets the caller show the real number in
   * the error rather than a generic message.
   */
  async reserveFromStock(user: RequestUser, target: Omit<ReservationTarget, 'source'>, qty: number): Promise<ReservationGrant> {
    const grant = await this.grantReservation(user, { ...target, source: 'STOCK' }, qty);
    if (grant.shortfallQty > 0) {
      const availability = await this.getAvailability(user, target.productId, target.warehouseId);
      throw new CodedConflictException(
        'STOCK_RESERVATION_INSUFFICIENT_AVAILABLE',
        `Only ${availability.available} unit(s) available to reserve, ${qty} requested.`,
        { available: availability.available, requested: qty, granted: grant.grantedQty },
      );
    }
    return grant;
  }

  /**
   * §6/§7/§8: a receipt landed against a purchase line linked to this order
   * requirement. Never throws — capped to whatever is actually available
   * right now (in practice always the full `qty` just received, since
   * receiving physically increases stock in the same request just before
   * this call), and the caller (PurchaseOrdersService#receive) is expected
   * to have ALSO capped `qty` to the requirement's own outstanding
   * uncovered need before calling this — this method only enforces the
   * physical-stock invariant, not the "don't over-reserve past what this
   * order actually still needs" business rule, which is a different,
   * requirement-level concern.
   */
  async reserveFromReceipt(user: RequestUser, target: Omit<ReservationTarget, 'source'>, qty: number): Promise<ReservationGrant> {
    return this.grantReservation(user, { ...target, source: 'PURCHASE' }, qty);
  }

  /**
   * §15: an order was cancelled, or otherwise no longer needs material it
   * had reserved — release `qty` back to general availability. Physical
   * stock is untouched (§3: reserved material never left the warehouse).
   * Clamped to whatever this reservation still actively holds — releasing
   * more than that is a caller bug, not a state this method should ever
   * silently invent negative numbers for.
   */
  async release(user: RequestUser, target: ReservationTarget, qty: number): Promise<number> {
    if (qty <= 0) return 0;
    const reservation = await this.prisma.tenant.stockReservation.findUnique({
      where: {
        customerOrderItemId_productId_warehouseId_source: {
          customerOrderItemId: target.customerOrderItemId,
          productId: target.productId,
          warehouseId: target.warehouseId,
          source: target.source,
        },
      },
    });
    if (!reservation) return 0;
    const actualQty = Math.min(qty, Number(reservation.qty));
    if (actualQty <= 0) return 0;

    await this.prisma.tenant.$executeRaw(
      Prisma.sql`
        UPDATE warehouse_stock
        SET "reservedQty" = GREATEST("reservedQty" - ${actualQty}::decimal(14,3), 0), "updatedAt" = now()
        WHERE "companyId" = ${user.companyId}::uuid AND "productId" = ${target.productId}::uuid AND "warehouseId" = ${target.warehouseId}::uuid
      `,
    );
    await this.prisma.tenant.stockReservation.update({
      where: { id: reservation.id },
      data: { qty: { decrement: actualQty }, releasedQty: { increment: actualQty } },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'stock_reservation.released',
      entityType: 'StockReservation',
      entityId: reservation.id,
      after: { ...target, releasedQty: actualQty },
    });

    return actualQty;
  }

  /** Every active (qty > 0) reservation on this order line, both sources — used by CustomerOrdersService#cancel (§15). */
  async releaseAllForOrderItem(user: RequestUser, customerOrderItemId: string): Promise<void> {
    const rows = await this.prisma.tenant.stockReservation.findMany({
      where: { customerOrderItemId, qty: { gt: 0 } },
    });
    for (const r of rows) {
      await this.release(
        user,
        { productId: r.productId, warehouseId: r.warehouseId, customerOrderId: r.customerOrderId, customerOrderItemId: r.customerOrderItemId, source: r.source },
        Number(r.qty),
      );
    }
  }

  /**
   * §14: material actually leaves the warehouse for production. This ONLY
   * closes out the hold (reservedQty/StockReservation.qty) — the physical
   * decrement is a separate, already-existing StockMovement
   * (PRODUCTION_CONSUMPTION) posted by the caller
   * (ProductionOrdersService#start) through StockService, same ledger every
   * other stock mutation goes through. Clamped to what's actually held,
   * same reasoning as `release`.
   */
  async consume(user: RequestUser, target: ReservationTarget, qty: number): Promise<number> {
    if (qty <= 0) return 0;
    const reservation = await this.prisma.tenant.stockReservation.findUnique({
      where: {
        customerOrderItemId_productId_warehouseId_source: {
          customerOrderItemId: target.customerOrderItemId,
          productId: target.productId,
          warehouseId: target.warehouseId,
          source: target.source,
        },
      },
    });
    if (!reservation) return 0;
    const actualQty = Math.min(qty, Number(reservation.qty));
    if (actualQty <= 0) return 0;

    await this.prisma.tenant.$executeRaw(
      Prisma.sql`
        UPDATE warehouse_stock
        SET "reservedQty" = GREATEST("reservedQty" - ${actualQty}::decimal(14,3), 0), "updatedAt" = now()
        WHERE "companyId" = ${user.companyId}::uuid AND "productId" = ${target.productId}::uuid AND "warehouseId" = ${target.warehouseId}::uuid
      `,
    );
    await this.prisma.tenant.stockReservation.update({
      where: { id: reservation.id },
      data: { qty: { decrement: actualQty }, consumedQty: { increment: actualQty } },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'stock_reservation.consumed',
      entityType: 'StockReservation',
      entityId: reservation.id,
      after: { ...target, consumedQty: actualQty },
    });

    return actualQty;
  }
}
