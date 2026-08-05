import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

export class InviteUserDto {
  @ApiProperty({ example: 'newcolleague@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Олена Ковальчук' })
  @IsString()
  @MinLength(1)
  fullName!: string;

  @ApiProperty({ description: "One of this company's Role ids (see GET /roles)." })
  @IsUUID()
  roleId!: string;
}
