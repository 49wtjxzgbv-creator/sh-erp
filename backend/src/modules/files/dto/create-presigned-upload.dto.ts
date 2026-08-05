import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { FileDomain } from '@prisma/client';

const FILE_DOMAINS: FileDomain[] = [
  'PRODUCT_PHOTO',
  'ASSEMBLY_PHOTO',
  'ASSEMBLY_DRAWING',
  'CUSTOMER_ORDER_DOCUMENT',
  'PURCHASE_INVOICE',
  'EMPLOYEE_PHOTO',
  'QC_PHOTO',
  'SHIPMENT_PHOTO',
  'BRANDING',
];

export class CreatePresignedUploadDto {
  @ApiProperty({ enum: FILE_DOMAINS })
  @IsIn(FILE_DOMAINS)
  domain!: FileDomain;

  @ApiProperty({ example: 'Product', description: 'The entity type this file attaches to, e.g. "Product", "Assembly".' })
  @IsString()
  @MaxLength(64)
  entityType!: string;

  @ApiProperty()
  @IsUUID()
  entityId!: string;

  @ApiProperty({ example: 'front-view.jpg' })
  @IsString()
  @MaxLength(255)
  originalName!: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  @MaxLength(127)
  mimeType!: string;

  @ApiProperty({ example: 245_760, description: 'Bytes. Enforced again at confirm time against R2 HeadObject.' })
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024) // 100MB ceiling — generous for QC/assembly photos and drawings, well under R2's own limits
  sizeBytes!: number;

  @ApiProperty({ required: false, default: false, description: 'true for branding assets that must be visible pre-login.' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
