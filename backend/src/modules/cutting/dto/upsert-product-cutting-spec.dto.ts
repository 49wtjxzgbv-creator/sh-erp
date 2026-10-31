import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';

export enum CuttingStockKindDto {
  BAR = 'BAR',
  SHEET = 'SHEET',
}

export class UpsertProductCuttingSpecDto {
  @ApiProperty({ enum: CuttingStockKindDto })
  @IsEnum(CuttingStockKindDto)
  kind!: CuttingStockKindDto;

  @ApiProperty({ description: 'BAR: length of one standard bar. SHEET: the sheet\'s own length (one of its two planar dimensions).' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  stockLengthCm!: number;

  @ApiPropertyOptional({ description: 'Required for SHEET (the sheet\'s other planar dimension), unused for BAR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  stockWidthCm?: number;

  @ApiPropertyOptional({ description: 'Saw/blade loss per cut, mm. Defaults to 3.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  kerfMm?: number;

  @ApiPropertyOptional({ description: 'BAR only: leftover below this length (cm) counts as waste, not a trackable remnant.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRemnantLengthCm?: number;

  @ApiPropertyOptional({ description: 'SHEET only: leftover below this area (cm²) counts as waste, not a trackable remnant.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRemnantAreaCm2?: number;

  @ApiPropertyOptional({ description: 'SHEET only: whether a piece may be rotated 90° when nesting. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  allowRotation?: boolean;
}
