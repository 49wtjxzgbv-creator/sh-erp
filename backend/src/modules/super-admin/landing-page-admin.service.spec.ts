import { LandingPageAdminService } from './landing-page-admin.service';
import { INITIAL_LANDING_PAGE_CONTENT } from '../landing-page/landing-page-content.types';

describe('LandingPageAdminService', () => {
  let service: LandingPageAdminService;
  let prisma: any;
  let audit: any;
  const actor = { superAdminId: 'sa1', email: 'admin@sh-erp.pro' };

  beforeEach(() => {
    prisma = {
      landingPageVersion: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        aggregate: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    audit = { record: jest.fn() };
    service = new LandingPageAdminService(prisma, audit);
  });

  describe('getDraft', () => {
    it('returns the existing DRAFT row without creating a new one', async () => {
      const draft = { id: 'd1', status: 'DRAFT', content: {} };
      prisma.landingPageVersion.findFirst.mockResolvedValueOnce(draft);

      const result = await service.getDraft(actor);

      expect(result).toBe(draft);
      expect(prisma.landingPageVersion.create).not.toHaveBeenCalled();
    });

    it('lazily creates a DRAFT from the current PUBLISHED content when none exists', async () => {
      const published = { id: 'p1', status: 'PUBLISHED', content: { hero: { headline: { uk: 'real' } } } };
      prisma.landingPageVersion.findFirst
        .mockResolvedValueOnce(null) // no draft
        .mockResolvedValueOnce(published); // published lookup
      prisma.landingPageVersion.create.mockResolvedValueOnce({ id: 'd1', status: 'DRAFT', content: published.content });

      await service.getDraft(actor);

      expect(prisma.landingPageVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', content: published.content, createdById: 'sa1' }) }),
      );
    });

    it('falls back to INITIAL_LANDING_PAGE_CONTENT when no PUBLISHED row exists either (first-ever visit)', async () => {
      prisma.landingPageVersion.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.landingPageVersion.create.mockResolvedValueOnce({ id: 'd1', status: 'DRAFT', content: INITIAL_LANDING_PAGE_CONTENT });

      await service.getDraft(actor);

      expect(prisma.landingPageVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ content: INITIAL_LANDING_PAGE_CONTENT }) }),
      );
    });
  });

  describe('saveDraft', () => {
    it('updates the draft content in place and records an audit event', async () => {
      prisma.landingPageVersion.findFirst.mockResolvedValueOnce({ id: 'd1', status: 'DRAFT', content: {} });
      const updated = { id: 'd1', status: 'DRAFT', content: { hero: {} } };
      prisma.landingPageVersion.update.mockResolvedValueOnce(updated);

      const result = await service.saveDraft(actor, { content: { hero: {} } as any });

      expect(prisma.landingPageVersion.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { content: { hero: {} } } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'landing_page.draft_saved', targetId: 'd1' }));
      expect(result).toBe(updated);
    });
  });

  describe('discardDraft', () => {
    it('reverts the draft content to the current PUBLISHED content', async () => {
      const published = { id: 'p1', status: 'PUBLISHED', content: { hero: { headline: { uk: 'published copy' } } } };
      prisma.landingPageVersion.findFirst
        .mockResolvedValueOnce({ id: 'd1', status: 'DRAFT', content: { hero: { headline: { uk: 'unsaved edit' } } } }) // getDraft
        .mockResolvedValueOnce(published); // published lookup
      prisma.landingPageVersion.update.mockResolvedValueOnce({ id: 'd1', status: 'DRAFT', content: published.content });

      await service.discardDraft(actor);

      expect(prisma.landingPageVersion.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { content: published.content } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'landing_page.draft_discarded' }));
    });
  });

  describe('publish', () => {
    it('archives the current PUBLISHED row and creates a new one snapshotting the draft, without touching the DRAFT row itself', async () => {
      const draft = { id: 'd1', status: 'DRAFT', content: { hero: { headline: { uk: 'new copy' } } } };
      const currentPublished = { id: 'p1', status: 'PUBLISHED', versionNumber: 3 };
      prisma.landingPageVersion.findFirst
        .mockResolvedValueOnce(draft) // getDraft
        .mockResolvedValueOnce(currentPublished); // inside transaction
      prisma.landingPageVersion.aggregate.mockResolvedValueOnce({ _max: { versionNumber: 3 } });
      const newPublished = { id: 'p2', status: 'PUBLISHED', versionNumber: 4, content: draft.content };
      prisma.landingPageVersion.create.mockResolvedValueOnce(newPublished);

      const result = await service.publish(actor);

      expect(prisma.landingPageVersion.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'ARCHIVED' } });
      expect(prisma.landingPageVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PUBLISHED', versionNumber: 4, content: draft.content, publishedById: 'sa1' }),
        }),
      );
      expect(result).toBe(newPublished);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'landing_page.published', targetId: 'p2' }));
    });

    it('starts versionNumber at 1 when nothing has ever been published', async () => {
      const draft = { id: 'd1', status: 'DRAFT', content: {} };
      prisma.landingPageVersion.findFirst
        .mockResolvedValueOnce(draft) // getDraft
        .mockResolvedValueOnce(null); // no current published inside transaction
      prisma.landingPageVersion.aggregate.mockResolvedValueOnce({ _max: { versionNumber: null } });
      prisma.landingPageVersion.create.mockResolvedValueOnce({ id: 'p1', versionNumber: 1 });

      await service.publish(actor);

      expect(prisma.landingPageVersion.update).not.toHaveBeenCalled();
      expect(prisma.landingPageVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ versionNumber: 1 }) }));
    });
  });

  describe('getVersion', () => {
    it('throws NotFoundException for an unknown id', async () => {
      prisma.landingPageVersion.findUnique.mockResolvedValueOnce(null);
      await expect(service.getVersion('missing')).rejects.toThrow();
    });
  });

  describe('restoreVersion', () => {
    it('copies the old version content into the DRAFT row without publishing it', async () => {
      const oldVersion = { id: 'v1', versionNumber: 2, content: { hero: { headline: { uk: 'old copy' } } } };
      prisma.landingPageVersion.findUnique.mockResolvedValueOnce(oldVersion); // getVersion
      prisma.landingPageVersion.findFirst.mockResolvedValueOnce({ id: 'd1', status: 'DRAFT', content: {} }); // getDraft
      const updated = { id: 'd1', status: 'DRAFT', content: oldVersion.content };
      prisma.landingPageVersion.update.mockResolvedValueOnce(updated);

      const result = await service.restoreVersion(actor, 'v1');

      expect(prisma.landingPageVersion.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { content: oldVersion.content } });
      expect(result).toBe(updated);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'landing_page.version_restored_to_draft', targetId: 'd1', metadata: expect.objectContaining({ restoredFromVersionId: 'v1' }) }),
      );
    });
  });
});
