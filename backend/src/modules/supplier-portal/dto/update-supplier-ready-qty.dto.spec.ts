import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSupplierReadyQtyDto } from './update-supplier-ready-qty.dto';

describe('UpdateSupplierReadyQtyDto', () => {
  async function errorsFor(plain: Record<string, unknown>) {
    const instance = plainToInstance(UpdateSupplierReadyQtyDto, plain);
    return validate(instance as object);
  }

  it('accepts a valid non-negative qty', async () => {
    const errors = await errorsFor({ supplierReadyQty: 42 });
    expect(errors).toHaveLength(0);
  });

  it('accepts zero', async () => {
    const errors = await errorsFor({ supplierReadyQty: 0 });
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative qty', async () => {
    const errors = await errorsFor({ supplierReadyQty: -1 });
    expect(errors.some((e) => e.property === 'supplierReadyQty')).toBe(true);
  });

  it('rejects a missing qty', async () => {
    const errors = await errorsFor({});
    expect(errors.some((e) => e.property === 'supplierReadyQty')).toBe(true);
  });
});
