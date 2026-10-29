import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Currency } from '@prisma/client';

export class UpdateCompanySettingsDto {
  @ApiPropertyOptional({
    enum: Currency,
    description:
      'Multi-currency module (2026-10-29) — this company\'s own base/reporting currency. New Assembly/Product/CustomerOrder/PurchaseOrder/Quotation rows default to this when no currency is given explicitly, and Finance/warehouse-valuation totals are reported in this.',
  })
  @IsOptional()
  @IsEnum(Currency)
  baseCurrency?: Currency;

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
