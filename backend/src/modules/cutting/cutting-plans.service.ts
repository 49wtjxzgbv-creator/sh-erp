import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PreviewCuttingPlanDto } from './dto/preview-cutting-plan.dto';
import { UpsertProductCuttingSpecDto } from './dto/upsert-product-cutting-spec.dto';
import {
  AvailableBarRemnant,
  AvailableSheetRemnant,
  BarDemandLine,
  SheetDemandLine,
  optimizeBarCutting,
  optimizeSheetNesting,
} from './cutting-optimizer';

interface CutDemandLine {
  cutLengthCm: number;
  cutWidthCm: number | null;
  qty: number;
}

/**
 * Cutting-stock optimization (розкрій, 2026-10-31) — see
 * cutting-optimizer.ts's own header and the feature's plan doc for the full
 * design rationale. Orchestrates: flattening a BOM down to cut-stock
 * demand (mirrors AssembliesService#flattenRequirements, but per-component-
 * line rather than aggregated by product, since two lines can need
 * different cut lengths from the same raw material) → the pure optimizer →
 * persisting a DRAFT CuttingPlan for review/print → execute() turning that
 * into remnant bookkeeping. Never touches WarehouseStock.qty itself —
 * production's existing consumption flow keeps deducting exact meters
 * regardless of whether a CuttingPlan was ever run.
 */
@Injectable()
export class CuttingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async preview(user: RequestUser, dto: PreviewCuttingPlanDto) {
    const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: dto.assemblyId } });
    if (!assembly) {
      throw new CodedNotFoundException('CUTTING_ASSEMBLY_NOT_FOUND', `Assembly ${dto.assemblyId} not found.`);
    }

    const demandByProduct = new Map<string, CutDemandLine[]>();
    await this.flattenCutDemand(dto.assemblyId, Number(dto.qty), demandByProduct, new Set());

    if (demandByProduct.size === 0) {
      throw new CodedBadRequestException(
        'CUTTING_NO_CUT_STOCK_COMPONENTS',
        'Ця специфікація не містить компонентів із заданою довжиною/розміром розкрою — вкажіть довжину деталі в редакторі компонентів.',
      );
    }

    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());

    const plan = await this.prisma.tenant.cuttingPlan.create({
      data: { assemblyId: dto.assemblyId, warehouseId, qty: dto.qty, status: 'DRAFT', createdById: user.userId } as any,
    });

    for (const [productId, lines] of demandByProduct) {
      const spec = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId } });
      // The product's cutting spec may have been removed after the BOM line
      // was set with a cutLengthCm — this demand group is simply dropped
      // rather than crashing the whole preview.
      if (!spec) continue;

      const remnants = await this.prisma.tenant.stockRemnant.findMany({ where: { productId, warehouseId, status: 'AVAILABLE' } });

      if (spec.kind === 'BAR') {
        const demand: BarDemandLine[] = lines.map((l) => ({ label: productId, lengthCm: l.cutLengthCm, qty: l.qty }));
        const availableRemnants: AvailableBarRemnant[] = remnants.map((r) => ({ remnantId: r.id, lengthCm: Number(r.lengthCm) }));
        const result = optimizeBarCutting(demand, Number(spec.stockLengthCm), Number(spec.kerfMm), availableRemnants);

        for (const stockItem of result.stockItems) {
          const stockRow = await this.prisma.tenant.cuttingPlanStock.create({
            data: {
              cuttingPlanId: plan.id,
              productId,
              sourceKind: stockItem.sourceKind,
              remnantId: stockItem.remnantId,
              lengthCm: stockItem.lengthCm,
              leftoverLengthCm: stockItem.leftoverLengthCm,
            } as any,
          });
          if (stockItem.cuts.length > 0) {
            await this.prisma.tenant.cuttingPlanCut.createMany({
              data: stockItem.cuts.map((c) => ({ cuttingPlanStockId: stockRow.id, productId, pieceLengthCm: c.pieceLengthCm })) as any,
            });
          }
        }
      } else {
        const demand: SheetDemandLine[] = lines.map((l) => ({ label: productId, widthCm: l.cutWidthCm ?? 0, heightCm: l.cutLengthCm, qty: l.qty }));
        const availableRemnants: AvailableSheetRemnant[] = remnants.map((r) => ({ remnantId: r.id, lengthCm: Number(r.lengthCm), widthCm: Number(r.widthCm ?? 0) }));
        const result = optimizeSheetNesting(demand, Number(spec.stockLengthCm), Number(spec.stockWidthCm ?? 0), Number(spec.kerfMm), availableRemnants, spec.allowRotation);

        for (const stockItem of result.stockItems) {
          const stockRow = await this.prisma.tenant.cuttingPlanStock.create({
            data: {
              cuttingPlanId: plan.id,
              productId,
              sourceKind: stockItem.sourceKind,
              remnantId: stockItem.remnantId,
              lengthCm: stockItem.lengthCm,
              widthCm: stockItem.widthCm,
              leftoverLengthCm: stockItem.leftoverLengthCm,
              leftoverWidthCm: stockItem.leftoverWidthCm,
            } as any,
          });
          if (stockItem.cuts.length > 0) {
            await this.prisma.tenant.cuttingPlanCut.createMany({
              data: stockItem.cuts.map((c) => ({
                cuttingPlanStockId: stockRow.id,
                productId,
                pieceLengthCm: c.pieceLengthCm,
                pieceWidthCm: c.pieceWidthCm,
                posXCm: c.posXCm,
                posYCm: c.posYCm,
                rotated: c.rotated,
              })) as any,
            });
          }
        }
      }
    }

    return this.getDetail(user, plan.id);
  }

  async execute(user: RequestUser, cuttingPlanId: string) {
    const plan = await this.prisma.tenant.cuttingPlan.findUnique({ where: { id: cuttingPlanId }, include: { stockItems: true } });
    if (!plan) throw new CodedNotFoundException('CUTTING_PLAN_NOT_FOUND', `Cutting plan ${cuttingPlanId} not found.`);
    if (plan.status === 'EXECUTED') {
      throw new CodedConflictException('CUTTING_PLAN_ALREADY_EXECUTED', 'Цей план розкрою вже виконано.');
    }

    for (const stockItem of plan.stockItems) {
      if (stockItem.sourceKind === 'REMNANT' && stockItem.remnantId) {
        await this.prisma.tenant.stockRemnant.update({
          where: { id: stockItem.remnantId },
          data: { status: 'CONSUMED', consumedAt: new Date(), consumedInCuttingPlanId: plan.id },
        });
      }

      const spec = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId: stockItem.productId } });
      if (!spec) continue;

      const leftoverLengthCm = Number(stockItem.leftoverLengthCm ?? 0);
      const leftoverWidthCm = stockItem.leftoverWidthCm != null ? Number(stockItem.leftoverWidthCm) : null;
      const clearsThreshold =
        spec.kind === 'SHEET'
          ? leftoverWidthCm != null && leftoverWidthCm > 0 && leftoverLengthCm > 0 && (spec.minRemnantAreaCm2 == null || leftoverLengthCm * leftoverWidthCm >= Number(spec.minRemnantAreaCm2))
          : leftoverLengthCm > 0 && (spec.minRemnantLengthCm == null || leftoverLengthCm >= Number(spec.minRemnantLengthCm));

      if (clearsThreshold) {
        const code = await this.nextRemnantCode(user.companyId);
        const newRemnant = await this.prisma.tenant.stockRemnant.create({
          data: {
            productId: stockItem.productId,
            warehouseId: plan.warehouseId,
            kind: spec.kind,
            lengthCm: leftoverLengthCm,
            widthCm: spec.kind === 'SHEET' ? leftoverWidthCm : null,
            code,
            status: 'AVAILABLE',
            sourceType: 'CuttingPlan',
            sourceId: plan.id,
          } as any,
        });
        await this.prisma.tenant.cuttingPlanStock.update({ where: { id: stockItem.id }, data: { newRemnantId: newRemnant.id } });
      }
    }

    await this.prisma.tenant.cuttingPlan.update({ where: { id: plan.id }, data: { status: 'EXECUTED', executedAt: new Date() } });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'cutting_plan.executed',
      entityType: 'CuttingPlan',
      entityId: plan.id,
      after: { assemblyId: plan.assemblyId, qty: Number(plan.qty) },
    });

    return this.getDetail(user, plan.id);
  }

  async getDetail(user: RequestUser, cuttingPlanId: string) {
    const plan = await this.prisma.tenant.cuttingPlan.findUnique({
      where: { id: cuttingPlanId },
      include: { stockItems: { include: { cuts: true } } },
    });
    if (!plan) throw new CodedNotFoundException('CUTTING_PLAN_NOT_FOUND', `Cutting plan ${cuttingPlanId} not found.`);

    const productIds = Array.from(new Set(plan.stockItems.map((s) => s.productId)));
    const products = await this.prisma.tenant.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    const specs = await this.prisma.tenant.productCuttingSpec.findMany({ where: { productId: { in: productIds } } });
    const specByProduct = new Map(specs.map((s) => [s.productId, s]));

    const materials = productIds.map((productId) => {
      const stockItems = plan.stockItems.filter((s) => s.productId === productId);
      return {
        productId,
        product: productById.get(productId) ?? null,
        kind: specByProduct.get(productId)?.kind ?? null,
        freshUnitsNeeded: stockItems.filter((s) => s.sourceKind === 'FRESH').length,
        remnantsUsed: stockItems.filter((s) => s.sourceKind === 'REMNANT').length,
        stockItems,
      };
    });

    return { ...plan, materials };
  }

  async listRemnants(user: RequestUser, filter: { productId?: string; warehouseId?: string }) {
    return this.prisma.tenant.stockRemnant.findMany({
      where: { status: 'AVAILABLE', productId: filter.productId, warehouseId: filter.warehouseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveDefaultWarehouseId(): Promise<string> {
    const def = await this.prisma.tenant.warehouse.findFirst({ where: { deletedAt: null, isDefault: true } });
    if (!def) throw new CodedBadRequestException('CUTTING_NO_DEFAULT_WAREHOUSE', 'У компанії не налаштовано основний склад.');
    return def.id;
  }

  /** Mirrors FinishedGoodsService#generateSerialNumbers' advisory-lock pattern — must run inside the caller's existing request transaction. */
  private async nextRemnantCode(companyId: string): Promise<string> {
    await this.prisma.tenant.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}))`;
    const existingCount = await this.prisma.tenant.stockRemnant.count();
    return `З-${String(existingCount + 1).padStart(6, '0')}`;
  }

  /**
   * Walks AssemblyComponent rows recursively, same cycle-guarded recursion
   * shape as AssembliesService#flattenRequirements, but keeps each distinct
   * cut length as its own demand line (grouped only by raw-material
   * productId) rather than summing into one Map<productId, qty> — two BOM
   * lines for the same profile may need different cut lengths.
   */
  private async flattenCutDemand(assemblyId: string, qtyOfAssembly: number, demandByProduct: Map<string, CutDemandLine[]>, visited: Set<string>): Promise<void> {
    if (visited.has(assemblyId)) {
      throw new CodedConflictException('CUTTING_CIRCULAR_BOM', `Circular BOM detected while expanding assembly ${assemblyId}.`);
    }
    visited.add(assemblyId);

    const components = await this.prisma.tenant.assemblyComponent.findMany({ where: { assemblyId } });
    for (const line of components) {
      if (line.componentType === 'PRODUCT' && line.productId && line.cutLengthCm != null) {
        const pieceQty = Math.ceil(qtyOfAssembly * Number(line.qtyPerUnit));
        if (pieceQty <= 0) continue;
        const lines = demandByProduct.get(line.productId) ?? [];
        lines.push({ cutLengthCm: Number(line.cutLengthCm), cutWidthCm: line.cutWidthCm != null ? Number(line.cutWidthCm) : null, qty: pieceQty });
        demandByProduct.set(line.productId, lines);
      } else if (line.componentType === 'ASSEMBLY' && line.subAssemblyId) {
        const neededQty = qtyOfAssembly * Number(line.qtyPerUnit);
        await this.flattenCutDemand(line.subAssemblyId, neededQty, demandByProduct, visited);
      }
    }

    visited.delete(assemblyId);
  }

  // ============================================================
  // ProductCuttingSpec (product-level "матеріал для розкрою" toggle) —
  // edited from the Product page, 1:1 with Product.
  // ============================================================

  async getSpec(user: RequestUser, productId: string) {
    return this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId } });
  }

  async upsertSpec(user: RequestUser, productId: string, dto: UpsertProductCuttingSpecDto) {
    if (dto.kind === 'SHEET' && dto.stockWidthCm == null) {
      throw new CodedBadRequestException('CUTTING_SHEET_NEEDS_WIDTH', 'Для листового матеріалу потрібно вказати ширину листа.');
    }

    const existing = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId } });
    const data = {
      kind: dto.kind,
      stockLengthCm: dto.stockLengthCm,
      stockWidthCm: dto.kind === 'SHEET' ? dto.stockWidthCm : null,
      kerfMm: dto.kerfMm ?? 3,
      minRemnantLengthCm: dto.minRemnantLengthCm ?? null,
      minRemnantAreaCm2: dto.minRemnantAreaCm2 ?? null,
      allowRotation: dto.allowRotation ?? true,
    };

    if (existing) {
      return this.prisma.tenant.productCuttingSpec.update({ where: { id: existing.id }, data });
    }
    return this.prisma.tenant.productCuttingSpec.create({ data: { productId, ...data } as any });
  }

  async deleteSpec(user: RequestUser, productId: string): Promise<void> {
    const existing = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId } });
    if (!existing) return;
    await this.prisma.tenant.productCuttingSpec.delete({ where: { id: existing.id } });
  }
}
