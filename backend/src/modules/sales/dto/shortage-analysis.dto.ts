import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ShortageGroupLineInputDto {
  @ApiProperty({ enum: ['PRODUCT', 'ASSEMBLY'] })
  @IsIn(['PRODUCT', 'ASSEMBLY'])
  kind!: 'PRODUCT' | 'ASSEMBLY';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  subAssemblyId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiProperty({
    description:
      'Quantity to actually order for this line — pre-filled from the preview\'s gross requirement but ' +
      'editable by the human before committing, per the "no hidden arithmetic" rule (Phase 1 §6.3): the ' +
      'preview never subtracts current stock automatically, so this is where a person applies their own judgment.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
}

export class PurchaseOrderGroupInputDto {
  @ApiPropertyOptional({ description: 'Null/omitted = the "без постачальника" (no supplier) bucket.' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  supplierName!: string;

  @ApiProperty({ type: [ShortageGroupLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShortageGroupLineInputDto)
  items!: ShortageGroupLineInputDto[];
}

export class CreatePurchaseOrdersFromGroupsDto {
  @ApiProperty({
    type: [PurchaseOrderGroupInputDto],
    description: 'Normally the (possibly hand-edited) output of GET .../shortage-preview — one PurchaseOrder is created per group.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderGroupInputDto)
  groups!: PurchaseOrderGroupInputDto[];
}
