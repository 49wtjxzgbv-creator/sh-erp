import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Filters at every granularity the План-графік spec requires: order, item,
 * batch, stage, supplier, responsible (employee), status, problem, and
 * date range. All optional — an empty query returns everything in range.
 */
export class QueryPlannerBoardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  responsibleId?: string;

  @ApiPropertyOptional({ enum: ['NEW', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'true = only orders with at least one problem attached.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  problem?: string;

  @ApiPropertyOptional({ description: 'Matches client name or order number, partial, case-insensitive.' })
  @IsOptional()
  @IsString()
  search?: string;
}
