import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskHelpDto {
  @ApiProperty({ description: 'User question, answered strictly from the built-in manual — the assistant has no access to live data (Phase 1 §3.7).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;
}
