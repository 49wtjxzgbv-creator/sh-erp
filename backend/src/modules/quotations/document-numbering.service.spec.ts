import { DocumentNumberingService } from './document-numbering.service';

describe('DocumentNumberingService', () => {
  let service: DocumentNumberingService;
  let prisma: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = { tenant: { $queryRaw: jest.fn() } };
    service = new DocumentNumberingService(prisma);
  });

  it('next() issues the atomic upsert and returns the claimed integer', async () => {
    prisma.tenant.$queryRaw.mockResolvedValue([{ lastValue: 7 }]);
    const value = await service.next(user, 'QUOTATION_2026');
    expect(value).toBe(7);
    expect(prisma.tenant.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('nextQuotationNumber() formats as "КП-<year>-0001" with zero-padding to 4 digits', async () => {
    prisma.tenant.$queryRaw.mockResolvedValue([{ lastValue: 1 }]);
    const number = await service.nextQuotationNumber(user);
    const year = new Date().getFullYear();
    expect(number).toBe(`КП-${year}-0001`);
  });

  it('nextQuotationNumber() does not truncate past 4 digits once the counter exceeds 9999', async () => {
    prisma.tenant.$queryRaw.mockResolvedValue([{ lastValue: 12345 }]);
    const number = await service.nextQuotationNumber(user);
    const year = new Date().getFullYear();
    expect(number).toBe(`КП-${year}-12345`);
  });

  // § real invariant this must never regress: two callers racing for the
  // SAME counterKey must never observe the same value. This test can't
  // exercise real Postgres row-locking (that was verified live, see this
  // service's own header comment — 30 concurrent non-superuser callers,
  // zero duplicates, zero lost updates) — what it DOES guard is the
  // service-layer contract: each resolved $queryRaw call's returned
  // lastValue is trusted as-is, never re-derived or cached, so nothing
  // in THIS layer could paper over a duplicate even if the DB ever
  // returned one.
  it('trusts each call\'s own returned lastValue independently — concurrent callers each get whatever their own RETURNING row said, never a shared/cached value', async () => {
    prisma.tenant.$queryRaw.mockResolvedValueOnce([{ lastValue: 10 }]).mockResolvedValueOnce([{ lastValue: 11 }]).mockResolvedValueOnce([{ lastValue: 12 }]);
    const results = await Promise.all([service.next(user, 'QUOTATION_2026'), service.next(user, 'QUOTATION_2026'), service.next(user, 'QUOTATION_2026')]);
    expect(new Set(results).size).toBe(3);
  });
});
