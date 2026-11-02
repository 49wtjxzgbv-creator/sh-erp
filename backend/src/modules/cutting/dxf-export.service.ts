import { Injectable } from '@nestjs/common';

/**
 * DXF shape EXPORT for розкрій (2026-11-01) — the inverse of
 * ../files/dxf-extraction.service.ts: that one reads a DXF to get a piece's
 * contour IN; this one writes the computed nesting layout of one physical
 * sheet back OUT, so a shop can load it straight into cutting-machine
 * software (laser/plasma/router CAM packages virtually all import DXF).
 *
 * `@dxfjs/parser` (already in this codebase for the read side) has no
 * writer API at all — DXF's own format is plain group-code/value text
 * pairs, trivial to hand-author (already done successfully this session
 * for test fixtures), so a small hand-rolled writer is the right call
 * here, not a second dependency.
 *
 * Only SHEET-kind stock items make sense to export — a BAR cut has no 2D
 * position at all (see CuttingPlansService#exportStockItemDxf's own
 * widthCm-null check, which gates this).
 */

export interface DxfExportCut {
  pieceLengthCm: number;
  pieceWidthCm: number | null;
  posXCm: number | null;
  posYCm: number | null;
  shapePolygonCm: { outerCm: [number, number][]; holesCm: [number, number][][] } | null;
}

export interface DxfExportStockItem {
  lengthCm: number;
  widthCm: number;
  cuts: DxfExportCut[];
}

const CM_TO_MM = 10; // DXF files are conventionally authored in mm (same assumption the read side makes) — see dxf-extraction.service.ts's own header comment.

function rectanglePolygon(xCm: number, yCm: number, lengthCm: number, widthCm: number): [number, number][] {
  return [
    [xCm, yCm],
    [xCm + lengthCm, yCm],
    [xCm + lengthCm, yCm + widthCm],
    [xCm, yCm + widthCm],
  ];
}

/**
 * SVG's `y` grows downward (the convention `SheetStockDiagram` on the
 * frontend already draws with); DXF's — and a person looking at a real
 * sheet from above — grows upward. Flips `y` against the sheet's own width
 * so the exported file matches how a human expects to see the sheet, not a
 * mirrored copy of the on-screen SVG coordinate space.
 */
function flipY(points: [number, number][], widthCm: number): [number, number][] {
  return points.map(([x, y]): [number, number] => [x, widthCm - y]);
}

function writeLwPolyline(points: [number, number][]): string {
  let s = `0\nLWPOLYLINE\n90\n${points.length}\n70\n1\n`;
  for (const [x, y] of points) {
    s += `10\n${(x * CM_TO_MM).toFixed(3)}\n20\n${(y * CM_TO_MM).toFixed(3)}\n`;
  }
  return s;
}

@Injectable()
export class DxfExportService {
  buildStockItemDxf(stockItem: DxfExportStockItem): string {
    let entities = '';

    // Reference boundary — the physical sheet's own outline, helps line up
    // the layout in CAM software (same reason the on-screen SheetStockDiagram
    // always shows the sheet's own border, not just the pieces floating in
    // space).
    entities += writeLwPolyline(flipY(rectanglePolygon(0, 0, stockItem.lengthCm, stockItem.widthCm), stockItem.widthCm));

    for (const cut of stockItem.cuts) {
      if (cut.shapePolygonCm) {
        entities += writeLwPolyline(flipY(cut.shapePolygonCm.outerCm, stockItem.widthCm));
        for (const hole of cut.shapePolygonCm.holesCm) {
          entities += writeLwPolyline(flipY(hole, stockItem.widthCm));
        }
      } else if (cut.pieceWidthCm != null && cut.posXCm != null && cut.posYCm != null) {
        entities += writeLwPolyline(flipY(rectanglePolygon(cut.posXCm, cut.posYCm, cut.pieceLengthCm, cut.pieceWidthCm), stockItem.widthCm));
      }
      // A cut missing both shapePolygonCm and a full rectangle (posX/posY
      // never null for an ordinary SHEET cut, per the optimizer's own
      // output contract) has nothing drawable — silently skipped rather
      // than guessed, same "drop, don't fabricate" discipline as the read
      // side's dangling-path handling.
    }

    const header = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n';
    const entitiesSection = `0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n`;
    return `${header}${entitiesSection}0\nEOF\n`;
  }
}
