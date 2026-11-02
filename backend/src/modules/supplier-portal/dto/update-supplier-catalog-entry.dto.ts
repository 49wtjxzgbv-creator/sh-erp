import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

/**
 * Both fields are the supplier's own, never staff's — kept strictly
 * separate from `ProductSupplier.price`/`isDefault` (see
 * SupplierCatalogService's own header comment). `supplierCostPrice` is a
 * private note for the supplier's own reference; `supplierOfferedPrice` is
 * the price at which they say they'll sell this to us.
 */
export class UpdateSupplierCatalogEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supplierCostPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  supplierOfferedPrice?: number;
}
