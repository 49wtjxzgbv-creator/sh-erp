import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { PrismaService } from '../../prisma/prisma.service';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { createR2Client, R2_BUCKET } from '../files/r2-client';
import { INITIAL_LANDING_PAGE_CONTENT, LandingPageContent } from './landing-page-content.types';

export interface PublicLandingPage {
  content: LandingPageContent;
  plans: Array<{ id: string; key: string; name: string; monthlyPriceEur: string; limits: unknown }>;
  versionId: string | null;
  publishedAt: Date | null;
}

/**
 * `LandingPageVersion` (like `Plan`) is a genuinely global, non-tenant
 * table — reads through the raw `this.prisma` client, never `.tenant` or
 * the Super Admin BYPASSRLS client (see billing/plans.service.ts's own
 * comment for the same rationale on `Plan`). This is the ONE place in the
 * codebase that must NEVER read DRAFT/ARCHIVED content — reviewed
 * explicitly, since a bug here would leak unpublished copy to the public
 * internet.
 */
@Injectable()
export class LandingPagePublicService {
  private readonly logger = new Logger(LandingPagePublicService.name);
  private readonly r2 = createR2Client();

  constructor(private readonly prisma: PrismaService) {}

  async getPublished(): Promise<PublicLandingPage> {
    const [published, plans] = await Promise.all([
      this.prisma.landingPageVersion.findFirst({ where: { status: 'PUBLISHED' } }),
      this.prisma.plan.findMany({ orderBy: { monthlyPriceEur: 'asc' } }),
    ]);

    // Deploy-ordering safety net (docs/deployment.md's own "residual risk"
    // convention — see this feature's own migration/seed comments): between
    // "migration applied" and "seed run" there's a narrow window where this
    // table is empty. Degrade to the built-in fallback content rather than
    // 500 the public homepage during that window.
    if (!published) {
      this.logger.warn('No PUBLISHED LandingPageVersion found — serving built-in fallback content.');
      return {
        content: INITIAL_LANDING_PAGE_CONTENT,
        plans: plans.map(serializePlan),
        versionId: null,
        publishedAt: null,
      };
    }

    return {
      content: published.content as unknown as LandingPageContent,
      plans: plans.map(serializePlan),
      versionId: published.id,
      publishedAt: published.publishedAt,
    };
  }

  /**
   * Streams a marketing image straight from R2 — a public-read proxy owned
   * entirely by this backend, so the public homepage never needs R2's
   * bucket itself to be publicly exposed (no Cloudflare dashboard change,
   * no separate public domain to provision — the backend already holds R2
   * read credentials for the Super Admin presigned-URL flow; this just
   * reuses them for an unauthenticated GET). URLs are content-addressed by
   * a stable media id that's never reused for different bytes (a
   * replacement upload gets a new id, the old one just stops being
   * referenced), so a long `immutable` cache lifetime is safe.
   */
  async getMediaObject(id: string): Promise<{ body: NodeJS.ReadableStream; contentType: string; contentLength?: number }> {
    const asset = await this.prisma.landingMediaAsset.findUnique({ where: { id } });
    if (!asset || asset.deletedAt) throw new CodedNotFoundException('LANDING_MEDIA_NOT_FOUND', 'Media asset not found.');

    const result = await this.r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: asset.storageKey }));
    if (!result.Body) throw new CodedNotFoundException('LANDING_MEDIA_NOT_FOUND', 'Media object not found in storage.');

    return {
      body: result.Body as NodeJS.ReadableStream,
      contentType: asset.mimeType,
      contentLength: result.ContentLength,
    };
  }
}

function serializePlan(plan: { id: string; key: string; name: string; monthlyPriceEur: unknown; limits: unknown }) {
  return { id: plan.id, key: plan.key, name: plan.name, monthlyPriceEur: String(plan.monthlyPriceEur), limits: plan.limits };
}
