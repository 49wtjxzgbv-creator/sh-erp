import { Prisma } from '@prisma/client';
import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let prisma: any;
  let audit: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        employee: {
          create: jest.fn(),
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn(),
        },
      },
    };
    audit = { record: jest.fn() };
    service = new EmployeesService(prisma, audit);
  });

  it('query() defaults to ACTIVE-only when no status filter is given', async () => {
    await service.query(user, {});
    expect(prisma.tenant.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });

  it('query() honors an explicit status filter', async () => {
    await service.query(user, { status: 'INACTIVE' });
    expect(prisma.tenant.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'INACTIVE' } }),
    );
  });

  it('deactivate() sets status to INACTIVE, never hard-deletes', async () => {
    prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
    prisma.tenant.employee.update.mockResolvedValue({ id: 'e1', status: 'INACTIVE' });

    await service.deactivate(user, 'e1');

    expect(prisma.tenant.employee.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'INACTIVE' } });
  });

  it('reactivate() sets status back to ACTIVE', async () => {
    prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', status: 'INACTIVE' });
    prisma.tenant.employee.update.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });

    await service.reactivate(user, 'e1');

    expect(prisma.tenant.employee.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { status: 'ACTIVE' } });
  });

  describe('generateTelegramPairingCode (2026-10-01)', () => {
    it('writes a 6-char code + a ~15min expiry + records who generated it', async () => {
      prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
      const expiresAt = new Date('2026-10-01T12:15:00Z');
      prisma.tenant.employee.update.mockResolvedValue({ id: 'e1', telegramPairingCode: 'ABC123', telegramPairingCodeExpiresAt: expiresAt });

      const result = await service.generateTelegramPairingCode(user, 'e1');

      expect(prisma.tenant.employee.update).toHaveBeenCalledTimes(1);
      const call = prisma.tenant.employee.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'e1' });
      expect(call.data.telegramPairingCode).toHaveLength(6);
      expect(call.data.telegramLinkedByUserId).toBe('u1');
      expect(call.data.telegramPairingCodeExpiresAt).toBeInstanceOf(Date);
      expect(result.pairingCode).toBe(call.data.telegramPairingCode);
    });

    it('retries with a fresh code on a unique-constraint collision (globally-unique code, shared across every company)', async () => {
      prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', status: 'ACTIVE' });
      const collision = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
      prisma.tenant.employee.update.mockRejectedValueOnce(collision).mockResolvedValueOnce({ id: 'e1', telegramPairingCode: 'ZZZ999' });

      const result = await service.generateTelegramPairingCode(user, 'e1');

      expect(prisma.tenant.employee.update).toHaveBeenCalledTimes(2);
      expect(result.pairingCode).toHaveLength(6);
    });
  });

  describe('unlinkTelegram (2026-10-01)', () => {
    it('clears every Telegram-related field, including the pending-submission FSM state', async () => {
      prisma.tenant.employee.findUnique.mockResolvedValue({ id: 'e1', telegramChatId: '12345' });
      prisma.tenant.employee.update.mockResolvedValue({ id: 'e1', telegramChatId: null });

      await service.unlinkTelegram(user, 'e1');

      expect(prisma.tenant.employee.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: {
          telegramChatId: null,
          telegramLinkedAt: null,
          telegramPendingProductionOrderId: null,
          telegramPairingCode: null,
          telegramPairingCodeExpiresAt: null,
        },
      });
    });
  });
});
