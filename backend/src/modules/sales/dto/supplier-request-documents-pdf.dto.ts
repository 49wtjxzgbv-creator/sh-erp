import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

export class SupplierRequestDocumentItemDto {
  @ApiProperty()
  @IsUUID()
  fileAssetId!: string;

  @ApiProperty({
    description:
      'Header text printed at the top of this attachment\'s page(s) — the line\'s article + product/assembly name, exactly as shown in the print preview.',
  })
  @IsString()
  @MinLength(1)
  heading!: string;
}

export class GenerateSupplierRequestDocumentsPdfDto {
  @ApiProperty({ type: [SupplierRequestDocumentItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierRequestDocumentItemDto)
  items!: SupplierRequestDocumentItemDto[];
}
