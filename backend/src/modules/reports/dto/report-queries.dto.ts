import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class MonthlyProductionRollupQueryDto {
  @ApiPropertyOptional({ description: 'ISO date — start of the period. Defaults to the start of the current month.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date — end of the period. Defaults to now.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ReorderSuggestionsQueryDto {
  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
