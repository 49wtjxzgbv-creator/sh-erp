import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class SwitchConnectionDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;

  @ApiProperty()
  @IsUUID()
  connectionId!: string;
}
