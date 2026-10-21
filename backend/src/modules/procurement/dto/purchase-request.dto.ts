import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength, ValidateNested } from 'class-validator';

export class PurchaseRequestItemDto {
  @ApiPropertyOptional({ description: 'Optional — same "article not yet in Products" allowance as PurchaseOrderItem.productId.' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({ description: 'Article snapshot — kept even if productId is set, and required when it is not.' })
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
  qty!: number;

  @ApiPropertyOptional({ description: 'Filled in as the supplier quotes a price — optional at creation.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedPrice?: number;
}

export class CreatePurchaseRequestDto {
  @ApiPropertyOptional({ description: 'May be omitted if the supplier is only known by name.' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ description: 'Free-text supplier name, preserved even if supplierId is set.' })
  @IsString()
  @MinLength(1)
  supplierNameSnapshot!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({ type: [PurchaseRequestItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestItemDto)
  items!: PurchaseRequestItemDto[];
}

/** Header-only update — same shape as CreatePurchaseRequestDto minus items (which go through the dedicated bulk-replace endpoint, see saveItems). */
export class UpdatePurchaseRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  supplierNameSnapshot?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

/** Full bulk replace — same convention as QuotationsService#saveItems (delete all, recreate from the submitted array). */
export class SavePurchaseRequestItemsDto {
  @ApiProperty({ type: [PurchaseRequestItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestItemDto)
  items!: PurchaseRequestItemDto[];
}

export class QueryPurchaseRequestsDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SENT', 'CONVERTED', 'CANCELLED'] })
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
