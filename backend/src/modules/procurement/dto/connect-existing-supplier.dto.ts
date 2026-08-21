import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Search-and-connect (2026-08-21 P2) — for a supplier who already
 * self-registered a Supplier Portal account independently (no invite link,
 * no prior Supplier row in this company). Staff supply the exact email the
 * supplier registered with, plus a name for the new local Supplier record.
 */
export class ConnectExistingSupplierDto {
  @ApiProperty({ example: 'supplier@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'ТОВ Ромашка' })
  @IsString()
  @MinLength(1)
  name!: string;
}
