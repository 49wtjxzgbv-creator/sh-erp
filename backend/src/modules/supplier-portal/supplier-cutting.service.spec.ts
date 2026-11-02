import { CodedBadRequestException } from '../../common/api-exceptions';
import { DxfExportService } from '../cutting/dxf-export.service';
import { SupplierCuttingService } from './supplier-cutting.service';
import { PreviewSupplierCuttingDto } from './dto/preview-supplier-cutting.dto';

describe('SupplierCuttingService', () => {
  const service = new SupplierCuttingService(new DxfExportService());

  it('nests a plain rectangle SHEET worksheet and attaches a DXF per stock item', () => {
    const dto: PreviewSupplierCuttingDto = {
      material: { label: 'Лист металу 2мм', kind: 'SHEET', stockLengthCm: 100, stockWidthCm: 50, kerfMm: 2 },
      lines: [{ label: 'деталь', qty: 3, cutLengthCm: 30, cutWidthCm: 20 }],
    };

    const result = service.preview(dto);

    expect(result.kind).toBe('SHEET');
    expect(result.stockItems.length).toBeGreaterThan(0);
    for (const stockItem of result.stockItems) {
      expect(stockItem.widthCm).toBe(50);
      expect(typeof stockItem.dxf).toBe('string');
      expect(stockItem.dxf).toContain('LWPOLYLINE');
    }
    const totalCuts = result.stockItems.reduce((sum, s) => sum + s.cuts.length, 0);
    expect(totalCuts).toBe(3);
  });

  it('nests an irregular/polygon SHEET worksheet via the raster engine, still attaching a DXF', () => {
    const dto: PreviewSupplierCuttingDto = {
      material: { label: 'Лист', kind: 'SHEET', stockLengthCm: 100, stockWidthCm: 100 },
      lines: [
        {
          qty: 1,
          cutLengthCm: 10,
          cutWidthCm: 10,
          cutShapePolygon: {
            outerCm: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          },
        },
      ],
    };

    const result = service.preview(dto);

    expect(result.kind).toBe('SHEET');
    expect(result.stockItems).toHaveLength(1);
    expect(result.stockItems[0].cuts[0].shapePolygonCm).not.toBeNull();
    expect(typeof result.stockItems[0].dxf).toBe('string');
  });

  it('nests a BAR worksheet and never attaches a DXF (no 2D layout to export)', () => {
    const dto: PreviewSupplierCuttingDto = {
      material: { label: 'Труба 20мм', kind: 'BAR', stockLengthCm: 300 },
      lines: [{ qty: 2, cutLengthCm: 50 }],
    };

    const result = service.preview(dto);

    expect(result.kind).toBe('BAR');
    expect(result.stockItems.length).toBeGreaterThan(0);
    for (const stockItem of result.stockItems) {
      expect(stockItem.dxf).toBeNull();
      expect(stockItem.widthCm).toBeNull();
    }
  });

  it('rejects a SHEET material with no stockWidthCm', () => {
    const dto: PreviewSupplierCuttingDto = {
      material: { label: 'Лист', kind: 'SHEET', stockLengthCm: 100 },
      lines: [{ qty: 1, cutLengthCm: 10, cutWidthCm: 10 }],
    };
    expect(() => service.preview(dto)).toThrow(CodedBadRequestException);
  });

  it('rejects a SHEET line with no cutWidthCm', () => {
    const dto: PreviewSupplierCuttingDto = {
      material: { label: 'Лист', kind: 'SHEET', stockLengthCm: 100, stockWidthCm: 50 },
      lines: [{ qty: 1, cutLengthCm: 10 }],
    };
    expect(() => service.preview(dto)).toThrow(CodedBadRequestException);
  });
});
