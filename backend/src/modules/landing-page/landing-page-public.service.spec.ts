import { LandingPagePublicService } from './landing-page-public.service';
import { INITIAL_LANDING_PAGE_CONTENT } from './landing-page-content.types';

describe('LandingPagePublicService', () => {
  let service: LandingPagePublicService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      landingPageVersion: { findFirst: jest.fn() },
      plan: { findMany: jest.fn().mockResolvedValue([]) },
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
});
