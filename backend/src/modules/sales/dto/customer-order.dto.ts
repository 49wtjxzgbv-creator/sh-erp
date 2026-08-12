import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
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
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CustomerOrderItemDto {
  @ApiProperty()
  @IsUUID()
  assemblyId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
}

export class CreateCustomerOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderNumber?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  clientName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPerson?: string;

  // See employee.dto.ts's #hireDate for the real incident this same fix
  // pattern addresses: dto.deadline/dto as any goes straight to Prisma, and
  // CustomerOrder.deadline is DateTime @db.Timestamptz(3), which needs a
  // real Date/full ISO datetime, not the bare "YYYY-MM-DD" a date <input>
  // sends (@IsDateString() alone would accept it but leave it a string) —
  // and an empty <input> submits '', not omitted, so the explicit ''/null
  // check is what actually makes this optional in practice.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  deadline?: Date;

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' })
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({ type: [CustomerOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CustomerOrderItemDto)
  items!: CustomerOrderItemDto[];
}

export class CustomerOrderHeaderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactPerson?: string;

  // See employee.dto.ts's #hireDate for the real incident this same fix
  // pattern addresses: dto.deadline/dto as any goes straight to Prisma, and
  // CustomerOrder.deadline is DateTime @db.Timestamptz(3), which needs a
  // real Date/full ISO datetime, not the bare "YYYY-MM-DD" a date <input>
  // sends (@IsDateString() alone would accept it but leave it a string) —
  // and an empty <input> submits '', not omitted, so the explicit ''/null
  // check is what actually makes this optional in practice.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  deadline?: Date;

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

/** Header-only update — item lines are immutable once created (mirrors AssemblyComponent/ProductionOrder's "no partial-edit" convention); cancel and recreate for a genuine line change. */
export class UpdateCustomerOrderDto extends PartialType(CustomerOrderHeaderDto) {}

export class QueryCustomerOrdersDto {
  @ApiPropertyOptional({ enum: ['NEW', 'IN_PRODUCTION', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Matches clientName, partial, case-insensitive.' })
  @IsOptional()
  @IsString()
  search?: string;

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
