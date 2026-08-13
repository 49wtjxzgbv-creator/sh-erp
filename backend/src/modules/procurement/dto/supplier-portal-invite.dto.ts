import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional } from 'class-validator';

export class SupplierPortalInviteDto {
  // Optional override — defaults to Supplier.email if that's already set.
  // Required in the request only when the supplier has no email on file yet.
  @ApiPropertyOptional({ example: 'supplier@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
