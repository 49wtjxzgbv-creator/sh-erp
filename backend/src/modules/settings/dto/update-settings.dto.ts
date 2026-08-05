import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateCompanySettingsDto {
  @ApiPropertyOptional({ example: 20, description: 'Percent, e.g. 20 = 20% VAT.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  vatRatePercent?: number;

  @ApiPropertyOptional({ type: [String], description: 'Ordered list of enabled dashboard widget keys.' })
  @IsOptional()
  @IsArray()
  dashboardWidgets?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  dailyDigestEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dailyDigestEnabled?: boolean;
}
