import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsUUID, Min, ValidateNested } from 'class-validator';

export class QuotePurchaseRequestItemDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quotedPrice!: number;
}

/** Supplier's per-line quote for a sent PurchaseRequest — mirrors ConfirmPurchaseOrderDto minus the delivery-date field (an RFQ has no delivery negotiation). */
export class QuotePurchaseRequestDto {
  @ApiProperty({ type: [QuotePurchaseRequestItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuotePurchaseRequestItemDto)
  items!: QuotePurchaseRequestItemDto[];
}
