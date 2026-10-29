import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

/** Same 4-locale set the app ships messages for (frontend/lib/i18n-locales.ts) — kept inline rather than importing QUOTATION_LOCALES from the Quotations module, which would be a backwards cross-module dependency for a generic AI endpoint. */
const SUPPORTED_LOCALES = ['uk', 'en', 'de', 'pl'];

export class TranslateJsonDto {
  @ApiProperty({ description: 'Flat {key: string|null} object — every non-empty value gets translated, in one request. Keys come back unchanged.' })
  @IsObject()
  fields!: Record<string, string | null>;

  @ApiProperty({ enum: SUPPORTED_LOCALES })
  @IsIn(SUPPORTED_LOCALES)
  targetLocale!: string;

  @ApiProperty({
    required: false,
    description:
      'Short Ukrainian noun phrase naming what this text IS, inserted into the AI prompt as "Це текст <documentKind>" so the translation is framed in the right register/context — e.g. "заявки постачальнику (назви й описи товарних позицій)". Defaults to a Quotations-flavored phrase if omitted.',
  })
  @IsOptional()
  @IsString()
  documentKind?: string;
}
