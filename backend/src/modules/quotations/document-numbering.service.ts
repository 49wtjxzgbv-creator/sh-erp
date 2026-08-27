import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Atomic per-company document numbering — no prior mechanism existed
 * anywhere in this codebase before the Quotations module (every existing
 * "number" field, CustomerOrder.orderNumber included, is free-typed by the
 * user; grep confirmed it). See CompanyDocumentCounter's own schema.prisma
 * comment for the full design: one `INSERT ... ON CONFLICT ... DO UPDATE
 * SET lastValue = lastValue + 1 RETURNING lastValue` is what makes
 * concurrent creation safe — Postgres serializes concurrent writers on the
 * same row, so two requests racing to create a Quotation the same
 * millisecond still get two different numbers, never a duplicate. Verified
 * live against a real (non-superuser, RLS-enforced) Postgres role with 30
 * concurrent callers before this went into the codebase.
 *
 * Deliberately its own small service rather than a method on
 * QuotationsService — the counter itself has nothing quotation-specific
 * about it (the `counterKey` is an arbitrary string the caller picks), so
 * a future second document type that needs safe numbering reuses this
 * directly instead of duplicating the atomic-upsert logic.
 */
@Injectable()
export class DocumentNumberingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Claims and returns the next integer for (companyId, counterKey) — 1 the first time a given key is ever used. */
  async next(user: RequestUser, counterKey: string): Promise<number> {
    const rows = await this.prisma.tenant.$queryRaw<Array<{ lastValue: number }>>(
      Prisma.sql`
        INSERT INTO company_document_counters ("companyId", "counterKey", "lastValue", "updatedAt")
        VALUES (${user.companyId}::uuid, ${counterKey}, 1, now())
        ON CONFLICT ("companyId", "counterKey")
        DO UPDATE SET "lastValue" = company_document_counters."lastValue" + 1, "updatedAt" = now()
        RETURNING "lastValue"
      `,
    );
    return Number(rows[0].lastValue);
  }

  /**
   * "КП-2026-0001" — the year lives IN the counter key (`QUOTATION_2026`),
   * not as separate reset logic: a new year is simply a key nobody's used
   * yet, so numbering starts at 1 automatically via the upsert's INSERT
   * branch. Nothing has to notice January 1st and reset a counter.
   */
  async nextQuotationNumber(user: RequestUser): Promise<string> {
    const year = new Date().getFullYear();
    const value = await this.next(user, `QUOTATION_${year}`);
    return `КП-${year}-${String(value).padStart(4, '0')}`;
  }
}
