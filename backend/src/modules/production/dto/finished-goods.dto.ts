import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class QueryFinishedGoodsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ enum: ['IN_STOCK', 'SHIPPED', 'CONSUMED', 'REWORK', 'DEFECTIVE'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
