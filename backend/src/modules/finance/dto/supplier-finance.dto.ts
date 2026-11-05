import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

const toOptionalDate = ({ value }: { value: unknown }) => (value === '' || value === null || value === undefined ? undefined : value);

/**
 * Supplier-portal invoice upload (2026-11-05) — same underlying
 * PurchaseOrderDocument row the staff Finance module manages
 * (finance-document.dto.ts's CreatePurchaseOrderDocumentDto), narrowed for
 * an external supplier actor: no `documentType` (always forced to
 * INVOICE server-side) and no `counterpartyId` (always the uploading
 * supplier's own id) — see FinanceService#createDocumentAsSupplier.
 */
export class CreateSupplierInvoiceDocumentDto {
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
