import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiProperty({
    example: 'shyring',
    description:
      'Which company to sign in to. The user must have a CompanyMembership for this ' +
      'company, verified server-side — never trusted purely because the client is on ' +
      'that subdomain (ADR-0002).',
  })
  @IsString()
  companySlug!: string;
}
