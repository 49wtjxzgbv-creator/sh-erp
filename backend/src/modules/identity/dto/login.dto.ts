import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsLatitude, IsLongitude, IsOptional, IsString, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({ description: 'Browser-reported GPS at login time (navigator.geolocation), best-effort — omitted entirely if denied/unavailable/timed out. Never required.' })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'See latitude.' })
  @IsOptional()
  @IsLongitude()
  longitude?: number;
}
