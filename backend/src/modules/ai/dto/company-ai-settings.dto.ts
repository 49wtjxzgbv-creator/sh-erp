import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateCompanyAiSettingsDto {
  @ApiPropertyOptional({
    description:
      'Bring-your-own Gemini API key (Phase 2 §8) — encrypted at rest before storage, never returned in plaintext by any read endpoint. ' +
      'Pass an empty string to clear it and fall back to the platform-provided key.',
  })
  @IsOptional()
  @IsString()
  @MinLength(0)
  apiKey?: string;

  @ApiPropertyOptional({ description: 'Monthly token quota — null/omitted means unlimited (still subject to the platform default if no BYOK key is set).' })
  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyUsageQuota?: number;
}
