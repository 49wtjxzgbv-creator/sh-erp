import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';

export class GenerateLoadPlanDto {
  @ApiProperty({ description: 'TransportUnitType to pack into — must have length/width/height set.' })
  @IsUUID()
  transportUnitTypeId!: string;
}

export class MoveLoadPlanItemDto {
  @ApiProperty({ description: '1-based truck index to move this item into. A truck with this index is created if it does not exist yet.' })
  @IsInt()
  @Min(1)
  toTruckIndex!: number;
}
