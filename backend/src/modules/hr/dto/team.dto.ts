import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateTeamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;
}

export class UpdateTeamDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;
}

/** Full replace, mirrors SetProductionOrderWorkersDto — a team's roster is a preset, changing it never touches any existing ProductionExecution's own recorded allocations. */
export class SetTeamMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(0)
  @IsUUID('4', { each: true })
  employeeIds!: string[];
}

export class QueryTeamsDto {
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
