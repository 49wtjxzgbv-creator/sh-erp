/**
 * Prisma's `Decimal` fields (schema.prisma: Product.qty/minQty/prices,
 * CompanySettings.vatRatePercent, and every other `@db.Decimal(...)` column)
 * serialize to JSON as **strings**, not numbers — `Decimal.prototype.toJSON`
 * returns `.toString()`, and NestJS's default Express JSON serializer does
 * not touch that. This is a real, easy-to-get-wrong contract detail: every
 * `DecimalString` field below arrives over the wire as `"12.500"`, and must
 * be sent back the same way (a plain JS `number` round-trips fine through
 * `class-transformer`'s `@Type(() => Number)` on the DTO side, but reading
 * a list/detail response as `number` will silently produce `NaN` on
 * arithmetic without an explicit parse first).
 *
 * Use `toNumber()` when a value needs to be computed with or rendered in a
 * numeric input; use `toDecimalInput()` when sending a form number back to
 * an endpoint that expects one of these fields.
 */
export type DecimalString = string;

export function toNumber(value: DecimalString | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export function toDecimalInput(value: number | null | undefined): number | undefined {
  return value === null || value === undefined || Number.isNaN(value) ? undefined : value;
}
