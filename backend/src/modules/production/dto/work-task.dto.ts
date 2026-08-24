import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateWorkTaskDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty({ description: 'Set manually — general work has no per-unit rate to derive it from.' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fund!: number;
}

export class UpdateWorkTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ description: 'Cannot be lowered below what CONFIRMED executions have already drawn from it.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fund?: number;
}

/** Full replace, mirrors SetTeamMembersDto — purely informational tags, reporting only, never read by any fund/allocation calculation. */
export class SetWorkTaskItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID('4', { each: true })
  customerOrderItemIds!: string[];
}

export class QueryWorkTasksDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
