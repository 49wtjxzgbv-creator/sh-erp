import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class ProductSupplierLineDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiPropertyOptional({ description: 'This supplier\'s price for this product. Not automatically pulled into any purchase order line — but when this line is also `isDefault`, saving it overwrites Product.sellPriceEur (see ProductsService#setSuppliers), the one cost basis every BOM/valuation calculation in this app is pinned to.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Display/pre-selection hint only — never bypasses the "ask which supplier" prompt in the shortage engine when a product has more than one linked supplier.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class SetProductSuppliersDto {
  @ApiProperty({
    type: [ProductSupplierLineDto],
    description: 'The full linked-supplier list for this product. Replaces every existing row — there is no partial-update endpoint, same convention as SetAssemblyComponentsDto.',
  })
  @IsArray()
  @ArrayUnique((line: ProductSupplierLineDto) => line.supplierId)
  @ValidateNested({ each: true })
  @Type(() => ProductSupplierLineDto)
  suppliers!: ProductSupplierLineDto[];
}
