import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuotePurchaseRequestDto } from './quote-purchase-request.dto';

describe('QuotePurchaseRequestDto', () => {
  async function errorsFor(plain: Record<string, unknown>) {
    const instance = plainToInstance(QuotePurchaseRequestDto, plain);
    return validate(instance as object);
  }

  it('accepts a valid single-line quote', async () => {
    const errors = await errorsFor({ items: [{ id: '123e4567-e89b-12d3-a456-426614174000', quotedPrice: 123.45 }] });
    expect(errors).toHaveLength(0);
  });

  it('rejects an empty items array', async () => {
    const errors = await errorsFor({ items: [] });
    expect(errors.some((e) => e.property === 'items')).toBe(true);
  });

  it('rejects a negative quotedPrice', async () => {
    const errors = await errorsFor({ items: [{ id: '123e4567-e89b-12d3-a456-426614174000', quotedPrice: -1 }] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-UUID line id', async () => {
    const errors = await errorsFor({ items: [{ id: 'not-a-uuid', quotedPrice: 10 }] });
    expect(errors.length).toBeGreaterThan(0);
  });
});
