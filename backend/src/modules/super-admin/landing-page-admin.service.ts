import { Injectable } from '@nestjs/common';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { RequestSuperAdmin } from './super-admin-context';
import { SaveLandingPageDraftDto } from './dto/save-landing-page-draft.dto';
import { CodedNotFoundException } from '../../common/api-exceptions';
import { INITIAL_LANDING_PAGE_CONTENT } from '../landing-page/landing-page-content.types';

/**
 * Draft/Preview/Publish workflow for the public homepage's content.
 * Mirrors AssemblyVersion's immutable-snapshot philosophy for every row
 * that has ever been PUBLISHED — publishing never mutates an existing
 * PUBLISHED row, it archives it and inserts a brand new one. The single
 * DRAFT row is the deliberate exception: it IS mutated in place while an
 * admin is actively editing, and its existence is guaranteed unique by a
 * partial unique index (migration 20260820080000), not just service-layer
 * discipline.
 */
@Injectable()
export class LandingPageAdminService {
  constructor(
    private readonly prisma: SuperAdminPrismaService,
    private readonly superAdminAudit: SuperAdminAuditService,
  ) {}

  /** Lazily creates the DRAFT row (as a copy of the current PUBLISHED content) on first visit if none exists yet. */
  async getDraft(actor: RequestSuperAdmin) {
    const existing = await this.prisma.landingPageVersion.findFirst({ where: { status: 'DRAFT' } });
    if (existing) return existing;

    const published = await this.prisma.landingPageVersion.findFirst({ where: { status: 'PUBLISHED' } });
    return this.prisma.landingPageVersion.create({
      data: {
        status: 'DRAFT',
        content: (published?.content ?? (INITIAL_LANDING_PAGE_CONTENT as any)) as any,
        createdById: actor.superAdminId,
      },
    });
  }

  async saveDraft(actor: RequestSuperAdmin, dto: SaveLandingPageDraftDto) {
    const draft = await this.getDraft(actor);
    const updated = await this.prisma.landingPageVersion.update({
      where: { id: draft.id },
      data: { content: dto.content as any },
    });
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'landing_page.draft_saved',
      targetType: 'LandingPageVersion',
      targetId: updated.id,
    });
    return updated;
  }

  /** Reverts unsaved draft edits back to the current PUBLISHED content. */
  async discardDraft(actor: RequestSuperAdmin) {
    const draft = await this.getDraft(actor);
    const published = await this.prisma.landingPageVersion.findFirst({ where: { status: 'PUBLISHED' } });
    const updated = await this.prisma.landingPageVersion.update({
      where: { id: draft.id },
      data: { content: (published?.content ?? (INITIAL_LANDING_PAGE_CONTENT as any)) as any },
    });
    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'landing_page.draft_discarded',
      targetType: 'LandingPageVersion',
      targetId: updated.id,
    });
    return updated;
  }

  /** Archives the current PUBLISHED row and snapshots the draft's current content into a brand new PUBLISHED row, in one transaction. The DRAFT row itself is left untouched (it keeps existing for further edits). */
  async publish(actor: RequestSuperAdmin) {
    const draft = await this.getDraft(actor);

    const newPublished = await this.prisma.$transaction(async (tx) => {
      const currentPublished = await tx.landingPageVersion.findFirst({ where: { status: 'PUBLISHED' } });
      if (currentPublished) {
        await tx.landingPageVersion.update({ where: { id: currentPublished.id }, data: { status: 'ARCHIVED' } });
      }
      const { _max } = await tx.landingPageVersion.aggregate({ _max: { versionNumber: true } });
      return tx.landingPageVersion.create({
        data: {
          status: 'PUBLISHED',
          versionNumber: (_max.versionNumber ?? 0) + 1,
          content: draft.content as any,
          createdById: actor.superAdminId,
          publishedById: actor.superAdminId,
          publishedAt: new Date(),
        },
      });
    });

    await this.superAdminAudit.record({
      superAdminId: actor.superAdminId,
      action: 'landing_page.published',
      targetType: 'LandingPageVersion',
      targetId: newPublished.id,
      metadata: { versionNumber: newPublished.versionNumber },
    });
    return newPublished;
  }

  /** History list — content excluded from the payload (can be large; fetch it explicitly via getVersion). */
  async listVersions() {
    return this.prisma.landingPageVersion.findMany({
      where: { status: { in: ['PUBLISHED', 'ARCHIVED'] } },
      select: { id: true, versionNumber: true, status: true, publishedAt: true, publishedById: true, createdAt: true },
      orderBy: [{ versionNumber: 'desc' }],
    });
  }

  async getVersion(id: string) {
    const version = await this.prisma.landingPageVersion.findUnique({ where: { id } });
    if (!version) throw new CodedNotFoundException('LANDING_PAGE_VERSION_NOT_FOUND', 'Version not found.');
    return version;
  }
}
