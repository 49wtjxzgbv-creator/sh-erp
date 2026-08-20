import { Injectable } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { CodedBadRequestException, CodedConflictException, CodedNotFoundException } from '../../common/api-exceptions';
import { createR2Client, R2_BUCKET } from '../files/r2-client';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { CreateLandingMediaUploadDto } from './dto/create-landing-media-upload.dto';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * Marketing images (hero/showcase screenshots, OG image) — reuses
 * `r2-client.ts`'s primitives directly rather than `FilesService`, since
 * `FileAsset.companyId` is required/tenant-scoped and this content is
 * company-independent (see `LandingMediaAsset`'s own schema comment). Same
 * two-step presigned-PUT-then-confirm flow as `FilesService`, just against
 * a `marketing/landing/` prefix with no companyId segment.
 */
@Injectable()
export class LandingPageMediaService {
  private readonly r2 = createR2Client();

  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly superAdminAudit: SuperAdminAuditService,
  ) {}

  async createPresignedUpload(actor: RequestSuperAdmin, dto: CreateLandingMediaUploadDto) {
    const safeName = sanitizeFilename(dto.originalName);
    const storageKey = `marketing/landing/${randomUUID()}-${safeName}`;

    const media = await this.prisma.landingMediaAsset.create({
      data: {
        storageKey,
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        uploadedById: actor.superAdminId,
      },
    });

    const uploadUrl = await getSignedUrl(
      this.r2,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: storageKey, ContentType: dto.mimeType, ContentLength: dto.sizeBytes }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );

    return { mediaId: media.id, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  async confirmUpload(actor: RequestSuperAdmin, mediaId: string) {
    const media = await this.prisma.landingMediaAsset.findUnique({ where: { id: mediaId } });
    if (!media) throw new CodedNotFoundException('LANDING_MEDIA_NOT_FOUND', 'Media asset not found.');

    let head;
    try {
      head = await this.r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: media.storageKey }));
    } catch {
      throw new CodedBadRequestException('LANDING_MEDIA_UPLOAD_NOT_FOUND_IN_STORAGE', 'Upload not found in storage yet — did the PUT to uploadUrl succeed?');
    }
    if (head.ContentLength !== undefined && head.ContentLength !== media.sizeBytes) {
      throw new CodedBadRequestException(
        'LANDING_MEDIA_SIZE_MISMATCH',
        `Uploaded object size (${head.ContentLength}) does not match the declared size (${media.sizeBytes}).`,
      );
    }

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'landing_page.media_uploaded',
      targetType: 'LandingMediaAsset',
      targetId: media.id,
      metadata: { originalName: media.originalName, mimeType: media.mimeType },
    });

    return media;
  }

  /** Media library picker — every non-deleted asset, most recent first, each with a fresh presigned view URL. */
  async list() {
    const assets = await this.prisma.landingMediaAsset.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return Promise.all(
      assets.map(async (asset) => ({
        ...asset,
        downloadUrl: await getSignedUrl(this.r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: asset.storageKey }), { expiresIn: DOWNLOAD_URL_TTL_SECONDS }),
      })),
    );
  }

  /**
   * Soft-delete, blocked if the id is still referenced anywhere in the
   * current PUBLISHED content — a best-effort scan (Json fields have no
   * real FK integrity), not a guarantee: an asset referenced only by an
   * ARCHIVED historical version can still be deleted, breaking that old
   * version's viewability in admin history, an accepted low-severity gap
   * since it never affects the live public site.
   */
  async delete(actor: RequestSuperAdmin, mediaId: string) {
    const media = await this.prisma.landingMediaAsset.findUnique({ where: { id: mediaId } });
    if (!media || media.deletedAt) throw new CodedNotFoundException('LANDING_MEDIA_NOT_FOUND', 'Media asset not found.');

    const published = await this.prisma.landingPageVersion.findFirst({ where: { status: 'PUBLISHED' } });
    if (published && JSON.stringify(published.content).includes(mediaId)) {
      throw new CodedConflictException('LANDING_MEDIA_IN_USE', 'This image is still referenced by the published homepage — remove it from that section first.');
    }

    await this.prisma.landingMediaAsset.update({ where: { id: mediaId }, data: { deletedAt: new Date() } });
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'landing_page.media_deleted',
      targetType: 'LandingMediaAsset',
      targetId: mediaId,
    });
    return { ok: true };
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-140);
}
