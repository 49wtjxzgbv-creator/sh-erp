import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class GiveItemToProductionDto {
  @ApiPropertyOptional({ description: 'Defaults to the order line\'s own qty if omitted. Must be a positive integer — see CreateProductionOrderDto.unitsPlanned.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPlanned?: number;
}
