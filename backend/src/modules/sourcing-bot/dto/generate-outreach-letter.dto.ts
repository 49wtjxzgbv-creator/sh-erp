import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * "поле від кого зараз [неправильне], зроби щоб це можна було вносити
 * вручну перед генеруванням пдф" (2026-11-11) — the "Від кого" party block
 * on the generated PDF defaulted to the company's own registered name,
 * which turned out to be wrong/undesired; the admin can now type whatever
 * should appear there instead. Optional — an empty/omitted value falls
 * back to the company name, same as before.
 */
export class GenerateOutreachLetterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fromName?: string;
}
