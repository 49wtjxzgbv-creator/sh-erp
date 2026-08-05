import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductionOrderWorkerDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ description: 'Share of the labor cost this worker receives. Normalized to sum to 100 across all workers on the order if the given values don\'t already (Phase 1 §3.5 convention).' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  percent!: number;
}

export class CreateProductionOrderDto {
  @ApiProperty({ description: 'Must have at least one saved AssemblyVersion (i.e. its BOM must have been saved at least once).' })
  @IsUUID()
  assemblyId!: string;

  @ApiProperty({
    description:
      'Number of finished units to plan. Must be a positive integer — one FinishedGood row with its own serial ' +
      'number is created per unit when the order is started (Phase 1 §3.3\'s generateSerialNumber_).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  unitsPlanned!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ type: [ProductionOrderWorkerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionOrderWorkerDto)
  workers?: ProductionOrderWorkerDto[];
}

export class SetProductionOrderWorkersDto {
  @ApiProperty({ type: [ProductionOrderWorkerDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => ProductionOrderWorkerDto)
  workers!: ProductionOrderWorkerDto[];
}

export class StartProductionOrderDto {
  @ApiPropertyOptional({ description: 'Warehouse to consume raw-material (PRODUCT-type) BOM lines from. Defaults to the company default warehouse.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

export class QueryProductionOrdersDto {
  @ApiPropertyOptional({ enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
