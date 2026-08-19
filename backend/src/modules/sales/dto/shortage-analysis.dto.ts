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

  @ApiPropertyOptional({
    description:
      'The resolved supplier price shown in the preview — carried through so the created PurchaseOrderItem.expectedPrice ' +
      'is populated instead of staying empty. Omitted/undefined when no price was known for this line.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Carried through from the preview\'s sourceRequirementId — links the created PurchaseOrderItem back to this order\'s material requirement, so receiving it auto-reserves for this order.' })
  @IsOptional()
  @IsUUID()
  sourceRequirementId?: string;
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

/** The "Забронювати зі складу" button's payload — one entry per PRODUCT line the user wants to (re)set the stock-reserved qty for. */
export class SaveReservationDecisionInputDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'The new "Заброньовано" (reserved from stock) qty for this product on this order — defaults to the maximum available at order creation, editable here.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyFromStock!: number;
}

export class SaveReservationDecisionsDto {
  @ApiProperty({ type: [SaveReservationDecisionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaveReservationDecisionInputDto)
  decisions!: SaveReservationDecisionInputDto[];
}
