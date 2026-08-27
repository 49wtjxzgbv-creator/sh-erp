import { assemblyToFormValues } from './assembly-form';
import type { Assembly } from '@/lib/api-client/bom';

const baseAssembly: Assembly = {
  id: 'a1',
  companyId: 'c1',
  name: 'Widget assembly',
  article: 'ASM-1',
  note: null,
  laborCostPerUnit: '3.500',
  packagingCostPerUnit: '0.750',
  deliveryCostPerUnit: '0.000',
  otherCostPerUnit: '0.000',
  baseSalePriceEur: null,
  defaultSupplierId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('assemblyToFormValues', () => {
  it('returns an empty object in create mode', () => {
    expect(assemblyToFormValues(undefined)).toEqual({});
  });

  it('converts Prisma Decimal strings to numbers', () => {
    const values = assemblyToFormValues(baseAssembly);
    expect(values.laborCostPerUnit).toBe(3.5);
    expect(values.packagingCostPerUnit).toBe(0.75);
    expect(values.deliveryCostPerUnit).toBe(0);
  });

  it('converts a null note to undefined', () => {
    expect(assemblyToFormValues(baseAssembly).note).toBeUndefined();
  });
});
