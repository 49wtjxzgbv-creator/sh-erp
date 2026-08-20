jest.mock('../files/r2-client', () => ({
  createR2Client: () => ({ send: jest.fn() }),
  R2_BUCKET: 'test-bucket',
}));

import { LandingPagePublicService } from './landing-page-public.service';
import { INITIAL_LANDING_PAGE_CONTENT } from './landing-page-content.types';

describe('LandingPagePublicService', () => {
  let service: LandingPagePublicService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      landingPageVersion: { findFirst: jest.fn() },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
      landingMediaAsset: { findUnique: jest.fn() },
    };
    service = new LandingPagePublicService(prisma);
  });

  it('only ever queries status: PUBLISHED — never DRAFT or ARCHIVED', async () => {
    prisma.landingPageVersion.findFirst.mockResolvedValueOnce({ id: 'p1', content: {}, publishedAt: new Date() });

    await service.getPublished();

    expect(prisma.landingPageVersion.findFirst).toHaveBeenCalledWith({ where: { status: 'PUBLISHED' } });
  });

  it('returns the published row content, id, and publishedAt when one exists', async () => {
    const published = { id: 'p1', content: { hero: { headline: { uk: 'real published copy' } } }, publishedAt: new Date('2026-01-01') };
    prisma.landingPageVersion.findFirst.mockResolvedValueOnce(published);

    const result = await service.getPublished();

    expect(result.content).toEqual(published.content);
    expect(result.versionId).toBe('p1');
    expect(result.publishedAt).toEqual(published.publishedAt);
  });

  it('degrades to the built-in fallback content (never 500s) when no PUBLISHED row exists yet — the deploy-ordering safety net', async () => {
    prisma.landingPageVersion.findFirst.mockResolvedValueOnce(null);

    const result = await service.getPublished();

    expect(result.content).toEqual(INITIAL_LANDING_PAGE_CONTENT);
    expect(result.versionId).toBeNull();
    expect(result.publishedAt).toBeNull();
  });

  it('merges live Plan rows into the response', async () => {
    prisma.landingPageVersion.findFirst.mockResolvedValueOnce({ id: 'p1', content: {}, publishedAt: new Date() });
    prisma.plan.findMany.mockResolvedValueOnce([{ id: 'pl1', key: 'starter', name: 'Starter', monthlyPriceEur: '0', limits: {} }]);

    const result = await service.getPublished();

    expect(result.plans).toEqual([{ id: 'pl1', key: 'starter', name: 'Starter', monthlyPriceEur: '0', limits: {} }]);
  });

  describe('getMediaObject', () => {
    it('throws NotFoundException for an unknown or soft-deleted asset', async () => {
      prisma.landingMediaAsset.findUnique.mockResolvedValueOnce(null);
      await expect(service.getMediaObject('missing')).rejects.toThrow();

      prisma.landingMediaAsset.findUnique.mockResolvedValueOnce({ id: 'm1', deletedAt: new Date() });
      await expect(service.getMediaObject('m1')).rejects.toThrow();
    });

    it('streams the object from R2 with the stored content type', async () => {
      prisma.landingMediaAsset.findUnique.mockResolvedValueOnce({ id: 'm1', storageKey: 'marketing/landing/x.png', mimeType: 'image/png', deletedAt: null });
      const fakeBody = {} as any;
      service['r2'].send = jest.fn().mockResolvedValue({ Body: fakeBody, ContentLength: 1234 });

      const result = await service.getMediaObject('m1');

      expect(result.body).toBe(fakeBody);
      expect(result.contentType).toBe('image/png');
      expect(result.contentLength).toBe(1234);
    });
  });
});
