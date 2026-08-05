import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class UpdateCompanyBrandingDto {
  @ApiPropertyOptional({ description: 'FileAsset id, domain=BRANDING' })
  @IsOptional()
  @IsUUID()
  siteLogoFileId?: string;

  @ApiPropertyOptional({ description: 'FileAsset id, domain=BRANDING' })
  @IsOptional()
  @IsUUID()
  printLogoFileId?: string;

  @ApiPropertyOptional({ description: 'FileAsset id, domain=BRANDING' })
  @IsOptional()
  @IsUUID()
  faviconFileId?: string;
}
