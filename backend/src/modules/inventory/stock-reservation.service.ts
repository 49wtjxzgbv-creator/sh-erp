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
  source: StockReservationSource;
}

export interface ReservationGrant {
  /** How much was actually reserved by this call — may be less than requested when capped against available stock. */
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
  orderNumber: string | null;
  clientName: string;
  source: StockReservationSource;
  qty: number;
}

export interface ShortageBreakdownLine {
  customerOrderId: string;
  orderNumber: string | null;
  clientName: string;
  /** requiredQty - covered for this order+product, always > 0 (fully-covered orders are omitted). */
  outstandingQty: number;
}

const ACTIVE_ORDER_STATUSES = ['NEW', 'IN_PRODUCTION'] as const;

/**
 * Owns the ONE hard invariant the stock-reservation feature requires under
 * concurrency: total ACTIVE reservations against a (product, warehouse)
 * must never exceed its physical stock — enforced by `grantReservation`'s
 * single atomic conditional UPDATE, never a "read available, compute in JS,
 * write back" round trip (see WarehouseStock.reservedQty's own schema
 * comment for why that would reopen a lost-update race).
 *
 * 2026-08-19 simplification pass: reservations are ORDER-level (one shared
 * pool per product per order), not per line — matching how the shortage
 * engine (customer-order-shortage.service.ts) has always treated a whole
 * order as one pool, and matching the simplified UI, which now lives on the
 * existing "Аналіз дефіциту" page. Two entry points create/grow a
 * reservation: (1) order creation auto-reserves whatever's available
 * (`reserveCapped`, source=STOCK), and the "Забронювати зі складу" button
 * adjusts it; (2) ANY stock increase (a receipt or a plain manual addition)
 * runs `topUp`, which fills outstanding order demand for that product —
 * targeting a specific order first if the movement is linked to one, then
 * whichever other active order has been waiting longest.
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

  /** Sum of this order's own active reservations (both sources) against a product/warehouse — "Зарезервовано" on the shortage-analysis page. */
  async getReservedForOrder(user: RequestUser, customerOrderId: string, productId: string, warehouseId: string): Promise<{ fromStock: number; fromPurchase: number }> {
    const rows = await this.prisma.tenant.stockReservation.findMany({ where: { customerOrderId, productId, warehouseId } });
    let fromStock = 0;
    let fromPurchase = 0;
    for (const r of rows) {
      if (r.source === 'STOCK') fromStock += Number(r.qty);
      else fromPurchase += Number(r.qty);
    }
    return { fromStock, fromPurchase };
  }

  /** Warehouse page drill-down: every ACTIVE reservation against this (product, warehouse), joined with the order it belongs to. */
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
      orderNumber: orderById.get(r.customerOrderId)?.orderNumber ?? null,
      clientName: orderById.get(r.customerOrderId)?.clientName ?? r.customerOrderId,
      source: r.source,
      qty: Number(r.qty),
    }));
  }

  /**
   * Company-wide, per-product outstanding demand across every active order
   * — "Не вистачає для резервації" on the warehouse page. `requiredQty` is
   * the locked-at-creation snapshot on OrderMaterialRequirement; "covered"
   * is the real, live reservation state (qty still held + already
   * consumed), so this never drifts from what's actually true even if a
   * reservation was later edited or partially issued to production.
   */
  async getGlobalShortageByProduct(user: RequestUser, warehouseId: string): Promise<Map<string, number>> {
    const requirements = await this.prisma.tenant.orderMaterialRequirement.findMany({
      where: { customerOrder: { status: { in: [...ACTIVE_ORDER_STATUSES] } } },
      select: { customerOrderId: true, productId: true, requiredQty: true },
    });
    if (requirements.length === 0) return new Map();

    const orderIds = Array.from(new Set(requirements.map((r) => r.customerOrderId)));
    const reservations = await this.prisma.tenant.stockReservation.findMany({
      where: { customerOrderId: { in: orderIds }, warehouseId },
      select: { customerOrderId: true, productId: true, qty: true, consumedQty: true },
    });
    const coveredByKey = new Map<string, number>();
    for (const r of reservations) {
      const key = `${r.customerOrderId}:${r.productId}`;
      coveredByKey.set(key, (coveredByKey.get(key) ?? 0) + Number(r.qty) + Number(r.consumedQty));
    }

    const shortageByProduct = new Map<string, number>();
    for (const req of requirements) {
      const key = `${req.customerOrderId}:${req.productId}`;
      const covered = coveredByKey.get(key) ?? 0;
      const outstanding = Math.max(Number(req.requiredQty) - covered, 0);
      if (outstanding > 0) {
        shortageByProduct.set(req.productId, (shortageByProduct.get(req.productId) ?? 0) + outstanding);
      }
    }
    return shortageByProduct;
  }

  /**
   * §17-style drill-down for the RED "Не вистачає для резервації" number —
   * clicking it shows exactly which orders are short and by how much, same
   * shape as `getBreakdown`'s "Зарезервовано" drill-down but for
   * uncovered demand instead of held reservations. Scoped to ONE product
   * (unlike `getGlobalShortageByProduct`, which aggregates across every
   * product for the whole warehouse page in one query) — this runs only
   * when a user actually opens the popover for one cell.
   */
  async getShortageBreakdown(user: RequestUser, productId: string, warehouseId: string): Promise<ShortageBreakdownLine[]> {
    const requirements = await this.prisma.tenant.orderMaterialRequirement.findMany({
      where: { productId, customerOrder: { status: { in: [...ACTIVE_ORDER_STATUSES] } } },
    });
    if (requirements.length === 0) return [];

    const orderIds = Array.from(new Set(requirements.map((r) => r.customerOrderId)));
    const [reservations, orders] = await Promise.all([
      this.prisma.tenant.stockReservation.findMany({ where: { customerOrderId: { in: orderIds }, productId, warehouseId } }),
      this.prisma.tenant.customerOrder.findMany({ where: { id: { in: orderIds } } }),
    ]);
    const coveredByOrder = new Map<string, number>();
    for (const r of reservations) {
      coveredByOrder.set(r.customerOrderId, (coveredByOrder.get(r.customerOrderId) ?? 0) + Number(r.qty) + Number(r.consumedQty));
    }
    const orderById = new Map(orders.map((o) => [o.id, o]));

    const lines: ShortageBreakdownLine[] = [];
    for (const req of requirements) {
      const covered = coveredByOrder.get(req.customerOrderId) ?? 0;
      const outstandingQty = Math.max(Number(req.requiredQty) - covered, 0);
      if (outstandingQty > 0) {
        lines.push({
          customerOrderId: req.customerOrderId,
          orderNumber: orderById.get(req.customerOrderId)?.orderNumber ?? null,
          clientName: orderById.get(req.customerOrderId)?.clientName ?? req.customerOrderId,
          outstandingQty,
        });
      }
    }
    return lines;
  }

  /**
   * The one atomic primitive every reservation-growth path funnels through.
   * Grants up to `requestedQty` against whatever is currently available
   * (physical - already-reserved), in a single conditional UPDATE — a
   * request for more than what's available simply comes back with a
   * smaller `grantedQty` and a nonzero `shortfallQty` for the caller to act
   * on (throw for a strict caller, silently accept the cap otherwise).
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
        customerOrderId_productId_warehouseId_source: {
          customerOrderId: target.customerOrderId,
          productId: target.productId,
          warehouseId: target.warehouseId,
          source: target.source,
        },
      },
      create: {
        productId: target.productId,
        warehouseId: target.warehouseId,
        customerOrderId: target.customerOrderId,
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
      entityId: target.customerOrderId,
      after: { ...target, requestedQty, grantedQty, shortfallQty },
    });

    return { grantedQty, shortfallQty };
  }

  /** Strict — throws if the full amount isn't available. Used by the explicit "Забронювати зі складу" action, where the user gets immediate feedback on a shortfall. */
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

  /** Capped, never throws — used for order-creation's automatic default reservation (§ simplified spec: reserve whatever's on hand, no user decision required). */
  async reserveCapped(user: RequestUser, target: ReservationTarget, qty: number): Promise<ReservationGrant> {
    return this.grantReservation(user, target, qty);
  }

  /**
   * A physical stock increase (receipt or manual addition) landed — fill
   * outstanding order demand for this product. `preferredOrderId` (set when
   * the movement is traceable to a specific order, e.g. a purchase created
   * via "Надіслати заявку постачальнику") is topped up FIRST; any remainder
   * (or the whole amount, if there's no preferred order) fills whichever
   * other active order has been waiting longest — never more than each
   * order's own outstanding need, so a delivery larger than what's owed
   * simply leaves the rest as ordinary free stock.
   */
  async topUp(user: RequestUser, input: { productId: string; warehouseId: string; qtyAvailable: number; preferredOrderId?: string }): Promise<number> {
    let remaining = input.qtyAvailable;
    if (remaining <= 0) return 0;

    if (input.preferredOrderId) {
      const outstanding = await this.getOutstandingForOrder(user, input.preferredOrderId, input.productId, input.warehouseId);
      if (outstanding > 0) {
        const grant = await this.reserveCapped(
          user,
          { productId: input.productId, warehouseId: input.warehouseId, customerOrderId: input.preferredOrderId, source: 'PURCHASE' },
          Math.min(remaining, outstanding),
        );
        remaining -= grant.grantedQty;
      }
    }
    if (remaining <= 0) return 0;

    const requirements = await this.prisma.tenant.orderMaterialRequirement.findMany({
      where: {
        productId: input.productId,
        customerOrderId: input.preferredOrderId ? { not: input.preferredOrderId } : undefined,
        customerOrder: { status: { in: [...ACTIVE_ORDER_STATUSES] } },
      },
      include: { customerOrder: { select: { createdAt: true } } },
    });
    requirements.sort((a, b) => a.customerOrder.createdAt.getTime() - b.customerOrder.createdAt.getTime());

    for (const req of requirements) {
      if (remaining <= 0) break;
      const outstanding = await this.getOutstandingForOrder(user, req.customerOrderId, input.productId, input.warehouseId);
      if (outstanding <= 0) continue;
      const grant = await this.reserveCapped(
        user,
        { productId: input.productId, warehouseId: input.warehouseId, customerOrderId: req.customerOrderId, source: 'PURCHASE' },
        Math.min(remaining, outstanding),
      );
      remaining -= grant.grantedQty;
    }
    return remaining;
  }

  private async getOutstandingForOrder(user: RequestUser, customerOrderId: string, productId: string, warehouseId: string): Promise<number> {
    const requirement = await this.prisma.tenant.orderMaterialRequirement.findUnique({
      where: { customerOrderId_productId: { customerOrderId, productId } },
    });
    if (!requirement) return 0;
    const { fromStock, fromPurchase } = await this.getReservedForOrder(user, customerOrderId, productId, warehouseId);
    const consumed = await this.prisma.tenant.stockReservation.aggregate({
      where: { customerOrderId, productId, warehouseId },
      _sum: { consumedQty: true },
    });
    const covered = fromStock + fromPurchase + Number(consumed._sum.consumedQty ?? 0);
    return Math.max(Number(requirement.requiredQty) - covered, 0);
  }

  /** §15-equivalent: release `qty` back to general availability. Physical stock is untouched. Clamped to what this order's reservation still actively holds. */
  async release(user: RequestUser, target: ReservationTarget, qty: number): Promise<number> {
    if (qty <= 0) return 0;
    const reservation = await this.prisma.tenant.stockReservation.findUnique({
      where: {
        customerOrderId_productId_warehouseId_source: {
          customerOrderId: target.customerOrderId,
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

  /** Every active (qty > 0) reservation on this order, both sources — used by CustomerOrdersService#cancel. */
  async releaseAllForOrder(user: RequestUser, customerOrderId: string): Promise<void> {
    const rows = await this.prisma.tenant.stockReservation.findMany({ where: { customerOrderId, qty: { gt: 0 } } });
    for (const r of rows) {
      await this.release(user, { productId: r.productId, warehouseId: r.warehouseId, customerOrderId: r.customerOrderId, source: r.source }, Number(r.qty));
    }
  }

  /**
   * Material actually leaves the warehouse for production. This ONLY
   * closes out the hold — the physical decrement is a separate,
   * already-existing StockMovement (PRODUCTION_CONSUMPTION) posted by the
   * caller through StockService. Clamped to what's actually held.
   */
  async consume(user: RequestUser, target: ReservationTarget, qty: number): Promise<number> {
    if (qty <= 0) return 0;
    const reservation = await this.prisma.tenant.stockReservation.findUnique({
      where: {
        customerOrderId_productId_warehouseId_source: {
          customerOrderId: target.customerOrderId,
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
