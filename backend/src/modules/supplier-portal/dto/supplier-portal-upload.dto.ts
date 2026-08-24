import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Phase 2 — presigned-upload request for a document a supplier attaches to
 * one of their own purchase orders. Deliberately narrower than the staff
 * `CreatePresignedUploadDto`: `domain`/`entityType`/`entityId` are NOT
 * client-supplied here — `SupplierPortalService` pins them server-side to
 * `PURCHASE_INVOICE`/`'PurchaseOrder'`/the already-ownership-verified
 * `orderId` from the URL, so a supplier can never attach a file to another
 * company's order or under an unrelated domain by manipulating the body.
 */
export class SupplierPortalUploadDto {
  @ApiProperty({ example: 'invoice.pdf' })
  @IsString()
  @MaxLength(255)
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @MaxLength(127)
  mimeType!: string;

  @ApiProperty({ example: 245_760 })
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes!: number;
}
