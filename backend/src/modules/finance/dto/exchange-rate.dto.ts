import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { Currency } from '@prisma/client';

export class QueryExchangeRatesDto {
  @ApiPropertyOptional({ description: 'Defaults to 90 days ago.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({ description: 'Defaults to today.' })
  @IsOptional()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class SetExchangeRateOverrideDto {
  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  rate!: number;

  @ApiProperty()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  asOfDate!: Date;
}

export class QueryExchangeRateDto {
  @ApiProperty({ enum: Currency })
  @IsEnum(Currency)
  currency!: Currency;

  @ApiProperty()
  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : value))
  @Type(() => Date)
  @IsDate()
  asOfDate!: Date;
}

export class SyncExchangeRatesDto {
  @ApiPropertyOptional({ description: 'How many days back to backfill, including today. Defaults to 1 (today only).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  days?: number;
}
