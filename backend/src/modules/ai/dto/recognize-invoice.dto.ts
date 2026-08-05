import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RecognizeInvoiceDto {
  @ApiProperty({ description: 'Base64-encoded photo/scan of a supplier invoice.' })
  @IsString()
  @IsNotEmpty()
  base64Image!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @IsNotEmpty()
  mimeType!: string;
}
