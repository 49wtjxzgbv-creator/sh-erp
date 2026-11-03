import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsNumber, IsUUID, Min, ValidateNested } from 'class-validator';

export class DeliveryScheduleLineInputDto {
  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  date!: Date;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  qty!: number;
}

/** Shared shape for both "create the first version" (staff) and "propose a split" (supplier) — same validation either way. */
export class DeliveryScheduleLinesDto {
  @ApiProperty({ type: [DeliveryScheduleLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryScheduleLineInputDto)
  lines!: DeliveryScheduleLineInputDto[];
}

/**
 * "fill once for the group" (2026-11-03) — one date+qty grid for several
 * sibling PurchaseOrderItems at once (produced by
 * PurchaseRequestsService#convertToOrder fanning an aggregated заявка line
 * out across customer orders). Each line's qty is split proportionally
 * across the items by PurchaseOrdersService#createGroupedDeliverySchedule,
 * which then calls DeliverySchedulesService#createFirstVersion once per
 * item — this DTO only carries the group + the totals staff typed.
 */
export class BulkCreateDeliveryScheduleDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  purchaseOrderItemIds!: string[];

  @ApiProperty({ type: [DeliveryScheduleLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryScheduleLineInputDto)
  lines!: DeliveryScheduleLineInputDto[];
}
