import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class ReceivePurchaseOrderLineDto {
  @ApiProperty()
  @IsUUID()
  purchaseOrderItemId!: string;

  @ApiProperty({ description: 'Quantity received in THIS receiving event (delta, not a running total) — receiving can happen in multiple partial deliveries.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qtyReceived!: number;

  @ApiPropertyOptional({ description: 'Realized price for this receipt — recorded separately from expectedPrice so realized cost can differ from what was quoted (Phase 1 §3.4).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualPrice?: number;
}

export class ReceivePurchaseOrderDto {
  @ApiPropertyOptional({ description: 'Warehouse to receive stock into. Defaults to the company default warehouse if omitted.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ type: [ReceivePurchaseOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderLineDto)
  lines!: ReceivePurchaseOrderLineDto[];
}
