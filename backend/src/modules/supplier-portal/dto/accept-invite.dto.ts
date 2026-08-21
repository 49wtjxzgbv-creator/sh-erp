import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Self-service registration (2026-08-21 P1, ADR-0013). `organizationName` is
 * required only when `email` doesn't already belong to an existing
 * `SupplierPortalUser` — the service decides which branch applies, not the
 * DTO (mirrors `SuppliersService#invitePortal`'s own 2-branch shape).
 */
export class AcceptSupplierInviteDto {
  @ApiProperty({ example: 'supplier@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'a strong password' })
  @IsString()
  @MinLength(12)
  password!: string;

  @ApiPropertyOptional({ example: 'ТОВ Ромашка', description: 'Required only when `email` has no existing Supplier Portal account.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  organizationName?: string;
}
