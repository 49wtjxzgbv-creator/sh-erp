import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StartConnectionDto {
  @ApiProperty({ example: 'GOOGLE_APPS_SCRIPT', description: 'One of the registered provider types (see GET /legacy-import/providers).' })
  @IsString()
  @MaxLength(64)
  providerType!: string;

  @ApiProperty({ required: false, example: 'Головна таблиця', description: 'User-facing label — defaults to "Джерело N" if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
