import { Injectable } from '@nestjs/common';
import { CodedBadRequestException } from '../../common/api-exceptions';
import { DxfExportService, DxfExportCut } from '../cutting/dxf-export.service';
import {
  AvailableBarRemnant,
  AvailableIrregularSheetRemnant,
  AvailableSheetRemnant,
  BarDemandLine,
  IrregularSheetDemandLine,
  SheetDemandLine,
  optimizeBarCutting,
  optimizeIrregularSheetNesting,
  optimizeSheetNesting,
} from '../cutting/cutting-optimizer';
import { PreviewSupplierCuttingDto } from './dto/preview-supplier-cutting.dto';

export interface SupplierCuttingResultCut {
  pieceLabel: string;
  pieceLengthCm: number;
  pieceWidthCm: number | null;
  posXCm: number | null;
  posYCm: number | null;
  rotated: boolean;
  shapePolygonCm: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

export interface SupplierCuttingResultStockItem {
  lengthCm: number;
  widthCm: number | null;
  cuts: SupplierCuttingResultCut[];
  leftoverLengthCm: number | null;
  leftoverWidthCm: number | null;
  usedAreaCm2: number | null;
  wasteAreaCm2: number | null;
  /** Only ever set for SHEET — a BAR cut has no 2D layout to export, same gate as the staff export endpoint. */
  dxf: string | null;
}

export interface SupplierCuttingResult {
  kind: 'BAR' | 'SHEET';
  stockItems: SupplierCuttingResultStockItem[];
  unitsUsed: number;
}

/**
 * "розкрій має могти робити постачальник сам собі" (2026-11-02) — the
 * supplier-portal counterpart of `CuttingPlansService.preview`'s ad-hoc
 * multi-material worksheet mode, but ALWAYS the catalog-free "custom
 * material" branch, and — "нічого додаткового не повертається нам" — with
 * NO persistence at all: no `PrismaService`, no `CuttingPlan`/
 * `CuttingPlanStock`/`CuttingPlanCut` rows, no remnant tracking (a
 * supplier has no `StockRemnant` history in our system to draw from in
 * the first place). Just the pure optimizer + DXF writer, called directly.
 */
@Injectable()
export class SupplierCuttingService {
  constructor(private readonly dxfExportService: DxfExportService) {}

  preview(dto: PreviewSupplierCuttingDto): SupplierCuttingResult {
    const { material, lines } = dto;

    if (material.kind === 'SHEET' && material.stockWidthCm == null) {
      throw new CodedBadRequestException('CUTTING_SHEET_NEEDS_WIDTH', 'Для листового матеріалу потрібно вказати ширину листа.');
    }
    if (material.kind === 'SHEET') {
      for (const line of lines) {
        if (line.cutWidthCm == null) {
          throw new CodedBadRequestException('CUTTING_PIECE_NEEDS_WIDTH', 'Для листового матеріалу потрібно вказати ширину деталі.');
        }
      }
    }

    const kerfMm = material.kerfMm ?? 3;
    const allowRotation = material.allowRotation ?? true;
    const labelFallback = material.label;

    if (material.kind === 'BAR') {
      const demand: BarDemandLine[] = lines.map((l) => ({ label: l.label ?? labelFallback, lengthCm: l.cutLengthCm, qty: l.qty }));
      const availableRemnants: AvailableBarRemnant[] = [];
      const result = optimizeBarCutting(demand, material.stockLengthCm, kerfMm, availableRemnants);

      return {
        kind: 'BAR',
        unitsUsed: result.stockItems.length,
        stockItems: result.stockItems.map((stockItem) => ({
          lengthCm: stockItem.lengthCm,
          widthCm: null,
          leftoverLengthCm: stockItem.leftoverLengthCm,
          leftoverWidthCm: null,
          usedAreaCm2: null,
          wasteAreaCm2: null,
          dxf: null,
          cuts: stockItem.cuts.map((c) => ({
            pieceLabel: c.label,
            pieceLengthCm: c.pieceLengthCm,
            pieceWidthCm: null,
            posXCm: null,
            posYCm: null,
            rotated: false,
            shapePolygonCm: null,
          })),
        })),
      };
    }

    const stockWidthCm = material.stockWidthCm!;

    if (lines.some((l) => l.cutShapePolygon)) {
      const demand: IrregularSheetDemandLine[] = lines.map((l) => ({
        label: l.label ?? labelFallback,
        outerCm: l.cutShapePolygon ? l.cutShapePolygon.outerCm : rectangleAsPolygon(l.cutWidthCm ?? 0, l.cutLengthCm),
        holesCm: l.cutShapePolygon ? l.cutShapePolygon.holesCm ?? [] : [],
        qty: l.qty,
      }));
      const availableRemnants: AvailableIrregularSheetRemnant[] = [];
      const result = optimizeIrregularSheetNesting(demand, material.stockLengthCm, stockWidthCm, kerfMm, availableRemnants, allowRotation);

      return {
        kind: 'SHEET',
        unitsUsed: result.stockItems.length,
        stockItems: result.stockItems.map((stockItem) => {
          const cuts: DxfExportCut[] = stockItem.cuts.map((c) => ({
            pieceLengthCm: c.boundingLengthCm,
            pieceWidthCm: c.boundingWidthCm,
            posXCm: c.posXCm,
            posYCm: c.posYCm,
            shapePolygonCm: { outerCm: c.outerCm, holesCm: c.holesCm },
          }));
          return {
            lengthCm: stockItem.lengthCm,
            widthCm: stockItem.widthCm,
            leftoverLengthCm: null,
            leftoverWidthCm: null,
            usedAreaCm2: stockItem.usedAreaCm2,
            wasteAreaCm2: stockItem.wasteAreaCm2,
            dxf: this.dxfExportService.buildStockItemDxf({ lengthCm: stockItem.lengthCm, widthCm: stockItem.widthCm, cuts }),
            cuts: stockItem.cuts.map((c) => ({
              pieceLabel: c.label,
              pieceLengthCm: c.boundingLengthCm,
              pieceWidthCm: c.boundingWidthCm,
              posXCm: c.posXCm,
              posYCm: c.posYCm,
              rotated: c.rotated,
              shapePolygonCm: { outerCm: c.outerCm, holesCm: c.holesCm },
            })),
          };
        }),
      };
    }

    const demand: SheetDemandLine[] = lines.map((l) => ({ label: l.label ?? labelFallback, widthCm: l.cutWidthCm ?? 0, heightCm: l.cutLengthCm, qty: l.qty }));
    const availableRemnants: AvailableSheetRemnant[] = [];
    const result = optimizeSheetNesting(demand, material.stockLengthCm, stockWidthCm, kerfMm, availableRemnants, allowRotation);

    return {
      kind: 'SHEET',
      unitsUsed: result.stockItems.length,
      stockItems: result.stockItems.map((stockItem) => {
        const cuts: DxfExportCut[] = stockItem.cuts.map((c) => ({
          pieceLengthCm: c.pieceLengthCm,
          pieceWidthCm: c.pieceWidthCm,
          posXCm: c.posXCm,
          posYCm: c.posYCm,
          shapePolygonCm: null,
        }));
        return {
          lengthCm: stockItem.lengthCm,
          widthCm: stockItem.widthCm,
          leftoverLengthCm: stockItem.leftoverLengthCm,
          leftoverWidthCm: stockItem.leftoverWidthCm,
          usedAreaCm2: null,
          wasteAreaCm2: null,
          dxf: this.dxfExportService.buildStockItemDxf({ lengthCm: stockItem.lengthCm, widthCm: stockItem.widthCm, cuts }),
          cuts: stockItem.cuts.map((c) => ({
            pieceLabel: c.label,
            pieceLengthCm: c.pieceLengthCm,
            pieceWidthCm: c.pieceWidthCm,
            posXCm: c.posXCm,
            posYCm: c.posYCm,
            rotated: c.rotated,
            shapePolygonCm: null,
          })),
        };
      }),
    };
  }
}

/** Mirrors `rectangleAsPolygon` in `cutting-plans.service.ts` — a plain rectangle expressed as a trivial 4-point polygon, so a mixed group (some lines with a real contour, some without) can nest on the same irregular/raster engine. */
function rectangleAsPolygon(widthCm: number, heightCm: number): [number, number][] {
  return [
    [0, 0],
    [widthCm, 0],
    [widthCm, heightCm],
    [0, heightCm],
  ];
}
