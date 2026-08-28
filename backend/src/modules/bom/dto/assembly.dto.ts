import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

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
}

export class UpdateAssemblyDto extends PartialType(CreateAssemblyDto) {}
