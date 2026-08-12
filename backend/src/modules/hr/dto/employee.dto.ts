import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  fullName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  // `@Transform` converts the plain "YYYY-MM-DD" string a date <input>
  // actually sends into a real `Date` BEFORE class-validator runs
  // (NestJS's ValidationPipe transforms first, validates second) —
  // `@IsDate()`, not `@IsDateString()`, validates that result. Real
  // incident: `@IsDateString()` alone happily accepted the string but left
  // it as a string; `dto as any` went straight to Prisma, and
  // Employee.hireDate is DateTime @db.Timestamptz(3), which needs a real
  // Date or full ISO-8601 datetime — every employee creation failed with
  // "Invalid value for argument `hireDate`: premature end of input.
  // Expected ISO-8601 DateTime." A plain `@Type(() => Date)` isn't enough
  // on its own either: an empty date <input> submits `''`, not omitted —
  // `@IsOptional()` only skips `undefined`/`null`, so `new Date('')`
  // (Invalid Date, but still `instanceof Date`) would have silently passed
  // `@IsDate()` and reached Prisma broken in a new way. The explicit ''/
  // null check here is what actually makes the field optional in practice.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  hireDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}

export class QueryEmployeesDto {
  @ApiPropertyOptional({ description: 'Matches fullName, partial, case-insensitive.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], description: 'Defaults to ACTIVE only if omitted.' })
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
