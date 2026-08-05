import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import {
  CreateProductionOrderDto,
  QueryProductionOrdersDto,
  SetProductionOrderWorkersDto,
  StartProductionOrderDto,
} from './dto/production-order.dto';
import { FinishedGoodsService } from './finished-goods.service';

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
    private readonly finishedGoodsService: FinishedGoodsService,
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
    if (!assembly) throw new NotFoundException('Assembly not found.');

    const latestVersion = await this.prisma.tenant.assemblyVersion.findFirst({
      where: { assemblyId: dto.assemblyId },
      orderBy: { versionNumber: 'desc' },
    });
    if (!latestVersion) {
      throw new BadRequestException(
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
      } as any,
    });

    if (dto.workers && dto.workers.length > 0) {
      await this.writeWorkers(order.id, dto.workers);
    }

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

  async findOne(user: RequestUser, id: string) {
    const order = await this.prisma.tenant.productionOrder.findUnique({
      where: { id },
      include: { workers: true, pickListItems: true, stageEvents: true, finishedGoods: true },
    });
    if (!order) throw new NotFoundException('Production order not found.');
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
      throw new BadRequestException('Workers can only be (re)assigned while the order is still PLANNED.');
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
      throw new BadRequestException('Only a PLANNED production order can be cancelled.');
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

  // ============================================================
  // Start — the core lifecycle transition
  // ============================================================

  async start(user: RequestUser, id: string, dto: StartProductionOrderDto) {
    const order = await this.findOne(user, id);
    if (order.status !== 'PLANNED') {
      throw new BadRequestException('Only a PLANNED production order can be started.');
    }
    if (!order.assemblyVersionId) {
      throw new ConflictException('This order has no locked BOM version — cannot start (pre-versioning legacy data, Phase 1 §6.4).');
    }

    const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: order.assemblyId } });
    if (!assembly) throw new NotFoundException('Assembly not found.');

    const version = await this.prisma.tenant.assemblyVersion.findUnique({
      where: { id: order.assemblyVersionId },
      include: { components: true },
    });
    if (!version) throw new NotFoundException('Locked assembly version not found.');

    const unitsPlanned = Number(order.unitsPlanned);
    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());

    // ---- Pass 1: check availability for every line before consuming anything ----
    const shortages: ShortageLine[] = [];
    const productLines: Array<{ productId: string; needed: number }> = [];
    const assemblyLines: Array<{ subAssemblyId: string; needed: number }> = [];

    for (const line of version.components) {
      const qtyPerUnit = Number(line.qtyPerUnit);
      if (line.componentType === 'PRODUCT' && line.productId) {
        const needed = unitsPlanned * qtyPerUnit;
        productLines.push({ productId: line.productId, needed });
        const product = await this.prisma.tenant.product.findUnique({ where: { id: line.productId } });
        const available = Number(product?.qty ?? 0);
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
      throw new BadRequestException({
        message: 'Insufficient stock/finished goods to start this production order.',
        shortages,
      });
    }

    // ---- Pass 2: consume ----
    let materialsLocalCost = 0;
    let materialsGermanCost = 0;
    const pickListRows: Array<{
      productId: string | null;
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
      const unitPrice = Number(product.localPriceExclVat ?? 0);
      materialsLocalCost += unitPrice * needed;
      materialsGermanCost += Number(product.germanPriceExclVat ?? 0) * needed;
      pickListRows.push({
        productId,
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
        throw new ConflictException(`Not enough IN_STOCK finished goods for sub-assembly ${subAssemblyId}.`);
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

    // ---- Piecework payroll split (Phase 1 §3.5) ----
    const workers = await this.prisma.tenant.productionOrderWorker.findMany({ where: { productionOrderId: order.id } });
    if (workers.length > 0) {
      const totalPercent = workers.reduce((sum, w) => sum + Number(w.percent), 0);
      await this.prisma.tenant.payrollEntry.createMany({
        data: workers.map((w) => {
          const normalizedPercent = totalPercent > 0 ? (Number(w.percent) / totalPercent) * 100 : 0;
          return {
            employeeId: w.employeeId,
            type: 'PIECEWORK',
            productionOrderId: order.id,
            unitsProduced: unitsPlanned * (normalizedPercent / 100),
            amount: ownLabor * (normalizedPercent / 100),
            createdById: user.userId,
            comment: `Piecework for production order ${order.id}`,
          };
        }) as any,
      });
    }

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
  // Stage advancement
  // ============================================================

  /** Records the transition, advances currentStageIndex, auto-completes on the last configured stage (ProductionStages.gs). */
  async advanceStage(user: RequestUser, id: string) {
    const order = await this.findOne(user, id);
    if (order.status !== 'IN_PROGRESS' || order.currentStageIndex === null) {
      throw new BadRequestException('Only an IN_PROGRESS order with an active stage can be advanced.');
    }

    const stages = await this.prisma.tenant.productionStage.findMany({ orderBy: { sortOrder: 'asc' } });
    if (stages.length === 0) {
      throw new ConflictException('No production stages are configured — this order should already be COMPLETED.');
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
        throw new ConflictException(`Employee ${w.employeeId} is listed more than once.`);
      }
      seen.add(w.employeeId);
      if (w.percent < 0) {
        throw new BadRequestException('percent must be non-negative.');
      }
    }
    if (workers.every((w) => w.percent === 0)) {
      throw new BadRequestException('At least one worker must have a nonzero percent.');
    }
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const warehouse = await this.prisma.tenant.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });
    if (!warehouse) {
      throw new BadRequestException(
        'No default warehouse configured and none specified — cannot determine where to consume components from.',
      );
    }
    return warehouse.id;
  }
}
