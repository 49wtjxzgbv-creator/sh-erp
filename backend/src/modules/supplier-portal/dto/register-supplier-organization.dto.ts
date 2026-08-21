import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Standalone self-registration (2026-08-21 P2) — no invite token, no
 * company involved. Always the "new organization" case, unlike
 * `AcceptSupplierInviteDto`: an account created this way starts with zero
 * connections, so there's no "existing account, prove ownership" branch to
 * support here.
 */
export class RegisterSupplierOrganizationDto {
  @ApiProperty({ example: 'ТОВ Ромашка' })
  @IsString()
  @MinLength(1)
  organizationName!: string;

  @ApiProperty({ example: 'supplier@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'a strong password' })
  @IsString()
  @MinLength(12)
  password!: string;
}
