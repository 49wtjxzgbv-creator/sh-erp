import { NotFoundException } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service';

describe('ExchangeRatesService', () => {
  let service: ExchangeRatesService;
  let prisma: any;

  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.c', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      nbuExchangeRate: { findUnique: jest.fn(), upsert: jest.fn() },
      tenant: {
        exchangeRateOverride: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
        companySettings: { findUnique: jest.fn() },
      },
    };
    service = new ExchangeRatesService(prisma);
  });

  // ---------------------------------------------------------------------
  // getBaseCurrency — this company's own base/reporting currency (phase 4, 2026-10-29)
  // ---------------------------------------------------------------------

  describe('getBaseCurrency', () => {
    it("returns this company's own CompanySettings.baseCurrency", async () => {
      prisma.tenant.companySettings.findUnique.mockResolvedValue({ companyId: 'c1', baseCurrency: 'USD' });
      expect(await service.getBaseCurrency('c1')).toBe('USD');
    });

    it('falls back to EUR when the settings row somehow has none', async () => {
      prisma.tenant.companySettings.findUnique.mockResolvedValue(null);
      expect(await service.getBaseCurrency('c1')).toBe('EUR');
    });
  });

  // ---------------------------------------------------------------------
  // getRate resolution order: override > exact NBU date > nearest prior NBU date > error
  // ---------------------------------------------------------------------

  it('prefers a manual override over an NBU rate on the same date', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue({ rate: 52 });
    prisma.nbuExchangeRate.findUnique.mockResolvedValue({ rate: 50.85 });

    const result = await service.getRate('c1', 'EUR', new Date('2026-10-28T00:00:00Z'));

    expect(result).toEqual({ rate: 52, source: 'MANUAL', asOfDate: new Date('2026-10-28T00:00:00.000Z') });
    expect(prisma.nbuExchangeRate.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the exact-date NBU rate when there is no override', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue(null);
    prisma.nbuExchangeRate.findUnique.mockResolvedValue({ rate: 50.85 });

    const result = await service.getRate('c1', 'EUR', new Date('2026-10-28T00:00:00Z'));

    expect(result).toEqual({ rate: 50.85, source: 'NBU', asOfDate: new Date('2026-10-28T00:00:00.000Z') });
    expect(prisma.nbuExchangeRate.findUnique).toHaveBeenCalledTimes(1);
  });

  it('walks backward to the nearest preceding NBU date when the exact date has none (weekend/holiday)', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue(null);
    // Saturday/Sunday have nothing; Friday (2 days back) does.
    prisma.nbuExchangeRate.findUnique
      .mockResolvedValueOnce(null) // Sunday
      .mockResolvedValueOnce(null) // Saturday
      .mockResolvedValueOnce({ rate: 50.7 }); // Friday

    const result = await service.getRate('c1', 'EUR', new Date('2026-10-25T00:00:00Z')); // a Sunday

    expect(result).toEqual({ rate: 50.7, source: 'NBU', asOfDate: new Date('2026-10-23T00:00:00.000Z') });
    expect(prisma.nbuExchangeRate.findUnique).toHaveBeenCalledTimes(3);
  });

  it('throws rather than silently assuming a rate when nothing is found within the lookback window', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue(null);
    prisma.nbuExchangeRate.findUnique.mockResolvedValue(null);

    await expect(service.getRate('c1', 'EUR', new Date('2026-10-28T00:00:00Z'))).rejects.toThrow(NotFoundException);
    expect(prisma.nbuExchangeRate.findUnique).toHaveBeenCalledTimes(8); // today + 7 days back
  });

  // ---------------------------------------------------------------------
  // convert
  // ---------------------------------------------------------------------

  it('returns the amount unchanged for a same-currency conversion, without touching any rate table', async () => {
    const result = await service.convert(100, 'EUR', 'EUR', 'c1', new Date('2026-10-28T00:00:00Z'));

    expect(result).toBe(100);
    expect(prisma.nbuExchangeRate.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant.exchangeRateOverride.findUnique).not.toHaveBeenCalled();
  });

  it('converts EUR to UAH by multiplying by the EUR rate', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue(null);
    prisma.nbuExchangeRate.findUnique.mockResolvedValue({ rate: 50 });

    const result = await service.convert(10, 'EUR', 'UAH', 'c1', new Date('2026-10-28T00:00:00Z'));

    expect(result).toBe(500);
  });

  it('converts UAH to EUR by dividing by the EUR rate', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue(null);
    prisma.nbuExchangeRate.findUnique.mockResolvedValue({ rate: 50 });

    const result = await service.convert(500, 'UAH', 'EUR', 'c1', new Date('2026-10-28T00:00:00Z'));

    expect(result).toBe(10);
  });

  it('bridges EUR to USD through UAH (two different rates)', async () => {
    prisma.tenant.exchangeRateOverride.findUnique.mockResolvedValue(null);
    prisma.nbuExchangeRate.findUnique
      .mockResolvedValueOnce({ rate: 50 }) // EUR -> UAH
      .mockResolvedValueOnce({ rate: 40 }); // USD -> UAH

    const result = await service.convert(10, 'EUR', 'USD', 'c1', new Date('2026-10-28T00:00:00Z'));

    // 10 EUR -> 500 UAH -> 500/40 = 12.5 USD
    expect(result).toBe(12.5);
  });

  // ---------------------------------------------------------------------
  // setOverride
  // ---------------------------------------------------------------------

  it('upserts a manual override scoped to the current user\'s company', async () => {
    await service.setOverride(user, 'EUR', 52, new Date('2026-10-28T00:00:00Z'));

    expect(prisma.tenant.exchangeRateOverride.upsert).toHaveBeenCalledWith({
      where: { companyId_currency_asOfDate: { companyId: 'c1', currency: 'EUR', asOfDate: new Date('2026-10-28T00:00:00.000Z') } },
      create: { companyId: 'c1', currency: 'EUR', rate: 52, asOfDate: new Date('2026-10-28T00:00:00.000Z'), createdById: 'u1' },
      update: { rate: 52 },
    });
  });
});
