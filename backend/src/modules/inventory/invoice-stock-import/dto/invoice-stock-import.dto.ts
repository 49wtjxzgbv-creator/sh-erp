import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsUUID, Min, ValidateNested } from 'class-validator';

export class InvoiceImportApplyLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Additive quantity to RECEIVE into the chosen warehouse — not an absolute target.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
}

export class ApplyInvoiceStockImportDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({
    type: [InvoiceImportApplyLineDto],
    description:
      'Rows the user confirmed (and possibly qty-corrected) from a prior /stock/invoice-import/preview call — ' +
      're-sent explicitly, same no-server-state convention as the German-price-import apply step.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceImportApplyLineDto)
  lines!: InvoiceImportApplyLineDto[];
}
