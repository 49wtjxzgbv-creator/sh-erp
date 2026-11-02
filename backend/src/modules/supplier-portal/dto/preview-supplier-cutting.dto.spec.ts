import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PreviewSupplierCuttingDto } from './preview-supplier-cutting.dto';

describe('PreviewSupplierCuttingDto', () => {
  async function errorsFor(plain: Record<string, unknown>) {
    const instance = plainToInstance(PreviewSupplierCuttingDto, plain);
    return validate(instance as object, { whitelist: true });
  }

  const validSheet = {
    material: { label: 'Лист металу 2мм', kind: 'SHEET', stockLengthCm: 250, stockWidthCm: 120, kerfMm: 3 },
    lines: [{ label: 'деталь 1', qty: 4, cutLengthCm: 30, cutWidthCm: 20 }],
  };

  it('accepts a valid SHEET worksheet', async () => {
    const errors = await errorsFor(validSheet);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid BAR worksheet with no cutWidthCm', async () => {
    const errors = await errorsFor({
      material: { label: 'Труба 20мм', kind: 'BAR', stockLengthCm: 300 },
      lines: [{ qty: 2, cutLengthCm: 50 }],
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an optional cutShapePolygon on a line', async () => {
    const errors = await errorsFor({
      ...validSheet,
      lines: [{ qty: 1, cutLengthCm: 30, cutWidthCm: 20, cutShapePolygon: { outerCm: [[0, 0], [10, 0], [10, 10]] } }],
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing material', async () => {
    const errors = await errorsFor({ lines: validSheet.lines });
    expect(errors.some((e) => e.property === 'material')).toBe(true);
  });

  it('rejects an empty lines array', async () => {
    const errors = await errorsFor({ material: validSheet.material, lines: [] });
    expect(errors.some((e) => e.property === 'lines')).toBe(true);
  });

  it('rejects a line with qty <= 0', async () => {
    const errors = await errorsFor({ ...validSheet, lines: [{ qty: 0, cutLengthCm: 30, cutWidthCm: 20 }] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid material kind', async () => {
    const errors = await errorsFor({ ...validSheet, material: { ...validSheet.material, kind: 'ROUND' } });
    expect(errors.length).toBeGreaterThan(0);
  });
});
