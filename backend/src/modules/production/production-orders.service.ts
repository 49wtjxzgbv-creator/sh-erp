import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockReservationService } from '../inventory/stock-reservation.service';
import { StockService } from '../inventory/stock.service';
import {
  CreateProductionOrderDto,
  QueryProductionOrdersDto,
  SetProductionOrderStagePlanDto,
  SetProductionOrderWorkersDto,
  StartProductionOrderDto,
} from './dto/production-order.dto';
import { FinishedGoodsService } from './finished-goods.service';
import { ProductionExecutionsService } from './production-executions.service';

interface ShortageLine {
  kind: 'PRODUCT' | 'ASSEMBLY';
  productId?: string;
  subAssemblyId?: string;
  needed: number;
  available: number;
}

/**
 * The primary production workflow (ProductionOrders.gs, Phase 1 §3.3/§6.4) —
 * the full reserve → start lifecycle, distinct from BOM module's
 * reservation-free `AssembliesService.produce()` (Phase 1 §6.1's "two
 * parallel make-a-product paths", never to be collapsed into one).
 *
 * Key design point ported faithfully from the legacy behavior: when the
 * locked BOM version contains an ASSEMBLY-type line (a sub-assembly),
 * `start()` does NOT recursively expand that sub-assembly down to raw
 * materials. It consumes already-manufactured FinishedGood units of that
 * sub-assembly instead (FIFO, oldest `manufactureDate` first — the ported
 * `consumeFinishedGoods_`), exactly like the legacy system required the
 * sub-assembly to have gone through its own prior ProductionOrder first.
 * This is why no multi-level BOM flattening is needed here: each
 * FinishedGood's `unitCostLocalEur`/`unitCostGermanEur` already carries the
 * fully-recursive cost that was frozen when THAT unit was produced, so
 * summing the consumed units' stored costs is the correct materials cost
 * contribution for this line — recomputing it recursively again would
 * double-count and would also violate cost freezing (Phase 1 §6.4).
 */
@Injectable()
export class ProductionOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stockService: StockService,
    private readonly stockReservationService: StockReservationService,
    private readonly finishedGoodsService: FinishedGoodsService,
    private readonly productionExecutionsService: ProductionExecutionsService,
  ) {}

  // ============================================================
  // Create / query / cancel
  // ============================================================

  /**
   * Reserve step — does NOT touch physical stock. Locks in the assembly's
   * *current* AssemblyVersion (its most recent saved BOM snapshot) so a
   * later BOM edit never retroactively changes this order (Phase 1 §6.4,
   * AssemblyVersion's own header comment).
   */
  async create(user: RequestUser, dto: CreateProductionOrderDto) {
    const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: dto.assemblyId } });
    if (!assembly) throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', 'Assembly not found.');

    const latestVersion = await this.prisma.tenant.assemblyVersion.findFirst({
      where: { assemblyId: dto.assemblyId },
      orderBy: { versionNumber: 'desc' },
    });
    if (!latestVersion) {
      throw new CodedBadRequestException(
        'PRODUCTION_NO_BOM_SAVED',
        'This assembly has no saved BOM yet — save its component list (PUT /assemblies/:id/components) before creating a production order.',
      );
    }

    if (dto.workers && dto.workers.length > 0) {
      this.assertPercentagesNormalizable(dto.workers);
    }

    const order = await this.prisma.tenant.productionOrder.create({
      data: {
        assemblyId: dto.assemblyId,
        assemblyVersionId: latestVersion.id,
        unitsPlanned: dto.unitsPlanned,
        status: 'PLANNED',
        createdById: user.userId,
        comment: dto.comment,
        scheduledStartAt: dto.scheduledStartAt,
        scheduledEndAt: dto.scheduledEndAt,
        customerOrderItemId: dto.customerOrderItemId,
        subAssemblyForItemId: dto.subAssemblyForItemId,
      } as any,
    });

    if (dto.workers && dto.workers.length > 0) {
      await this.writeWorkers(order.id, dto.workers);
    }

    await this.createStagePlanSkeleton(order.id);

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_order.created',
      entityType: 'ProductionOrder',
      entityId: order.id,
      after: order,
    });

    return order;
  }

  /**
   * Auto-skeleton (План-графік §2, confirmed opt-in default): one
   * ProductionOrderStagePlan row per this company's active ProductionStage,
   * dates left null. Never guesses a date/duration — the user fills them in
   * later via setStagePlan. No-op for companies with no configured stages,
   * same fallback as start()'s "completes immediately if none configured."
   */
  private async createStagePlanSkeleton(productionOrderId: string) {
    const stages = await this.prisma.tenant.productionStage.findMany({ orderBy: { sortOrder: 'asc' } });
    if (stages.length === 0) return;
    await this.prisma.tenant.productionOrderStagePlan.createMany({
      data: stages.map((s) => ({
        productionOrderId,
        productionStageId: s.id,
        sortOrder: s.sortOrder,
      })) as any,
    });
  }

  /** Plan only — stage names always resolved from ProductionStage, never touches ProductionOrderStageEvent (fact). */
  async getStagePlan(user: RequestUser, id: string) {
    await this.findOne(user, id);
    return this.prisma.tenant.productionOrderStagePlan.findMany({
      where: { productionOrderId: id },
      orderBy: { sortOrder: 'asc' },
      include: { productionStage: true },
    });
  }

  /** Full replace, mirrors setWorkers. Each stage's window is independent — never auto-divided evenly across the batch (План-графік §2). */
  async setStagePlan(user: RequestUser, id: string, dto: SetProductionOrderStagePlanDto) {
    await this.findOne(user, id);

    const stageIds = dto.stages.map((s) => s.productionStageId);
    if (new Set(stageIds).size !== stageIds.length) {
      throw new CodedBadRequestException('PRODUCTION_STAGE_PLAN_DUPLICATE_STAGE', 'Each stage can appear at most once in the plan.');
    }
    const stages = await this.prisma.tenant.productionStage.findMany({ where: { id: { in: stageIds } } });
    if (stages.length !== stageIds.length) {
      throw new CodedNotFoundException('PRODUCTION_STAGE_PLAN_UNKNOWN_STAGE', 'One or more stages do not belong to this company.');
    }
    const sortOrderByStage = new Map(stages.map((s) => [s.id, s.sortOrder]));

    await this.prisma.tenant.productionOrderStagePlan.deleteMany({ where: { productionOrderId: id } });
    if (dto.stages.length > 0) {
      await this.prisma.tenant.productionOrderStagePlan.createMany({
        data: dto.stages.map((s) => ({
          productionOrderId: id,
          productionStageId: s.productionStageId,
          plannedStartAt: s.plannedStartAt,
          plannedEndAt: s.plannedEndAt,
          sortOrder: sortOrderByStage.get(s.productionStageId)!,
        })) as any,
      });
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_order.stage_plan_updated',
      entityType: 'ProductionOrder',
      entityId: id,
      after: { stages: dto.stages },
    });

    return this.getStagePlan(user, id);
  }

  async findOne(user: RequestUser, id: string) {
    const order = await this.prisma.tenant.productionOrder.findUnique({
      where: { id },
      include: { workers: true, pickListItems: true, stageEvents: true, finishedGoods: true },
    });
    if (!order) throw new CodedNotFoundException('PRODUCTION_ORDER_NOT_FOUND', 'Production order not found.');
    return order;
  }

  async query(user: RequestUser, query: QueryProductionOrdersDto) {
    const where: Prisma.ProductionOrderWhereInput = {};
    if (query.status) where.status = query.status as any;
    if (query.assemblyId) where.assemblyId = query.assemblyId;

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;
    const [items, total] = await Promise.all([
      this.prisma.tenant.productionOrder.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.tenant.productionOrder.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  async setWorkers(user: RequestUser, id: string, dto: SetProductionOrderWorkersDto) {
    const order = await this.findOne(user, id);
    if (order.status !== 'PLANNED') {
      throw new CodedBadRequestException('PRODUCTION_WORKERS_ONLY_WHILE_PLANNED', 'Workers can only be (re)assigned while the order is still PLANNED.');
    }
    if (dto.workers.length > 0) this.assertPercentagesNormalizable(dto.workers);

    await this.prisma.tenant.productionOrderWorker.deleteMany({ where: { productionOrderId: id } });
    if (dto.workers.length > 0) {
      await this.writeWorkers(id, dto.workers);
    }
    return this.findOne(user, id);
  }

  /** Planned-only, per Phase 1 §3.3's `cancelProductionOrder`. */
  async cancel(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== 'PLANNED') {
      throw new CodedBadRequestException('PRODUCTION_CANCEL_ONLY_PLANNED', 'Only a PLANNED production order can be cancelled.');
    }
    const cancelled = await this.prisma.tenant.productionOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_order.cancelled',
      entityType: 'ProductionOrder',
      entityId: id,
      before: order,
      after: cancelled,
    });
    return cancelled;
  }

  /**
   * Permanent hard delete — admin-only (`production-orders:delete`), and
   * only for an order that never actually started: `start()` (below)
   * physically decrements stock and generates serialized FinishedGood
   * units — none of that is undone by removing this row, and
   * FinishedGood.productionOrder is a Restrict FK (schema.prisma), so the
   * DB would reject the delete anyway once any exist. This pre-check
   * exists to give a clear, coded error instead of a raw FK-violation.
   * PLANNED and CANCELLED are both safe in the common case: neither status
   * can have any FinishedGood rows (only ever created inside `start()`),
   * and `cancel()` only ever transitions PLANNED -> CANCELLED, never
   * IN_PROGRESS -> CANCELLED. Every other child (stage plans, pick-list
   * items, stage events, worker assignments) cascades at the DB level.
   *
   * A PLANNED order CAN have ProductionExecution history if it was
   * IN_PROGRESS and got reverted (`revertStart` below) — those rows stay
   * VOIDED, compensating PayrollEntry already written, immutable-ledger
   * convention. Real incident (2026-08-25): this used to be additionally
   * guarded here against exactly that case, on the mistaken belief that
   * ProductionExecution.productionOrder had no onDelete: SetNull — it
   * always did (see that field's schema.prisma comment, a real drift
   * between the migration and the Prisma annotation). Deleting the order
   * now correctly orphans those rows (productionOrderId -> null) instead
   * of being blocked; the compensating PayrollEntry rows (already
   * SetNull) keep their own textual comment referencing the order id, so
   * no audit information is actually lost.
   */
  async remove(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== 'PLANNED' && order.status !== 'CANCELLED') {
      throw new CodedConflictException(
        'PRODUCTION_ORDER_DELETE_ALREADY_STARTED',
        'Cannot delete: this production order has already started — it has consumed stock, generated finished-good units, and/or paid out payroll. Only a planned or already-cancelled order can be deleted.',
      );
    }
    await this.prisma.tenant.productionOrder.delete({ where: { id } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_order.deleted',
      entityType: 'ProductionOrder',
      entityId: id,
      before: order,
    });
  }

  // ============================================================
  // Start — the core lifecycle transition
  // ============================================================

  async start(user: RequestUser, id: string, dto: StartProductionOrderDto) {
    const order = await this.findOne(user, id);
    if (order.status !== 'PLANNED') {
      throw new CodedBadRequestException('PRODUCTION_START_ONLY_PLANNED', 'Only a PLANNED production order can be started.');
    }
    if (!order.assemblyVersionId) {
      throw new CodedConflictException(
        'PRODUCTION_NO_LOCKED_BOM_VERSION',
        'This order has no locked BOM version — cannot start (pre-versioning legacy data, Phase 1 §6.4).',
      );
    }

    const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: order.assemblyId } });
    if (!assembly) throw new CodedNotFoundException('PRODUCTION_ASSEMBLY_NOT_FOUND', 'Assembly not found.');

    const version = await this.prisma.tenant.assemblyVersion.findUnique({
      where: { id: order.assemblyVersionId },
      include: { components: true },
    });
    if (!version) throw new CodedNotFoundException('PRODUCTION_LOCKED_VERSION_NOT_FOUND', 'Locked assembly version not found.');

    const unitsPlanned = Number(order.unitsPlanned);
    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());

    // Stock-reservation spec §14: this batch's own customer order (if any,
    // resolved via its order line) — its reservations are what gets closed
    // out as material is actually consumed below. Reservations are a
    // shared pool for the WHOLE order (CustomerOrderShortageService's own
    // design), so only the order id is needed, not the specific line.
    const orderItem = order.customerOrderItemId
      ? await this.prisma.tenant.customerOrderItem.findUnique({ where: { id: order.customerOrderItemId } })
      : null;
    const customerOrderId = orderItem?.customerOrderId ?? null;

    // ---- Pass 1: check availability for every line before consuming anything ----
    const shortages: ShortageLine[] = [];
    const productLines: Array<{ productId: string; needed: number }> = [];
    const assemblyLines: Array<{ subAssemblyId: string; needed: number }> = [];
    // §4/§16: "available" for THIS batch's own consumption is physical
    // minus what OTHER orders have reserved — this batch's own order's
    // reservation (only present if it's linked to a customer order) counts
    // as available to itself, never double-subtracted. An ad-hoc/internal
    // batch (no customer order) has no reservation of its own, so it must
    // still respect every OTHER order's reservation in full — it was never
    // entitled to eat into material held for a real customer order.
    const myReservedByProduct = new Map<string, { fromStock: number; fromPurchase: number }>();

    for (const line of version.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);
      if (line.componentType === 'PRODUCT' && line.productId) {
        const needed = unitsPlanned * qtyPerUnit;
        productLines.push({ productId: line.productId, needed });
        const stock = await this.prisma.tenant.warehouseStock.findUnique({
          where: { companyId_productId_warehouseId: { companyId: user.companyId, productId: line.productId, warehouseId } },
        });
        const physical = Number(stock?.qty ?? 0);
        const totalReserved = Number(stock?.reservedQty ?? 0);
        const mine = customerOrderId
          ? await this.stockReservationService.getReservedForOrder(user, customerOrderId, line.productId, warehouseId)
          : { fromStock: 0, fromPurchase: 0 };
        myReservedByProduct.set(line.productId, mine);
        const otherReserved = Math.max(totalReserved - (mine.fromStock + mine.fromPurchase), 0);
        const available = physical - otherReserved;
        if (available < needed) {
          shortages.push({ kind: 'PRODUCT', productId: line.productId, needed, available });
        }
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const needed = unitsPlanned * qtyPerUnit;
        assemblyLines.push({ subAssemblyId: line.subAssemblyId, needed });
        const available = await this.prisma.tenant.finishedGood.count({
          where: { assemblyId: line.subAssemblyId, status: 'IN_STOCK' },
        });
        if (available < Math.ceil(needed)) {
          shortages.push({ kind: 'ASSEMBLY', subAssemblyId: line.subAssemblyId, needed, available });
        }
      }
    }

    if (shortages.length > 0) {
      throw new CodedBadRequestException(
        'PRODUCTION_INSUFFICIENT_STOCK',
        'Insufficient stock/finished goods to start this production order.',
        { shortages },
      );
    }

    // ---- Pass 2: consume ----
    // `sellPriceEur` is the ONE price every calculation in this app is
    // pinned to (explicit business rule) — localPriceExclVat/
    // germanPriceExclVat are informational reference fields only, never
    // multiplied into a cost total anywhere (matches the same rule applied
    // to BOM cost in assemblies.service.ts and the valuation report in
    // reports.service.ts). `materialsLocalCost`/`materialsGermanCost` (and
    // the ProductionOrder.totalLocalCostEur/totalGermanCostEur columns they
    // feed below) are NOT being collapsed into one column — unlike BOM
    // cost, this is a real, persisted, frozen-at-start-time snapshot
    // (Phase 1 §6.4: "current prices at the moment of starting, frozen
    // permanently"), and a schema migration to consolidate them isn't
    // worth the risk against live production-order history just to remove
    // a now-redundant duplicate. Both are simply sourced from the same
    // sellPriceEur going forward, so they end up equal for every NEW order
    // — existing completed orders keep whatever their historical local vs.
    // German split actually was at the time, which is correct: a frozen
    // snapshot must never be recomputed after the fact.
    let materialsLocalCost = 0;
    let materialsGermanCost = 0;
    const pickListRows: Array<{
      productId: string | null;
      subAssemblyId: string | null;
      description: string;
      qty: number;
      unitPriceEur: number | null;
      lineTotalEur: number | null;
      consumedFinishedGoodIds: string[];
    }> = [];

    for (const { productId, needed } of productLines) {
      const product = await this.prisma.tenant.product.findUniqueOrThrow({ where: { id: productId } });
      await this.stockService.applyMovement(user, {
        productId,
        warehouseId,
        type: 'PRODUCTION_CONSUMPTION',
        qtyDelta: -needed,
        sourceType: 'ProductionOrder',
        sourceId: order.id,
      });

      // §14: reservation is not a write-off — the physical decrement just
      // above already happened through the normal ledger; this only closes
      // out THIS order's own hold on the portion actually consumed, never
      // touching what other orders have reserved. STOCK-source is closed
      // first, then PURCHASE-source for any remainder — an arbitrary but
      // consistent order, since both sources are equally "this order's
      // material" once reserved.
      if (customerOrderId) {
        const mine = myReservedByProduct.get(productId) ?? { fromStock: 0, fromPurchase: 0 };
        let remaining = needed;
        const fromStockConsumed = Math.min(remaining, mine.fromStock);
        if (fromStockConsumed > 0) {
          await this.stockReservationService.consume(user, { productId, warehouseId, customerOrderId, source: 'STOCK' }, fromStockConsumed);
          remaining -= fromStockConsumed;
        }
        const fromPurchaseConsumed = Math.min(remaining, mine.fromPurchase);
        if (fromPurchaseConsumed > 0) {
          await this.stockReservationService.consume(user, { productId, warehouseId, customerOrderId, source: 'PURCHASE' }, fromPurchaseConsumed);
        }
      }

      const unitPrice = Number(product.sellPriceEur ?? 0);
      materialsLocalCost += unitPrice * needed;
      materialsGermanCost += unitPrice * needed;
      pickListRows.push({
        productId,
        subAssemblyId: null,
        description: `${product.article} — ${product.name}`,
        qty: needed,
        unitPriceEur: unitPrice,
        lineTotalEur: unitPrice * needed,
        consumedFinishedGoodIds: [],
      });
    }

    for (const { subAssemblyId, needed } of assemblyLines) {
      const takeCount = Math.ceil(needed);
      const consumed = await this.prisma.tenant.finishedGood.findMany({
        where: { assemblyId: subAssemblyId, status: 'IN_STOCK' },
        orderBy: { manufactureDate: 'asc' },
        take: takeCount,
      });
      // Re-checked defensively — the availability pass above already
      // guaranteed this, but stock could theoretically have moved between
      // pass 1 and pass 2 within the same transaction only if this method
      // itself raced with itself, which it cannot inside one transaction.
      if (consumed.length < takeCount) {
        throw new CodedConflictException(
          'PRODUCTION_SUBASSEMBLY_STOCK_RACE',
          `Not enough IN_STOCK finished goods for sub-assembly ${subAssemblyId}.`,
        );
      }

      const subAssembly = await this.prisma.tenant.assembly.findUnique({ where: { id: subAssemblyId } });
      const consumedIds: string[] = [];
      let lineLocalCost = 0;
      let lineGermanCost = 0;
      for (const good of consumed) {
        await this.prisma.tenant.finishedGood.update({
          where: { id: good.id },
          data: { status: 'CONSUMED', consumedInProductionOrderId: order.id },
        });
        consumedIds.push(good.id);
        lineLocalCost += Number(good.unitCostLocalEur);
        lineGermanCost += Number(good.unitCostGermanEur);
      }
      materialsLocalCost += lineLocalCost;
      materialsGermanCost += lineGermanCost;
      pickListRows.push({
        productId: null,
        subAssemblyId,
        description: `[assembly] ${subAssembly?.name ?? subAssemblyId}`,
        qty: needed,
        unitPriceEur: takeCount > 0 ? lineLocalCost / takeCount : null,
        lineTotalEur: lineLocalCost,
        consumedFinishedGoodIds: consumedIds,
      });
    }

    if (pickListRows.length > 0) {
      await this.prisma.tenant.productionOrderPickListItem.createMany({
        data: pickListRows.map((row) => ({ productionOrderId: order.id, ...row })) as any,
      });
    }

    // ---- Cost freezing (Phase 1 §6.4: current prices at the moment of starting, frozen permanently) ----
    const ownLabor = Number(assembly.laborCostPerUnit) * unitsPlanned;
    const ownPackaging = Number(assembly.packagingCostPerUnit) * unitsPlanned;
    const ownDelivery = Number(assembly.deliveryCostPerUnit) * unitsPlanned;
    const ownOther = Number(assembly.otherCostPerUnit) * unitsPlanned;

    const totalLocalCostEur = materialsLocalCost + ownLabor + ownPackaging + ownDelivery + ownOther;
    const totalGermanCostEur = materialsGermanCost + ownLabor + ownPackaging + ownDelivery + ownOther;
    const perUnitLocalCost = totalLocalCostEur / unitsPlanned;
    const perUnitGermanCost = totalGermanCostEur / unitsPlanned;

    // ---- Generate FinishedGoods, one per planned unit ----
    const serials = await this.finishedGoodsService.generateSerialNumbers(user.companyId, unitsPlanned);
    await this.prisma.tenant.finishedGood.createMany({
      data: serials.map((serialNumber) => ({
        serialNumber,
        assemblyId: order.assemblyId,
        productionOrderId: order.id,
        status: 'IN_STOCK',
        unitCostLocalEur: perUnitLocalCost,
        unitCostGermanEur: perUnitGermanCost,
      })) as any,
    });

    // Production-labor module (2026-08-24): piecework PayrollEntry rows are
    // no longer generated here. `laborCostEur` (frozen just below) is now
    // consumed incrementally by ProductionExecution#confirm
    // (production-executions.service.ts) instead of being paid out in one
    // shot at start() time — see that file's own header comment. The
    // ProductionOrderWorker rows saved on this order are kept as-is: they
    // remain a preset/suggestion for prefilling an execution's allocations,
    // never a source of automatic payroll.

    // ---- Stage tracking, or immediate completion if none configured ----
    const stages = await this.prisma.tenant.productionStage.findMany({ orderBy: { sortOrder: 'asc' } });
    const hasStages = stages.length > 0;

    const updated = await this.prisma.tenant.productionOrder.update({
      where: { id: order.id },
      data: {
        status: hasStages ? 'IN_PROGRESS' : 'COMPLETED',
        currentStageIndex: hasStages ? 0 : null,
        completedAt: hasStages ? null : new Date(),
        totalLocalCostEur,
        totalGermanCostEur,
        laborCostEur: ownLabor,
        packagingCostEur: ownPackaging,
        deliveryCostEur: ownDelivery,
        otherCostEur: ownOther,
        fullCostEur: totalLocalCostEur,
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_order.started',
      entityType: 'ProductionOrder',
      entityId: order.id,
      after: { status: updated.status, unitsPlanned, totalLocalCostEur, totalGermanCostEur, serials },
    });

    return this.findOne(user, order.id);
  }

  // ============================================================
  // Revert — undo a started (IN_PROGRESS) order back to PLANNED
  // ============================================================

  /**
   * "Скасувати виробництво, повернути все на склад" (2026-08-25 user
   * request): undoes everything `start()` did, as if it had never been
   * called — returns consumed raw-material stock and consumed sub-assembly
   * FinishedGood units, deletes the FinishedGood units THIS order itself
   * produced, reverses any labor pay already recorded against it, and
   * resets the order's own fields back to their pre-start values. The
   * order row itself is kept (transitioned to PLANNED, not deleted) —
   * FinishedGood/ProductionExecution both have Restrict-by-default FKs to
   * ProductionOrder, and a VOIDED execution's compensating PayrollEntry
   * needs a real row to keep pointing at (immutable-ledger convention).
   * `remove()` above can hard-delete the result afterward IF it has no
   * execution history left (i.e. it never had any CONFIRMED work booked).
   *
   * Deliberately IN_PROGRESS-only, never COMPLETED: a completed batch's
   * output has had a full stage-tracking lifecycle and is far more likely
   * to already be shipped/consumed downstream — the guard below would
   * reject most of those anyway, but the status check gives a clearer,
   * earlier error for the common case.
   *
   * Blocked (not silently partial) if ANY FinishedGood this order produced
   * is no longer exactly as `start()` left it — shipped, consumed as
   * someone else's sub-assembly, QC-checked, or linked to a customer
   * order. "Return everything as if nothing happened" is only actually
   * true if nothing downstream has happened yet; once it has, undoing this
   * order would have to silently undo THAT too, which this deliberately
   * never does.
   */
  async revertStart(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== 'IN_PROGRESS') {
      throw new CodedBadRequestException(
        'PRODUCTION_REVERT_ONLY_IN_PROGRESS',
        'Only an IN_PROGRESS production order can be reverted.',
      );
    }

    const ownGoods = await this.prisma.tenant.finishedGood.findMany({
      where: { productionOrderId: id },
      include: { qcChecks: true },
    });
    const touched = ownGoods.filter((g) => g.status !== 'IN_STOCK' || g.customerOrderId !== null || g.qcChecks.length > 0);
    if (touched.length > 0) {
      throw new CodedConflictException(
        'PRODUCTION_REVERT_OUTPUT_ALREADY_USED',
        `Cannot revert: ${touched.length} finished-good unit(s) from this order have already been shipped, QC-checked, or otherwise touched (${touched
          .map((g) => g.serialNumber)
          .join(', ')}). Resolve those first.`,
        { serialNumbers: touched.map((g) => g.serialNumber) },
      );
    }

    // ---- Reverse labor/payroll first (its own guards — e.g. a closed
    // payroll period — should abort before any stock is touched) ----
    const executions = await this.prisma.tenant.productionExecution.findMany({ where: { productionOrderId: id } });
    for (const execution of executions) {
      if (execution.status === 'DRAFT') {
        await this.productionExecutionsService.remove(user, execution.id);
      } else if (execution.status === 'CONFIRMED') {
        await this.productionExecutionsService.void_(user, execution.id, {
          note: 'Виробниче замовлення скасовано, залишки повернено на склад',
        });
      }
      // VOIDED: already reversed by an earlier void — nothing to do.
    }

    // ---- Reverse raw-material consumption — the StockMovement ledger is
    // the authoritative record of exactly what warehouse/qty was consumed
    // (the pick-list row doesn't carry a warehouseId), and re-crediting
    // through `applyMovement` with `preferredOrderId` re-creates this
    // batch's customer-order reservation the same way any other stock
    // increase does (StockReservationService#topUp) — no manual
    // reservation surgery needed. ----
    const orderItem = order.customerOrderItemId
      ? await this.prisma.tenant.customerOrderItem.findUnique({ where: { id: order.customerOrderItemId } })
      : null;
    const customerOrderId = orderItem?.customerOrderId ?? undefined;

    const consumptionMovements = await this.prisma.tenant.stockMovement.findMany({
      where: { sourceType: 'ProductionOrder', sourceId: id, type: 'PRODUCTION_CONSUMPTION' },
    });
    for (const movement of consumptionMovements) {
      if (!movement.warehouseId) continue;
      await this.stockService.applyMovement(user, {
        productId: movement.productId,
        warehouseId: movement.warehouseId,
        type: 'PRODUCTION_REVERSAL',
        qtyDelta: -Number(movement.qtyDelta),
        sourceType: 'ProductionOrder',
        sourceId: id,
        preferredOrderId: customerOrderId,
      });
    }

    // ---- Reverse sub-assembly consumption — return the exact FinishedGood
    // units this order consumed (recorded on its own pick-list rows),
    // never re-derived via a fresh FIFO pick. ----
    for (const line of order.pickListItems) {
      if (line.subAssemblyId && line.consumedFinishedGoodIds.length > 0) {
        await this.prisma.tenant.finishedGood.updateMany({
          where: { id: { in: line.consumedFinishedGoodIds } },
          data: { status: 'IN_STOCK', consumedInProductionOrderId: null },
        });
      }
    }

    // ---- Drop this order's own pick-list rows and the (confirmed-untouched)
    // output units it produced. Deliberately does NOT touch
    // ProductionOrderStageEvent: it's an immutable append-only ledger by the
    // same DB-level rule as stock_movements/payroll_entries/audit_events
    // (schema migration 20260805000000's `REVOKE UPDATE, DELETE ... FROM
    // app_user` — a real 500 the first time this ran in production,
    // "permission denied for table production_order_stage_events").
    // "Stage X was reached at time Y" stays true as a historical fact even
    // after the order is reverted, exactly like a reverted stock movement or
    // a voided execution's PayrollEntry never get deleted either. ----
    await this.prisma.tenant.productionOrderPickListItem.deleteMany({ where: { productionOrderId: id } });
    await this.prisma.tenant.finishedGood.deleteMany({ where: { productionOrderId: id } });

    // ---- Reset the order itself back to exactly its pre-start() state ----
    const reverted = await this.prisma.tenant.productionOrder.update({
      where: { id },
      data: {
        status: 'PLANNED',
        currentStageIndex: null,
        completedAt: null,
        totalLocalCostEur: null,
        totalGermanCostEur: null,
        laborCostEur: null,
        packagingCostEur: null,
        deliveryCostEur: null,
        otherCostEur: null,
        fullCostEur: null,
      },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'production_order.reverted',
      entityType: 'ProductionOrder',
      entityId: id,
      before: order,
      after: reverted,
    });

    return this.findOne(user, id);
  }

  // ============================================================
  // Stage advancement
  // ============================================================

  /** Records the transition, advances currentStageIndex, auto-completes on the last configured stage (ProductionStages.gs). */
  async advanceStage(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== 'IN_PROGRESS' || order.currentStageIndex === null) {
      throw new CodedBadRequestException('PRODUCTION_ADVANCE_ONLY_IN_PROGRESS', 'Only an IN_PROGRESS order with an active stage can be advanced.');
    }

    const stages = await this.prisma.tenant.productionStage.findMany({ orderBy: { sortOrder: 'asc' } });
    if (stages.length === 0) {
      throw new CodedConflictException(
        'PRODUCTION_NO_STAGES_CONFIGURED',
        'No production stages are configured — this order should already be COMPLETED.',
      );
    }

    await this.prisma.tenant.productionOrderStageEvent.create({
      data: {
        productionOrderId: id,
        stageIndex: order.currentStageIndex,
        actorUserId: user.userId,
      } as any,
    });

    const nextIndex = order.currentStageIndex + 1;
    const isLastStage = nextIndex >= stages.length;

    const updated = await this.prisma.tenant.productionOrder.update({
      where: { id },
      data: isLastStage
        ? { status: 'COMPLETED', currentStageIndex: null, completedAt: new Date() }
        : { currentStageIndex: nextIndex },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: isLastStage ? 'production_order.completed' : 'production_order.stage_advanced',
      entityType: 'ProductionOrder',
      entityId: id,
      after: updated,
    });

    return updated;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  private async writeWorkers(productionOrderId: string, workers: Array<{ employeeId: string; percent: number }>) {
    await this.prisma.tenant.productionOrderWorker.createMany({
      data: workers.map((w) => ({ productionOrderId, employeeId: w.employeeId, percent: w.percent })) as any,
    });
  }

  /** Just validates every employeeId is distinct and every percent is non-negative — normalization to 100 happens at start() time using whatever ratios were given (Phase 1 §3.5: "normalized to sum to 100 if the input percentages don't"). */
  private assertPercentagesNormalizable(workers: Array<{ employeeId: string; percent: number }>) {
    const seen = new Set<string>();
    for (const w of workers) {
      if (seen.has(w.employeeId)) {
        throw new CodedConflictException('PRODUCTION_WORKER_DUPLICATE', `Employee ${w.employeeId} is listed more than once.`);
      }
      seen.add(w.employeeId);
      if (w.percent < 0) {
        throw new CodedBadRequestException('PRODUCTION_WORKER_PERCENT_NEGATIVE', 'percent must be non-negative.');
      }
    }
    if (workers.every((w) => w.percent === 0)) {
      throw new CodedBadRequestException('PRODUCTION_WORKER_PERCENT_ALL_ZERO', 'At least one worker must have a nonzero percent.');
    }
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (!warehouse) {
      throw new CodedBadRequestException(
        'PRODUCTION_NO_DEFAULT_WAREHOUSE',
        'No default warehouse configured and none specified — cannot determine where to consume components from.',
      );
    }
    return warehouse.id;
  }
}
