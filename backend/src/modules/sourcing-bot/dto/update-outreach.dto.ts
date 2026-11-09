import { ApiProperty } from '@nestjs/swagger';
import { SourcingOutreachStatus } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/** Mini App's candidate-detail sheet (2026-11-10) — same fields the bot's own setstatus/note/quote_price+quote_note flows already write, just as one PATCH instead of a multi-step chat exchange. */
export class UpdateOutreachDto {
  @ApiProperty({ enum: SourcingOutreachStatus, required: false })
  @IsOptional()
  @IsEnum(SourcingOutreachStatus)
  status?: SourcingOutreachStatus;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  quotedPriceEur?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  quotedPriceNote?: string;
}
