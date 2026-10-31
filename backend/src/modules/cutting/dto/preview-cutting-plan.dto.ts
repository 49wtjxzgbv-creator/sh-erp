import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class PreviewCuttingPlanDto {
  @ApiProperty({ description: 'Assembly whose BOM is flattened for cut-stock demand ("Порахувати розкрій" on the assembly page).' })
  @IsUUID()
  assemblyId!: string;

  @ApiProperty({ description: 'How many units of the assembly this plan is computed for.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiPropertyOptional({ description: 'Which warehouse remnants are drawn from / a new leftover remnant is assigned to. Defaults to the company\'s default warehouse.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
