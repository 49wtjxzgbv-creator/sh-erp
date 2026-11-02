import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSupplierCatalogEntryDto } from './update-supplier-catalog-entry.dto';

describe('UpdateSupplierCatalogEntryDto', () => {
  async function errorsFor(plain: Record<string, unknown>) {
    const instance = plainToInstance(UpdateSupplierCatalogEntryDto, plain);
    return validate(instance as object);
  }

  it('accepts both fields set', async () => {
    const errors = await errorsFor({ supplierCostPrice: 10, supplierOfferedPrice: 50 });
    expect(errors).toHaveLength(0);
  });

  it('accepts neither field set (partial update)', async () => {
    const errors = await errorsFor({});
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative supplierCostPrice', async () => {
    const errors = await errorsFor({ supplierCostPrice: -1 });
    expect(errors.some((e) => e.property === 'supplierCostPrice')).toBe(true);
  });

  it('rejects a negative supplierOfferedPrice', async () => {
    const errors = await errorsFor({ supplierOfferedPrice: -1 });
    expect(errors.some((e) => e.property === 'supplierOfferedPrice')).toBe(true);
  });
});
