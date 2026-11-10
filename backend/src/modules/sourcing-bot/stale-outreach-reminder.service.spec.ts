import { StaleOutreachReminderService } from './stale-outreach-reminder.service';

describe('StaleOutreachReminderService (2026-11-10 — "нагадування про зависле outreach")', () => {
  let prisma: any;
  let telegram: any;
  let tx: any;
  let service: StaleOutreachReminderService;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, SOURCING_BOT_COMPANY_ID: 'c1', SOURCING_BOT_TELEGRAM_TOKEN: 'test-token' };
    tx = {
      sourcingOutreach: { findMany: jest.fn().mockResolvedValue([]) },
      companyMembership: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = { runInTenantTransaction: jest.fn((_ctx: unknown, work: (tx: unknown) => unknown) => work(tx)) };
    telegram = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    service = new StaleOutreachReminderService(prisma, telegram);
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('does nothing when SOURCING_BOT_COMPANY_ID is not configured', async () => {
    delete process.env.SOURCING_BOT_COMPANY_ID;
    await service.sendStaleOutreachReminders();
    expect(prisma.runInTenantTransaction).not.toHaveBeenCalled();
  });

  it('does nothing when the bot token is not configured', async () => {
    delete process.env.SOURCING_BOT_TELEGRAM_TOKEN;
    await service.sendStaleOutreachReminders();
    expect(prisma.runInTenantTransaction).not.toHaveBeenCalled();
  });

  it('queries only CONTACTED/AWAITING_RESPONSE outreach older than the stale cutoff', async () => {
    await service.sendStaleOutreachReminders();
    expect(tx.sourcingOutreach.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['CONTACTED', 'AWAITING_RESPONSE'] }, updatedAt: { lt: expect.any(Date) } }) }),
    );
  });

  it('sends nothing when there is no stale outreach', async () => {
    await service.sendStaleOutreachReminders();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('messages every paired admin, skipping non-admins and admins never paired to the bot', async () => {
    tx.sourcingOutreach.findMany.mockResolvedValue([
      { status: 'CONTACTED', updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), candidate: { name: 'ARGIP', category: { name: 'А. Метизи' } } },
    ]);
    tx.companyMembership.findMany.mockResolvedValue([
      { user: { sourcingBotChatId: 'chat1' }, role: { permissions: [{ permission: { key: 'purchase-orders:manage' } }] } },
      { user: { sourcingBotChatId: 'chat2' }, role: { permissions: [{ permission: { key: 'something-else' } }] } },
      { user: { sourcingBotChatId: null }, role: { permissions: [{ permission: { key: 'purchase-orders:manage' } }] } },
    ]);

    await service.sendStaleOutreachReminders();

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith('chat1', expect.stringContaining('ARGIP'));
  });

  it('does not send anything when stale outreach exists but no admin is paired', async () => {
    tx.sourcingOutreach.findMany.mockResolvedValue([
      { status: 'AWAITING_RESPONSE', updatedAt: new Date(), candidate: { name: 'Hersteller GmbH', category: { name: 'Б. Труба' } } },
    ]);
    tx.companyMembership.findMany.mockResolvedValue([]);

    await service.sendStaleOutreachReminders();

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('swallows errors so a single bad run never crashes the process', async () => {
    tx.sourcingOutreach.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.sendStaleOutreachReminders()).resolves.toBeUndefined();
  });
});
