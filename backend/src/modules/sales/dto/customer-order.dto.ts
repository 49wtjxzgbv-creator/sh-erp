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

/** Same fields on both Create and the header-only Update DTO below — factored out once instead of duplicated. */
class ExtraCostsDto {
  @ApiPropertyOptional({ description: 'Доставка.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryCost?: number;

  @ApiPropertyOptional({ description: 'Транспортно-такелажні витрати.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  transportRiggingCost?: number;

  @ApiPropertyOptional({ description: 'Додаткові витрати.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  otherCost?: number;
}

export class SubAssemblyToProduceDto {
  @ApiProperty()
  @IsUUID()
  assemblyId!: string;

  @ApiProperty({ description: 'Whole number of units to plan a production batch for — one FinishedGood serial per unit, same as any other ProductionOrder.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;
}

export class CustomerOrderItemDto {
  @ApiProperty()
  @IsUUID()
  assemblyId!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;

  @ApiPropertyOptional({
    type: [SubAssemblyToProduceDto],
    description:
      'Sub-assemblies (recursively) the user marked "Виготовити" for this line. Recorded as intent only on ' +
      'CustomerOrderItem.plannedSubAssemblies — no ProductionOrder is created here. The actual batch is only ' +
      'created later, per node, when staff confirm "Передати у виробництво" in the Хід виробництва tree; this ' +
      'list just pre-fills that dialog\'s quantity.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubAssemblyToProduceDto)
  subAssembliesToProduce?: SubAssemblyToProduceDto[];

  @ApiPropertyOptional({
    type: [SubAssemblyToProduceDto],
    description:
      'Sub-assemblies (recursively) the user marked "Зі складу" for this line. Claims `qty` of that assembly\'s ' +
      'IN_STOCK finished goods via SubAssemblyReservation, so a LATER order\'s own "Підвироби" dialog can see it ' +
      'was already spoken for — see SubAssemblyReservationService\'s own header comment for why this is ' +
      'best-effort, not a hard atomic guarantee.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubAssemblyToProduceDto)
  subAssembliesFromStock?: SubAssemblyToProduceDto[];

  @ApiPropertyOptional({ description: 'Planned start for this line, only if it differs from the order\'s own. Never auto-derived — left null shows as "не заплановано".' })
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

  @ApiPropertyOptional({ description: 'Deadline for this specific line, only if it differs from the order\'s own deadline.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  itemDeadline?: Date;
}

export class CreateCustomerOrderDto extends ExtraCostsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderNumber?: string;

  // Quotations module (2026-08-27): optional link to the new Customer
  // directory — see CustomerOrder.customerId's own schema.prisma comment.
  // clientName stays required and independent on this DTO (not derived
  // from customerId server-side) so every existing caller that never heard
  // of Customer keeps working unmodified; the frontend's CustomerPicker
  // fills clientName from the chosen Customer.name itself when this is set.
  @ApiPropertyOptional({ description: 'Optional Customer directory link.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

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

  // Planning targets for the order as a whole (План-графік §4) — optional,
  // never auto-derived; a null value shows as "не заплановано" everywhere,
  // never a guessed date.
  @ApiPropertyOptional()
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
  plannedCompletionAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedShipmentAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedDeliveryAt?: Date;

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

export class CustomerOrderHeaderDto extends ExtraCostsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orderNumber?: string;

  @ApiPropertyOptional({ description: 'Optional Customer directory link.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

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
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedStartAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedCompletionAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedShipmentAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  plannedDeliveryAt?: Date;

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
