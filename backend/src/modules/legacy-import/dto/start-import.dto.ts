import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class StartImportDto {
  @ApiProperty({ example: 'https://script.google.com/macros/s/AKfycb.../exec' })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  sourceUrl!: string;

  @ApiProperty({ description: 'The token the customer set inside WebAppExport.gs\'s TOKEN constant when they deployed it.' })
  @IsString()
  @MaxLength(500)
  sourceToken!: string;

  @ApiProperty({ required: false, default: false, description: 'true = validate-only (dry run), never writes business data.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
