import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class StartJobDto {
  @ApiProperty()
  @IsUUID()
  connectionId!: string;

  @ApiProperty({ required: false, default: false, description: 'true = validate-only (dry run), never writes business data.' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
