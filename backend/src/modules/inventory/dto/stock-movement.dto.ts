import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min, NotEquals } from 'class-validator';

const SINGLE_WAREHOUSE_MOVEMENT_TYPES = [
  'RECEIVE',
  'ISSUE',
  'ADJUST',
  'DEFECT_WRITE_OFF',
] as const;
export type SingleWarehouseMovementType = (typeof SINGLE_WAREHOUSE_MOVEMENT_TYPES)[number];

export class RecordStockMovementDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ enum: SINGLE_WAREHOUSE_MOVEMENT_TYPES })
  @IsIn(SINGLE_WAREHOUSE_MOVEMENT_TYPES)
  type!: SingleWarehouseMovementType;

  @ApiProperty({
    description:
      'Signed delta. RECEIVE/ADJUST are typically positive; ISSUE/DEFECT_WRITE_OFF are typically negative — ' +
      'the sign is taken as given, not inferred from `type`, so a correcting ADJUST can go either direction.',
  })
  @Type(() => Number)
  @IsNumber()
  @NotEquals(0)
  qtyDelta!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class MoveStockDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty()
  @IsUUID()
  fromWarehouseId!: string;

  @ApiProperty()
  @IsUUID()
  toWarehouseId!: string;

  @ApiProperty({ description: 'Positive quantity to move.' })
  @Type(() => Number)
  @IsNumber()
  qty!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}

export class QueryStockDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

/**
 * `QueryStockDto & { limit?: number; offset?: number }` (the previous
 * shape here) is a TypeScript-only lie: Nest's ValidationPipe resolves the
 * runtime metatype from the parameter's reflected design type, which for
 * an intersection type is just `Object` — so validation/transform silently
 * never ran, and `limit`/`offset` reached the service as raw query
 * strings, which Prisma's `take`/`skip` (expecting `number`) rejected. A
 * real subclass gives Nest an actual metatype to transform against.
 */
export class QueryStockHistoryDto extends QueryStockDto {
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
