import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSupplierStockQtyDto } from './update-supplier-stock-qty.dto';

describe('UpdateSupplierStockQtyDto', () => {
  async function errorsFor(plain: Record<string, unknown>) {
    const instance = plainToInstance(UpdateSupplierStockQtyDto, plain);
    return validate(instance as object);
  }

  it('accepts valid non-negative quantities for both fields', async () => {
    const errors = await errorsFor({ supplierReadyQty: 42, supplierShippedQty: 8 });
    expect(errors).toHaveLength(0);
  });

  it('accepts zero for both fields', async () => {
    const errors = await errorsFor({ supplierReadyQty: 0, supplierShippedQty: 0 });
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative supplierReadyQty', async () => {
    const errors = await errorsFor({ supplierReadyQty: -1, supplierShippedQty: 0 });
    expect(errors.some((e) => e.property === 'supplierReadyQty')).toBe(true);
  });

  it('rejects a negative supplierShippedQty', async () => {
    const errors = await errorsFor({ supplierReadyQty: 0, supplierShippedQty: -1 });
    expect(errors.some((e) => e.property === 'supplierShippedQty')).toBe(true);
  });

  it('rejects a missing supplierReadyQty', async () => {
    const errors = await errorsFor({ supplierShippedQty: 0 });
    expect(errors.some((e) => e.property === 'supplierReadyQty')).toBe(true);
  });

  it('rejects a missing supplierShippedQty', async () => {
    const errors = await errorsFor({ supplierReadyQty: 0 });
    expect(errors.some((e) => e.property === 'supplierShippedQty')).toBe(true);
  });
});
