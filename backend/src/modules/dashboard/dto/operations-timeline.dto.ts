import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

/** Same from/to ISO-string DTO pattern as QueryProductionScheduleDto — defaults (current calendar year) resolved in the service, not here. */
export class QueryOperationsTimelineDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
