import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { QUOTATION_LOCALES } from '../quotation-renderer.service';

export class CreateQuotationDto {
  @ApiProperty()
  @IsUUID()
  customerId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @ApiPropertyOptional({ default: 'EUR' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deliveryTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  installationTerms?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Free-text override for the header\'s company-details block (under the logo) — wins over both the template\'s own companyDetailsText and the Settings → "Реквізити компанії" fallback. Lets staff type literally anything for this one document.',
  })
  @IsOptional()
  @IsString()
  companyDetailsOverride?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    description:
      'VAT rate used to split a VAT amount out of any GERMAN_PRICE_INCL_VAT item on this version, for display on the printed totals — manually entered, never defaulted (CompanySettings.vatRatePercent is unused dead weight, see its own schema comment).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  vatRatePercent?: number;
}

/**
 * Header-only update of the CURRENT version's terms — items are saved
 * separately via SaveQuotationItemsDto. Only valid while the current
 * version is still DRAFT (not sentAt). companyDetailsOverride is
 * redeclared (not inherited via PartialType) with the same
 * "omitted leaves untouched, null/empty clears" convention as
 * PurchaseRequest's own fromName — CreateQuotationDto's own field stays
 * undefined-only since create() never needs to clear anything.
 */
export class UpdateQuotationVersionDto extends PartialType(OmitType(CreateQuotationDto, ['companyDetailsOverride'] as const)) {
  @ApiPropertyOptional({ nullable: true, description: 'null/empty clears the override back to the computed company-details text; an omitted key leaves the current value untouched.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  companyDetailsOverride?: string | null;
}

/** Document number — editable (2026-10-22 user request) in case staff need to append a suffix or match an external numbering scheme. Lives on the Quotation row itself (not per-version), so unlike UpdateQuotationVersionDto this is never locked by a sent version. Stays unique per company. */
export class UpdateQuotationNumberDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  number!: string;
}

/** Staff-only note (2026-10-22 user request) — editable inline from the quotations list, never shown on the printed/customer-facing document. Same "omitted leaves untouched, null/empty clears" convention as the other Quotation-level editable fields. */
export class UpdateQuotationInternalNoteDto {
  @ApiPropertyOptional({ nullable: true, description: 'Internal, staff-only note — never rendered on the printed document. null/empty clears it; an omitted key leaves the current value untouched.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  internalNote?: string | null;
}

export class QuotationItemInputDto {
  @ApiProperty({ enum: ['ASSEMBLY', 'PRODUCT', 'SERVICE', 'DELIVERY', 'INSTALLATION', 'CUSTOM'] })
  @IsIn(['ASSEMBLY', 'PRODUCT', 'SERVICE', 'DELIVERY', 'INSTALLATION', 'CUSTOM'])
  kind!: string;

  @ApiPropertyOptional({ description: 'Required for kind=ASSEMBLY.' })
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ description: 'Required for kind=PRODUCT.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Required for SERVICE/DELIVERY/INSTALLATION/CUSTOM — for ASSEMBLY/PRODUCT, defaults to the live name if omitted.' })
  @IsOptional()
  @IsString()
  nameSnapshot?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionSnapshot?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @ApiPropertyOptional({ default: 'шт' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({
    enum: ['BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'LABOR_MARKUP_PERCENT', 'LABOR_COST_PLUS_MARGIN', 'CUSTOM', 'GERMAN_PRICE_INCL_VAT', 'GERMAN_PRICE'],
  })
  @IsIn(['BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'LABOR_MARKUP_PERCENT', 'LABOR_COST_PLUS_MARGIN', 'CUSTOM', 'GERMAN_PRICE_INCL_VAT', 'GERMAN_PRICE'])
  pricingSource!: string;

  @ApiPropertyOptional({ description: 'Required for MARKUP_PERCENT/COST_PLUS_MARGIN/LABOR_MARKUP_PERCENT/LABOR_COST_PLUS_MARGIN. Optional for GERMAN_PRICE (a percent markup on top — see germanPriceMarkupAmount for the fixed-amount alternative).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pricingPercent?: number;

  @ApiPropertyOptional({ description: 'GERMAN_PRICE only — optional fixed €-amount markup added on top of Assembly.germanPriceEur. Wins over pricingPercent when both are set.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  germanPriceMarkupAmount?: number;

  @ApiPropertyOptional({ description: 'Required for CUSTOM.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  customUnitPrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountAmountOverride?: number;

  // Deliberately NO belowCostApproved field here — approval only ever
  // happens through QuotationsService#approveBelowCost, a separate
  // quotations:approve-below-cost-gated endpoint. If this DTO accepted the
  // flag, anyone with plain quotations:manage could wave through an
  // under-cost line just by including it in a bulk saveItems payload.
}

export class SaveQuotationItemsDto {
  @ApiProperty({ type: [QuotationItemInputDto], description: 'Full replacement of the current (DRAFT) version\'s item list, in the given order.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotationItemInputDto)
  items!: QuotationItemInputDto[];
}

export class TranslateQuotationDto {
  @ApiProperty({ enum: QUOTATION_LOCALES, description: 'Target language for the new, translated version.' })
  @IsIn(QUOTATION_LOCALES)
  locale!: string;
}

export class QueryQuotationsDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ description: 'Matches number or customer name, partial, case-insensitive.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
