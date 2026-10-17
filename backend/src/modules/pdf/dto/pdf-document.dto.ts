import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreatePdfPresignedUploadDto {
  @ApiProperty({ example: 'contract.pdf' })
  @IsString()
  @MaxLength(255)
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MaxLength(127)
  mimeType!: string;

  @ApiProperty({ example: 245_760, description: 'Bytes. Enforced again at confirm time against R2 HeadObject.' })
  @IsInt()
  @Min(1)
  @Max(200 * 1024 * 1024)
  sizeBytes!: number;

  @ApiPropertyOptional({
    description: '"Зберегти" an already-open document overwrites this existing row (new R2 object, same id) instead of creating a new library entry. Omit to upload a brand-new document.',
  })
  @IsOptional()
  @IsUUID()
  existingDocumentId?: string;
}

export class RenamePdfDocumentDto {
  @ApiProperty({ example: 'contract-signed.pdf' })
  @IsString()
  @MaxLength(255)
  name!: string;
}
