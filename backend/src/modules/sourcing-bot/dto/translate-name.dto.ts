import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** "додай можливість перекладу назв товарів на українську" (2026-11-10) — the catalog's own names are mostly German (imported from a German supplier), this is an on-demand per-name translate, not a bulk/automatic one. */
export class TranslateNameDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}
