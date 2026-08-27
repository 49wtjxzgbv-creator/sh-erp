import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;
}

/** Header-only update of the CURRENT version's terms — items are saved separately via SaveQuotationItemsDto. Only valid while the current version is still DRAFT (not sentAt). */
export class UpdateQuotationVersionDto extends PartialType(CreateQuotationDto) {}

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

  @ApiProperty({ enum: ['BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'CUSTOM'] })
  @IsIn(['BASE_PRICE', 'MARKUP_PERCENT', 'COST_PLUS_MARGIN', 'CUSTOM'])
  pricingSource!: string;

  @ApiPropertyOptional({ description: 'Required for MARKUP_PERCENT/COST_PLUS_MARGIN.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pricingPercent?: number;

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
