import { SourcingIdentityService } from './sourcing-identity.service';

describe('SourcingIdentityService (2026-11-10 — shared by the chat bot and the Mini App)', () => {
  let pairingPrisma: any;
  let service: SourcingIdentityService;

  const chatId = '999';
  const user = { id: 'u1', fullName: 'Іван Петренко' };

  beforeEach(() => {
    process.env.SOURCING_BOT_COMPANY_ID = 'c1';
    pairingPrisma = {
      user: { findFirst: jest.fn().mockResolvedValue(user) },
      companyMembership: { findFirst: jest.fn().mockResolvedValue({ companyId: 'c1', roleId: 'role1' }) },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role1', permissions: [] }) },
    };
    service = new SourcingIdentityService(pairingPrisma);
  });

  it('resolves a paired, member-of-the-right-company chat to {userId, companyId, fullName, isAdmin}', async () => {
    const identity = await service.resolveByChatId(chatId);
    expect(identity).toEqual({ userId: 'u1', companyId: 'c1', fullName: 'Іван Петренко', isAdmin: false });
  });

  it('returns null for an unpaired chat, without checking membership', async () => {
    pairingPrisma.user.findFirst.mockResolvedValue(null);
    const identity = await service.resolveByChatId(chatId);
    expect(identity).toBeNull();
    expect(pairingPrisma.companyMembership.findFirst).not.toHaveBeenCalled();
  });

  it('returns null when the user has no membership in the configured company, even if paired', async () => {
    pairingPrisma.companyMembership.findFirst.mockResolvedValue(null);
    const identity = await service.resolveByChatId(chatId);
    expect(identity).toBeNull();
  });

  it('marks isAdmin true only when the role carries purchase-orders:manage', async () => {
    pairingPrisma.role.findUnique.mockResolvedValue({ id: 'role1', permissions: [{ permission: { key: 'purchase-orders:manage' } }] });
    const identity = await service.resolveByChatId(chatId);
    expect(identity?.isAdmin).toBe(true);
  });

  it('caches the result — a second call does not re-query', async () => {
    await service.resolveByChatId(chatId);
    await service.resolveByChatId(chatId);
    expect(pairingPrisma.user.findFirst).toHaveBeenCalledTimes(1);
  });

  it('invalidate() clears the cache so the next call re-queries', async () => {
    await service.resolveByChatId(chatId);
    service.invalidate(chatId);
    await service.resolveByChatId(chatId);
    expect(pairingPrisma.user.findFirst).toHaveBeenCalledTimes(2);
  });
});
