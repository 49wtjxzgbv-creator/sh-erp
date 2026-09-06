import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateCompanyAiSettingsDto {
  @ApiPropertyOptional({
    enum: ['gemini', 'deepseek'],
    description: 'Which AI vendor to use (2026-09-06) — switching does NOT carry the API key over, since each vendor needs its own key.',
  })
  @IsOptional()
  @IsIn(['gemini', 'deepseek'])
  provider?: 'gemini' | 'deepseek';

  @ApiPropertyOptional({
    description:
      "Bring-your-own API key for the currently selected `provider` (Phase 2 §8) — encrypted at rest before storage, never returned in plaintext by any read endpoint. " +
      'Pass an empty string to clear it (Gemini falls back to the platform-provided key; DeepSeek has none, so this becomes non-functional until a new key is set).',
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
