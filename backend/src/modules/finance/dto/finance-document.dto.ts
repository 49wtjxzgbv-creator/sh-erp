import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Min, MinLength } from 'class-validator';
import { PurchaseOrderDocumentType } from '@prisma/client';

const DOCUMENT_TYPES: PurchaseOrderDocumentType[] = [
  'INVOICE',
  'DELIVERY_NOTE',
  'PROFORMA_INVOICE',
  'PACKING_LIST',
  'TRANSPORT_DOCUMENT',
  'CUSTOMS_DOCUMENT',
  'ACT',
  'OTHER',
];

// Same '' -> undefined fix as purchase-order.dto.ts#expectedDeliveryDate — a
// date <input> submits '' when cleared, not omitted, and `@db.Date` needs a
// real Date or nothing.
const toOptionalDate = ({ value }: { value: unknown }) => (value === '' || value === null || value === undefined ? undefined : value);

export class CreatePurchaseOrderDocumentDto {
  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType!: PurchaseOrderDocumentType;

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

  @ApiProperty({ description: 'Supplier id — the PO\'s own supplier, or any other counterparty (carrier, customs broker, insurer, ...).' })
  @IsUUID()
  counterpartyId!: string;

  @ApiPropertyOptional({ description: 'Omit for documents with no monetary amount (e.g. a plain Packing List) — such a document can never receive payments.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

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

export class UpdatePurchaseOrderDocumentDto {
  @ApiPropertyOptional({ enum: DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(DOCUMENT_TYPES)
  documentType?: PurchaseOrderDocumentType;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  counterpartyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null ? null : value))
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase code, e.g. EUR' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryFinancePurchaseOrdersDto {
  @ApiPropertyOptional({ description: 'Case-insensitive substring match against the supplier name snapshot.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;

  @ApiPropertyOptional({ enum: ['UNPAID', 'PARTIAL', 'PAID'], description: 'Filters by the PO\'s own-currency (unpaidPerDocuments vs totalDocuments) payment status.' })
  @IsOptional()
  @IsIn(['UNPAID', 'PARTIAL', 'PAID'])
  paymentStatus?: 'UNPAID' | 'PARTIAL' | 'PAID';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalDate)
  @Type(() => Date)
  @IsDate()
  dateFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalDate)
  @Type(() => Date)
  @IsDate()
  dateTo?: Date;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number;
}
