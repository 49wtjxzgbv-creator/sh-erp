import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { Currency } from '@prisma/client';

// Mirrors the old Assemblies sheet's header columns (Phase 1 §3.3) 1:1 —
// see schema.prisma's Assembly model for the field list this DTO mirrors.
export class CreateAssemblyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  article?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ default: 0, description: 'Per-unit labor cost, added once per unit at this BOM level (not per component).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  laborCostPerUnit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  packagingCostPerUnit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryCostPerUnit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  otherCostPerUnit?: number;

  @ApiPropertyOptional({
    enum: Currency,
    default: 'EUR',
    description:
      'Multi-currency module (2026-10-29) — one currency for the four cost fields above AND baseSalePriceEur below. Does NOT cover germanPriceEur, which is always a EUR-denominated German-market benchmark regardless of this.',
  })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiPropertyOptional({
    description:
      'Quotations module (2026-08-27) — the sale-price starting point for BASE_PRICE-method quotation lines. ' +
      'Independent of the cost fields above and of Product.sellPriceEur (a cost input, not a retail price). ' +
      'Leave unset if this assembly is only ever priced per-quotation via markup/margin/custom.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseSalePriceEur?: number;

  @ApiPropertyOptional({
    description:
      'Set when this assembly is purchased finished from a supplier rather than manufactured in-house ' +
      '(Phase 1 §3.3). This only affects the Sales module\'s purchasing/shortage-grouping logic (Phase 1 §6.3) — ' +
      'BOM cost calculation and produce-time consumption in this module always flatten all the way down to real ' +
      'Product components regardless of this field, since neither Assembly nor a purchased sub-assembly carries ' +
      'its own stock ledger in this schema.',
  })
  @IsOptional()
  @IsUUID()
  defaultSupplierId?: string;

  @ApiPropertyOptional({
    description:
      'Pure benchmarking input — the going price for this same item in Germany, entered manually for comparison ' +
      'against our own calculated cost on the BOM cost page. Never used by any cost/pricing/quotation calculation.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  germanPriceEur?: number;

  @ApiPropertyOptional({
    description:
      'Shipment-calculation module (2026-10-28) — how many finished units of this assembly fit in one box. ' +
      'Unset means each finished unit is treated as its own box when calculating a shipment\'s place count.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPerBox?: number;

  @ApiPropertyOptional({ description: 'How many boxes fit on one pallet. Unset means boxes themselves are the shipment place count.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  boxesPerPallet?: number;

  @ApiPropertyOptional({ description: 'Packed box length, cm — used to estimate shipment volume.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  boxLengthCm?: number;

  @ApiPropertyOptional({ description: 'Packed box width, cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  boxWidthCm?: number;

  @ApiPropertyOptional({ description: 'Packed box height, cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  boxHeightCm?: number;
}

export class UpdateAssemblyDto extends PartialType(CreateAssemblyDto) {}
