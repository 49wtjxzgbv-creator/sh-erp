import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

export class QcCheckResultLineDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  itemName!: string;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;
}

export class RecordQcCheckDto {
  @ApiProperty()
  @IsUUID()
  finishedGoodId!: string;

  @ApiProperty({ enum: ['ACCEPTED', 'REWORK'], description: 'Flips the finished good\'s status to IN_STOCK (ACCEPTED) or REWORK (Phase 1 §3.3).' })
  @IsIn(['ACCEPTED', 'REWORK'])
  result!: 'ACCEPTED' | 'REWORK';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ type: [QcCheckResultLineDto], description: 'Per-checklist-item pass/fail snapshot at the time of this check.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QcCheckResultLineDto)
  results?: QcCheckResultLineDto[];
}
