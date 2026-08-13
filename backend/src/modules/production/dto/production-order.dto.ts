import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDate,
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

  // Same DateTime DTO pattern as CustomerOrder.deadline/hireDate elsewhere
  // in this codebase — @IsDateString() alone would accept a bare
  // "YYYY-MM-DD" from a date <input> but leave it a string, which Prisma's
  // DateTime column rejects; @Type(() => Date) converts it first.
  @ApiPropertyOptional({ description: 'Optional target window for the production schedule view — purely a plan, never frozen/enforced like the cost fields.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  scheduledStartAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  scheduledEndAt?: Date;

  @ApiPropertyOptional({ type: [ProductionOrderWorkerDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionOrderWorkerDto)
  workers?: ProductionOrderWorkerDto[];

  @ApiPropertyOptional({ description: 'This batch\'s parent order line, if created via "give to production" (План-графік §1). One CustomerOrderItem can have many ProductionOrder batches.' })
  @IsOptional()
  @IsUUID()
  customerOrderItemId?: string;
}

export class ProductionOrderStagePlanEntryDto {
  @ApiProperty({ description: 'Must be a real ProductionStage of this company — stage names are never invented client-side (План-графік §2).' })
  @IsUUID()
  productionStageId!: string;

  @ApiPropertyOptional({ description: 'Date AND time — not date-only.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedStartAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedEndAt?: Date;
}

/** Full replace, mirrors SetProductionOrderWorkersDto. Each stage's window is independent — never auto-divided evenly across the batch. */
export class SetProductionOrderStagePlanDto {
  @ApiProperty({ type: [ProductionOrderStagePlanEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionOrderStagePlanEntryDto)
  stages!: ProductionOrderStagePlanEntryDto[];
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
