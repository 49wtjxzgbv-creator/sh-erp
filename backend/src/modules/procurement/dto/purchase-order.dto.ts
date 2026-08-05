import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseOrderItemDto {
  @ApiPropertyOptional({ description: 'Optional — the legacy system allowed ordering an article not yet entered as a Product (Phase 1 §10.7).' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ description: 'Article snapshot at order time — kept even if productId is set, and required when it is not.' })
  @IsString()
  @MinLength(1)
  articleSnapshot!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  productNameSnapshot!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qtyOrdered!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedPrice?: number;
}

export class CreatePurchaseOrderDto {
  @ApiPropertyOptional({ description: 'Must belong to the same company if given (composite FK, decision 4). May be omitted if the supplier is only known by name (Phase 1 §10.6).' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ description: 'Free-text supplier name, preserved even if supplierId is set, for historical accuracy.' })
  @IsString()
  @MinLength(1)
  supplierNameSnapshot!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Set when this PO was generated from a customer order\'s shortage analysis (Phase 1 §6.3, wired up fully in the Sales module).' })
  @IsOptional()
  @IsUUID()
  sourceCustomerOrderId?: string;

  @ApiProperty({ type: [CreatePurchaseOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items!: CreatePurchaseOrderItemDto[];
}

export class QueryPurchaseOrdersDto {
  @ApiPropertyOptional({ enum: ['ORDERED', 'PARTIAL', 'DELIVERED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

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
