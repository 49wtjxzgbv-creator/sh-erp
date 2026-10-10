import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsUUID, Min, ValidateNested } from 'class-validator';

export class GermanPriceUpdateLineDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'New Product.germanPriceExclVat value, as recognized from the uploaded document.' })
  @IsNumber()
  @Min(0)
  price!: number;
}

export class ApplyGermanPriceImportDto {
  @ApiProperty({
    type: [GermanPriceUpdateLineDto],
    description:
      'Rows the user confirmed from a prior /german-price-import/preview call — re-sent explicitly (not a stored ' +
      'session id) so the apply step has no server-side state to go stale between preview and confirmation.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GermanPriceUpdateLineDto)
  updates!: GermanPriceUpdateLineDto[];
}
