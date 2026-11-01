import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { DefaultCutShapePolygonDto } from './upsert-product-cutting-spec.dto';

// Ad-hoc multi-material worksheet (2026-11-01): one typed-in position, no
// catalog product of its own required — only the raw material it's cut
// FROM (materialProductId) needs a ProductCuttingSpec. Same {length, width,
// polygon} shape as AssemblyComponent/ProductCuttingSpec's own cut fields.
export class AdHocCutLineDto {
  @ApiProperty({ description: 'The raw-material product this piece is cut from — must have a ProductCuttingSpec.' })
  @IsUUID()
  materialProductId!: string;

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
