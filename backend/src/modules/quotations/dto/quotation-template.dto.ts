import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateQuotationTemplateDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ default: false, description: 'At most conceptually one default per company — the service does not enforce a hard uniqueness constraint, just clears the flag off any previous default when a new one is set.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Hex accent color, e.g. "#6423d0".' })
  @IsOptional()
  @IsString()
  accentColor?: string;

  @ApiPropertyOptional({ description: 'FileAsset id (domain=BRANDING) — falls back to CompanyBranding.printLogoFileId when null.' })
  @IsOptional()
  @IsUUID()
  printLogoFileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companyDetailsText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  headerText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  footerText?: string;

  @ApiPropertyOptional({ description: 'Which optional PDF blocks render — a flat map so new blocks never need a migration to become toggleable (§9).' })
  @IsOptional()
  @IsObject()
  visibleBlocks?: Record<string, boolean>;
}

export class UpdateQuotationTemplateDto extends PartialType(CreateQuotationTemplateDto) {}
