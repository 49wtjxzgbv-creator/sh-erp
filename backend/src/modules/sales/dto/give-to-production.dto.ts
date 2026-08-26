import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * One batch out of a possibly-multi-batch line (План-графік §1). `unitsPlanned`
 * is this batch's own quantity — defaults to whatever's still remaining on
 * the line (item.qty minus every other active batch's unitsPlanned), not
 * the full line qty, since the line may already be partially given.
 */
export class GiveItemToProductionDto {
  @ApiPropertyOptional({ description: 'This batch\'s quantity. Defaults to the line\'s full remaining (not-yet-given) qty if omitted. Must be a positive integer and cannot exceed what remains — see CreateProductionOrderDto.unitsPlanned.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPlanned?: number;

  @ApiPropertyOptional({ description: 'Planned start for this specific batch — date AND time.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  scheduledStartAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  scheduledEndAt?: Date;
}

/**
 * "Хід виробництва" per-node give-to-production (2026-08-27 user request):
 * replaces the old upfront-at-creation sub-assembly planning dialog — a
 * sub-assembly (at ANY depth in the item's BOM tree, not just direct
 * children) can now be handed to production on demand, straight from the
 * tree, same as the top-level item already could via GiveItemToProductionDto.
 * `assemblyId` identifies which tree node; the batch links back to the
 * order via `subAssemblyForItemId` (never `customerOrderItemId` — see that
 * field's schema comment for why the two must stay separate).
 */
export class GiveSubAssemblyToProductionDto {
  @ApiProperty({ description: 'assemblyId of the tree node being given to production — must be a real sub-assembly node under this item\'s BOM tree.' })
  @IsUUID()
  assemblyId!: string;

  @ApiProperty({ description: 'This batch\'s quantity. Must be a positive integer.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;
}
