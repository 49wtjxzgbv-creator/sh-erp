import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/** PIECEWORK is deliberately excluded — those entries are system-generated only, from ProductionOrdersService.start() (Module 6). This endpoint is for the 3 manual entry types. */
export const MANUAL_PAYROLL_ENTRY_TYPES = ['ADVANCE', 'BONUS', 'PENALTY'] as const;
export type ManualPayrollEntryType = (typeof MANUAL_PAYROLL_ENTRY_TYPES)[number];

export class RecordPayrollEntryDto {
  @ApiProperty()
  @IsUUID()
  employeeId!: string;

  @ApiProperty({ enum: MANUAL_PAYROLL_ENTRY_TYPES })
  @IsIn(MANUAL_PAYROLL_ENTRY_TYPES)
  type!: ManualPayrollEntryType;

  @ApiProperty({
    description:
      'Positive magnitude — the service applies the correct sign convention (ADVANCE/PENALTY negative, BONUS ' +
      'positive, Phase 1 §3.5) automatically, so callers never need to remember which direction a type goes.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class QueryPayrollEntriesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ['PIECEWORK', 'ADVANCE', 'BONUS', 'PENALTY'] })
  @IsOptional()
  @IsString()
  type?: string;

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

export class PayrollSummaryQueryDto {
  @ApiPropertyOptional({ description: 'ISO date — defaults to no lower bound.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date — defaults to no upper bound.' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
