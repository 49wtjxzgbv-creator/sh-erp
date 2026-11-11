import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** "лист ... після формування ... надсилати постачальнику" (2026-11-11) — carries back exactly the text the admin reviewed from the generate step, so the email sent matches what they saw (the PDF itself is regenerated fresh server-side, not round-tripped through the client). */
export class SendOutreachLetterDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  text!: string;
}
