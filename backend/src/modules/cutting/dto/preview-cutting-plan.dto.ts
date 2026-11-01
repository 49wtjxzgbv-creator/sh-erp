import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { DefaultCutShapePolygonDto } from './upsert-product-cutting-spec.dto';

// Ad-hoc multi-material worksheet (2026-11-01): the raw material a line is
// cut from when there's no catalog product behind it at all — "довільний
// розкрій" means not picking from the catalog for the material either, not
// just the piece. Same {kind, stockLengthCm, stockWidthCm, kerfMm} shape as
// ProductCuttingSpec's own fields, just typed in per line instead of saved.
export class CustomMaterialDto {
  @ApiProperty({ description: 'Free-text material name/type (e.g. "Алюміній", "Дерево") — shown as this group\'s label on the plan.' })
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
}

// Ad-hoc multi-material worksheet (2026-11-01): one typed-in position. The
// piece itself never needs a catalog product; the material it's cut from is
// EITHER an existing product with a ProductCuttingSpec (materialProductId,
// reuses that product's own remnants) OR a fully custom, catalog-free
// material (customMaterial — no remnant tracking, nothing persisted on the
// catalog). Exactly one of the two is set per line.
export class AdHocCutLineDto {
  @ApiPropertyOptional({ description: 'The raw-material product this piece is cut from — must have a ProductCuttingSpec. Exactly one of materialProductId/customMaterial must be set.' })
  @IsOptional()
  @IsUUID()
  materialProductId?: string;

  @ApiPropertyOptional({ description: 'A catalog-free material typed in just for this worksheet — no product, no remnant tracking. Exactly one of materialProductId/customMaterial must be set.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomMaterialDto)
  customMaterial?: CustomMaterialDto;

  @ApiPropertyOptional({ description: 'Free-text label for this position (e.g. "кришка", "бокова панель") — shown on the plan\'s cut diagrams. Not a catalog product.' })
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

  @ApiPropertyOptional({ description: 'The piece\'s real contour (STEP-sourced), overriding the plain rectangle implied by cutLengthCm/cutWidthCm.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DefaultCutShapePolygonDto)
  cutShapePolygon?: DefaultCutShapePolygonDto;
}

// Exactly one of assemblyId/productId/lines must be set — enforced both
// here (service-level validateExactlyOneSource) and, for assemblyId/
// productId, by the cutting_plan_source_consistency DB CHECK constraint.
export class PreviewCuttingPlanDto {
  @ApiPropertyOptional({ description: 'Assembly whose BOM is flattened for cut-stock demand ("Порахувати розкрій" on the assembly page). Exactly one of assemblyId/productId/lines must be set.' })
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ description: 'Product cut directly, using its own ProductCuttingSpec.defaultCut* shape ("Порахувати розкрій" on the product page, no assembly involved). Exactly one of assemblyId/productId/lines must be set.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    type: [AdHocCutLineDto],
    description: 'Ad-hoc multi-material worksheet: a hand-typed list of positions, each its own material/shape/qty, nested together per material. Exactly one of assemblyId/productId/lines must be set.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdHocCutLineDto)
  lines?: AdHocCutLineDto[];

  @ApiPropertyOptional({ description: 'How many units this plan is computed for — units of the assembly when assemblyId is set, pieces of the product when productId is set. Ignored (computed as the sum of line quantities) when lines is set.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qty?: number;

  @ApiPropertyOptional({ description: 'Which warehouse remnants are drawn from / a new leftover remnant is assigned to. Defaults to the company\'s default warehouse.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
