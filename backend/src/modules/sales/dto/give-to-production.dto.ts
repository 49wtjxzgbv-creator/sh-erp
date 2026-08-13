import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, Min } from 'class-validator';

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
