import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateProductionScheduleSlotDto {
  @ApiPropertyOptional({ description: "Optional — a slot can predate knowing exactly which assembly it'll be." })
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  plannedUnits?: number;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  startAt!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  endAt!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateProductionScheduleSlotDto extends PartialType(CreateProductionScheduleSlotDto) {}

export class QueryProductionScheduleDto {
  // Same from/to ISO-string DTO pattern as MonthlyProductionRollupQueryDto
  // (reports/dto/report-queries.dto.ts) — defaults resolved in the service,
  // not here, to keep the "default = current month" decision in one place.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
