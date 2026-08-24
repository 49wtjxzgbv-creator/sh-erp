import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export const PRODUCTION_EXECUTION_METHODS = ['SOLO', 'TEAM', 'MULTI_WORKER'] as const;
export type ProductionExecutionMethod = (typeof PRODUCTION_EXECUTION_METHODS)[number];

export const EXECUTION_ALLOCATION_MODES = ['PERCENT', 'HOURS'] as const;
export type ExecutionAllocationMode = (typeof EXECUTION_ALLOCATION_MODES)[number];

export class ProductionExecutionAllocationDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiPropertyOptional({ description: 'Required when allocationMode=PERCENT. Normalized to sum to 100 across the execution\'s allocations, same convention as ProductionOrderWorker.percent.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  percent?: number;

  @ApiPropertyOptional({ description: 'Required when allocationMode=HOURS. A manually-entered, execution-scoped coefficient used only to split totalAmount — never an hourly wage.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  hours?: number;
}

/** Same empty-string-input fix as StartProductionOrderDto/RecordPayrollEntryDto's date fields elsewhere in this codebase. */
const dateTransform = Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value));

export class CreateProductionExecutionDto {
  @ApiPropertyOptional({ description: 'Exactly one of productionOrderId/workTaskId must be set (PRODUCT vs GENERAL execution).' })
  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workTaskId?: string;

  @ApiProperty()
  @dateTransform
  @Type(() => Date)
  @IsDate()
  performedAt!: Date;

  @ApiPropertyOptional({ description: 'Drives the server-computed fund for a PRODUCT execution (qtyCompleted / unitsPlanned x laborCostEur). Informational only for GENERAL.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyCompleted?: number;

  @ApiProperty({ enum: PRODUCTION_EXECUTION_METHODS })
  @IsIn(PRODUCTION_EXECUTION_METHODS)
  method!: ProductionExecutionMethod;

  @ApiPropertyOptional({ description: 'Reporting tag only — never drives fund math, never validated against the allocations list.' })
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiProperty({ enum: EXECUTION_ALLOCATION_MODES })
  @IsIn(EXECUTION_ALLOCATION_MODES)
  allocationMode!: ExecutionAllocationMode;

  @ApiPropertyOptional({
    description:
      'GENERAL (workTaskId) executions only — entered manually and validated against the WorkTask\'s remaining fund. ' +
      'Ignored/rejected for PRODUCT (productionOrderId) executions, which are always server-computed — never client input.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @ApiProperty({ type: [ProductionExecutionAllocationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductionExecutionAllocationDto)
  allocations!: ProductionExecutionAllocationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** DRAFT-only patch — productionOrderId/workTaskId are immutable once created (the parent an execution belongs to never changes). */
export class PatchProductionExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @dateTransform
  @Type(() => Date)
  @IsDate()
  performedAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyCompleted?: number;

  @ApiPropertyOptional({ enum: PRODUCTION_EXECUTION_METHODS })
  @IsOptional()
  @IsIn(PRODUCTION_EXECUTION_METHODS)
  method?: ProductionExecutionMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({ enum: EXECUTION_ALLOCATION_MODES })
  @IsOptional()
  @IsIn(EXECUTION_ALLOCATION_MODES)
  allocationMode?: ExecutionAllocationMode;

  @ApiPropertyOptional({ description: 'GENERAL executions only, same rule as on create.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @ApiPropertyOptional({ type: [ProductionExecutionAllocationDto], description: 'Full replace, mirrors SetProductionOrderWorkersDto.' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductionExecutionAllocationDto)
  allocations?: ProductionExecutionAllocationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class VoidProductionExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

/** Body for the replacement execution created by a correction (void + new). Same shape as create, minus the parent — inherited from the execution being corrected. */
export class CorrectProductionExecutionDto {
  @ApiProperty()
  @dateTransform
  @Type(() => Date)
  @IsDate()
  performedAt!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qtyCompleted?: number;

  @ApiProperty({ enum: PRODUCTION_EXECUTION_METHODS })
  @IsIn(PRODUCTION_EXECUTION_METHODS)
  method!: ProductionExecutionMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiProperty({ enum: EXECUTION_ALLOCATION_MODES })
  @IsIn(EXECUTION_ALLOCATION_MODES)
  allocationMode!: ExecutionAllocationMode;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @ApiProperty({ type: [ProductionExecutionAllocationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductionExecutionAllocationDto)
  allocations!: ProductionExecutionAllocationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryProductionExecutionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workTaskId?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'CONFIRMED', 'VOIDED'] })
  @IsOptional()
  @IsString()
  status?: string;

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
