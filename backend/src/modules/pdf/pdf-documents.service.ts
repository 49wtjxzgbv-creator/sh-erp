import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { createR2Client, R2_BUCKET } from '../files/r2-client';
import { CreatePdfPresignedUploadDto, RenamePdfDocumentDto } from './dto/pdf-document.dto';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

/**
 * "створи пдф редактор і переглядач такий як едобе акробат" (2026-10-17) —
 * a company-wide PDF library (PdfDocument — see its own schema comment for
 * why it's deliberately NOT a FileAsset: no entityType/entityId, this is a
 * standalone document someone opened to view/mark up/rearrange, not an
 * attachment on some other record). Mirrors FilesService's own 2-step
 * presigned-upload+confirm flow almost exactly (same R2 client, same
 * HeadObject size check) — the one real difference is `existingDocumentId`:
 * "Зберегти" on an already-open document reuses this same pair, just
 * updating that row's storageKey instead of creating a new one, so every
 * save is a plain R2 PUT, never a server-side PDF-processing step. All
 * actual editing (page reorder/rotate/delete/merge, annotations) happens
 * client-side via pdf-lib against the bytes `getContent` streams out.
 */
@Injectable()
export class PdfDocumentsService {
  private readonly r2 = createR2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: RequestUser) {
    return this.prisma.tenant.pdfDocument.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createPresignedUpload(user: RequestUser, dto: CreatePdfPresignedUploadDto) {
    if (dto.existingDocumentId) {
      const existing = await this.prisma.tenant.pdfDocument.findUnique({ where: { id: dto.existingDocumentId } });
      if (!existing || existing.deletedAt) throw new CodedNotFoundException('PDF_DOCUMENT_NOT_FOUND', 'PDF document not found.');
    }

    const safeName = sanitizeFilename(dto.originalName);
    const storageKey = `tenants/${user.companyId}/pdf-documents/${randomUUID()}-${safeName}`;

    const uploadUrl = await getSignedUrl(
      this.r2,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: storageKey, ContentType: dto.mimeType, ContentLength: dto.sizeBytes }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    // Not yet confirmed to exist in R2 — same "row first, bytes later"
    // ordering as FilesService#createPresignedUpload, so there's always a
    // stable id to hand back and to confirm against.
    const doc = dto.existingDocumentId
      ? await this.prisma.tenant.pdfDocument.update({
          where: { id: dto.existingDocumentId },
          data: { storageKey, sizeBytes: dto.sizeBytes, name: dto.originalName },
        })
      : await this.prisma.tenant.pdfDocument.create({
          data: {
            companyId: user.companyId,
            name: dto.originalName,
            storageKey,
            sizeBytes: dto.sizeBytes,
            createdById: user.userId,
          },
        });

    return { pdfDocumentId: doc.id, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  async confirmUpload(user: RequestUser, pdfDocumentId: string) {
    const doc = await this.prisma.tenant.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!doc) throw new CodedNotFoundException('PDF_DOCUMENT_NOT_FOUND', 'PDF document not found.');

    let head;
    try {
      head = await this.r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: doc.storageKey }));
    } catch {
      throw new CodedBadRequestException('PDF_UPLOAD_NOT_FOUND_IN_STORAGE', 'Upload not found in storage yet — did the PUT to uploadUrl succeed?');
    }
    if (head.ContentLength !== undefined && head.ContentLength !== doc.sizeBytes) {
      throw new CodedBadRequestException('PDF_SIZE_MISMATCH', `Uploaded object size (${head.ContentLength}) does not match the declared size (${doc.sizeBytes}).`);
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'pdf_document.uploaded',
      entityType: 'PdfDocument',
      entityId: doc.id,
      metadata: { name: doc.name, sizeBytes: doc.sizeBytes },
    });

    return doc;
  }

  async rename(user: RequestUser, pdfDocumentId: string, dto: RenamePdfDocumentDto) {
    const doc = await this.prisma.tenant.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!doc || doc.deletedAt) throw new CodedNotFoundException('PDF_DOCUMENT_NOT_FOUND', 'PDF document not found.');
    return this.prisma.tenant.pdfDocument.update({ where: { id: pdfDocumentId }, data: { name: dto.name } });
  }

  async delete(user: RequestUser, pdfDocumentId: string) {
    const doc = await this.prisma.tenant.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!doc || doc.deletedAt) throw new CodedNotFoundException('PDF_DOCUMENT_NOT_FOUND', 'PDF document not found.');

    await this.prisma.tenant.pdfDocument.update({ where: { id: pdfDocumentId }, data: { deletedAt: new Date() } });
    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'pdf_document.deleted',
      entityType: 'PdfDocument',
      entityId: pdfDocumentId,
    });
    return { ok: true };
  }

  /**
   * Same-origin streaming proxy (mirrors
   * landing-page-public.service.ts#getMediaObject's own reasoning): a
   * browser-side `fetch()`/pdfjs-dist `getDocument()` call reading a
   * cross-origin R2 presigned URL would need R2 CORS configured for GET,
   * which this app's R2 bucket doesn't have (only the presigned-PUT upload
   * path does — see files.service.ts's own header comment on
   * getSpreadsheetPreview for the same gap). Routing through this backend
   * instead makes the request same-origin as the frontend's own API base,
   * no CORS involved at all.
   */
  async getContent(user: RequestUser, pdfDocumentId: string): Promise<{ body: NodeJS.ReadableStream; sizeBytes: number; name: string }> {
    const doc = await this.prisma.tenant.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!doc || doc.deletedAt) throw new CodedNotFoundException('PDF_DOCUMENT_NOT_FOUND', 'PDF document not found.');

    const object = await this.r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.storageKey }));
    if (!object.Body) throw new CodedNotFoundException('PDF_DOCUMENT_NOT_FOUND', 'PDF object not found in storage.');

    return { body: object.Body as unknown as NodeJS.ReadableStream, sizeBytes: doc.sizeBytes, name: doc.name };
  }
}

/** Same ASCII-only convention as files.service.ts's own sanitizeFilename — see that function's header comment for why (a non-ASCII R2 key breaks presigned-URL signature verification). */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-140);
}
