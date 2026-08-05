import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AskFullAssistantDto {
  @ApiProperty({ description: 'User question — the assistant may call read-only data tools to answer it, and can propose (never silently execute) critical actions like a stock adjustment.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question!: string;

  @ApiPropertyOptional({ description: 'JSON-serialized prior turns (as returned in a previous response\'s `history` field) — carries conversation context forward, mirrors the legacy `historyJson` parameter.' })
  @IsOptional()
  @IsString()
  historyJson?: string;

  @ApiPropertyOptional({ description: 'Base64-encoded image/PDF attached to this turn.' })
  @IsOptional()
  @IsString()
  fileBase64?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fileMimeType?: string;
}
