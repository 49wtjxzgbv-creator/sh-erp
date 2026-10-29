import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Currency } from '@prisma/client';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** How far back to look for an NBU rate when the exact date has none (weekends/holidays NBU doesn't publish for). */
const MAX_LOOKBACK_DAYS = 7;

/** Currencies synced from NBU — UAH itself is never fetched (NBU always quotes 1 <currency> = X UAH, UAH is the implicit base). */
const SYNCED_CURRENCIES: Currency[] = ['EUR', 'USD', 'PLN'];

export interface ResolvedRate {
  rate: number;
  source: 'MANUAL' | 'NBU';
  /** The actual date the rate was recorded for — may be earlier than the requested date (NBU-nearest-prior fallback). */
  asOfDate: Date;
}

function toDateOnlyUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function subDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

/**
 * Multi-currency module (2026-10-29) — see schema.prisma's "SECTION:
 * Currency / Exchange Rates" header comment for the two-table design
 * (NbuExchangeRate global, ExchangeRateOverride tenant-scoped) this
 * service sits on top of.
 */
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolution order: this company's own manual override for the exact
   * date → NBU's own rate for the exact date → NBU's rate on the nearest
   * PRECEDING date within `MAX_LOOKBACK_DAYS` (NBU doesn't publish on
   * weekends/holidays) → throws rather than silently assuming a rate of 1.
   */
  async getRate(companyId: string, currency: Currency, asOfDate: Date): Promise<ResolvedRate> {
    const date = toDateOnlyUtc(asOfDate);

    const override = await this.prisma.tenant.exchangeRateOverride.findUnique({
      where: { companyId_currency_asOfDate: { companyId, currency, asOfDate: date } },
    });
    if (override) return { rate: Number(override.rate), source: 'MANUAL', asOfDate: date };

    for (let daysBack = 0; daysBack <= MAX_LOOKBACK_DAYS; daysBack++) {
      const candidate = subDaysUtc(date, daysBack);
      const nbu = await this.prisma.nbuExchangeRate.findUnique({
        where: { currency_asOfDate: { currency, asOfDate: candidate } },
      });
      if (nbu) return { rate: Number(nbu.rate), source: 'NBU', asOfDate: candidate };
    }

    throw new CodedNotFoundException(
      'EXCHANGE_RATE_NOT_FOUND',
      `No ${currency} exchange rate found for ${date.toISOString().slice(0, 10)} or the preceding ${MAX_LOOKBACK_DAYS} days — add a manual rate on the Курси валют page.`,
    );
  }

  /** This company's own base/reporting currency (CompanySettings.baseCurrency, multi-currency module phase 4, 2026-10-29) — the one spot every create()/summary method that used to hardcode 'EUR' now reads from instead. Falls back to EUR if the row somehow doesn't exist yet (shouldn't happen — CompanyService#create always creates one), same defensive fallback as the column's own DB default. */
  async getBaseCurrency(companyId: string): Promise<Currency> {
    const settings = await this.prisma.tenant.companySettings.findUnique({ where: { companyId } });
    return settings?.baseCurrency ?? 'EUR';
  }

  /** `from === to` short-circuits without touching the rate tables — a same-currency "conversion" always needs no rate at all. Cross-currency goes through UAH as the bridge, matching how NBU itself only ever quotes <currency>-to-UAH. */
  async convert(amount: number, from: Currency, to: Currency, companyId: string, asOfDate: Date): Promise<number> {
    if (from === to) return amount;

    const amountInUah = from === 'UAH' ? amount : amount * (await this.getRate(companyId, from, asOfDate)).rate;
    if (to === 'UAH') return amountInUah;

    const toRate = (await this.getRate(companyId, to, asOfDate)).rate;
    return amountInUah / toRate;
  }

  async listRates(from: Date, to: Date): Promise<{ currency: Currency; rate: number; asOfDate: Date; source: 'NBU' | 'MANUAL' }[]> {
    const [nbuRates, overrides] = await Promise.all([
      this.prisma.nbuExchangeRate.findMany({ where: { asOfDate: { gte: from, lte: to } }, orderBy: { asOfDate: 'desc' } }),
      this.prisma.tenant.exchangeRateOverride.findMany({ where: { asOfDate: { gte: from, lte: to } }, orderBy: { asOfDate: 'desc' } }),
    ]);
    return [
      ...nbuRates.map((r) => ({ currency: r.currency, rate: Number(r.rate), asOfDate: r.asOfDate, source: 'NBU' as const })),
      ...overrides.map((r) => ({ currency: r.currency, rate: Number(r.rate), asOfDate: r.asOfDate, source: 'MANUAL' as const })),
    ].sort((a, b) => b.asOfDate.getTime() - a.asOfDate.getTime());
  }

  async setOverride(user: RequestUser, currency: Currency, rate: number, asOfDate: Date): Promise<void> {
    const date = toDateOnlyUtc(asOfDate);
    await this.prisma.tenant.exchangeRateOverride.upsert({
      where: { companyId_currency_asOfDate: { companyId: user.companyId, currency, asOfDate: date } },
      create: { companyId: user.companyId, currency, rate, asOfDate: date, createdById: user.userId },
      update: { rate },
    });
  }

  /**
   * Fetches today's rate from bank.gov.ua (public, no auth — verified live:
   * `GET /NBUStatService/v1/statdirectory/exchange?valcode=EUR&date=
   * YYYYMMDD&json` → `[{"rate":50.8522,"cc":"EUR","exchangedate":
   * "28.10.2026"}]`) for every currency in `SYNCED_CURRENCIES`, upserting
   * into the GLOBAL `NbuExchangeRate` table — `this.prisma.nbuExchangeRate`,
   * never `this.prisma.tenant`, since this has no per-request tenant
   * context to scope by (same as every other global reference-data write
   * in this codebase, e.g. PlansAdminService). `@Cron` runs this daily;
   * `syncRange` below additionally calls it once per day for a backfill.
   */
  async syncNbuRates(date: Date = new Date()): Promise<void> {
    const dateParam = toDateOnlyUtc(date).toISOString().slice(0, 10).replace(/-/g, '');
    for (const currency of SYNCED_CURRENCIES) {
      try {
        const res = await fetch(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${currency}&date=${dateParam}&json`);
        if (!res.ok) continue; // NBU has nothing for this date (weekend/holiday) — not an error, just nothing to upsert
        const rows = (await res.json()) as { rate: number; cc: string; exchangedate: string }[];
        const row = rows[0];
        if (!row) continue;
        await this.prisma.nbuExchangeRate.upsert({
          where: { currency_asOfDate: { currency, asOfDate: toDateOnlyUtc(date) } },
          create: { currency, rate: row.rate, asOfDate: toDateOnlyUtc(date) },
          update: { rate: row.rate },
        });
      } catch (err) {
        this.logger.warn(`NBU sync failed for ${currency} on ${dateParam}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** One-off backfill (initial rollout + manual "sync now") — walks backward day by day rather than firing all requests at once, polite to NBU's public API. */
  async syncRange(days: number): Promise<void> {
    const today = toDateOnlyUtc(new Date());
    for (let i = 0; i < days; i++) {
      await this.syncNbuRates(subDaysUtc(today, i));
    }
  }

  @Cron('0 10 * * *') // NBU publishes tomorrow's official rate around 9-10am Kyiv time
  async dailySync(): Promise<void> {
    await this.syncNbuRates();
  }
}
