import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PreviewCuttingPlanDto } from './dto/preview-cutting-plan.dto';
import { QueryCuttableProductsDto } from './dto/query-cuttable-products.dto';
import { UpsertProductCuttingSpecDto } from './dto/upsert-product-cutting-spec.dto';
import {
  AvailableBarRemnant,
  AvailableIrregularSheetRemnant,
  AvailableSheetRemnant,
  BarDemandLine,
  IrregularSheetDemandLine,
  Point2D,
  SheetDemandLine,
  optimizeBarCutting,
  optimizeIrregularSheetNesting,
  optimizeSheetNesting,
} from './cutting-optimizer';

interface ShapePolygon {
  outerCm: Point2D[];
  holesCm: Point2D[][];
}

interface CutDemandLine {
  cutLengthCm: number;
  cutWidthCm: number | null;
  qty: number;
  /** Irregular-shape nesting (2026-11-01): the real contour, STEP-sourced only — null for a plain-rectangle component. */
  shapePolygon: ShapePolygon | null;
  /** Ad-hoc multi-material worksheet (2026-11-01): the user's own free-text label for this position — null for assembly/direct-product-sourced demand. */
  pieceLabel: string | null;
}

/** A material group's resolved cutting spec — either read from a real ProductCuttingSpec or, for a catalog-free custom material, built in-memory straight from the request. Same shape either way so the per-material loop never needs to care which. */
interface ResolvedMaterialSpec {
  kind: 'BAR' | 'SHEET';
  stockLengthCm: number;
  stockWidthCm: number | null;
  kerfMm: number;
  allowRotation: boolean;
}

/** Which real product (if any) and/or custom-material label a demandByProduct group key resolves to. Always populated for every group key, regardless of source (assembly/direct-product groups are always real products; ad-hoc groups may be either). */
interface MaterialGroupInfo {
  productId: string | null;
  customMaterialLabel: string | null;
  /** Only set when productId is null. */
  customSpec: ResolvedMaterialSpec | null;
}

/** A plain rectangle, as a 4-point polygon — lets a simple BAR/SHEET-rectangle component nest on the same sheet as a real irregular-contour one via the same polygon placement engine. */
function rectangleAsPolygon(widthCm: number, heightCm: number): Point2D[] {
  return [
    [0, 0],
    [widthCm, 0],
    [widthCm, heightCm],
    [0, heightCm],
  ];
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
    this.validateExactlyOneSource(dto);

    const demandByProduct = new Map<string, CutDemandLine[]>();
    const materialGroupInfo = new Map<string, MaterialGroupInfo>();
    let qty: number;

    if (dto.assemblyId) {
      if (dto.qty == null) throw new CodedBadRequestException('CUTTING_QTY_REQUIRED', 'Вкажіть кількість виробів.');
      qty = Number(dto.qty);
      const assembly = await this.prisma.tenant.assembly.findUnique({ where: { id: dto.assemblyId } });
      if (!assembly) {
        throw new CodedNotFoundException('CUTTING_ASSEMBLY_NOT_FOUND', `Assembly ${dto.assemblyId} not found.`);
      }
      await this.flattenCutDemand(dto.assemblyId, qty, demandByProduct, new Set());

      if (demandByProduct.size === 0) {
        throw new CodedBadRequestException(
          'CUTTING_NO_CUT_STOCK_COMPONENTS',
          'Ця специфікація не містить компонентів із заданою довжиною/розміром розкрою — вкажіть довжину деталі в редакторі компонентів.',
        );
      }
    } else if (dto.productId) {
      if (dto.qty == null) throw new CodedBadRequestException('CUTTING_QTY_REQUIRED', 'Вкажіть кількість виробів.');
      qty = Number(dto.qty);
      // Direct-product cutting (2026-11-01): no BOM walk, a single demand
      // line built straight from the product's own ProductCuttingSpec.default*
      // fields, set once on the product page independently of any assembly.
      const spec = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId: dto.productId } });
      if (!spec) {
        throw new CodedNotFoundException('CUTTING_PRODUCT_SPEC_NOT_FOUND', `Product ${dto.productId} has no cutting spec.`);
      }
      if (spec.defaultCutLengthCm == null) {
        throw new CodedBadRequestException(
          'CUTTING_PRODUCT_NO_DEFAULT_SHAPE',
          'Для цього товару не задано розмір деталі для прямого розкрою — вкажіть довжину/ширину або завантажте STEP-файл на картці товару.',
        );
      }
      const shapePolygon = spec.defaultCutShapePolygon as unknown as ShapePolygon | null;
      demandByProduct.set(dto.productId, [
        {
          cutLengthCm: Number(spec.defaultCutLengthCm),
          cutWidthCm: spec.defaultCutWidthCm != null ? Number(spec.defaultCutWidthCm) : null,
          qty,
          shapePolygon: shapePolygon?.outerCm ? shapePolygon : null,
          pieceLabel: null,
        },
      ]);
    } else {
      // Ad-hoc multi-material worksheet (2026-11-01): the client supplies
      // the demand directly — no assembly/BOM, no single product's saved
      // default shape. Each line's material is EITHER an existing product
      // (materialProductId, reuses that product's own remnants) OR a fully
      // custom, catalog-free material (customMaterial — "довільний розкрій"
      // means not picking from the catalog for the material either, per
      // explicit user feedback; no remnant tracking for these, nothing
      // touches the catalog). Both kinds land in the SAME demandByProduct
      // map the assembly path already builds, grouped under a synthetic
      // string key for custom materials — so a worksheet can freely mix
      // real and custom materials in one plan with zero changes to the
      // per-material loop below beyond resolving `spec` from either source.
      const lines = dto.lines!;

      for (const line of lines) {
        const sourcesGiven = [Boolean(line.materialProductId), Boolean(line.customMaterial)].filter(Boolean).length;
        if (sourcesGiven !== 1) {
          throw new CodedBadRequestException(
            'CUTTING_LINE_MATERIAL_SOURCE_INVALID',
            'Кожна позиція повинна мати або товар-матеріал, або власний (довільний) матеріал — не обидва і не жодного.',
          );
        }
        if (line.customMaterial && line.customMaterial.kind === 'SHEET' && line.customMaterial.stockWidthCm == null) {
          throw new CodedBadRequestException('CUTTING_SHEET_NEEDS_WIDTH', 'Для листового матеріалу потрібно вказати ширину листа.');
        }
      }

      const materialIds = Array.from(new Set(lines.map((l) => l.materialProductId).filter((id): id is string => Boolean(id))));
      const specByProduct = new Map<string, { kind: 'BAR' | 'SHEET' }>();
      if (materialIds.length > 0) {
        const specs = await this.prisma.tenant.productCuttingSpec.findMany({ where: { productId: { in: materialIds } } });
        for (const s of specs) specByProduct.set(s.productId, s);
        const missing = materialIds.filter((id) => !specByProduct.has(id));
        if (missing.length > 0) {
          throw new CodedBadRequestException(
            'CUTTING_LINE_MATERIAL_NO_SPEC',
            `Для товарів без спеки розкрою не можна рахувати: ${missing.join(', ')}. Увімкніть "Матеріал для розкрою" на картці товару.`,
          );
        }
      }

      // Every line whose material (real or custom) is SHEET-kind must carry
      // its own piece width — without this, a blank cutWidthCm silently
      // defaults to 0 further down and the optimizer happily "places" a
      // zero-area piece instead of erroring.
      for (const line of lines) {
        const kind = line.materialProductId ? specByProduct.get(line.materialProductId)!.kind : line.customMaterial!.kind;
        if (kind === 'SHEET' && line.cutWidthCm == null) {
          throw new CodedBadRequestException('CUTTING_PIECE_NEEDS_WIDTH', 'Для листового матеріалу потрібно вказати ширину деталі.');
        }
      }

      qty = lines.reduce((sum, l) => sum + Number(l.qty), 0);
      for (const line of lines) {
        let groupKey: string;
        if (line.materialProductId) {
          groupKey = line.materialProductId;
          if (!materialGroupInfo.has(groupKey)) {
            materialGroupInfo.set(groupKey, { productId: groupKey, customMaterialLabel: null, customSpec: null });
          }
        } else {
          const cm = line.customMaterial!;
          const kerfMm = cm.kerfMm ?? 3;
          groupKey = `custom:${cm.kind}:${cm.stockLengthCm}:${cm.stockWidthCm ?? ''}:${kerfMm}:${cm.label}`;
          if (!materialGroupInfo.has(groupKey)) {
            materialGroupInfo.set(groupKey, {
              productId: null,
              customMaterialLabel: cm.label,
              customSpec: { kind: cm.kind, stockLengthCm: cm.stockLengthCm, stockWidthCm: cm.stockWidthCm ?? null, kerfMm, allowRotation: true },
            });
          }
        }

        const group = demandByProduct.get(groupKey) ?? [];
        group.push({
          cutLengthCm: Number(line.cutLengthCm),
          cutWidthCm: line.cutWidthCm != null ? Number(line.cutWidthCm) : null,
          qty: Number(line.qty),
          shapePolygon: line.cutShapePolygon?.outerCm ? (line.cutShapePolygon as unknown as ShapePolygon) : null,
          pieceLabel: line.label ?? null,
        });
        demandByProduct.set(groupKey, group);
      }
    }

    // Assembly/direct-product group keys are always real productIds —
    // fill those in now so the per-material loop below can treat every
    // group uniformly regardless of source. (Ad-hoc already populated its
    // own entries, real and custom, above.)
    for (const groupKey of demandByProduct.keys()) {
      if (!materialGroupInfo.has(groupKey)) {
        materialGroupInfo.set(groupKey, { productId: groupKey, customMaterialLabel: null, customSpec: null });
      }
    }

    const warehouseId = dto.warehouseId ?? (await this.resolveDefaultWarehouseId());

    const plan = await this.prisma.tenant.cuttingPlan.create({
      data: { assemblyId: dto.assemblyId ?? null, productId: dto.productId ?? null, warehouseId, qty, status: 'DRAFT', createdById: user.userId } as any,
    });

    for (const [groupKey, lines] of demandByProduct) {
      const groupInfo = materialGroupInfo.get(groupKey)!;
      const { productId, customMaterialLabel } = groupInfo;
      // Real-vs-custom fallback for the optimizer's own `label` field
      // (always a non-empty string) — productId when this group has one,
      // else the synthetic group key. Also doubles as the sentinel to
      // detect "no real piece label was given" when persisting pieceLabel
      // below (the optimizer carries `label` through to every output cut
      // untouched, so comparing against this exact fallback recovers
      // whether a real per-piece label was set).
      const labelFallback = productId ?? groupKey;

      let spec: ResolvedMaterialSpec;
      let remnants: { id: string; lengthCm: unknown; widthCm: unknown }[] = [];
      if (productId) {
        const dbSpec = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId } });
        // The product's cutting spec may have been removed after the BOM
        // line was set with a cutLengthCm — this demand group is simply
        // dropped rather than crashing the whole preview.
        if (!dbSpec) continue;
        spec = {
          kind: dbSpec.kind,
          stockLengthCm: Number(dbSpec.stockLengthCm),
          stockWidthCm: dbSpec.stockWidthCm != null ? Number(dbSpec.stockWidthCm) : null,
          kerfMm: Number(dbSpec.kerfMm),
          allowRotation: dbSpec.allowRotation,
        };
        remnants = await this.prisma.tenant.stockRemnant.findMany({ where: { productId, warehouseId, status: 'AVAILABLE' } });
      } else {
        // Custom (catalog-free) material (2026-11-01) — no remnants exist
        // or ever get created for these (nothing in the catalog to tie a
        // StockRemnant.productId to); `spec` was already fully resolved
        // from the request when this group was first seen above.
        spec = groupInfo.customSpec!;
      }

      if (spec.kind === 'BAR') {
        const demand: BarDemandLine[] = lines.map((l) => ({ label: l.pieceLabel ?? labelFallback, lengthCm: l.cutLengthCm, qty: l.qty }));
        const availableRemnants: AvailableBarRemnant[] = remnants.map((r) => ({ remnantId: r.id, lengthCm: Number(r.lengthCm) }));
        const result = optimizeBarCutting(demand, spec.stockLengthCm, spec.kerfMm, availableRemnants);

        for (const stockItem of result.stockItems) {
          const stockRow = await this.prisma.tenant.cuttingPlanStock.create({
            data: {
              cuttingPlanId: plan.id,
              productId,
              customMaterialLabel,
              sourceKind: stockItem.sourceKind,
              remnantId: stockItem.remnantId,
              lengthCm: stockItem.lengthCm,
              leftoverLengthCm: stockItem.leftoverLengthCm,
            } as any,
          });
          if (stockItem.cuts.length > 0) {
            await this.prisma.tenant.cuttingPlanCut.createMany({
              data: stockItem.cuts.map((c) => ({
                cuttingPlanStockId: stockRow.id,
                productId,
                pieceLengthCm: c.pieceLengthCm,
                pieceLabel: c.label !== labelFallback ? c.label : null,
              })) as any,
            });
          }
        }
      } else if (lines.some((l) => l.shapePolygon)) {
        // Irregular-shape nesting (2026-11-01): at least one component in
        // this material group has a real contour — nest the WHOLE group
        // (rectangle-only lines included, as trivial 4-point polygons) on
        // the same grid/raster engine, so everything shares one set of
        // sheets/remnants.
        const demand: IrregularSheetDemandLine[] = lines.map((l) => ({
          label: l.pieceLabel ?? labelFallback,
          outerCm: l.shapePolygon ? l.shapePolygon.outerCm : rectangleAsPolygon(l.cutWidthCm ?? 0, l.cutLengthCm),
          holesCm: l.shapePolygon ? l.shapePolygon.holesCm : [],
          qty: l.qty,
        }));
        const availableRemnants: AvailableIrregularSheetRemnant[] = remnants.map((r) => ({ remnantId: r.id, lengthCm: Number(r.lengthCm), widthCm: Number(r.widthCm ?? 0) }));
        const result = optimizeIrregularSheetNesting(demand, spec.stockLengthCm, spec.stockWidthCm ?? 0, spec.kerfMm, availableRemnants, spec.allowRotation);

        for (const stockItem of result.stockItems) {
          const stockRow = await this.prisma.tenant.cuttingPlanStock.create({
            data: {
              cuttingPlanId: plan.id,
              productId,
              customMaterialLabel,
              sourceKind: stockItem.sourceKind,
              remnantId: stockItem.remnantId,
              lengthCm: stockItem.lengthCm,
              widthCm: stockItem.widthCm,
              // No clean rectangular leftover for an irregular nest — see
              // this service's class header / the feature's plan doc for
              // why no StockRemnant gets created from these at execute().
              usedAreaCm2: stockItem.usedAreaCm2,
              wasteAreaCm2: stockItem.wasteAreaCm2,
            } as any,
          });
          if (stockItem.cuts.length > 0) {
            await this.prisma.tenant.cuttingPlanCut.createMany({
              data: stockItem.cuts.map((c) => ({
                cuttingPlanStockId: stockRow.id,
                productId,
                pieceLengthCm: c.boundingLengthCm,
                pieceWidthCm: c.boundingWidthCm,
                posXCm: c.posXCm,
                posYCm: c.posYCm,
                rotated: c.rotated,
                shapePolygonCm: { outerCm: c.outerCm, holesCm: c.holesCm },
                pieceLabel: c.label !== labelFallback ? c.label : null,
              })) as any,
            });
          }
        }
      } else {
        const demand: SheetDemandLine[] = lines.map((l) => ({ label: l.pieceLabel ?? labelFallback, widthCm: l.cutWidthCm ?? 0, heightCm: l.cutLengthCm, qty: l.qty }));
        const availableRemnants: AvailableSheetRemnant[] = remnants.map((r) => ({ remnantId: r.id, lengthCm: Number(r.lengthCm), widthCm: Number(r.widthCm ?? 0) }));
        const result = optimizeSheetNesting(demand, spec.stockLengthCm, spec.stockWidthCm ?? 0, spec.kerfMm, availableRemnants, spec.allowRotation);

        for (const stockItem of result.stockItems) {
          const stockRow = await this.prisma.tenant.cuttingPlanStock.create({
            data: {
              cuttingPlanId: plan.id,
              productId,
              customMaterialLabel,
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
                pieceLabel: c.label !== labelFallback ? c.label : null,
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

      // Custom (catalog-free) material (2026-11-01) — no product, so no
      // ProductCuttingSpec and no remnant to ever create from its leftover.
      if (!stockItem.productId) continue;

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
      after: { assemblyId: plan.assemblyId, productId: plan.productId, qty: Number(plan.qty) },
    });

    return this.getDetail(user, plan.id);
  }

  async getDetail(user: RequestUser, cuttingPlanId: string) {
    const plan = await this.prisma.tenant.cuttingPlan.findUnique({
      where: { id: cuttingPlanId },
      include: { stockItems: { include: { cuts: true } } },
    });
    if (!plan) throw new CodedNotFoundException('CUTTING_PLAN_NOT_FOUND', `Cutting plan ${cuttingPlanId} not found.`);

    // Ad-hoc multi-material worksheet (2026-11-01): a stock item may have
    // no productId at all (a custom, catalog-free material) — group by
    // productId when present, else by (customMaterialLabel, stock dims),
    // which is safe because every stock row from the same preview()-time
    // group necessarily shares the same nominal stock size + label (that's
    // what "same material" meant when the demand was grouped).
    const groupKeyOf = (s: { productId: string | null; customMaterialLabel: string | null; lengthCm: unknown; widthCm: unknown }) =>
      s.productId ? `p:${s.productId}` : `c:${s.customMaterialLabel}:${s.lengthCm}:${s.widthCm ?? ''}`;

    const productIds = Array.from(new Set(plan.stockItems.map((s) => s.productId).filter((id): id is string => id != null)));
    const products = await this.prisma.tenant.product.findMany({ where: { id: { in: productIds } } });
    const productById = new Map(products.map((p) => [p.id, p]));

    const specs = await this.prisma.tenant.productCuttingSpec.findMany({ where: { productId: { in: productIds } } });
    const specByProduct = new Map(specs.map((s) => [s.productId, s]));

    const groupKeys = Array.from(new Set(plan.stockItems.map((s) => groupKeyOf(s))));
    const materials = groupKeys.map((groupKey) => {
      const stockItems = plan.stockItems.filter((s) => groupKeyOf(s) === groupKey);
      const first = stockItems[0];
      return {
        productId: first.productId,
        product: first.productId ? (productById.get(first.productId) ?? null) : null,
        materialLabel: first.customMaterialLabel ?? null,
        kind: first.productId ? (specByProduct.get(first.productId)?.kind ?? null) : first.widthCm != null ? 'SHEET' : 'BAR',
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

  /** Direct-product cutting (2026-11-01): exactly one of assemblyId/productId must be set — mirrors the cutting_plan_source_consistency DB CHECK constraint. */
  /** Ad-hoc multi-material worksheet (2026-11-01): exactly one of assemblyId/productId/lines must be given. */
  private validateExactlyOneSource(dto: PreviewCuttingPlanDto): void {
    const sourcesGiven = [Boolean(dto.assemblyId), Boolean(dto.productId), Boolean(dto.lines?.length)].filter(Boolean).length;
    if (sourcesGiven > 1) {
      throw new CodedBadRequestException('CUTTING_PLAN_SOURCE_AMBIGUOUS', 'Вкажіть специфікацію, товар АБО довільний список позицій — не декілька одночасно.');
    }
    if (sourcesGiven === 0) {
      throw new CodedBadRequestException('CUTTING_PLAN_SOURCE_REQUIRED', 'Потрібно вказати специфікацію, товар або список позицій для розкрою.');
    }
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
        const shapePolygon = line.cutShapePolygon as unknown as ShapePolygon | null;
        lines.push({
          cutLengthCm: Number(line.cutLengthCm),
          cutWidthCm: line.cutWidthCm != null ? Number(line.cutWidthCm) : null,
          qty: pieceQty,
          shapePolygon: shapePolygon?.outerCm ? shapePolygon : null,
          pieceLabel: null,
        });
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
    // Direct-product cutting (2026-11-01): same reasoning as the ad-hoc
    // worksheet's own CUTTING_PIECE_NEEDS_WIDTH check — a SHEET material with
    // a default cut length but no default cut width would otherwise silently
    // become a 0-width demand line when "Порахувати розкрій" runs.
    if (dto.kind === 'SHEET' && dto.defaultCutLengthCm != null && dto.defaultCutWidthCm == null) {
      throw new CodedBadRequestException('CUTTING_PIECE_NEEDS_WIDTH', 'Для листового матеріалу потрібно вказати ширину деталі за замовчуванням.');
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
      // Direct-product cutting (2026-11-01)
      defaultCutLengthCm: dto.defaultCutLengthCm ?? null,
      defaultCutWidthCm: dto.defaultCutWidthCm ?? null,
      defaultCutShapePolygon: dto.defaultCutShapePolygon ?? null,
    };

    if (existing) {
      return this.prisma.tenant.productCuttingSpec.update({ where: { id: existing.id }, data: data as any });
    }
    return this.prisma.tenant.productCuttingSpec.create({ data: { productId, ...data } as any });
  }

  async deleteSpec(user: RequestUser, productId: string): Promise<void> {
    const existing = await this.prisma.tenant.productCuttingSpec.findFirst({ where: { productId } });
    if (!existing) return;
    await this.prisma.tenant.productCuttingSpec.delete({ where: { id: existing.id } });
  }

  /**
   * Direct-product cutting (2026-11-01): every product with a
   * ProductCuttingSpec, enriched with draft/executed CuttingPlan counts and
   * the last plan's date — backs the top-level "Розкрій" list page. Counts
   * computed via groupBy + in-memory merge, same style as getDetail()'s own
   * Map-based grouping, rather than a raw SQL join.
   */
  async listCuttableProducts(user: RequestUser, query: QueryCuttableProductsDto) {
    const where: any = { product: { deletedAt: null } };
    if (query.search) {
      where.product.OR = [{ name: { contains: query.search, mode: 'insensitive' } }, { article: { contains: query.search, mode: 'insensitive' } }];
    }

    const take = query.limit ?? 50;
    const skip = query.offset ?? 0;

    const [specs, total] = await Promise.all([
      this.prisma.tenant.productCuttingSpec.findMany({
        where,
        include: { product: true },
        orderBy: { product: { name: 'asc' } },
        take,
        skip,
      }),
      this.prisma.tenant.productCuttingSpec.count({ where }),
    ]);

    const productIds = specs.map((s) => s.productId);
    const counts = await this.prisma.tenant.cuttingPlan.groupBy({
      by: ['productId', 'status'],
      where: { productId: { in: productIds } },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const items = specs.map(({ product, ...spec }) => {
      const rows = counts.filter((c) => c.productId === spec.productId);
      const draftPlanCount = rows.find((r) => r.status === 'DRAFT')?._count._all ?? 0;
      const executedPlanCount = rows.find((r) => r.status === 'EXECUTED')?._count._all ?? 0;
      const lastPlanAt = rows.reduce<Date | null>((max, r) => {
        const at = r._max.createdAt;
        return at && (!max || at > max) ? at : max;
      }, null);
      return {
        productId: spec.productId,
        product,
        spec,
        hasDefaultShape: spec.defaultCutLengthCm != null,
        draftPlanCount,
        executedPlanCount,
        lastPlanAt,
      };
    });

    return { items, total, limit: take, offset: skip };
  }
}
