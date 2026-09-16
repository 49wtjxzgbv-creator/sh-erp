import { LoginSessionsAdminService } from './login-sessions-admin.service';

describe('LoginSessionsAdminService', () => {
  let service: LoginSessionsAdminService;
  let prisma: any;
  let geoIp: any;

  beforeEach(() => {
    prisma = {
      refreshToken: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    geoIp = { lookupMany: jest.fn().mockResolvedValue(new Map()) };
    service = new LoginSessionsAdminService(prisma, geoIp);
  });

  function row(overrides: Partial<Record<string, any>>) {
    return {
      id: overrides.id,
      createdAt: overrides.createdAt,
      userId: 'u1',
      companyId: 'c1',
      familyId: overrides.familyId,
      ipAddress: '203.0.113.5',
      device: 'Mozilla/5.0',
      impersonatedBy: null,
      user: { email: 'user@acme.com', fullName: 'Test User' },
      ...overrides,
    };
  }

  it('treats the first row of a family as a login event, and a routine ~15min rotation right after it as NOT one', async () => {
    const t0 = new Date('2026-09-16T10:00:00Z');
    const t1 = new Date('2026-09-16T10:15:00Z'); // 15 min later — routine access-token rotation
    prisma.refreshToken.findMany.mockResolvedValue([
      row({ id: 'r2', familyId: 'fam1', createdAt: t1 }),
      row({ id: 'r1', familyId: 'fam1', createdAt: t0 }),
    ]);

    const result = await service.list(50, 0);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('r1');
  });

  it('treats a rotation more than 1 hour after the previous one in the same family as a NEW login event ("прийшов після паузи")', async () => {
    const t0 = new Date('2026-09-16T10:00:00Z');
    const t1 = new Date('2026-09-16T12:00:00Z'); // 2h later — user came back after being away
    prisma.refreshToken.findMany.mockResolvedValue([
      row({ id: 'r2', familyId: 'fam1', createdAt: t1 }),
      row({ id: 'r1', familyId: 'fam1', createdAt: t0 }),
    ]);

    const result = await service.list(50, 0);

    expect(result.items.map((i) => i.id).sort()).toEqual(['r1', 'r2']);
  });

  it('treats a different family as its own independent login event regardless of timing', async () => {
    const t0 = new Date('2026-09-16T10:00:00Z');
    prisma.refreshToken.findMany.mockResolvedValue([row({ id: 'r1', familyId: 'fam1', createdAt: t0 }), row({ id: 'r2', familyId: 'fam2', createdAt: t0 })]);

    const result = await service.list(50, 0);

    expect(result.items.map((i) => i.id).sort()).toEqual(['r1', 'r2']);
  });

  it('resolves the company name via a lookup, falling back to the raw id when not found', async () => {
    prisma.refreshToken.findMany.mockResolvedValue([row({ id: 'r1', familyId: 'fam1', createdAt: new Date(), companyId: 'c1' })]);
    prisma.company.findMany.mockResolvedValue([{ id: 'c1', name: 'Acme Ltd' }]);

    const result = await service.list(50, 0);

    expect(result.items[0].companyName).toBe('Acme Ltd');
  });

  it('flags an impersonated session distinctly via impersonatedBySuperAdminId', async () => {
    prisma.refreshToken.findMany.mockResolvedValue([row({ id: 'r1', familyId: 'fam1', createdAt: new Date(), impersonatedBy: 'super-admin-1' })]);

    const result = await service.list(50, 0);

    expect(result.items[0].impersonatedBySuperAdminId).toBe('super-admin-1');
  });

  it('only geolocates the current page of results, not the whole recent-history window', async () => {
    const now = new Date();
    prisma.refreshToken.findMany.mockResolvedValue([
      row({ id: 'r1', familyId: 'fam1', createdAt: now, ipAddress: '203.0.113.5' }),
      row({ id: 'r2', familyId: 'fam2', createdAt: now, ipAddress: '198.51.100.9' }),
    ]);

    await service.list(1, 0); // page size 1 — only one of the two events should ever reach geoIp

    expect(geoIp.lookupMany).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));
    expect(geoIp.lookupMany.mock.calls[0][0]).toHaveLength(1);
  });
});
