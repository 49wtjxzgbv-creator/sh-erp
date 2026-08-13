import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { QueryOperationsTimelineDto } from './dto/operations-timeline.dto';

export type TimelineStage = 'planned' | 'in_progress' | 'completed';

export interface TimelineLine {
  id: string;
  label: string;
  groupName: string;
  stage: TimelineStage;
  startAt: Date;
  endAt: Date;
}

/**
 * Backs the dashboard's unified operations Gantt chart — one printable
 * view spanning three otherwise-separate lifecycles: purchase orders (to
 * suppliers), production orders, and shipments (to customers). Each
 * module's own detail pages remain the source of truth; this is a
 * read-only rollup, computed the same "fetch broadly, derive fallback
 * dates/status in application code" way as
 * ProductionScheduleService#getSchedule — not reused directly from there
 * (deliberately not importing ProductionModule: every module here stays
 * independent, per company.service.ts's own header comment on that
 * principle), just the same judgment call applied a second time.
 *
 * Stage mapping (`planned` / `in_progress` / `completed` — the vocabulary
 * the dashboard chart's legend uses, shared across all three lines even
 * though the underlying enums differ per module):
 * - PurchaseOrder: ORDERED → planned (placed, nothing received yet),
 *   PARTIAL → in_progress, DELIVERED → completed. There is no receipt
 *   timestamp anywhere in the schema (see purchase-orders.service.ts —
 *   status is derived purely from qtyReceived vs qtyOrdered), so a
 *   DELIVERED order's bar still ends at its (expected) delivery date, not
 *   an actual one — a known, documented approximation.
 * - ProductionOrder: PLANNED → planned, IN_PROGRESS → in_progress,
 *   COMPLETED → completed (CANCELLED excluded entirely).
 * - Shipment: has no "planned" state at all in this schema — a Shipment
 *   row doesn't exist until it's created as SHIPPED — so only in_progress
 *   (SHIPPED) and completed (DELIVERED) ever appear; an undelivered
 *   shipment's bar is drawn open-ended, up to "now" (or `to`, whichever is
 *   earlier), so it visibly reads as "still in transit" rather than
 *   silently stopping at `shipDate`.
 */
@Injectable()
export class DashboardTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  async getOperationsTimeline(user: RequestUser, query: QueryOperationsTimelineDto) {
    const now = new Date();
    const from = query.from ?? new Date(now.getFullYear(), 0, 1);
    const to = query.to ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const [purchaseOrders, productionOrders, shipments] = await Promise.all([
      this.prisma.tenant.purchaseOrder.findMany({ include: { supplier: true } }),
      this.prisma.tenant.productionOrder.findMany({ where: { status: { not: 'CANCELLED' } } }),
      this.prisma.tenant.shipment.findMany({ include: { customerOrder: true } }),
    ]);

    const assemblyIds = new Set<string>();
    for (const o of productionOrders as any[]) assemblyIds.add(o.assemblyId);
    const assemblies = assemblyIds.size
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: Array.from(assemblyIds) } } })
      : [];
    const assemblyNameById = new Map<string, string>();
    for (const a of assemblies as any[]) assemblyNameById.set(a.id, a.name);

    const purchaseOrderLines: TimelineLine[] = (purchaseOrders as any[])
      .map((po) => {
        const stage: TimelineStage = po.status === 'DELIVERED' ? 'completed' : po.status === 'PARTIAL' ? 'in_progress' : 'planned';
        const startAt: Date = po.orderDate;
        const endAt: Date = po.expectedDeliveryDate ?? po.supplierConfirmedDeliveryDate ?? po.orderDate;
        const groupName: string = po.supplier?.name ?? po.supplierNameSnapshot;
        return { id: po.id, label: groupName, groupName, stage, startAt, endAt: endAt < startAt ? startAt : endAt };
      })
      .filter((l) => l.startAt <= to && l.endAt >= from);

    const productionLines: TimelineLine[] = (productionOrders as any[])
      .map((o) => {
        const stage: TimelineStage = o.status === 'COMPLETED' ? 'completed' : o.status === 'IN_PROGRESS' ? 'in_progress' : 'planned';
        const startAt: Date = o.scheduledStartAt ?? o.createdAt;
        const endAt: Date = o.scheduledEndAt ?? o.completedAt ?? o.createdAt;
        const groupName = assemblyNameById.get(o.assemblyId) ?? o.assemblyId;
        return { id: o.id, label: `${groupName} (${Number(o.unitsPlanned)})`, groupName, stage, startAt, endAt: endAt < startAt ? startAt : endAt };
      })
      .filter((l) => l.startAt <= to && l.endAt >= from);

    const cappedNow = now < to ? now : to;
    const shipmentLines: TimelineLine[] = (shipments as any[])
      .map((s) => {
        const stage: TimelineStage = s.status === 'DELIVERED' ? 'completed' : 'in_progress';
        const startAt: Date = s.shipDate ?? s.createdAt;
        const endAt: Date = s.deliveryDate ?? cappedNow;
        const groupName: string = s.customerOrder?.clientName ?? s.waybillNumber ?? s.id;
        return { id: s.id, label: groupName, groupName, stage, startAt, endAt: endAt < startAt ? startAt : endAt };
      })
      .filter((l) => l.startAt <= to && l.endAt >= from);

    return { from, to, purchaseOrders: purchaseOrderLines, productionOrders: productionLines, shipments: shipmentLines };
  }
}
