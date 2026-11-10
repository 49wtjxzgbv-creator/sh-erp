import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Mini App's "➕ Додати постачальника" form (2026-11-10) — same fields the bot's own admin-only add-candidate text flow already collects, just a real form instead of one semicolon-separated message. */
export class CreateCandidateDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  website?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  whatTheyDo?: string;
}
