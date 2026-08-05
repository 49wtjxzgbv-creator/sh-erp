import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateCompanyUnitDto {
  @ApiProperty({ example: 'шт' })
  @IsString()
  @MinLength(1)
  name!: string;
}
