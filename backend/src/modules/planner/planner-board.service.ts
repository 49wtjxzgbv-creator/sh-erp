import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { QueryPlannerBoardDto } from './dto/planner-query.dto';
import { PlannerConflictsService, PlannerProblem, BatchCtx, ItemCtx } from './planner-conflicts.service';

/**
 * План-графік — Диспетчерський центр виробництва. Pure read/compute layer
 * over real entities (no Planner/GanttEvent/PlannerTask storage — see the
 * confirmed plan): CustomerOrder → CustomerOrderItem → ProductionOrder
 * (batch) → ProductionOrderStagePlan, plus each order's PurchaseOrders and
 * FinishedGoods. Every date is either a real stored plan field or a real
 * fact derived from an existing event/status — nothing here invents a
 * date. Same "fetch broadly, derive in application code" pattern as
 * DashboardTimelineService, one level deeper.
 */
@Injectable()
export class PlannerBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conflicts: PlannerConflictsService,
  ) {}

  async getBoard(user: RequestUser, query: QueryPlannerBoardDto) {
    const now = new Date();
    const from = query.from ?? new Date(now.getFullYear(), 0, 1);
    const to = query.to ?? new Date(now.getFullYear(), 11, 31, 23, 59, 59);

    const orderWhere: any = {};
    if (query.orderId) orderWhere.id = query.orderId;
    if (query.status) orderWhere.status = query.status;
    if (query.search) orderWhere.OR = [{ clientName: { contains: query.search, mode: 'insensitive' } }, { orderNumber: { contains: query.search, mode: 'insensitive' } }];

    const orders = await this.prisma.tenant.customerOrder.findMany({ where: orderWhere, include: { items: true }, orderBy: { createdAt: 'desc' } });
    let itemIds = (orders as any[]).flatMap((o) => o.items.map((i: any) => i.id));
    if (query.itemId) itemIds = itemIds.filter((id) => id === query.itemId);
    const orderIds = (orders as any[]).map((o) => o.id);

    const [batches, purchaseOrders, employees] = await Promise.all([
      itemIds.length
        ? this.prisma.tenant.productionOrder.findMany({
            where: { customerOrderItemId: { in: itemIds } },
            include: { workers: true, stagePlans: { include: { productionStage: true }, orderBy: { sortOrder: 'asc' } }, stageEvents: true, finishedGoods: true },
          })
        : [],
      orderIds.length
        ? this.prisma.tenant.purchaseOrder.findMany({ where: { sourceCustomerOrderId: { in: orderIds } }, include: { supplier: true } })
        : [],
      this.prisma.tenant.employee.findMany(),
    ]);

    const assemblyIds = Array.from(new Set([...(orders as any[]).flatMap((o) => o.items.map((i: any) => i.assemblyId)), ...(batches as any[]).map((b) => b.assemblyId)]));
    const assemblies = assemblyIds.length ? await this.prisma.tenant.assembly.findMany({ where: { id: { in: assemblyIds } } }) : [];
    const assemblyNameById = new Map((assemblies as any[]).map((a) => [a.id, a.name]));
    const assemblyArticleById = new Map((assemblies as any[]).map((a) => [a.id, a.article as string | null]));
    const employeeNameById = new Map((employees as any[]).map((e) => [e.id, `${e.firstName} ${e.lastName}`]));

    // Stock levels for the material-shortage forecast (Rule 1) — same two
    // signals production-orders.service.ts#start() checks, read-only here.
    // Cached per assemblyVersionId since several batches often share one.
    const bomLinesByVersion = new Map<string, Awaited<ReturnType<typeof this.getBomLines>>>();
    for (const b of batches as any[]) {
      if (b.assemblyVersionId && !bomLinesByVersion.has(b.assemblyVersionId)) {
        bomLinesByVersion.set(b.assemblyVersionId, await this.getBomLines(b.assemblyVersionId));
      }
    }
    const allProductIds = Array.from(new Set(Array.from(bomLinesByVersion.values()).flatMap((lines) => lines.map((l) => l.productId).filter((id): id is string => Boolean(id)))));
    const products = allProductIds.length ? await this.prisma.tenant.product.findMany({ where: { id: { in: allProductIds } } }) : [];
    const stockByProduct = new Map((products as any[]).map((p) => [p.id, Number(p.qty)]));
    const allSubAssemblyIds = Array.from(new Set(Array.from(bomLinesByVersion.values()).flatMap((lines) => lines.map((l) => l.subAssemblyId).filter((id): id is string => Boolean(id)))));
    const fgCounts = allSubAssemblyIds.length
      ? await this.prisma.tenant.finishedGood.groupBy({ by: ['assemblyId'], where: { assemblyId: { in: allSubAssemblyIds }, status: 'IN_STOCK' }, _count: { _all: true } })
      : [];
    const fgStockByAssembly = new Map((fgCounts as any[]).map((r) => [r.assemblyId, r._count._all]));

    const allProblems: PlannerProblem[] = [];
    const allBatchesFlat: (BatchCtx & { itemLabel: string; orderId: string })[] = [];

    const orderNodes = (orders as any[])
      .map((order) => {
        const orderPOs = (purchaseOrders as any[])
          .filter((po) => po.sourceCustomerOrderId === order.id)
          .filter((po) => !query.supplierId || po.supplierId === query.supplierId)
          .map((po) => ({
            id: po.id,
            supplierId: po.supplierId,
            supplierName: po.supplier?.name ?? po.supplierNameSnapshot,
            status: po.status,
            expectedDeliveryDate: po.expectedDeliveryDate,
            orderDate: po.orderDate,
          }));

        const itemNodes = (order.items as any[])
          .filter((item) => !query.itemId || item.id === query.itemId)
          .map((item) => {
            const itemBatches = (batches as any[])
              .filter((b) => b.customerOrderItemId === item.id)
              .filter((b) => !query.batchId || b.id === query.batchId)
              .filter((b) => !query.responsibleId || b.workers.some((w: any) => w.employeeId === query.responsibleId));

            const assemblyName = assemblyNameById.get(item.assemblyId) ?? item.assemblyId;
            const itemLabel = `${assemblyName} × ${Number(item.qty)}`;
            const itemCtx: ItemCtx = {
              id: item.id,
              assemblyName,
              itemLabel,
              qty: Number(item.qty),
              itemDeadline: item.itemDeadline,
              orderId: order.id,
              orderDeadline: order.deadline,
              batches: [],
            };

            const batchNodes = itemBatches.map((b) => {
              const bomLines = bomLinesByVersion.get(b.assemblyVersionId ?? '') ?? [];
              const batchCtx: BatchCtx = {
                id: b.id,
                unitsPlanned: Number(b.unitsPlanned),
                status: b.status,
                scheduledStartAt: b.scheduledStartAt,
                scheduledEndAt: b.scheduledEndAt,
                assemblyId: b.assemblyId,
                bomLines: bomLines.map((l) => ({ componentType: l.componentType, productId: l.productId, subAssemblyId: l.subAssemblyId, qtyPerUnit: Number(l.qtyPerUnit) })),
                workers: (b.workers as any[]).map((w) => ({ employeeId: w.employeeId, employeeName: employeeNameById.get(w.employeeId) ?? w.employeeId })),
              };
              itemCtx.batches.push(batchCtx);
              allBatchesFlat.push({ ...batchCtx, itemLabel, orderId: order.id });

              const batchProblems: PlannerProblem[] = [];
              const shortage = this.conflicts.checkMaterialShortage(itemCtx, batchCtx, stockByProduct, fgStockByAssembly);
              if (shortage) batchProblems.push(shortage);
              batchProblems.push(...this.conflicts.checkPurchaseOrders(itemCtx, batchCtx, orderPOs, now));
              const deadlineRisk = this.conflicts.checkDeadlineRisk(itemCtx, batchCtx);
              if (deadlineRisk) batchProblems.push(deadlineRisk);
              allProblems.push(...batchProblems);

              const factStart = (b.stageEvents as any[]).length ? (b.stageEvents as any[]).map((e) => e.createdAt).sort((a, c) => a.getTime() - c.getTime())[0] : null;

              return {
                id: b.id,
                unitsPlanned: Number(b.unitsPlanned),
                status: b.status,
                currentStageIndex: b.currentStageIndex,
                plan: { startAt: b.scheduledStartAt, endAt: b.scheduledEndAt },
                fact: { startAt: factStart, endAt: b.completedAt },
                stages: (b.stagePlans as any[]).map((sp) => ({
                  id: sp.productionStageId,
                  name: sp.productionStage.name,
                  sortOrder: sp.sortOrder,
                  plan: sp.plannedStartAt || sp.plannedEndAt ? { startAt: sp.plannedStartAt, endAt: sp.plannedEndAt } : null,
                })),
                workers: batchCtx.workers,
                problems: batchProblems,
              };
            });

            const finishedGoods = (batches as any[])
              .filter((b) => b.customerOrderItemId === item.id)
              .flatMap((b) => b.finishedGoods as any[])
              .filter((fg) => fg.status === 'IN_STOCK');
            const fgProblems = this.conflicts.checkFinishedGoodsAwaitingShipment(order.id, finishedGoods.map((fg) => ({ id: fg.id, manufactureDate: fg.manufactureDate, assemblyName })), now);
            allProblems.push(...fgProblems);

            const ordered = Number(item.qty);
            const activeBatches = itemBatches.filter((b) => b.status !== 'CANCELLED');
            const inProduction = activeBatches.reduce((sum, b) => sum + Number(b.unitsPlanned), 0);
            const completed = activeBatches.flatMap((b) => b.finishedGoods as any[]).filter((fg) => ['IN_STOCK', 'SHIPPED', 'CONSUMED'].includes(fg.status)).length;

            return {
              id: item.id,
              assemblyId: item.assemblyId,
              assemblyName,
              article: assemblyArticleById.get(item.assemblyId) ?? null,
              qty: ordered,
              plan: { startAt: item.plannedStartAt, endAt: item.plannedEndAt, deadline: item.itemDeadline },
              quantitySummary: { ordered, inProduction, completed, remaining: Math.max(ordered - inProduction, 0) },
              batches: batchNodes,
              problems: [...batchNodes.flatMap((b) => b.problems), ...fgProblems],
            };
          });

        const shipmentProblem = this.conflicts.checkShipmentBeforeReady(order.id, order.plannedShipmentAt, itemNodes.map((n) => ({ ...n, orderDeadline: order.deadline } as any)));
        if (shipmentProblem) allProblems.push(shipmentProblem);

        const allItemProblems = itemNodes.flatMap((n) => n.problems);
        const orderProblems = shipmentProblem ? [...allItemProblems, shipmentProblem] : allItemProblems;
        const riskLevel: 'none' | 'warning' | 'critical' = orderProblems.some((p) => p.severity === 'critical')
          ? 'critical'
          : orderProblems.some((p) => p.severity === 'warning')
            ? 'warning'
            : 'none';

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          clientName: order.clientName,
          status: order.status,
          deadline: order.deadline,
          plan: { startAt: order.plannedStartAt, completionAt: order.plannedCompletionAt, shipmentAt: order.plannedShipmentAt, deliveryAt: order.plannedDeliveryAt },
          items: itemNodes,
          purchaseOrders: orderPOs,
          riskLevel,
          problemCount: orderProblems.length,
        };
      })
      .filter((o) => (query.problem === 'true' ? o.problemCount > 0 : true))
      .filter((o) => this.overlapsRange(o, from, to));

    allProblems.push(...this.conflicts.checkResourceDoubleBooking(allBatchesFlat));

    return { from, to, orders: orderNodes, problems: allProblems };
  }

  private overlapsRange(order: { plan: { startAt: Date | null; completionAt: Date | null }; deadline: Date | null; items: any[] }, from: Date, to: Date): boolean {
    const dates: Date[] = [];
    if (order.plan.startAt) dates.push(order.plan.startAt);
    if (order.plan.completionAt) dates.push(order.plan.completionAt);
    if (order.deadline) dates.push(order.deadline);
    for (const item of order.items) {
      for (const b of item.batches) {
        if (b.plan.startAt) dates.push(b.plan.startAt);
        if (b.plan.endAt) dates.push(b.plan.endAt);
      }
    }
    if (dates.length === 0) return true; // nothing dated yet — never hide unplanned work
    return dates.some((d) => d >= from && d <= to) || (Math.min(...dates.map((d) => d.getTime())) <= to.getTime() && Math.max(...dates.map((d) => d.getTime())) >= from.getTime());
  }

  private async getBomLines(assemblyVersionId: string) {
    return this.prisma.tenant.assemblyVersionComponent.findMany({ where: { assemblyVersionId } }) as unknown as Promise<
      { componentType: 'PRODUCT' | 'ASSEMBLY'; productId: string | null; subAssemblyId: string | null; qtyPerUnit: any }[]
    >;
  }
}
