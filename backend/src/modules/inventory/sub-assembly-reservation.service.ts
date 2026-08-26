import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

export interface SubAssemblyReservationBreakdownLine {
  customerOrderId: string;
  orderNumber: string | null;
  clientName: string;
  qty: number;
}

/**
 * "Зі складу" claims from the order-creation "Підвироби" dialog (2026-08-27)
 * — see SubAssemblyReservation's own Prisma schema comment for the full
 * rationale. Deliberately best-effort (`reserve` is an unconditional
 * upsert, no atomic conditional-grant like StockReservationService's raw
 * materials have): the real backstop against overselling the same
 * IN_STOCK finished-goods units to two orders is
 * ProductionOrdersService#start's own availability check, which calls
 * `getReservedByOthers` to subtract every OTHER order's claim from
 * physical stock before letting a batch start.
 */
@Injectable()
export class SubAssemblyReservationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Claims `qty` of `assemblyId` for `customerOrderId` — accumulates if this order already has a claim on this assembly. */
  async reserve(user: RequestUser, customerOrderId: string, assemblyId: string, qty: number): Promise<void> {
    if (qty <= 0) return;
    await this.prisma.tenant.subAssemblyReservation.upsert({
      where: { companyId_customerOrderId_assemblyId: { companyId: user.companyId, customerOrderId, assemblyId } },
      create: { assemblyId, customerOrderId, qty, createdById: user.userId },
      update: { qty: { increment: qty } },
    } as any);
  }

  /** Shrinks (or removes) this order's claim on `assemblyId` as units are actually consumed at batch start — never goes below 0. */
  async consume(user: RequestUser, customerOrderId: string, assemblyId: string, qty: number): Promise<void> {
    if (qty <= 0) return;
    const row = await this.prisma.tenant.subAssemblyReservation.findUnique({
      where: { companyId_customerOrderId_assemblyId: { companyId: user.companyId, customerOrderId, assemblyId } },
    } as any);
    if (!row) return;
    const remaining = Math.max(0, Number((row as any).qty) - qty);
    if (remaining === 0) {
      await this.prisma.tenant.subAssemblyReservation.delete({ where: { id: (row as any).id } });
    } else {
      await this.prisma.tenant.subAssemblyReservation.update({ where: { id: (row as any).id }, data: { qty: remaining } });
    }
  }

  /** Every claim this order holds, released in full — order cancel (CustomerOrdersService#cancel); order delete cascades on its own. */
  async releaseAllForOrder(user: RequestUser, customerOrderId: string): Promise<void> {
    await this.prisma.tenant.subAssemblyReservation.deleteMany({ where: { customerOrderId } });
  }

  /** Sum of every OTHER order's active claim on this assembly — what a new order's own dialog, or a batch's own start(), must treat as unavailable. */
  async getReservedByOthers(user: RequestUser, assemblyId: string, excludeCustomerOrderId?: string): Promise<number> {
    const rows = await this.prisma.tenant.subAssemblyReservation.findMany({
      where: { assemblyId, ...(excludeCustomerOrderId ? { customerOrderId: { not: excludeCustomerOrderId } } : {}) },
    } as any);
    return rows.reduce((sum, r) => sum + Number((r as any).qty), 0);
  }

  /** Per-order breakdown of every claim on this assembly, for the "Підвироби" dialog's "заброньовано для замовлень" display. */
  async getBreakdown(user: RequestUser, assemblyId: string, excludeCustomerOrderId?: string): Promise<SubAssemblyReservationBreakdownLine[]> {
    const rows = await this.prisma.tenant.subAssemblyReservation.findMany({
      where: { assemblyId, qty: { gt: 0 }, ...(excludeCustomerOrderId ? { customerOrderId: { not: excludeCustomerOrderId } } : {}) },
      orderBy: { createdAt: 'asc' },
    } as any);
    if (rows.length === 0) return [];
    const orderIds = Array.from(new Set(rows.map((r) => (r as any).customerOrderId)));
    const orders = await this.prisma.tenant.customerOrder.findMany({ where: { id: { in: orderIds } } });
    const orderById = new Map(orders.map((o: any) => [o.id, o]));
    return rows.map((r: any) => ({
      customerOrderId: r.customerOrderId,
      orderNumber: orderById.get(r.customerOrderId)?.orderNumber ?? null,
      clientName: orderById.get(r.customerOrderId)?.clientName ?? r.customerOrderId,
      qty: Number(r.qty),
    }));
  }
}
