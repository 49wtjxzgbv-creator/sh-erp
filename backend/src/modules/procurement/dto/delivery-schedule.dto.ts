import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDate, IsNumber, Min, ValidateNested } from 'class-validator';

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
