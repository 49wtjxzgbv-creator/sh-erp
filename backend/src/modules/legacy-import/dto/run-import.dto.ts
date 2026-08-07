import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class RunImportDto {
  @ApiProperty()
  @IsUUID()
  connectionId!: string;
}
