import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

// Direct-product cutting (2026-11-01): exactly one of assemblyId/productId
// must be set — enforced both here (service-level validateExactlyOneSource)
// and by the cutting_plan_source_consistency DB CHECK constraint.
export class PreviewCuttingPlanDto {
  @ApiPropertyOptional({ description: 'Assembly whose BOM is flattened for cut-stock demand ("Порахувати розкрій" on the assembly page). Exactly one of assemblyId/productId must be set.' })
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ description: 'Product cut directly, using its own ProductCuttingSpec.defaultCut* shape ("Порахувати розкрій" on the product page, no assembly involved). Exactly one of assemblyId/productId must be set.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ description: 'How many units this plan is computed for — units of the assembly when assemblyId is set, pieces of the product when productId is set.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiPropertyOptional({ description: 'Which warehouse remnants are drawn from / a new leftover remnant is assigned to. Defaults to the company\'s default warehouse.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
