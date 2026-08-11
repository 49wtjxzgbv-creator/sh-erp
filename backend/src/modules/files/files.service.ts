import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { FileDomain } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { createR2Client, R2_BUCKET } from './r2-client';
import { CreatePresignedUploadDto } from './dto/create-presigned-upload.dto';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

@Injectable()
export class FilesService {
  private readonly r2 = createR2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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
    if (!fileAsset) throw new NotFoundException('File not found.');

    let head;
    try {
      head = await this.r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: fileAsset.storageKey }));
    } catch {
      throw new BadRequestException('Upload not found in storage yet — did the PUT to uploadUrl succeed?');
    }

    if (head.ContentLength !== undefined && head.ContentLength !== fileAsset.sizeBytes) {
      throw new BadRequestException(
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
    if (!fileAsset || fileAsset.deletedAt) throw new NotFoundException('File not found.');

    const downloadUrl = await getSignedUrl(
      this.r2,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: fileAsset.storageKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    return { downloadUrl, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  async listForEntity(user: RequestUser, entityType: string, entityId: string) {
    return this.prisma.tenant.fileAsset.findMany({
      where: { entityType, entityId, deletedAt: null },
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
  async listForEntities(user: RequestUser, entityType: string, entityIds: string[]) {
    if (entityIds.length === 0) return {};

    const files = await this.prisma.tenant.fileAsset.findMany({
      where: { entityType, entityId: { in: entityIds }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const withUrls = await Promise.all(
      files.map(async (file) => ({
        ...file,
        downloadUrl: await getSignedUrl(this.r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: file.storageKey }), {
          expiresIn: DOWNLOAD_URL_TTL_SECONDS,
        }),
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
    if (!fileAsset || fileAsset.deletedAt) throw new NotFoundException('File not found.');

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
