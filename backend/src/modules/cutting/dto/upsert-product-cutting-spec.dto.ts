import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';

export enum CuttingStockKindDto {
  BAR = 'BAR',
  SHEET = 'SHEET',
}

// Mirrors CutShapePolygonDto in backend/src/modules/bom/dto/assembly-component.dto.ts
// (same {outerCm, holesCm} shape) — duplicated locally rather than imported
// since `cutting` has no existing dependency on `bom`'s DTOs.
export class DefaultCutShapePolygonDto {
  @ApiProperty({ description: 'The piece\'s real outer contour, [x,y] pairs in cm (arcs already tessellated into line segments upstream).' })
  @IsArray()
  @ArrayMinSize(3)
  outerCm!: [number, number][];

  @ApiPropertyOptional({ description: 'Any holes in the contour (e.g. a punched circle), same coordinate frame as outerCm.' })
  @IsOptional()
  @IsArray()
  holesCm?: [number, number][][];
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

  // Direct-product cutting (2026-11-01): this product's own default piece-
  // to-cut shape, used when "Порахувати розкрій" is run directly against
  // the product (no assembly/BOM involved).
  @ApiPropertyOptional({ description: 'Direct-product cutting: length of the piece cut from this product\'s own stock, when run without an assembly.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  defaultCutLengthCm?: number;

  @ApiPropertyOptional({ description: 'Direct-product cutting: width of the piece (SHEET only).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  defaultCutWidthCm?: number;

  @ApiPropertyOptional({ description: 'Direct-product cutting: the piece\'s real contour (STEP-sourced), overriding the plain rectangle implied by defaultCutLengthCm/defaultCutWidthCm.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefaultCutShapePolygonDto)
  defaultCutShapePolygon?: DefaultCutShapePolygonDto;
}
