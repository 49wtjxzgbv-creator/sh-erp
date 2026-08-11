import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResetUserPasswordDto {
  @ApiPropertyOptional({
    description: 'New password to set. If omitted, a random secure password is generated and returned once.',
    minLength: 8,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  newPassword?: string;
}
