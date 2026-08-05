import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Shyring OÜ' })
  @IsString()
  @MinLength(2)
  companyName!: string;

  @ApiProperty({
    example: 'shyring',
    description: 'Subdomain slug — UX resolution only, never trusted for auth (ADR-0002).',
  })
  @IsString()
  @Matches(/^[a-z0-9-]{3,63}$/, {
    message: 'slug must be lowercase alphanumeric with hyphens, 3-63 characters',
  })
  slug!: string;

  @ApiPropertyOptional({ example: 'Europe/Kyiv', default: 'Europe/Kyiv' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ example: 'uk', default: 'uk' })
  @IsOptional()
  @IsString()
  locale?: string;

  // First user — becomes the company's Admin. Company signup and first-user
  // creation are one flow, by design: there is no company with zero members.
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  ownerEmail!: string;

  @ApiProperty({ example: 'a strong password' })
  @IsString()
  @MinLength(12)
  ownerPassword!: string;

  @ApiProperty({ example: 'Олена Ковальчук' })
  @IsString()
  @MinLength(1)
  ownerFullName!: string;
}
