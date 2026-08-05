import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateProductionStageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;
}

export class ReorderProductionStagesDto {
  @ApiProperty({ type: [String], description: 'Every existing stage id, in the desired order. sortOrder is rewritten to match this array\'s position.' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  orderedIds!: string[];
}
