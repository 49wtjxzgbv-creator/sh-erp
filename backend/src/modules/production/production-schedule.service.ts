import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryProductionScheduleDto } from './dto/production-schedule-slot.dto';

export interface ScheduledOrderLine {
  id: string;
  assemblyName: string;
  status: string;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  unitsPlanned: number;
}

export interface ScheduleSlotLine {
  id: string;
  assemblyId: string | null;
  assemblyName: string | null;
  title: string;
  startAt: Date;
  endAt: Date;
  plannedUnits: number | null;
}

/**
 * Read side of the schedule — unifies real ProductionOrders (visualized)
 * with not-yet-converted ProductionScheduleSlots (forward-planned), per
 * the two-part request ("візуалізація вже створених замовлень" +
 * "інструмент планування наперед"). An order without explicit
 * scheduledStartAt/scheduledEndAt falls back to createdAt/completedAt (or
 * just createdAt if not yet completed) — most existing orders never got a
 * schedule window, and the timeline still needs *something* to place them
 * at.
 *
 * Fetches broadly then filters/computes fallback dates in application
 * code rather than trying to express the OR-with-null-fallback condition
 * in Prisma's query builder — same "not worth perfect SQL for a small
 * dataset" judgment as ReportsService#getReorderSuggestions.
 */
@Injectable()
export class ProductionScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  async getSchedule(user: RequestUser, query: QueryProductionScheduleDto): Promise<{ orders: ScheduledOrderLine[]; slots: ScheduleSlotLine[] }> {
    const now = new Date();
    const from = query.from ?? new Date(now.getFullYear(), 0, 1);
    const to = query.to ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const [orders, slots] = await Promise.all([
      this.prisma.tenant.productionOrder.findMany({ where: { status: { not: 'CANCELLED' } } }),
      this.prisma.tenant.productionScheduleSlot.findMany({ where: { convertedToProductionOrderId: null } }),
    ]);

    const assemblyIds = new Set<string>();
    for (const o of orders as any[]) assemblyIds.add(o.assemblyId);
    for (const s of slots as any[]) if (s.assemblyId) assemblyIds.add(s.assemblyId);

    const assemblies = assemblyIds.size
      ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: Array.from(assemblyIds) } } })
      : [];
    const assemblyNameById = new Map<string, string>();
    for (const a of assemblies as any[]) assemblyNameById.set(a.id, a.name);

    const orderRows: ScheduledOrderLine[] = (orders as any[])
      .map((o) => ({
        id: o.id,
        assemblyName: assemblyNameById.get(o.assemblyId) ?? o.assemblyId,
        status: o.status,
        scheduledStartAt: o.scheduledStartAt ?? o.createdAt,
        scheduledEndAt: o.scheduledEndAt ?? o.completedAt ?? o.createdAt,
        unitsPlanned: Number(o.unitsPlanned),
      }))
      .filter((o) => o.scheduledStartAt <= to && o.scheduledEndAt >= from);

    const slotRows: ScheduleSlotLine[] = (slots as any[])
      .map((s) => ({
        id: s.id,
        assemblyId: s.assemblyId ?? null,
        assemblyName: s.assemblyId ? (assemblyNameById.get(s.assemblyId) ?? s.assemblyId) : null,
        title: s.title,
        startAt: s.startAt,
        endAt: s.endAt,
        plannedUnits: s.plannedUnits != null ? Number(s.plannedUnits) : null,
      }))
      .filter((s) => s.startAt <= to && s.endAt >= from);

    return { orders: orderRows, slots: slotRows };
  }
}
