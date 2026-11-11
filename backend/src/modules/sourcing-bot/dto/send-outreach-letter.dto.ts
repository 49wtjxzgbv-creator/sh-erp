import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** "лист ... після формування ... надсилати постачальнику" (2026-11-11) — carries back exactly the text the admin reviewed from the generate step, so the email sent matches what they saw (the PDF itself is regenerated fresh server-side, not round-tripped through the client). `fromName` is carried through the same way, so an edit made before generating isn't lost when the PDF gets regenerated for the send step. */
export class SendOutreachLetterDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fromName?: string;
}
