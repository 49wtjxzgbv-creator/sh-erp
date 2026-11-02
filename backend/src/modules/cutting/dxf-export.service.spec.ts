import { Parser } from '@dxfjs/parser';
import { DxfExportService } from './dxf-export.service';

describe('DxfExportService', () => {
  const service = new DxfExportService();

  it('round-trips a sheet with a rectangle cut and an irregular cut-with-hole through @dxfjs/parser', async () => {
    const dxfText = service.buildStockItemDxf({
      lengthCm: 50,
      widthCm: 40,
      cuts: [
        { pieceLengthCm: 20, pieceWidthCm: 15, posXCm: 5, posYCm: 5, shapePolygonCm: null },
        {
          pieceLengthCm: 0,
          pieceWidthCm: null,
          posXCm: null,
          posYCm: null,
          shapePolygonCm: {
            outerCm: [
              [30, 5],
              [45, 5],
              [45, 20],
              [30, 20],
            ],
            holesCm: [
              [
                [35, 10],
                [40, 10],
                [40, 15],
                [35, 15],
              ],
            ],
          },
        },
      ],
    });

    const dxf = await new Parser().parse(dxfText);

    expect(dxf.header['$INSUNITS']).toBe(4);
    // sheet boundary + rectangle cut + irregular outer + its hole
    expect(dxf.entities.lwPolylines).toHaveLength(4);

    // mm (×10), y-flipped against the sheet's own 40cm width so the file
    // matches a human looking down at the sheet, not a mirrored SVG copy.
    const [sheetBoundary, rectCut] = dxf.entities.lwPolylines;
    expect(sheetBoundary.vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 400],
      [500, 400],
      [500, 0],
      [0, 0],
    ]);
    expect(rectCut.vertices.map((v) => [v.x, v.y])).toEqual([
      [50, 350],
      [250, 350],
      [250, 200],
      [50, 200],
    ]);
  });

  it('skips a cut with neither shapePolygonCm nor a full rectangle rather than fabricating geometry', async () => {
    const dxfText = service.buildStockItemDxf({
      lengthCm: 50,
      widthCm: 40,
      cuts: [{ pieceLengthCm: 20, pieceWidthCm: null, posXCm: null, posYCm: null, shapePolygonCm: null }],
    });

    const dxf = await new Parser().parse(dxfText);

    // only the sheet's own reference boundary
    expect(dxf.entities.lwPolylines).toHaveLength(1);
  });
});
