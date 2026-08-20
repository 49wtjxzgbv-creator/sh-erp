jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/signed'),
}));
jest.mock('../files/r2-client', () => ({
  createR2Client: () => ({ send: jest.fn() }),
  R2_BUCKET: 'test-bucket',
}));

import { LandingPageMediaService } from './landing-page-media.service';

describe('LandingPageMediaService', () => {
  let service: LandingPageMediaService;
  let prisma: any;
  let audit: any;
  const actor = { superAdminId: 'sa1', email: 'admin@sh-erp.pro' };

  beforeEach(() => {
    prisma = {
      landingMediaAsset: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      landingPageVersion: { findFirst: jest.fn() },
    };
    audit = { record: jest.fn() };
    service = new LandingPageMediaService(prisma, audit);
  });

  it('createPresignedUpload keys objects under marketing/landing/ with no companyId segment', async () => {
    prisma.landingMediaAsset.create.mockResolvedValueOnce({ id: 'm1' });

    const res = await service.createPresignedUpload(actor, { originalName: 'hero shot.png', mimeType: 'image/png', sizeBytes: 1000 });

    const createCall = prisma.landingMediaAsset.create.mock.calls[0][0];
    expect(createCall.data.storageKey).toMatch(/^marketing\/landing\//);
    expect(createCall.data.storageKey).toContain('hero_shot.png');
    expect(createCall.data.uploadedById).toBe('sa1');
    expect(res.mediaId).toBe('m1');
  });

  it('confirmUpload rejects when the object is not yet present in R2', async () => {
    prisma.landingMediaAsset.findUnique.mockResolvedValueOnce({ id: 'm1', storageKey: 'k', sizeBytes: 1000 });
    service['r2'].send = jest.fn().mockRejectedValue(new Error('NotFound'));

    await expect(service.confirmUpload(actor, 'm1')).rejects.toThrow();
  });

  it('confirmUpload rejects on size mismatch', async () => {
    prisma.landingMediaAsset.findUnique.mockResolvedValueOnce({ id: 'm1', storageKey: 'k', sizeBytes: 1000 });
    service['r2'].send = jest.fn().mockResolvedValue({ ContentLength: 500 });

    await expect(service.confirmUpload(actor, 'm1')).rejects.toThrow();
  });

  it('delete blocks removal when the media id is still referenced in the PUBLISHED content JSON', async () => {
    prisma.landingMediaAsset.findUnique.mockResolvedValueOnce({ id: 'm1', deletedAt: null });
    prisma.landingPageVersion.findFirst.mockResolvedValueOnce({ content: { hero: { heroImageId: 'm1' } } });

    await expect(service.delete(actor, 'm1')).rejects.toThrow();
    expect(prisma.landingMediaAsset.update).not.toHaveBeenCalled();
  });

  it('delete soft-deletes when the media id is not referenced anywhere in the PUBLISHED content', async () => {
    prisma.landingMediaAsset.findUnique.mockResolvedValueOnce({ id: 'm1', deletedAt: null });
    prisma.landingPageVersion.findFirst.mockResolvedValueOnce({ content: { hero: { heroImageId: 'other-id' } } });
    prisma.landingMediaAsset.update.mockResolvedValueOnce({ id: 'm1', deletedAt: new Date() });

    const result = await service.delete(actor, 'm1');

    expect(prisma.landingMediaAsset.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { deletedAt: expect.any(Date) } });
    expect(result).toEqual({ ok: true });
  });
});
