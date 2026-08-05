import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SuperAdminLoginDto {
  @ApiProperty({ example: 'root@sh-erp.internal' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}
