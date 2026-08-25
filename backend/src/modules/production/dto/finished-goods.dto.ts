import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from 'class-validator';

export class QueryFinishedGoodsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assemblyId?: string;

  @ApiPropertyOptional({ enum: ['IN_STOCK', 'SHIPPED', 'CONSUMED', 'REWORK', 'DEFECTIVE'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Stocks units of an assembly bought ready-made from a supplier, bypassing the ProductionOrder create->start lifecycle entirely (no BOM consumption, no labor fund — there is none to freeze). */
export class ReceivePurchasedFinishedGoodsDto {
  @ApiProperty()
  @IsUUID()
  assemblyId!: string;

  @ApiProperty({ description: 'Whole number of units received — one FinishedGood row per unit, same as start().' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  qty!: number;

  @ApiProperty({ description: 'Purchase cost per unit — stored as both unitCostLocalEur and unitCostGermanEur, same "one cost basis" convention start() now uses.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitCostEur!: number;

  @ApiPropertyOptional({ description: 'e.g. supplier name, invoice number — free text, same field a manufactured unit\'s comment already uses.' })
  @IsOptional()
  @IsString()
  comment?: string;
}
