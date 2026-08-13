import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class ConfirmPurchaseOrderItemDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  confirmedPrice!: number;
}

export class ConfirmPurchaseOrderDto {
  // Same DateTime DTO pattern as CustomerOrder.deadline/hireDate elsewhere
  // in this codebase — a bare "YYYY-MM-DD" from a date <input> needs
  // @Type(() => Date), @IsDateString() alone would accept it but leave it
  // a string, which Prisma's DateTime column rejects.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  confirmedDeliveryDate?: Date;

  @ApiProperty({ type: [ConfirmPurchaseOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfirmPurchaseOrderItemDto)
  items!: ConfirmPurchaseOrderItemDto[];
}
