import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateTransportUnitTypeDto {
  @ApiProperty({ example: 'Тент 20т' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 20000, description: 'Max cargo weight, kg.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxWeightKg!: number;

  @ApiPropertyOptional({ example: 82, description: 'Max cargo volume, m³.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxVolumeM3?: number;

  @ApiPropertyOptional({ example: 33, description: 'Max number of pallet/box places.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPackages?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateTransportUnitTypeDto extends PartialType(CreateTransportUnitTypeDto) {}
