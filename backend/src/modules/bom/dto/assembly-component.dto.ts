import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

/** Mirrors the Prisma `ComponentType` enum — kept as a separate DTO-layer enum so validation errors read cleanly without importing `@prisma/client` into the DTO layer. */
export enum ComponentTypeDto {
  PRODUCT = 'PRODUCT',
  ASSEMBLY = 'ASSEMBLY',
}

/** Irregular-shape nesting (2026-11-01) — STEP-sourced only, never hand-typed, so validation here stays structural (array shape) rather than per-point, same trust level the rest of this DTO already gives STEP-derived values. */
export class CutShapePolygonDto {
  @ApiProperty({ description: 'The piece\'s real outer contour, [x,y] pairs in cm (arcs already tessellated into line segments upstream).' })
  @IsArray()
  @ArrayMinSize(3)
  outerCm!: [number, number][];

  @ApiPropertyOptional({ description: 'Any holes in the contour (e.g. a punched circle), same coordinate frame as outerCm.' })
  @IsOptional()
  @IsArray()
  holesCm?: [number, number][][];
}

export class AssemblyComponentLineDto {
  @ApiProperty({ enum: ComponentTypeDto })
  @IsEnum(ComponentTypeDto)
  componentType!: ComponentTypeDto;

  @ApiPropertyOptional({ description: 'Required when componentType = PRODUCT; must be omitted otherwise.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description:
      'Required when componentType = ASSEMBLY; must be omitted otherwise. Must not (transitively) contain the ' +
      'parent assembly — checked on save and rejected with 409 rather than silently truncated (Phase 1 §10.5 ' +
      'documented this as a known weakness of the legacy calcAssemblyCost_/collectShortageGroups_ recursion; this ' +
      'save-time check is a deliberate improvement, not a schema change).',
  })
  @IsOptional()
  @IsUUID()
  subAssemblyId?: string;

  @ApiPropertyOptional({ description: 'Optional: which warehouse this component is expected to be drawn from. Informational only for BOM lines — actual consumption warehouse is chosen at produce() time.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'Quantity of this component needed per one unit of the parent assembly.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qtyPerUnit!: number;

  @ApiPropertyOptional({
    description:
      'Розкрій (2026-10-31): per-piece length needed, only meaningful when the selected product has a ProductCuttingSpec of kind BAR (profile/bar) — cutWidthCm stays unset. Not snapshotted into AssemblyVersionComponent (a live planning input, not a historical cost/consumption fact).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  cutLengthCm?: number;

  @ApiPropertyOptional({
    description: 'Розкрій (2026-10-31): the piece\'s other planar dimension, only meaningful when the product has a ProductCuttingSpec of kind SHEET (used together with cutLengthCm as the two piece dimensions).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  cutWidthCm?: number;

  @ApiPropertyOptional({
    description:
      'Irregular-shape nesting (2026-11-01): the piece\'s real contour, STEP-sourced only — never hand-typed (no manual-entry UI for this). When set, the cutting optimizer nests this piece by its real shape instead of the cutLengthCm×cutWidthCm bounding box above (which stays populated alongside it, for display/sorting). Not snapshotted into AssemblyVersionComponent, same scoping as cutLengthCm/cutWidthCm.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CutShapePolygonDto)
  cutShapePolygon?: CutShapePolygonDto;
}

export class SetAssemblyComponentsDto {
  @ApiProperty({
    type: [AssemblyComponentLineDto],
    description:
      'The full BOM line list for this assembly. Replaces every existing line and writes a new immutable ' +
      'AssemblyVersion snapshot (Phase 1 §3.3\'s saveAssembly/saveAssemblyVersionSnapshot_ behavior) — there is ' +
      'no partial-update endpoint for BOM lines, by design, so every save is a clean, fully-specified version.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssemblyComponentLineDto)
  components!: AssemblyComponentLineDto[];
}
