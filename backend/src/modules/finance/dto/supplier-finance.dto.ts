import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';

const toOptionalDate = ({ value }: { value: unknown }) => (value === '' || value === null || value === undefined ? undefined : value);

/**
 * Supplier-portal invoice upload (2026-11-05) — same underlying
 * PurchaseOrderDocument row the staff Finance module manages
 * (finance-document.dto.ts's CreatePurchaseOrderDocumentDto), narrowed for
 * an external supplier actor: no `documentType` (always forced to
 * INVOICE server-side) and no `counterpartyId` (always the uploading
 * supplier's own id) — see FinanceService#createDocumentAsSupplier.
 *
 * `purchaseOrderIds` is OPTIONAL and an ARRAY (2026-11-06 — "рахунок не
 * обов'язково може бути прив'язаний до замовлення"; extended 2026-11-19 —
 * "якщо постачальник призначив декільком замовленням один рахунок на
 * оплату"): a supplier's invoice does not always correspond to exactly
 * one order — it may cover zero, one, or several. When present, EVERY id
 * is verified against the caller's own supplierId server-side before
 * anything is created (see FinanceService#createDocumentAsSupplier).
 */
export class CreateSupplierInvoiceDocumentDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  purchaseOrderIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalDate)
  @Type(() => Date)
  @IsDate()
  documentDate?: Date;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ default: 'EUR', description: 'ISO-4217-shaped currency tag — no conversion is performed anywhere in this app.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase code, e.g. EUR' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** Supplier self-reports a payment received against their own invoice — same shape/rules as the staff-facing CreatePurchaseOrderPaymentDto. */
export class CreateSupplierInvoicePaymentDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional({ description: 'Defaults to the parent document\'s currency if omitted.' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase code, e.g. EUR' })
  currency?: string;

  @ApiProperty()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  paidAt!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
