import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDefined, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { DefaultCutShapePolygonDto } from '../../cutting/dto/upsert-product-cutting-spec.dto';

/**
 * "розкрій має могти робити постачальник сам собі" (2026-11-02) — the
 * supplier-portal counterpart of the staff ad-hoc multi-material worksheet
 * (`cutting/dto/preview-cutting-plan.dto.ts`), but a strict subset: the
 * supplier never picks one of OUR catalog products as the material (no
 * `materialProductId` branch) — only his own, typed-in sheet/bar, same
 * shape as that mode's own `CustomMaterialDto`.
 */
export class SupplierCuttingMaterialDto {
  @ApiProperty({ description: 'Free-text material name/type (e.g. "Лист металу 2мм") — shown as the result\'s label.' })
  @IsString()
  label!: string;

  @ApiProperty({ enum: ['BAR', 'SHEET'] })
  @IsEnum(['BAR', 'SHEET'])
  kind!: 'BAR' | 'SHEET';

  @ApiProperty({ description: 'BAR: length of one standard bar. SHEET: the sheet\'s own length.' })
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

  @ApiPropertyOptional({ description: 'SHEET only: whether a piece may be rotated 90° when nesting. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  allowRotation?: boolean;
}

export class SupplierCuttingLineDto {
  @ApiPropertyOptional({ description: 'Free-text label for this position — shown on the resulting cut diagram.' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ description: 'How many of this piece are needed.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiProperty({ description: 'Piece length, cm.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  cutLengthCm!: number;

  @ApiPropertyOptional({ description: 'Piece width, cm — required when the material is SHEET kind, unused for BAR.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  cutWidthCm?: number;

  @ApiPropertyOptional({ description: "The piece's real contour, overriding the plain rectangle implied by cutLengthCm/cutWidthCm — pre-filled from a picked catalog/order item's own cutting spec, if it has one." })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefaultCutShapePolygonDto)
  cutShapePolygon?: DefaultCutShapePolygonDto;
}

export class PreviewSupplierCuttingDto {
  @ApiProperty({ type: SupplierCuttingMaterialDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => SupplierCuttingMaterialDto)
  material!: SupplierCuttingMaterialDto;

  @ApiProperty({ type: [SupplierCuttingLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierCuttingLineDto)
  lines!: SupplierCuttingLineDto[];
}
