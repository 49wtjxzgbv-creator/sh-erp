import { Injectable } from '@nestjs/common';
import { CodedBadRequestException, CodedNotFoundException } from '../../common/api-exceptions';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import * as ExcelJS from 'exceljs';
import type { FileDomain } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { createR2Client, R2_BUCKET } from './r2-client';
import { CreatePresignedUploadDto } from './dto/create-presigned-upload.dto';
import { StepConversionService } from './step-conversion.service';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/** Only the modern OOXML format — ExcelJS (already a backend dependency, see products-import-export.service.ts) reads .xlsx, not legacy binary .xls. A genuine legacy .xls attachment falls back to "no preview, download instead" client-side, same honest-gap convention as any other unsupported preview type — not silently claimed to work. */
const SPREADSHEET_PREVIEW_MIME_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const MAX_PREVIEW_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 500;
const MAX_PREVIEW_COLS = 50;
const MAX_PREVIEW_SHEETS = 10;

@Injectable()
export class FilesService {
  private readonly r2 = createR2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly stepConversionService: StepConversionService,
  ) {}

  /**
   * Step 1 of the upload flow (Phase 2 §7: files never proxy through the
   * API). Creates the `FileAsset` row up front (so we have a stable id/key
   * to hand back) and a short-lived presigned PUT URL the client uploads
   * directly to R2. Key layout: `tenants/{companyId}/{domain}/{entityType}/{entityId}/{filename}`.
   */
  async createPresignedUpload(user: RequestUser, dto: CreatePresignedUploadDto) {
    const safeName = sanitizeFilename(dto.originalName);
    const storageKey = `tenants/${user.companyId}/${dto.domain.toLowerCase()}/${dto.entityType.toLowerCase()}/${dto.entityId}/${randomUUID()}-${safeName}`;

    // Root cause of a real Docker-build failure (TS2322 "Property 'company'
    // is missing"), found once `prisma generate` finally ran for real (see
    // docs/readiness-report.md): `FileAsset`'s only relation is `company`
    // (schema.prisma), and this literal previously provided neither the
    // `companyId` scalar nor a `company: { connect: ... } }` relation
    // object — it relied entirely on `tenantScopingExtension`'s runtime
    // `stampCompanyId` to inject `companyId` invisibly, which the real
    // generated `FileAssetUncheckedCreateInput` type has no way to know
    // about. Providing `companyId` explicitly here (the same value the
    // extension would have stamped anyway — it verifies rather than
    // overwrites, see prisma-tenant.extension.ts) satisfies the real type
    // directly, with no cast needed at all.
    const fileAsset = await this.prisma.tenant.fileAsset.create({
      data: {
        companyId: user.companyId,
        domain: dto.domain,
        entityType: dto.entityType,
        entityId: dto.entityId,
        storageKey,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        isPublic: dto.isPublic ?? false,
        uploadedById: user.userId,
      },
    });

    const uploadUrl = await getSignedUrl(
      this.r2,
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        ContentType: dto.mimeType,
        ContentLength: dto.sizeBytes,
      }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return { fileAssetId: fileAsset.id, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Step 2: client calls this after the direct-to-R2 PUT succeeds. We
   * HeadObject to confirm the file is actually there and matches the
   * declared size — protects against a client claiming "uploaded" when it
   * didn't, or uploading something other than what it declared.
   */
  async confirmUpload(user: RequestUser, fileAssetId: string) {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset) throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');

    let head;
    try {
      head = await this.r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: fileAsset.storageKey }));
    } catch {
      throw new CodedBadRequestException('FILE_UPLOAD_NOT_FOUND_IN_STORAGE', 'Upload not found in storage yet — did the PUT to uploadUrl succeed?');
    }

    if (head.ContentLength !== undefined && head.ContentLength !== fileAsset.sizeBytes) {
      throw new CodedBadRequestException(
        'FILE_SIZE_MISMATCH',
        `Uploaded object size (${head.ContentLength}) does not match the declared size (${fileAsset.sizeBytes}).`,
      );
    }

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'file.uploaded',
      entityType: 'FileAsset',
      entityId: fileAsset.id,
      metadata: { domain: fileAsset.domain, entityType: fileAsset.entityType, entityId: fileAsset.entityId },
    });

    // Deliberately not awaited — see StepConversionService's header comment
    // (same "fire-and-forget, own try/catch persists status onto the row"
    // pattern as legacy-import.service.ts#startImport). A multi-minute STEP
    // parse has no business blocking the upload-confirm response.
    if (this.stepConversionService.isStepFile(fileAsset.originalName)) {
      void this.stepConversionService.convert(fileAsset);
    }

    return fileAsset;
  }

/**
   * Server-side upload path for content the API generates itself and that
   * is NOT a business document attached to a specific entity — currently
   * only the AI assistant's `exportToExcel`/`exportToPdf` tools (Module 11).
   *
   * Deliberately does **not** create a `FileAsset` row. `FileAsset.domain`
   * is the frozen Phase 3 `FileDomain` enum (`PRODUCT_PHOTO`, `ASSEMBLY_DRAWING`,
   * `PURCHASE_INVOICE`, etc.) — every value in it is a business document tied
   * to a specific `entityType`/`entityId`. An AI-generated report isn't
   * attached to a Product or a PurchaseOrder, it's attached to a chat turn,
   * so it doesn't actually fit that model; adding an `AI_EXPORT` enum value
   * to bend it into fitting would be a schema change, which is out of scope
   * for this module without a stop-and-confirm (frozen Phase 0-4 schema).
   * Instead this stores the object under its own `tenants/{companyId}/ai-exports/`
   * prefix and returns a presigned URL directly — still fully tenant-scoped
   * (the key is namespaced by companyId same as everything else in the
   * bucket) and still audit-logged (`AuditEvent.entityType` is a free string,
   * not the closed enum), just outside the `FileAsset` listing/discoverability
   * feature. A future `AiUsageLog`-linked export-history view, if wanted,
   * should be its own explicitly-designed table rather than an awkward
   * `FileAsset` fit.
   */
  async uploadEphemeralExport(
    user: RequestUser,
    input: { filename: string; mimeType: string; body: Buffer },
  ): Promise<{ downloadUrl: string; expiresInSeconds: number }> {
    const safeName = sanitizeFilename(input.filename);
    const storageKey = `tenants/${user.companyId}/ai-exports/${randomUUID()}-${safeName}`;

    await this.r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: input.body,
        ContentType: input.mimeType,
        ContentLength: input.body.byteLength,
      }),
    );

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'ai.export_generated',
      entityType: 'AiExport',
      entityId: storageKey,
      metadata: { filename: input.filename, mimeType: input.mimeType, sizeBytes: input.body.byteLength },
    });

    const downloadUrl = await getSignedUrl(this.r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }), {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });

    return { downloadUrl, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  /**
   * Server-side "bytes already in hand, no live request" ingest path —
   * used by legacy-import's background photo-migration job
   * (`photo-import.service.ts`), which has no `RequestUser`/presigned-PUT
   * round trip to drive and must not hold a DB transaction open across the
   * slow external fetch (see `PrismaService.runInTenantTransaction`'s own
   * header comment on why background-job code opens its own transaction
   * rather than reading off ambient `prisma.tenant`). The R2 PUT happens
   * here directly (bytes in hand already, no presigned URL needed); only
   * the FileAsset row write opens a transaction, and only for as long as
   * that single upsert takes.
   *
   * Upserts on `(companyId, legacyId)` (see `FileAsset`'s own unique
   * constraint) so re-running an import job is idempotent — a re-fetched
   * photo overwrites its own row's object/metadata rather than piling up
   * duplicates. The OLD R2 object at the previous storageKey is left
   * orphaned on re-import, same as this module's existing soft-delete
   * convention (a lifecycle rule handles real purging, out of scope here).
   */
  async ingestPhotoAsset(input: {
    companyId: string;
    actorUserId: string;
    domain: FileDomain;
    entityType: string;
    entityId: string;
    legacyId: string;
    originalName: string;
    mimeType: string;
    bytes: Buffer;
  }): Promise<{ fileAssetId: string }> {
    const safeName = sanitizeFilename(input.originalName);
    const storageKey = `tenants/${input.companyId}/${input.domain.toLowerCase()}/${input.entityType.toLowerCase()}/${input.entityId}/${randomUUID()}-${safeName}`;

    await this.r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: input.bytes,
        ContentType: input.mimeType,
        ContentLength: input.bytes.byteLength,
      }),
    );

    const fileAsset = await this.prisma.runInTenantTransaction(
      { companyId: input.companyId, userId: input.actorUserId },
      (tx) =>
        tx.fileAsset.upsert({
          where: { companyId_legacyId: { companyId: input.companyId, legacyId: input.legacyId } },
          create: {
            companyId: input.companyId,
            domain: input.domain,
            entityType: input.entityType,
            entityId: input.entityId,
            storageKey,
            originalName: safeName,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
            uploadedById: input.actorUserId,
            legacyId: input.legacyId,
          },
          update: {
            entityType: input.entityType,
            entityId: input.entityId,
            storageKey,
            originalName: safeName,
            mimeType: input.mimeType,
            sizeBytes: input.bytes.byteLength,
          },
        }),
    );

    return { fileAssetId: fileAsset.id };
  }

  async getDownloadUrl(user: RequestUser, fileAssetId: string) {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.deletedAt) throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');

    const downloadUrl = await getSignedUrl(
      this.r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: fileAsset.storageKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    return { downloadUrl, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  /**
   * Server-side parsed preview for a spreadsheet attachment (Finance
   * documents point in the pre-production feedback: "перегляд Excel без
   * завантаження"). Files are otherwise never proxied through the API
   * (everything else goes straight to R2 via a presigned URL) — this is a
   * deliberate, narrow exception: unlike a PDF/image, a browser can't
   * render .xlsx natively via `<iframe>`/`<img>`, and parsing it
   * client-side would require fetching the raw bytes via `fetch()`,
   * which needs R2 CORS support that isn't set up for GET (only the
   * presigned-PUT upload path needs it today). Parsing here instead reuses
   * the `exceljs` dependency already vetted for the product-import feature
   * (products-import-export.service.ts) and returns plain JSON rows — no
   * new R2 CORS configuration required.
   */
  async getSpreadsheetPreview(user: RequestUser, fileAssetId: string) {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.deletedAt) throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');
    if (!SPREADSHEET_PREVIEW_MIME_TYPES.includes(fileAsset.mimeType)) {
      throw new CodedBadRequestException('FILE_PREVIEW_UNSUPPORTED_TYPE', 'Preview is only available for .xlsx spreadsheets.');
    }
    if (fileAsset.sizeBytes > MAX_PREVIEW_SIZE_BYTES) {
      throw new CodedBadRequestException('FILE_PREVIEW_TOO_LARGE', 'This file is too large to preview — download it instead.');
    }

    const bytes = await this.getObjectBytes(fileAsset.storageKey);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(bytes as any); // eslint-disable-line @typescript-eslint/no-explicit-any -- ExcelJS's Buffer overload isn't in its own type union for this SDK version, same cast products-import-export.service.ts already uses.
    } catch {
      throw new CodedBadRequestException('FILE_PREVIEW_UNREADABLE', 'Could not read this file as a spreadsheet.');
    }

    const truncatedSheets = workbook.worksheets.length > MAX_PREVIEW_SHEETS;
    const sheets = workbook.worksheets.slice(0, MAX_PREVIEW_SHEETS).map((worksheet) => {
      const truncatedRows = worksheet.rowCount > MAX_PREVIEW_ROWS;
      const rows: (string | number | null)[][] = [];
      const rowLimit = Math.min(worksheet.rowCount, MAX_PREVIEW_ROWS);
      let truncatedCols = false;
      for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const colLimit = Math.min(row.cellCount, MAX_PREVIEW_COLS);
        if (row.cellCount > MAX_PREVIEW_COLS) truncatedCols = true;
        const cells: (string | number | null)[] = [];
        for (let colNumber = 1; colNumber <= colLimit; colNumber++) {
          cells.push(cellToPlainValue(row.getCell(colNumber).value));
        }
        rows.push(cells);
      }
      return { name: worksheet.name, rows, truncatedRows, truncatedCols };
    });

    return { sheets, truncatedSheets };
  }

  private async getObjectBytes(storageKey: string): Promise<Buffer> {
    const object = await this.r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: storageKey }));
    const chunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AWS SDK v3's Body is a Node Readable at runtime for this client, but typed as a union across browser/Node targets.
    for await (const chunk of object.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async listForEntity(user: RequestUser, entityType: string, entityId: string, domains?: FileDomain[]) {
    return this.prisma.tenant.fileAsset.findMany({
      where: { entityType, entityId, deletedAt: null, ...(domains ? { domain: { in: domains } } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Batch counterpart to `listForEntity` — one query for N entity ids
   * instead of N requests, using this codebase's established
   * `findMany({ where: { id: { in: [...] } } })` idiom (e.g.
   * `customer-order-shortage.service.ts`, `users.service.ts`). Grouped by
   * entityId client-side rather than via a `groupBy` query since callers
   * need the full FileAsset rows per entity, not just counts.
   *
   * Also attaches a presigned `downloadUrl` to each row, generated here
   * rather than left to a separate `GET /:id/download-url` call per file —
   * `getSignedUrl` only signs locally (no round trip to R2), so doing it
   * for an entire list-view page's worth of thumbnails in one request is
   * cheap and is what actually avoids the N+1 this endpoint exists for;
   * returning bare `storageKey`s would just move the N+1 to the client.
   */
  async listForEntities(user: RequestUser, entityType: string, entityIds: string[], domains?: FileDomain[]) {
    if (entityIds.length === 0) return {};

    const files = await this.prisma.tenant.fileAsset.findMany({
      where: { entityType, entityId: { in: entityIds }, deletedAt: null, ...(domains ? { domain: { in: domains } } : {}) },
      orderBy: { createdAt: 'desc' },
    });

    const withUrls = await Promise.all(
      files.map(async (file) => ({
        ...file,
        downloadUrl: await getSignedUrl(this.r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.storageKey }), {
          expiresIn: DOWNLOAD_URL_TTL_SECONDS,
        }),
        // Only set once StepConversionService finishes — lets the frontend
        // load the small pre-tessellated .glb via GLTFLoader instead of
        // re-parsing the raw STEP client-side (see that service's header
        // comment for why that matters for a large real assembly).
        convertedDownloadUrl:
          file.conversionStatus === 'DONE' && file.convertedStorageKey
            ? await getSignedUrl(this.r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.convertedStorageKey }), {
                expiresIn: DOWNLOAD_URL_TTL_SECONDS,
              })
            : undefined,
      })),
    );

    const byEntityId: Record<string, typeof withUrls> = {};
    for (const file of withUrls) {
      (byEntityId[file.entityId] ??= []).push(file);
    }
    return byEntityId;
  }

  /** Soft delete only — matches the schema-wide convention; the R2 object is left in place (a lifecycle rule handles real purging, out of scope for this module). */
  async delete(user: RequestUser, fileAssetId: string) {
    const fileAsset = await this.prisma.tenant.fileAsset.findUnique({ where: { id: fileAssetId } });
    if (!fileAsset || fileAsset.deletedAt) throw new CodedNotFoundException('FILE_NOT_FOUND', 'File not found.');

    await this.prisma.tenant.fileAsset.update({
      where: { id: fileAssetId },
      data: { deletedAt: new Date() },
    });

    await this.auditService.record({
      companyId: user.companyId,
      actorUserId: user.userId,
      action: 'file.deleted',
      entityType: 'FileAsset',
      entityId: fileAssetId,
    });

    return { ok: true };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-140); // keep the tail (extension survives truncation of an overly long name)
}

/** Reduces an ExcelJS cell value to a plain JSON-safe primitive for the preview response — formulas resolve to their cached result, rich text/hyperlinks to their display text, dates to an ISO string. */
function cellToPlainValue(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) return cellToPlainValue((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('text' in value) return String((value as ExcelJS.CellHyperlinkValue).text ?? '');
    if ('richText' in value) return (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
  }
  return String(value);
}
