import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: any;
  let audit: any;
  let email: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'admin@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        companyMembership: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
          count: jest.fn().mockResolvedValue(2),
        },
        user: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        role: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    email = { send: jest.fn().mockResolvedValue({ sent: true }) };
    service = new UsersService(prisma, audit, email);
  });

  describe('me() — self-service profile lookup (2026-09-06, dashboard greeting by name)', () => {
    it('returns id/fullName/email/telegramPaired for the current user, nothing else (never the raw passwordHash/chat id)', async () => {
      prisma.tenant.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'Іван Петренко', email: 'admin@b.com', passwordHash: 'secret-hash', telegramChatId: '555' });

      const result = await service.me(user);

      expect(result).toEqual({ id: 'u1', fullName: 'Іван Петренко', email: 'admin@b.com', telegramPaired: true });
      expect(prisma.tenant.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
    });

    it('telegramPaired is false when no Telegram chat id is set', async () => {
      prisma.tenant.user.findUnique.mockResolvedValue({ id: 'u1', fullName: 'Іван Петренко', email: 'admin@b.com', telegramChatId: null });
      const result = await service.me(user);
      expect(result.telegramPaired).toBe(false);
    });

    it('throws when the user row is somehow gone', async () => {
      prisma.tenant.user.findUnique.mockResolvedValue(null);
      await expect(service.me(user)).rejects.toThrow();
    });
  });

  it('list() includes telegramPaired per member (2026-10-06 — so the admin users page can offer "generate code" vs "unlink")', async () => {
    prisma.tenant.companyMembership.findMany.mockResolvedValue([{ userId: 'u1', roleId: 'role1', createdAt: new Date('2026-01-01') }]);
    prisma.tenant.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@b.com', fullName: 'A B', active: true, telegramChatId: '555' }]);
    prisma.tenant.role.findMany.mockResolvedValue([{ id: 'role1', name: 'Owner' }]);

    const result = await service.list(user);

    expect(result[0].telegramPaired).toBe(true);
  });

  it('invite() creates a new account with a temp password for a brand-new email', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', name: 'Storekeeper' });
    prisma.tenant.user.findUnique.mockResolvedValue(null);
    prisma.tenant.user.create.mockResolvedValue({ id: 'newUser1', email: 'x@y.com', fullName: 'X Y' });
    prisma.tenant.companyMembership.create.mockResolvedValue({ id: 'm1' });

    const result = await service.invite(user, { email: 'x@y.com', fullName: 'X Y', roleId: 'role1' });

    expect(result.tempPassword).not.toBeNull();
    expect(prisma.tenant.user.create).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
  });

  it('invite() attaches an existing user without touching their password', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1', name: 'Storekeeper' });
    prisma.tenant.user.findUnique.mockResolvedValue({ id: 'existing1', email: 'x@y.com', fullName: 'X Y' });
    prisma.tenant.companyMembership.findUnique.mockResolvedValue(null); // no existing membership yet
    prisma.tenant.companyMembership.create.mockResolvedValue({ id: 'm1' });

    const result = await service.invite(user, { email: 'x@y.com', fullName: 'X Y', roleId: 'role1' });

    expect(result.tempPassword).toBeNull();
    expect(prisma.tenant.user.create).not.toHaveBeenCalled();
  });

  it('invite() rejects if the person already has a membership in this company', async () => {
    prisma.tenant.role.findUnique.mockResolvedValue({ id: 'role1' });
    prisma.tenant.user.findUnique.mockResolvedValue({ id: 'existing1', email: 'x@y.com' });
    prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm-existing' });

    await expect(service.invite(user, { email: 'x@y.com', fullName: 'X Y', roleId: 'role1' })).rejects.toThrow();
  });

  it('deactivate() refuses to remove your own access', async () => {
    await expect(service.deactivate(user, user.userId)).rejects.toThrow();
    expect(prisma.tenant.companyMembership.delete).not.toHaveBeenCalled();
  });

  it('deactivate() refuses to remove the last remaining member', async () => {
    prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm2', roleId: 'role1' });
    prisma.tenant.companyMembership.count.mockResolvedValue(1);

    await expect(service.deactivate(user, 'otherUser')).rejects.toThrow();
    expect(prisma.tenant.companyMembership.delete).not.toHaveBeenCalled();
  });

  it('deactivate() removes the CompanyMembership, not the global User row', async () => {
    prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm2', roleId: 'role1' });
    prisma.tenant.companyMembership.count.mockResolvedValue(2);
    prisma.tenant.companyMembership.delete.mockResolvedValue({ id: 'm2' });

    await service.deactivate(user, 'otherUser');

    expect(prisma.tenant.companyMembership.delete).toHaveBeenCalledWith({ where: { id: 'm2' } });
  });

  describe('generateTelegramPairingCode (2026-10-01 — supervisor Telegram notifications)', () => {
    it('writes a 6-char code + a ~15min expiry, no special permission required', async () => {
      const expiresAt = new Date('2026-10-01T12:15:00Z');
      prisma.tenant.user.update.mockResolvedValue({ telegramPairingCode: 'ABC123', telegramPairingCodeExpiresAt: expiresAt });

      const result = await service.generateTelegramPairingCode(user);

      expect(prisma.tenant.user.update).toHaveBeenCalledTimes(1);
      const call = prisma.tenant.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u1' });
      expect(call.data.telegramPairingCode).toHaveLength(6);
      expect(result.pairingCode).toBe(call.data.telegramPairingCode);
    });

    it('retries with a fresh code on a unique-constraint collision (globally-unique code, shared across every company)', async () => {
      const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
      prisma.tenant.user.update.mockRejectedValueOnce(collision).mockResolvedValueOnce({ telegramPairingCode: 'ZZZ999' });

      const result = await service.generateTelegramPairingCode(user);

      expect(prisma.tenant.user.update).toHaveBeenCalledTimes(2);
      expect(result.pairingCode).toHaveLength(6);
    });
  });

  describe('unlinkTelegram (2026-10-01)', () => {
    it('clears every Telegram-related field on the User row', async () => {
      prisma.tenant.user.update.mockResolvedValue({ id: 'u1', telegramChatId: null });

      await service.unlinkTelegram(user);

      expect(prisma.tenant.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { telegramChatId: null, telegramPairingCode: null, telegramPairingCodeExpiresAt: null },
      });
    });
  });

  describe('generateTelegramPairingCodeForUser / unlinkTelegramForUser (2026-10-06 — "підписати в бот ще одного адміністратора")', () => {
    it('generates a code for the TARGET user, not the caller, once membership is confirmed', async () => {
      prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm2', userId: 'u2', companyId: 'c1', roleId: 'role1' });
      const expiresAt = new Date('2026-10-06T12:15:00Z');
      prisma.tenant.user.update.mockResolvedValue({ telegramPairingCode: 'ABC123', telegramPairingCodeExpiresAt: expiresAt });

      const result = await service.generateTelegramPairingCodeForUser(user, 'u2');

      expect(prisma.tenant.companyMembership.findUnique).toHaveBeenCalledWith({ where: { companyId_userId: { companyId: 'c1', userId: 'u2' } } });
      const call = prisma.tenant.user.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'u2' });
      expect(result.pairingCode).toHaveLength(6);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.telegram_pairing_code_generated_by_admin', entityId: 'u2' }));
    });

    it('refuses to generate a code for someone outside the admin\'s own company', async () => {
      prisma.tenant.companyMembership.findUnique.mockResolvedValue(null);
      await expect(service.generateTelegramPairingCodeForUser(user, 'u2')).rejects.toThrow();
      expect(prisma.tenant.user.update).not.toHaveBeenCalled();
    });

    it('unlinkTelegramForUser clears the TARGET user\'s Telegram fields, scoped to the same company', async () => {
      prisma.tenant.companyMembership.findUnique.mockResolvedValue({ id: 'm2', userId: 'u2', companyId: 'c1', roleId: 'role1' });
      prisma.tenant.user.update.mockResolvedValue({ id: 'u2', telegramChatId: null });

      await service.unlinkTelegramForUser(user, 'u2');

      expect(prisma.tenant.user.update).toHaveBeenCalledWith({
        where: { id: 'u2' },
        data: { telegramChatId: null, telegramPairingCode: null, telegramPairingCodeExpiresAt: null },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.telegram_unlinked_by_admin', entityId: 'u2' }));
    });
  });
});
