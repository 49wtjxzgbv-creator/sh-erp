import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class GenerateLoadPlanDto {
  @ApiProperty({ description: 'TransportUnitType to pack into — must have length/width/height set.' })
  @IsUUID()
  transportUnitTypeId!: string;
}

export class MoveLoadPlanItemDto {
  @ApiProperty({ description: '1-based truck index to move this item into. A truck with this index is created if it does not exist yet.' })
  @IsInt()
  @Min(1)
  toTruckIndex!: number;
}

/**
 * Ad-hoc load-plan item (2026-10-30, "також додавати той якого нема в
 * замовленні") — either `assemblyId` (a real catalog pick, packaging/
 * weight looked up the same way an order line already is) OR the four
 * `manual*` fields (a fully free-form box with no catalog link at all),
 * never both — enforced in LoadPlanService#addItem, not here, since
 * class-validator doesn't do cross-field "exactly one of" cleanly.
 */
export class AddLoadPlanItemDto {
  @ApiProperty({ description: '1-based truck index to add this item into. A truck with this index is created if it does not exist yet.' })
  @IsInt()
  @Min(1)
  truckIndex!: number;

  @ApiPropertyOptional({ description: 'Pick a real Assembly from the catalog — its own box dimensions/weight/stacking rules apply, same as an order-derived line.' })
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ description: 'Required when assemblyId is not given — short label for this manual box.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  manualName?: string;

  @ApiPropertyOptional({ description: 'Required when assemblyId is not given — box length, cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  manualLengthCm?: number;

  @ApiPropertyOptional({ description: 'Required when assemblyId is not given — box width, cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  manualWidthCm?: number;

  @ApiPropertyOptional({ description: 'Required when assemblyId is not given — box height, cm.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  manualHeightCm?: number;

  @ApiPropertyOptional({ description: 'Required when assemblyId is not given — weight per box, kg.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  manualWeightKg?: number;

  @ApiProperty({ description: 'How many identical boxes of this item.' })
  @IsInt()
  @Min(1)
  unitsQty!: number;
}

/** Manual drag positioning (2026-10-30, "можливість самому переміщувати вантаж") — pins one specific box (by its loop index within its line) to an exact spot, pulling it out of the auto-packer. Bounds against the truck's own envelope are checked in LoadPlanService#setBoxPosition, not here (needs the plan's truck dims). */
export class SetLoadPlanBoxPositionDto {
  @ApiProperty({ description: 'Position along the truck length, cm, from the front.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  xCm!: number;

  @ApiProperty({ description: 'Position along the truck width, cm, from one side.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  yCm!: number;

  @ApiProperty({ description: 'Height off the truck floor, cm.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  zCm!: number;
}
