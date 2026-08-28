import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Every field is optional AND nullable: `undefined`/omitted means "leave
 * as-is" (class-validator's IsOptional lets it pass through untouched),
 * `null` means "clear this field" — SettingsService#updateRequisites
 * passes the DTO straight into Prisma's upsert `update`, so an explicit
 * null becomes a real `SET column = NULL`. The frontend form always
 * submits the full current state (not a sparse per-field patch), so it
 * sends null rather than omitting a field the user cleared — see
 * RequisitesCard in settings/page.tsx.
 */
export class UpdateCompanyRequisitesDto {
  @ApiPropertyOptional({ description: 'Legal/registered company name, as it should appear on documents.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalName?: string | null;

  @ApiPropertyOptional({ description: 'ЄДРПОУ or ІПН — no format validation, differs by legal entity type.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  legalAddress?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  bankName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  bankIban?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  bankMfo?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string | null;
}
