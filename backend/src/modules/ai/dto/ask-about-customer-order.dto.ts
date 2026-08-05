import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class AskAboutCustomerOrderDto {
  @ApiProperty()
  @IsUUID()
  customerOrderId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;
}
