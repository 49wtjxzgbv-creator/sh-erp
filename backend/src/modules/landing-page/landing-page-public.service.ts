import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { INITIAL_LANDING_PAGE_CONTENT, LandingPageContent } from './landing-page-content.types';

export interface PublicLandingPage {
  content: LandingPageContent;
  plans: Array<{ id: string; key: string; name: string; monthlyPriceEur: string; limits: unknown }>;
  // mediaId -> public URL, resolved server-side so the frontend never needs
  // its own storageKey-construction logic or a second network round trip.
  // Empty until LANDING_MEDIA_PUBLIC_BASE_URL is provisioned (Phase 3 — R2
  // public-read domain, a disclosed open ops item) — every imageId simply
  // has no entry until then, and callers treat a missing entry as "no
  // image", not an error.
  mediaUrls: Record<string, string>;
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
        mediaUrls: {},
        versionId: null,
        publishedAt: null,
      };
    }

    const content = published.content as unknown as LandingPageContent;
    return {
      content,
      plans: plans.map(serializePlan),
      mediaUrls: await this.resolveMediaUrls(content),
      versionId: published.id,
      publishedAt: published.publishedAt,
    };
  }

  /** Resolves every imageId referenced anywhere in `content` into a public URL, in one query. */
  private async resolveMediaUrls(content: LandingPageContent): Promise<Record<string, string>> {
    const baseUrl = process.env.LANDING_MEDIA_PUBLIC_BASE_URL;
    if (!baseUrl) return {}; // Phase 3 open item — no public R2 domain provisioned yet

    const ids = collectImageIds(content);
    if (ids.length === 0) return {};

    const assets = await this.prisma.landingMediaAsset.findMany({ where: { id: { in: ids }, deletedAt: null } });
    const trimmedBase = baseUrl.replace(/\/$/, '');
    const urls: Record<string, string> = {};
    for (const asset of assets) urls[asset.id] = `${trimmedBase}/${asset.storageKey}`;
    return urls;
  }
}

function serializePlan(plan: { id: string; key: string; name: string; monthlyPriceEur: unknown; limits: unknown }) {
  return { id: plan.id, key: plan.key, name: plan.name, monthlyPriceEur: String(plan.monthlyPriceEur), limits: plan.limits };
}

function collectImageIds(content: LandingPageContent): string[] {
  const ids = [content.hero.heroImageId, content.seo.ogImageId, ...content.showcase.steps.map((s) => s.imageId)];
  return ids.filter((id): id is string => Boolean(id));
}
