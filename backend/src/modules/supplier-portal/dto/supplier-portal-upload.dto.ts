import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

// Invoice-appropriate types only — this upload path is reachable by an
// external, unauthenticated-until-login supplier account, not just staff,
// so it's intentionally narrower than the staff CreatePresignedUploadDto's
// free-text mimeType (which still goes through FilesService's own
// dangerous-inline-type neutralization, but accepts any declared type).
const SUPPLIER_PORTAL_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
];

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

  @ApiProperty({ example: 'application/pdf', enum: SUPPLIER_PORTAL_UPLOAD_MIME_TYPES })
  @IsIn(SUPPLIER_PORTAL_UPLOAD_MIME_TYPES)
  mimeType!: string;

  @ApiProperty({ example: 245_760 })
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes!: number;
}
