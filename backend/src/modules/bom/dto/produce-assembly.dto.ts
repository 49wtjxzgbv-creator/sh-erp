import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class ProduceAssemblyDto {
  @ApiProperty({ description: 'Number of finished units to produce.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qty!: number;

  @ApiPropertyOptional({ description: 'Warehouse to consume components from. Defaults to the company default warehouse if omitted.' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class CheckAvailabilityDto {
  @ApiProperty({ description: 'Number of finished units to check availability for.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  qty!: number;
}
