import { Injectable } from '@nestjs/common';

export type PlannerProblemSeverity = 'critical' | 'warning' | 'info';

export interface PlannerProblem {
  severity: PlannerProblemSeverity;
  code: string;
  message: string;
  entityType: 'CustomerOrder' | 'CustomerOrderItem' | 'ProductionOrder' | 'PurchaseOrder' | 'FinishedGood' | 'Employee';
  entityId: string;
  orderId: string;
}

interface BomLine {
  componentType: 'PRODUCT' | 'ASSEMBLY';
  productId: string | null;
  subAssemblyId: string | null;
  qtyPerUnit: number;
}

interface BatchCtx {
  id: string;
  unitsPlanned: number;
  status: string;
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  assemblyId: string;
  bomLines: BomLine[];
  workers: { employeeId: string; employeeName: string }[];
}

interface ItemCtx {
  id: string;
  assemblyName: string;
  itemLabel: string;
  qty: number;
  itemDeadline: Date | null;
  orderId: string;
  orderDeadline: Date | null;
  batches: BatchCtx[];
}

/**
 * Every rule below is derived purely from data that already exists — no
 * new table, no guessed thresholds beyond what's stated in the confirmed
 * План-графік plan. Each message names the exact виріб/партія it's about
 * (never a bare "order has a problem"); aggregation to an order-level risk
 * badge happens in planner-board.service.ts, not here.
 */
@Injectable()
export class PlannerConflictsService {
  /** Rule 1: forecast material shortage for a not-yet-started batch — mirrors production-orders.service.ts#start()'s Pass 1, read-only. */
  checkMaterialShortage(item: ItemCtx, batch: BatchCtx, stockByProduct: Map<string, number>, finishedGoodStockByAssembly: Map<string, number>): PlannerProblem | null {
    if (batch.status !== 'PLANNED') return null;
    const units = batch.unitsPlanned;
    for (const line of batch.bomLines) {
      if (line.componentType === 'PRODUCT' && line.productId) {
        const needed = units * line.qtyPerUnit;
        const available = stockByProduct.get(line.productId) ?? 0;
        if (available < needed) {
          return this.problem('critical', 'MATERIAL_SHORTAGE', item, batch, `бракує матеріалу для запуску (потрібно ${needed}, наявно ${available})`);
        }
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const needed = Math.ceil(units * line.qtyPerUnit);
        const available = finishedGoodStockByAssembly.get(line.subAssemblyId) ?? 0;
        if (available < needed) {
          return this.problem('critical', 'MATERIAL_SHORTAGE', item, batch, `бракує готового підвиробу для запуску (потрібно ${needed}, наявно ${available})`);
        }
      }
    }
    return null;
  }

  /** Rule 2/3: a purchase order backing this order is overdue, or expected later than this batch's planned start. */
  checkPurchaseOrders(
    item: ItemCtx,
    batch: BatchCtx,
    purchaseOrders: { id: string; status: string; expectedDeliveryDate: Date | null; supplierName: string }[],
    now: Date,
  ): PlannerProblem[] {
    const problems: PlannerProblem[] = [];
    for (const po of purchaseOrders) {
      if (po.status === 'DELIVERED') continue;
      if (po.expectedDeliveryDate && po.expectedDeliveryDate < now) {
        problems.push({
          severity: 'warning',
          code: 'PURCHASE_OVERDUE',
          message: `${item.itemLabel} → закупівля у «${po.supplierName}» прострочена (очікувалась ${po.expectedDeliveryDate.toLocaleDateString()})`,
          entityType: 'PurchaseOrder',
          entityId: po.id,
          orderId: item.orderId,
        });
      }
      if (po.expectedDeliveryDate && batch.scheduledStartAt && po.expectedDeliveryDate > batch.scheduledStartAt) {
        problems.push({
          severity: 'critical',
          code: 'MATERIAL_LATE_FOR_START',
          message: `${item.itemLabel} → Партія (${batch.unitsPlanned} шт.) → матеріал від «${po.supplierName}» очікується ${po.expectedDeliveryDate.toLocaleDateString()}, виробництво заплановано на ${batch.scheduledStartAt.toLocaleDateString()}`,
          entityType: 'ProductionOrder',
          entityId: batch.id,
          orderId: item.orderId,
        });
      }
    }
    return problems;
  }

  /** Rule 4: batch's own planned end (or fallback to item/order deadline) is after the deadline that applies to it. */
  checkDeadlineRisk(item: ItemCtx, batch: BatchCtx): PlannerProblem | null {
    const deadline = item.itemDeadline ?? item.orderDeadline;
    if (!deadline || !batch.scheduledEndAt) return null;
    if (batch.scheduledEndAt > deadline) {
      return this.problem('warning', 'DEADLINE_RISK', item, batch, `виробництво заплановано на ${batch.scheduledEndAt.toLocaleDateString()}, після дедлайну ${deadline.toLocaleDateString()}`);
    }
    return null;
  }

  /** Rule 8: same employee assigned to two batches (any order) with overlapping planned windows. */
  checkResourceDoubleBooking(allBatches: (BatchCtx & { itemLabel: string; orderId: string })[]): PlannerProblem[] {
    const problems: PlannerProblem[] = [];
    const byEmployee = new Map<string, (BatchCtx & { itemLabel: string; orderId: string })[]>();
    for (const b of allBatches) {
      if (!b.scheduledStartAt || !b.scheduledEndAt) continue;
      for (const w of b.workers) {
        const arr = byEmployee.get(w.employeeId) ?? [];
        arr.push(b);
        byEmployee.set(w.employeeId, arr);
      }
    }
    for (const [, batches] of byEmployee) {
      const sorted = [...batches].sort((a, b) => a.scheduledStartAt!.getTime() - b.scheduledStartAt!.getTime());
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        if (cur.scheduledStartAt! < prev.scheduledEndAt!) {
          problems.push({
            severity: 'warning',
            code: 'RESOURCE_DOUBLE_BOOKED',
            message: `Ресурс призначений одночасно на «${prev.itemLabel}» та «${cur.itemLabel}»`,
            entityType: 'ProductionOrder',
            entityId: cur.id,
            orderId: cur.orderId,
          });
        }
      }
    }
    return problems;
  }

  /** Rule 6: order-level planned shipment is earlier than production for its items is expected to finish. */
  checkShipmentBeforeReady(orderId: string, plannedShipmentAt: Date | null, items: ItemCtx[]): PlannerProblem | null {
    if (!plannedShipmentAt) return null;
    const latestBatchEnd = items
      .flatMap((i) => i.batches)
      .filter((b) => b.status !== 'CANCELLED' && b.status !== 'COMPLETED')
      .map((b) => b.scheduledEndAt)
      .filter((d): d is Date => d != null)
      .reduce((max, d) => (d > max ? d : max), new Date(0));
    if (latestBatchEnd.getTime() > 0 && plannedShipmentAt < latestBatchEnd) {
      return {
        severity: 'warning',
        code: 'SHIPMENT_BEFORE_READY',
        message: `Планове відвантаження (${plannedShipmentAt.toLocaleDateString()}) заплановане раніше завершення виробництва (${latestBatchEnd.toLocaleDateString()})`,
        entityType: 'CustomerOrder',
        entityId: orderId,
        orderId,
      };
    }
    return null;
  }

  /** Rule 7: finished goods sitting IN_STOCK for a while with no shipment yet. */
  checkFinishedGoodsAwaitingShipment(orderId: string, finishedGoods: { id: string; manufactureDate: Date; assemblyName: string }[], now: Date): PlannerProblem[] {
    const THRESHOLD_DAYS = 7;
    return finishedGoods
      .filter((fg) => now.getTime() - fg.manufactureDate.getTime() > THRESHOLD_DAYS * 24 * 60 * 60 * 1000)
      .map((fg) => ({
        severity: 'info' as const,
        code: 'FG_AWAITING_SHIPMENT',
        message: `«${fg.assemblyName}» готовий з ${fg.manufactureDate.toLocaleDateString()} і досі очікує відвантаження`,
        entityType: 'FinishedGood' as const,
        entityId: fg.id,
        orderId,
      }));
  }

  private problem(severity: PlannerProblemSeverity, code: string, item: ItemCtx, batch: BatchCtx, tail: string): PlannerProblem {
    return {
      severity,
      code,
      message: `${item.itemLabel} → Партія (${batch.unitsPlanned} шт.) → ${tail}`,
      entityType: 'ProductionOrder',
      entityId: batch.id,
      orderId: item.orderId,
    };
  }
}

export type { BomLine, BatchCtx, ItemCtx };
