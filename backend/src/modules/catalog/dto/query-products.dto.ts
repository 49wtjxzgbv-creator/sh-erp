import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class QueryProductsDto {
  @ApiPropertyOptional({ description: 'Matches article (citext) or name, partial.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  barcode?: string;

  @ApiPropertyOptional({ description: 'Matches Product.defaultSupplierId.' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ default: false, description: 'Include soft-deleted products.' })
  @IsOptional()
  includeDeleted?: boolean;

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

  @ApiPropertyOptional({
    enum: ['name', 'newest'],
    default: 'name',
    description: '"newest" surfaces just-created products (createdAt desc) instead of alphabetical order.',
  })
  @IsOptional()
  @IsIn(['name', 'newest'])
  sort?: 'name' | 'newest';
}
