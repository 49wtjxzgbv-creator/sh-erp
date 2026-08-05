import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        companySettings: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
        companyBranding: { findUnique: jest.fn(), upsert: jest.fn() },
      },
    };
    audit = { record: jest.fn() };
    service = new SettingsService(prisma, audit);
  });

  it('updateSettings() updates keyed by companyId and logs before/after', async () => {
    const before = { companyId: 'c1', vatRatePercent: 20 };
    const after = { companyId: 'c1', vatRatePercent: 21 };
    prisma.tenant.companySettings.findUniqueOrThrow.mockResolvedValue(before);
    prisma.tenant.companySettings.update.mockResolvedValue(after);

    const result = await service.updateSettings(user, { vatRatePercent: 21 });

    expect(prisma.tenant.companySettings.update).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      data: { vatRatePercent: 21 },
    });
    expect(result).toBe(after);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'company_settings.updated', before, after }),
    );
  });

  it('updateBranding() upserts (branding row may not exist yet)', async () => {
    const branding = { companyId: 'c1', siteLogoFileId: 'f1' };
    prisma.tenant.companyBranding.upsert.mockResolvedValue(branding);

    const result = await service.updateBranding(user, { siteLogoFileId: 'f1' });

    expect(prisma.tenant.companyBranding.upsert).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      update: { siteLogoFileId: 'f1' },
      create: { siteLogoFileId: 'f1' },
    });
    expect(result).toBe(branding);
  });
});
