import { CodedConflictException } from '../../common/api-exceptions';
import { TelegramBotService } from './telegram-bot.service';

describe('TelegramBotService (2026-10-01)', () => {
  let service: TelegramBotService;
  let pairingPrisma: any;
  let prisma: any;
  let productionExecutionsService: any;
  let filesService: any;
  let telegram: any;
  let tx: any;

  const employee = {
    id: 'emp1',
    companyId: 'c1',
    fullName: 'Іван Петренко',
    telegramChatId: '555',
    telegramLinkedByUserId: 'u1',
    telegramPendingProductionOrderId: null as string | null,
    telegramPendingWorkTaskId: null as string | null,
    telegramPendingQty: null as string | null,
    telegramPendingAllocations: null as string | null,
    telegramAwaitingPhotoForExecutionId: null as string | null,
  };

  const adminUser = {
    id: 'admin1',
    email: 'admin@acme.test',
    fullName: 'Марія Коваль',
    telegramChatId: '777',
    telegramAdminPendingEmployeeIds: null as string | null,
    telegramAdminPendingProductionOrderId: null as string | null,
    telegramAdminPendingWorkTaskId: null as string | null,
    telegramAdminPendingQty: null as string | null,
    telegramAdminAwaitingPhotoForExecutionId: null as string | null,
  };

  /** Grants `production-executions:record` to whatever user findAdminByChatId resolves — tx.companyMembership/tx.role back userHasPermission's own live check. */
  function grantRecordPermission(): void {
    tx.companyMembership.findFirst.mockResolvedValue({ userId: adminUser.id, roleId: 'role-admin' });
    tx.role.findUnique.mockResolvedValue({ id: 'role-admin', permissions: [{ permission: { key: 'production-executions:record' } }] });
  }

  beforeEach(() => {
    tx = {
      productionOrder: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      assembly: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      workTask: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      productionExecution: { update: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      employee: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      companyMembership: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      role: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      payrollEntry: { findMany: jest.fn().mockResolvedValue([]) },
    };
    pairingPrisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...employee, ...data })),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...adminUser, ...data })),
      },
      companyMembership: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      company: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = { runInTenantTransaction: jest.fn((_ctx: unknown, work: (tx: unknown) => unknown) => work(tx)) };
    productionExecutionsService = { create: jest.fn(), confirm: jest.fn(), remove: jest.fn() };
    filesService = { listForEntities: jest.fn().mockResolvedValue({}), storeBotUploadedAsset: jest.fn() };
    telegram = {
      sendMessage: jest.fn(),
      sendPhoto: jest.fn().mockResolvedValue(false),
      sendChatAction: jest.fn(),
      answerCallbackQuery: jest.fn(),
      setMyCommands: jest.fn(),
      editMessageText: jest.fn(),
      downloadPhoto: jest.fn(),
    };
    service = new TelegramBotService(pairingPrisma, prisma, productionExecutionsService, filesService, telegram);
  });

  describe('/start', () => {
    it('with no code and no existing pairing, prompts for the HR-issued code', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('код'));
    });

    it('with a valid, unexpired code, pairs the chat id to the Employee row', async () => {
      pairingPrisma.employee.findFirst.mockImplementation(({ where }: any) =>
        where.telegramPairingCode === 'ABC123'
          ? Promise.resolve({ ...employee, telegramChatId: null, telegramPairingCode: 'ABC123', telegramPairingCodeExpiresAt: new Date(Date.now() + 60_000) })
          : Promise.resolve(null),
      );

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start ABC123' } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'emp1' },
          data: expect.objectContaining({ telegramChatId: '555', telegramPairingCode: null, telegramPairingCodeExpiresAt: null }),
        }),
      );
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Готово'), expect.objectContaining({ keyboard: expect.anything() }));
    });

    it('normalizes a lowercase-typed code to uppercase (codes are generated uppercase)', async () => {
      pairingPrisma.employee.findFirst.mockImplementation(({ where }: any) =>
        where.telegramPairingCode === 'ABC123'
          ? Promise.resolve({ ...employee, telegramChatId: null, telegramPairingCode: 'ABC123', telegramPairingCodeExpiresAt: new Date(Date.now() + 60_000) })
          : Promise.resolve(null),
      );
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start abc123' } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'emp1' } }));
    });

    it('rejects an unknown code without pairing anything', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue(null);
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start WRONG1' } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Невірний код'));
    });

    it('rejects an expired code', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({
        ...employee,
        telegramChatId: null,
        telegramPairingCode: 'OLD123',
        telegramPairingCodeExpiresAt: new Date(Date.now() - 60_000),
      });
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start OLD123' } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('прострочено'));
    });
  });

  describe('onModuleInit — setMyCommands', () => {
    it('registers the command menu when TELEGRAM_BOT_TOKEN is set', async () => {
      const prev = process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      await service.onModuleInit();
      expect(telegram.setMyCommands).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ command: 'start' })]));
      process.env.TELEGRAM_BOT_TOKEN = prev;
    });

    it('skips registration when TELEGRAM_BOT_TOKEN is unset (local dev)', async () => {
      const prev = process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
      await service.onModuleInit();
      expect(telegram.setMyCommands).not.toHaveBeenCalled();
      process.env.TELEGRAM_BOT_TOKEN = prev;
    });
  });

  describe('order list — default browse', () => {
    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
    });

    function sixOrders() {
      return Array.from({ length: 6 }, (_, i) => ({ id: `po${i}`, assemblyId: `a${i}`, unitsPlanned: i + 1, status: 'IN_PROGRESS' }));
    }
    function sixAssemblies() {
      return Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, article: `ART-${i}`, name: `Виріб ${i}` }));
    }

    it('/start with no code, already paired, greets with the main menu and shows page 1 of the active-order list', async () => {
      tx.productionOrder.findMany.mockResolvedValue(sixOrders());
      tx.assembly.findMany.mockResolvedValue(sixAssemblies());

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start' } });

      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Вітаю'), expect.objectContaining({ keyboard: expect.anything() }));
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('ART-0'), expect.anything());
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('ART-4'), expect.anything());
      expect(telegram.sendMessage).not.toHaveBeenCalledWith('555', expect.stringContaining('ART-5'), expect.anything());
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('Сторінка 1 з 2'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'list:1' })]] }),
      );
    });

    it('the "📋 Активні замовлення" main-menu button shows the list', async () => {
      tx.productionOrder.findMany.mockResolvedValue(sixOrders().slice(0, 2));
      tx.assembly.findMany.mockResolvedValue(sixAssemblies().slice(0, 2));
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '📋 Активні замовлення' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('ART-0'), expect.anything());
    });

    it('"/роботи" re-shows the list at any time while idle', async () => {
      tx.productionOrder.findMany.mockResolvedValue(sixOrders().slice(0, 2));
      tx.assembly.findMany.mockResolvedValue(sixAssemblies().slice(0, 2));
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/роботи' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('ART-0'), expect.anything());
    });

    it('list:<page> callback shows the next page, with both ⬅️ Попередня and ➡️ Наступна when in the middle', async () => {
      tx.productionOrder.findMany.mockResolvedValue(sixOrders());
      tx.assembly.findMany.mockResolvedValue(sixAssemblies());

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'list:1', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(telegram.answerCallbackQuery).toHaveBeenCalledWith('cb1');
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('ART-5'), expect.anything());
      expect(telegram.sendMessage).not.toHaveBeenCalledWith('555', expect.stringContaining('ART-0'), expect.anything());
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('Сторінка 2 з 2'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'list:0' })]] }),
      );
    });

    it('reports when there are no active orders at all, without a pagination footer', async () => {
      tx.productionOrder.findMany.mockResolvedValue([]);
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/start' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Немає активних замовлень'), expect.anything());
    });
  });

  describe('help and today-submissions menu entries', () => {
    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
    });

    it('"❓ Допомога" sends the help text', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '❓ Допомога' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Як це працює'), expect.anything());
    });

    it('"📊 Мої подання сьогодні" reports nothing submitted yet', async () => {
      tx.productionExecution.findMany.mockResolvedValue([]);
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '📊 Мої подання сьогодні' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('ще нічого не подавали'), expect.anything());
    });

    it('"📊 Мої подання сьогодні" lists today\'s executions with a status icon/label per row', async () => {
      tx.productionExecution.findMany.mockResolvedValue([
        { productionOrderId: 'po1', workTaskId: null, qtyCompleted: 5, status: 'DRAFT' },
        { productionOrderId: 'po2', workTaskId: null, qtyCompleted: 3, status: 'CONFIRMED' },
      ]);
      tx.productionOrder.findMany.mockResolvedValue([
        { id: 'po1', assemblyId: 'a1' },
        { id: 'po2', assemblyId: 'a2' },
      ]);
      tx.assembly.findMany.mockResolvedValue([
        { id: 'a1', article: 'ART-1', name: 'Перший' },
        { id: 'a2', article: 'ART-2', name: 'Другий' },
      ]);

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '📊 Мої подання сьогодні' } });

      const call = telegram.sendMessage.mock.calls.find((c: any[]) => typeof c[1] === 'string' && c[1].includes('Ваші подання сьогодні'));
      expect(call[1]).toContain('⏳');
      expect(call[1]).toContain('ART-1');
      expect(call[1]).toContain('очікує підтвердження');
      expect(call[1]).toContain('✅');
      expect(call[1]).toContain('ART-2');
      expect(call[1]).toContain('підтверджено');
    });
  });

  describe('search (paired, idle)', () => {
    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
    });

    it('filters IN_PROGRESS orders by article/name substring and sends each as its own message with a single select button', async () => {
      tx.productionOrder.findMany.mockResolvedValue([
        { id: 'po1', assemblyId: 'a1', unitsPlanned: 4, status: 'IN_PROGRESS' },
        { id: 'po2', assemblyId: 'a2', unitsPlanned: 2, status: 'IN_PROGRESS' },
      ]);
      tx.assembly.findMany.mockResolvedValue([
        { id: 'a1', article: '409219.L', name: 'Förderband' },
        { id: 'a2', article: '264084.02', name: 'Antriebsrad' },
      ]);

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '409219' } });

      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Оберіть'));
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('409219.L'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'order:po1' })]] }),
      );
    });

    it('sends a photo when the assembly has an ASSEMBLY_PHOTO, with the same select button as a caption', async () => {
      tx.productionOrder.findMany.mockResolvedValue([{ id: 'po1', assemblyId: 'a1', unitsPlanned: 4, status: 'IN_PROGRESS' }]);
      tx.assembly.findMany.mockResolvedValue([{ id: 'a1', article: '409219.L', name: 'Förderband' }]);
      filesService.listForEntities.mockResolvedValue({ a1: [{ downloadUrl: 'https://r2.example/a1.jpg' }] });
      telegram.sendPhoto.mockResolvedValue(true);

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '409219' } });

      expect(filesService.listForEntities).toHaveBeenCalledWith(expect.anything(), 'Assembly', ['a1'], ['ASSEMBLY_PHOTO']);
      expect(telegram.sendPhoto).toHaveBeenCalledWith(
        '555',
        'https://r2.example/a1.jpg',
        expect.stringContaining('409219.L'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'order:po1' })]] }),
      );
      expect(telegram.sendMessage).not.toHaveBeenCalledWith('555', expect.stringContaining('409219.L'), expect.anything());
    });

    it('falls back to a text message when sendPhoto fails even though a photo exists', async () => {
      tx.productionOrder.findMany.mockResolvedValue([{ id: 'po1', assemblyId: 'a1', unitsPlanned: 4, status: 'IN_PROGRESS' }]);
      tx.assembly.findMany.mockResolvedValue([{ id: 'a1', article: '409219.L', name: 'Förderband' }]);
      filesService.listForEntities.mockResolvedValue({ a1: [{ downloadUrl: 'https://r2.example/a1.jpg' }] });
      telegram.sendPhoto.mockResolvedValue(false);

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '409219' } });

      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('409219.L'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'order:po1' })]] }),
      );
    });

    it('reports when nothing matches', async () => {
      tx.productionOrder.findMany.mockResolvedValue([{ id: 'po1', assemblyId: 'a1', unitsPlanned: 4, status: 'IN_PROGRESS' }]);
      tx.assembly.findMany.mockResolvedValue([{ id: 'a1', article: '409219.L', name: 'Förderband' }]);

      await service.handleUpdate({ message: { chat: { id: 555 }, text: 'щось зовсім інше' } });

      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Нічого не знайдено'));
    });

    it('a chat with no paired Employee is told to pair first', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue(null);
      await service.handleUpdate({ message: { chat: { id: 999 }, text: '409219' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('999', expect.stringContaining('не прив\'язані'));
    });
  });

  describe('order selection (callback_query)', () => {
    it('sets telegramPendingProductionOrderId, clears any stale telegramPendingQty, and prompts for a quantity', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'order:po1', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: { telegramPendingProductionOrderId: 'po1', telegramPendingWorkTaskId: null, telegramPendingQty: null, telegramPendingAllocations: null },
      });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('кількість'));
    });

    it('rejects a selection for an order that is no longer IN_PROGRESS', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'COMPLETED' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'order:po1', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('не доступне'));
    });
  });

  describe('quantity entry -> review card (2026-10-01 "зроби бота розумнішим" — a review step before anything is recorded)', () => {
    const pendingEmployee = { ...employee, telegramPendingProductionOrderId: 'po1' };

    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', unitsPlanned: 10, status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });
    });

    it('typing a quantity stores it and asks who performed the work', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5' } });

      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: '5' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('Хто виконував'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'team:solo' }), expect.objectContaining({ callback_data: 'team:start' })]] }),
      );
    });

    it('accepts a comma decimal (uk locale input)', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5,5' } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: '5.5' } });
    });

    it('rejects non-numeric input without touching the pending state', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: 'привіт' } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('додатне число'));
    });

    it('/cancel clears the pending state without submitting anything', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/cancel' } });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: { telegramPendingProductionOrderId: null, telegramPendingWorkTaskId: null, telegramPendingQty: null, telegramPendingAllocations: null },
      });
    });

    it('"🙋 Тільки я" shows the review card', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5' } });
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee, telegramPendingQty: '5' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'team:solo', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('Перевірте'),
        expect.objectContaining({
          inline_keyboard: [
            [expect.objectContaining({ callback_data: 'submit:confirm' })],
            [expect.objectContaining({ callback_data: 'submit:editqty' }), expect.objectContaining({ callback_data: 'submit:cancel' })],
          ],
        }),
      );
    });
  });

  describe('review card -> submit (callback_query)', () => {
    const confirmingEmployee = { ...employee, telegramPendingProductionOrderId: 'po1', telegramPendingQty: '5' };

    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...confirmingEmployee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', unitsPlanned: 10, status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });
    });

    it('submit:confirm creates a SOLO/PERCENT-100 DRAFT execution via ProductionExecutionsService, flags submittedViaTelegram, clears pending state, and shows progress', async () => {
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });
      tx.productionExecution.findMany.mockResolvedValue([{ qtyCompleted: 3 }]); // 3 already CONFIRMED before this submission

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(productionExecutionsService.create).toHaveBeenCalledWith(
        { userId: 'u1', companyId: 'c1', email: '', roleId: '' },
        expect.objectContaining({
          productionOrderId: 'po1',
          qtyCompleted: 5,
          method: 'SOLO',
          allocationMode: 'PERCENT',
          allocations: [{ employeeId: 'emp1', percent: 100 }],
        }),
      );
      expect(tx.productionExecution.update).toHaveBeenCalledWith({ where: { id: 'exec1' }, data: { submittedViaTelegram: true } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: { telegramPendingProductionOrderId: null, telegramPendingWorkTaskId: null, telegramPendingQty: null, telegramPendingAllocations: null },
      });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramAwaitingPhotoForExecutionId: 'exec1' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('✅'), expect.anything());
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('3 з 10'), expect.anything());
    });

    it('relays a business-rule error (e.g. qty exceeds remaining), clears only the qty so the order stays selected for a retry', async () => {
      productionExecutionsService.create.mockRejectedValue(
        new CodedConflictException('PRODUCTION_EXECUTION_QTY_EXCEEDS_PLANNED', "Quantity exceeds this batch's remaining unitsPlanned (2.000 left)."),
      );

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: null } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ telegramPendingProductionOrderId: null }) }));
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('remaining unitsPlanned'));
    });

    it('submit:editqty clears only the qty and re-prompts, keeping the order selected', async () => {
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:editqty', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: null } });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('кількість'));
    });

    it('submit:cancel clears all pending fields without submitting', async () => {
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:cancel', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: { telegramPendingProductionOrderId: null, telegramPendingWorkTaskId: null, telegramPendingQty: null, telegramPendingAllocations: null },
      });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
    });

    it('typing a new number while the review card is up updates it in place, without needing ✏️ first', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '7' } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: '7' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('7'), expect.anything());
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
    });

    it('a non-numeric message while the review card is up nudges back to the buttons instead of erroring', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: 'ой' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('кнопками'));
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
    });
  });

  describe('general work (WorkTask) — 2026-10-01 "давай все" revision', () => {
    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
    });

    it('"🛠 Загальні роботи" lists OPEN work tasks, newest first', async () => {
      tx.workTask.findMany.mockResolvedValue([{ id: 'wt1', title: 'Прибирання цеху', status: 'OPEN' }]);
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '🛠 Загальні роботи' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('Прибирання цеху'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'worktask:wt1' })]] }),
      );
    });

    it('selecting a work task prompts for an amount in €, not a quantity', async () => {
      tx.workTask.findUnique.mockResolvedValue({ id: 'wt1', title: 'Прибирання цеху', status: 'OPEN' });
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'worktask:wt1', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: { telegramPendingWorkTaskId: 'wt1', telegramPendingProductionOrderId: null, telegramPendingQty: null, telegramPendingAllocations: null },
      });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('суму'));
    });

    it('submitting a GENERAL execution sends totalAmount, not qtyCompleted, and never submittedViaTelegram-flags a PRODUCT field', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee, telegramPendingWorkTaskId: 'wt1', telegramPendingQty: '25' });
      tx.workTask.findUnique.mockResolvedValue({ id: 'wt1', title: 'Прибирання цеху', status: 'OPEN' });
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(productionExecutionsService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ workTaskId: 'wt1', productionOrderId: undefined, totalAmount: 25, qtyCompleted: undefined, method: 'SOLO' }),
      );
    });
  });

  describe('multi-worker — "давай все" revision', () => {
    const pendingEmployee = { ...employee, telegramPendingProductionOrderId: 'po1', telegramPendingQty: '10' };

    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', unitsPlanned: 10, status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });
    });

    it('"👥 Разом з колегами" shows other ACTIVE employees (excluding self) as a toggleable list', async () => {
      tx.employee.findMany.mockResolvedValue([{ id: 'emp2', fullName: 'Марія К.' }]);
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'team:start', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(tx.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE', id: { not: 'emp1' } } }));
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('Оберіть колег'),
        expect.objectContaining({ inline_keyboard: expect.arrayContaining([[expect.objectContaining({ callback_data: 'team:toggle:emp2' }), ]]) }),
      );
    });

    it('toggling a colleague on, then off, edits the SAME message in place via editMessageText', async () => {
      tx.employee.findMany.mockResolvedValue([{ id: 'emp2', fullName: 'Марія К.' }]);

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'team:toggle:emp2', message: { chat: { id: 555 }, message_id: 42 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingAllocations: JSON.stringify(['emp2']) } });
      expect(telegram.editMessageText).toHaveBeenCalledWith('555', 42, expect.stringContaining('Оберіть колег'), expect.objectContaining({
        inline_keyboard: expect.arrayContaining([[expect.objectContaining({ text: '✅ Марія К.' })]]),
      }));

      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee, telegramPendingAllocations: JSON.stringify(['emp2']) });
      await service.handleUpdate({ callback_query: { id: 'cb2', data: 'team:toggle:emp2', message: { chat: { id: 555 }, message_id: 42 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingAllocations: JSON.stringify([]) } });
    });

    it('team:done with colleagues selected shows the review card listing participants', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee, telegramPendingAllocations: JSON.stringify(['emp2']) });
      tx.employee.findMany.mockResolvedValue([{ fullName: 'Марія К.' }]);

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'team:done', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Марія К.'), expect.anything());
    });

    it('submitting with 1 colleague selected creates a MULTI_WORKER execution split 50/50', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee, telegramPendingAllocations: JSON.stringify(['emp2']) });
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(productionExecutionsService.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: 'MULTI_WORKER', allocations: [{ employeeId: 'emp1', percent: 50 }, { employeeId: 'emp2', percent: 50 }] }),
      );
    });
  });

  describe('/unlink — self-service', () => {
    it('asks for confirmation before unlinking', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/unlink' } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining(employee.fullName),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'unlink:confirm' }), expect.objectContaining({ callback_data: 'unlink:cancel' })]] }),
      );
    });

    it('unlink:confirm clears the Telegram chat id and all pending state', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'unlink:confirm', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: {
          telegramChatId: null,
          telegramLinkedAt: null,
          telegramPendingProductionOrderId: null,
          telegramPendingWorkTaskId: null,
          telegramPendingQty: null,
          telegramPendingAllocations: null,
          telegramAwaitingPhotoForExecutionId: null,
        },
      });
    });

    it('unlink:cancel leaves everything untouched', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'unlink:cancel', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
    });
  });

  describe('optional proof photo', () => {
    it('after a successful submission, the bot offers to attach a photo', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee, telegramPendingProductionOrderId: 'po1', telegramPendingQty: '5' });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', unitsPlanned: 10, status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramAwaitingPhotoForExecutionId: 'exec1' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('фото'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'photo:skip' })]] }),
      );
    });

    it('a photo message while awaiting one uploads it via FilesService and clears the awaiting state', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee, telegramAwaitingPhotoForExecutionId: 'exec1' });
      telegram.downloadPhoto.mockResolvedValue({ bytes: Buffer.from('fake'), mimeType: 'image/jpeg' });

      await service.handleUpdate({ message: { chat: { id: 555 }, photo: [{ file_id: 'f1', file_size: 100 }, { file_id: 'f2', file_size: 500 }] } });

      expect(telegram.downloadPhoto).toHaveBeenCalledWith('f2'); // the larger of the two sizes
      expect(filesService.storeBotUploadedAsset).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'PRODUCTION_EXECUTION_PHOTO', entityType: 'ProductionExecution', entityId: 'exec1', mimeType: 'image/jpeg' }),
      );
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramAwaitingPhotoForExecutionId: null } });
    });

    it('a photo arriving when none is expected is silently ignored', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      await service.handleUpdate({ message: { chat: { id: 555 }, photo: [{ file_id: 'f1' }] } });
      expect(telegram.downloadPhoto).not.toHaveBeenCalled();
    });

    it('"Пропустити" just clears the awaiting state', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee, telegramAwaitingPhotoForExecutionId: 'exec1' });
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'photo:skip', message: { chat: { id: 555 }, message_id: 1 } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramAwaitingPhotoForExecutionId: null } });
    });
  });

  describe('supervisor notification + approve/reject', () => {
    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee, telegramPendingProductionOrderId: 'po1', telegramPendingQty: '5' });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', unitsPlanned: 10, status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });
    });

    it('notifies every company User holding production-executions:confirm who has their own Telegram paired, with approve/reject buttons', async () => {
      tx.companyMembership.findMany.mockResolvedValue([{ userId: 'sup1', roleId: 'role1' }]);
      tx.role.findMany.mockResolvedValue([{ id: 'role1', permissions: [{ permission: { key: 'production-executions:confirm' } }] }]);
      tx.user.findMany.mockResolvedValue([{ telegramChatId: '999' }]);

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '999',
        expect.stringContaining('Нове подання'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'approve:c1:exec1' }), expect.objectContaining({ callback_data: 'reject:c1:exec1' })]] }),
      );
    });

    it('skips a supervisor-eligible User who has not paired their own Telegram', async () => {
      tx.companyMembership.findMany.mockResolvedValue([{ userId: 'sup1', roleId: 'role1' }]);
      tx.role.findMany.mockResolvedValue([{ id: 'role1', permissions: [{ permission: { key: 'production-executions:confirm' } }] }]);
      tx.user.findMany.mockResolvedValue([{ telegramChatId: null }]);

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 }, message_id: 1 } } });

      expect(telegram.sendMessage).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('Нове подання'), expect.anything());
    });
  });

  describe('approve:/reject: callback (tapped by a Supervisor User, not an Employee)', () => {
    it('approve: confirms the execution and notifies the submitting employee, only after re-verifying the permission live', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ id: 'sup1', email: 'sup@co.test' });
      tx.companyMembership.findFirst.mockResolvedValue({ userId: 'sup1', roleId: 'role1' });
      tx.role.findUnique.mockResolvedValue({ id: 'role1', permissions: [{ permission: { key: 'production-executions:confirm' } }] });
      tx.productionExecution.findUnique.mockResolvedValue({ id: 'exec1', status: 'DRAFT', allocations: [{ employeeId: 'emp1' }] });
      tx.employee.findUnique.mockResolvedValue({ telegramChatId: '555' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'approve:c1:exec1', message: { chat: { id: 999 }, message_id: 1 } } });

      expect(productionExecutionsService.confirm).toHaveBeenCalledWith({ userId: 'sup1', companyId: 'c1', email: 'sup@co.test', roleId: '' }, 'exec1');
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('підтверджено'));
    });

    it('reject: removes the DRAFT instead of confirming it', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ id: 'sup1', email: 'sup@co.test' });
      tx.companyMembership.findFirst.mockResolvedValue({ userId: 'sup1', roleId: 'role1' });
      tx.role.findUnique.mockResolvedValue({ id: 'role1', permissions: [{ permission: { key: 'production-executions:confirm' } }] });
      tx.productionExecution.findUnique.mockResolvedValue({ id: 'exec1', status: 'DRAFT', allocations: [] });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'reject:c1:exec1', message: { chat: { id: 999 }, message_id: 1 } } });

      expect(productionExecutionsService.remove).toHaveBeenCalledWith({ userId: 'sup1', companyId: 'c1', email: 'sup@co.test', roleId: '' }, 'exec1');
    });

    it('rejects the tap if the User no longer holds production-executions:confirm, without calling confirm/remove', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ id: 'sup1', email: 'sup@co.test' });
      tx.companyMembership.findFirst.mockResolvedValue({ userId: 'sup1', roleId: 'role1' });
      tx.role.findUnique.mockResolvedValue({ id: 'role1', permissions: [] }); // demoted since the notification was sent

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'approve:c1:exec1', message: { chat: { id: 999 }, message_id: 1 } } });

      expect(productionExecutionsService.confirm).not.toHaveBeenCalled();
      expect(telegram.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('прав'));
    });

    it('an unpaired chat tapping approve/reject is told it is not subscribed', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue(null);
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'approve:c1:exec1', message: { chat: { id: 999 }, message_id: 1 } } });
      expect(telegram.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('підписані'));
      expect(productionExecutionsService.confirm).not.toHaveBeenCalled();
    });
  });

  describe('completeUserPairing — supervisor pairing code (2026-10-05 fix: the code-generation side existed, but /start CODE never consumed it)', () => {
    it('with a valid code and production-executions:record, pairs the chat and shows the admin menu', async () => {
      pairingPrisma.user.findFirst.mockImplementation(({ where }: any) =>
        where.telegramPairingCode === 'XYZ789'
          ? Promise.resolve({ ...adminUser, telegramChatId: null, telegramPairingCode: 'XYZ789', telegramPairingCodeExpiresAt: new Date(Date.now() + 60_000) })
          : Promise.resolve(null),
      );
      pairingPrisma.companyMembership.findFirst.mockResolvedValue({ companyId: 'c1', userId: 'admin1' });
      grantRecordPermission();

      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/start XYZ789' } });

      expect(pairingPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'admin1' },
        data: { telegramChatId: '777', telegramPairingCode: null, telegramPairingCodeExpiresAt: null },
      });
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('за інших працівників'), expect.objectContaining({ keyboard: expect.anything() }));
    });

    it('with a valid code and only production-executions:confirm (no record), gets the confirm-queue menu but not the submit-for-employee button (2026-10-06: a confirm-only User used to get no active menu at all)', async () => {
      pairingPrisma.user.findFirst.mockImplementation(({ where }: any) =>
        where.telegramPairingCode === 'XYZ789'
          ? Promise.resolve({ ...adminUser, telegramChatId: null, telegramPairingCode: 'XYZ789', telegramPairingCodeExpiresAt: new Date(Date.now() + 60_000) })
          : Promise.resolve(null),
      );
      pairingPrisma.companyMembership.findFirst.mockResolvedValue({ companyId: 'c1', userId: 'admin1' });
      tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-confirm-only' });
      tx.role.findUnique.mockResolvedValue({ id: 'role-confirm-only', permissions: [{ permission: { key: 'production-executions:confirm' } }] });

      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/start XYZ789' } });

      expect(pairingPrisma.user.update).toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '777',
        expect.stringContaining('підтверджувати подання'),
        expect.objectContaining({ keyboard: expect.arrayContaining([[expect.objectContaining({ text: '📥 На підтвердження' })]]) }),
      );
      expect(telegram.sendMessage).not.toHaveBeenCalledWith(
        '777',
        expect.anything(),
        expect.objectContaining({ keyboard: expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ text: '👤 Подати роботу за працівника' })])]) }),
      );
    });

    it('with neither permission, pairs for notifications only (no admin menu)', async () => {
      pairingPrisma.user.findFirst.mockImplementation(({ where }: any) =>
        where.telegramPairingCode === 'XYZ789'
          ? Promise.resolve({ ...adminUser, telegramChatId: null, telegramPairingCode: 'XYZ789', telegramPairingCodeExpiresAt: new Date(Date.now() + 60_000) })
          : Promise.resolve(null),
      );
      pairingPrisma.companyMembership.findFirst.mockResolvedValue({ companyId: 'c1', userId: 'admin1' });
      tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-none' });
      tx.role.findUnique.mockResolvedValue({ id: 'role-none', permissions: [] });

      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/start XYZ789' } });

      expect(pairingPrisma.user.update).toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('підтвердження'));
    });

    it('rejects an expired code without pairing anything', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser, telegramPairingCode: 'OLD999', telegramPairingCodeExpiresAt: new Date(Date.now() - 1000) });
      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/start OLD999' } });
      expect(pairingPrisma.user.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('прострочено'));
    });

    it('rejects a code already claimed by a different Telegram chat', async () => {
      pairingPrisma.user.findFirst.mockImplementation(({ where }: any) =>
        where.telegramPairingCode === 'XYZ789'
          ? Promise.resolve({ ...adminUser, telegramChatId: null, telegramPairingCode: 'XYZ789', telegramPairingCodeExpiresAt: new Date(Date.now() + 60_000) })
          : where.telegramChatId === '777'
            ? Promise.resolve({ ...adminUser, id: 'admin2', telegramChatId: '777' })
            : Promise.resolve(null),
      );
      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/start XYZ789' } });
      expect(pairingPrisma.user.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('уже прив\'язано'));
    });
  });

  describe('admin — "Подати роботу за працівника" (2026-10-05 user request)', () => {
    beforeEach(() => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser });
      pairingPrisma.companyMembership.findFirst.mockResolvedValue({ companyId: 'c1', userId: 'admin1' });
      grantRecordPermission();
    });

    it('a chat with no Employee pairing but holding production-executions:record sees the admin menu, not "not paired"', async () => {
      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/start' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('Вітаю'), expect.objectContaining({ keyboard: expect.anything() }));
      expect(telegram.sendMessage).not.toHaveBeenCalledWith('777', expect.stringContaining('ще не прив\'язані'));
    });

    it('a chat paired as a User WITHOUT production-executions:record gets a neutral message, not the HR-code prompt', async () => {
      tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-confirm-only' });
      tx.role.findUnique.mockResolvedValue({ id: 'role-confirm-only', permissions: [] });
      await service.handleUpdate({ message: { chat: { id: 777 }, text: 'привіт' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('сповіщення керівника'));
    });

    it('"👤 Подати роботу за працівника" shows a toggleable list of ACTIVE employees', async () => {
      tx.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Петро Іваненко' }, { id: 'e2', fullName: 'Олена Сидоренко' }]);
      await service.handleUpdate({ message: { chat: { id: 777 }, text: '👤 Подати роботу за працівника' } });
      expect(tx.employee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE' } }));
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '777',
        expect.stringContaining('За кого подати роботу'),
        expect.objectContaining({ inline_keyboard: expect.arrayContaining([[expect.objectContaining({ callback_data: 'admin:emp:toggle:e1' }), expect.anything()]]) }),
      );
    });

    it('toggling an employee on edits the same message in place, then "✅ Готово" offers виріб/загальна робота', async () => {
      tx.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Петро Іваненко' }]);

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:emp:toggle:e1', message: { chat: { id: 777 }, message_id: 7 } } });
      expect(pairingPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { telegramAdminPendingEmployeeIds: JSON.stringify(['e1']) } });
      expect(telegram.editMessageText).toHaveBeenCalledWith('777', 7, expect.stringContaining('За кого'), expect.objectContaining({
        inline_keyboard: expect.arrayContaining([[expect.objectContaining({ text: '✅ Петро Іваненко' })]]),
      }));

      pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser, telegramAdminPendingEmployeeIds: JSON.stringify(['e1']) });
      tx.employee.findMany.mockResolvedValue([{ fullName: 'Петро Іваненко' }]);
      await service.handleUpdate({ callback_query: { id: 'cb2', data: 'admin:emp:done', message: { chat: { id: 777 }, message_id: 7 } } });
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '777',
        expect.stringContaining('Петро Іваненко'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'admin:menu:orders' }), expect.objectContaining({ callback_data: 'admin:menu:tasks' })]] }),
      );
    });

    it('"✅ Готово" with nobody selected refuses and does not advance', async () => {
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:emp:done', message: { chat: { id: 777 }, message_id: 7 } } });
      expect(telegram.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('Оберіть'));
    });

    describe('with 2 employees already selected', () => {
      beforeEach(() => {
        pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser, telegramAdminPendingEmployeeIds: JSON.stringify(['e1', 'e2']) });
      });

      it('"📦 Виріб (замовлення)" lists IN_PROGRESS production orders with admin:order: buttons', async () => {
        tx.productionOrder.findMany.mockResolvedValue([{ id: 'po1', assemblyId: 'a1', unitsPlanned: 10, status: 'IN_PROGRESS' }]);
        tx.assembly.findMany.mockResolvedValue([{ id: 'a1', article: 'ART-1', name: 'Виріб 1' }]);

        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:menu:orders', message: { chat: { id: 777 }, message_id: 7 } } });

        expect(telegram.sendMessage).toHaveBeenCalledWith(
          '777',
          expect.stringContaining('ART-1'),
          expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'admin:order:po1' })]] }),
        );
      });

      it('picking a production order asks for a quantity', async () => {
        tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
        tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: 'ART-1', name: 'Виріб 1' });

        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:order:po1', message: { chat: { id: 777 }, message_id: 7 } } });

        expect(pairingPrisma.user.update).toHaveBeenCalledWith({
          where: { id: 'admin1' },
          data: { telegramAdminPendingProductionOrderId: 'po1', telegramAdminPendingWorkTaskId: null, telegramAdminPendingQty: null },
        });
        expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('кількість'));
      });

      it('typing a quantity after picking an order shows a review card naming both employees', async () => {
        pairingPrisma.user.findFirst.mockResolvedValue({
          ...adminUser,
          telegramAdminPendingEmployeeIds: JSON.stringify(['e1', 'e2']),
          telegramAdminPendingProductionOrderId: 'po1',
        });
        tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
        tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: 'ART-1', name: 'Виріб 1' });
        tx.employee.findMany.mockResolvedValue([{ fullName: 'Петро Іваненко' }, { fullName: 'Олена Сидоренко' }]);

        await service.handleUpdate({ message: { chat: { id: 777 }, text: '12' } });

        expect(pairingPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { telegramAdminPendingQty: '12' } });
        expect(telegram.sendMessage).toHaveBeenCalledWith(
          '777',
          expect.stringMatching(/Петро Іваненко.*Олена Сидоренко/s),
          expect.anything(),
        );
      });

      it('submitting creates a MULTI_WORKER execution split 50/50 across both employees, flags submittedViaTelegram, and notifies each employee', async () => {
        pairingPrisma.user.findFirst.mockResolvedValue({
          ...adminUser,
          telegramAdminPendingEmployeeIds: JSON.stringify(['e1', 'e2']),
          telegramAdminPendingProductionOrderId: 'po1',
          telegramAdminPendingQty: '12',
        });
        tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
        tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: 'ART-1', name: 'Виріб 1' });
        productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });
        tx.employee.findUnique.mockImplementation(({ where }: any) =>
          Promise.resolve(where.id === 'e1' ? { id: 'e1', telegramChatId: '111' } : { id: 'e2', telegramChatId: '222' }),
        );

        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:submit:confirm', message: { chat: { id: 777 }, message_id: 7 } } });

        expect(productionExecutionsService.create).toHaveBeenCalledWith(
          expect.objectContaining({ userId: 'admin1', companyId: 'c1' }),
          expect.objectContaining({
            productionOrderId: 'po1',
            qtyCompleted: 12,
            method: 'MULTI_WORKER',
            allocations: [{ employeeId: 'e1', percent: 50 }, { employeeId: 'e2', percent: 50 }],
          }),
        );
        expect(tx.productionExecution.update).toHaveBeenCalledWith({ where: { id: 'exec1' }, data: { submittedViaTelegram: true } });
        expect(pairingPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { telegramAdminAwaitingPhotoForExecutionId: 'exec1' } });
        expect(telegram.sendMessage).toHaveBeenCalledWith('111', expect.stringContaining('записав'));
        expect(telegram.sendMessage).toHaveBeenCalledWith('222', expect.stringContaining('записав'));
      });

      it('submitting with a single employee selected uses method SOLO with 100%', async () => {
        pairingPrisma.user.findFirst.mockResolvedValue({
          ...adminUser,
          telegramAdminPendingEmployeeIds: JSON.stringify(['e1']),
          telegramAdminPendingProductionOrderId: 'po1',
          telegramAdminPendingQty: '12',
        });
        tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
        tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: 'ART-1', name: 'Виріб 1' });
        productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });

        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:submit:confirm', message: { chat: { id: 777 }, message_id: 7 } } });

        expect(productionExecutionsService.create).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ method: 'SOLO', allocations: [{ employeeId: 'e1', percent: 100 }] }),
        );
      });
    });

    it('/cancel clears admin pending state', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser, telegramAdminPendingEmployeeIds: JSON.stringify(['e1']) });
      await service.handleUpdate({ message: { chat: { id: 777 }, text: '/cancel' } });
      expect(pairingPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'admin1' },
        data: {
          telegramAdminPendingEmployeeIds: null,
          telegramAdminPendingProductionOrderId: null,
          telegramAdminPendingWorkTaskId: null,
          telegramAdminPendingQty: null,
          telegramAdminAwaitingSummaryQuery: false,
        },
      });
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', '❌ Скасовано.', expect.objectContaining({ keyboard: expect.anything() }));
    });

    it('a chat with neither Employee nor sufficient-permission User pairing is told to get a code from HR', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue(null);
      await service.handleUpdate({ message: { chat: { id: 777 }, text: 'hi' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('не прив\'язані'));
    });
  });

  describe('admin — "На підтвердження" / "Сьогодні записано мною" / "Підсумок по працівнику" (2026-10-06 user request)', () => {
    beforeEach(() => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser });
      pairingPrisma.companyMembership.findFirst.mockResolvedValue({ companyId: 'c1', userId: 'admin1' });
    });

    describe('📥 На підтвердження (confirm-only User, no record permission)', () => {
      beforeEach(() => {
        tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-confirm-only' });
        tx.role.findUnique.mockResolvedValue({ id: 'role-confirm-only', permissions: [{ permission: { key: 'production-executions:confirm' } }] });
      });

      it('"📥 На підтвердження" lists every DRAFT execution with approve:/reject: buttons (the SAME callback_data the push notification uses)', async () => {
        tx.productionExecution.findMany.mockResolvedValue([
          { id: 'exec1', productionOrderId: 'po1', workTaskId: null, qtyCompleted: 5, totalAmount: 12.5, allocations: [{ employeeId: 'e1' }] },
        ]);
        tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1' });
        tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: 'ART-1', name: 'Виріб 1' });
        tx.employee.findMany.mockResolvedValue([{ fullName: 'Петро Іваненко' }]);

        await service.handleUpdate({ message: { chat: { id: 777 }, text: '📥 На підтвердження' } });

        expect(telegram.sendMessage).toHaveBeenCalledWith(
          '777',
          expect.stringContaining('Петро Іваненко'),
          expect.objectContaining({
            inline_keyboard: [[expect.objectContaining({ callback_data: 'approve:c1:exec1' }), expect.objectContaining({ callback_data: 'reject:c1:exec1' })]],
          }),
        );
      });

      it('with nothing pending, says so instead of an empty list', async () => {
        tx.productionExecution.findMany.mockResolvedValue([]);
        await service.handleUpdate({ message: { chat: { id: 777 }, text: '📥 На підтвердження' } });
        expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('Немає подань'), expect.anything());
      });

      it('a record-only admin does NOT see the "📥 На підтвердження" button in their menu (dispatch is gated, not just hidden)', async () => {
        tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-record-only' });
        tx.role.findUnique.mockResolvedValue({ id: 'role-record-only', permissions: [{ permission: { key: 'production-executions:record' } }] });
        await service.handleUpdate({ message: { chat: { id: 777 }, text: '📥 На підтвердження' } });
        expect(tx.productionExecution.findMany).not.toHaveBeenCalled();
      });
    });

    describe('📊 Сьогодні записано мною (record permission)', () => {
      beforeEach(() => {
        tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-record-only' });
        tx.role.findUnique.mockResolvedValue({ id: 'role-record-only', permissions: [{ permission: { key: 'production-executions:record' } }] });
      });

      it('lists only executions this admin recorded today, matched via recordedById', async () => {
        tx.productionExecution.findMany.mockResolvedValue([
          { id: 'exec1', productionOrderId: 'po1', workTaskId: null, qtyCompleted: 5, totalAmount: 12.5, status: 'DRAFT', allocations: [{ employeeId: 'e1' }] },
        ]);
        tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1' });
        tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: 'ART-1', name: 'Виріб 1' });
        tx.employee.findMany.mockResolvedValue([{ fullName: 'Петро Іваненко' }]);

        await service.handleUpdate({ message: { chat: { id: 777 }, text: '📊 Сьогодні записано мною' } });

        expect(tx.productionExecution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ recordedById: 'admin1' }) }));
        expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('Петро Іваненко'), expect.anything());
      });

      it('with nothing recorded today, says so', async () => {
        tx.productionExecution.findMany.mockResolvedValue([]);
        await service.handleUpdate({ message: { chat: { id: 777 }, text: '📊 Сьогодні записано мною' } });
        expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('ще нічого не записали'), expect.anything());
      });
    });

    describe('📈 Підсумок по працівнику (available regardless of which permission is held)', () => {
      beforeEach(() => {
        tx.companyMembership.findFirst.mockResolvedValue({ userId: 'admin1', roleId: 'role-record-only' });
        tx.role.findUnique.mockResolvedValue({ id: 'role-record-only', permissions: [{ permission: { key: 'production-executions:record' } }] });
      });

      it('tapping the menu button asks for a name and sets the awaiting-query flag', async () => {
        await service.handleUpdate({ message: { chat: { id: 777 }, text: '📈 Підсумок по працівнику' } });
        expect(pairingPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { telegramAdminAwaitingSummaryQuery: true } });
        expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('ім\'я'));
      });

      it('typing a name while awaiting shows matching employees as buttons, and clears the flag', async () => {
        pairingPrisma.user.findFirst.mockResolvedValue({ ...adminUser, telegramAdminAwaitingSummaryQuery: true });
        tx.employee.findMany.mockResolvedValue([{ id: 'e1', fullName: 'Петро Іваненко' }, { id: 'e2', fullName: 'Олена Сидоренко' }]);

        await service.handleUpdate({ message: { chat: { id: 777 }, text: 'Петро' } });

        expect(pairingPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'admin1' }, data: { telegramAdminAwaitingSummaryQuery: false } });
        expect(telegram.sendMessage).toHaveBeenCalledWith(
          '777',
          expect.stringContaining('Оберіть працівника'),
          expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'admin:summary:emp:e1' })]] }),
        );
      });

      it('picking an employee shows a period picker', async () => {
        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:summary:emp:e1', message: { chat: { id: 777 }, message_id: 1 } } });
        expect(telegram.sendMessage).toHaveBeenCalledWith(
          '777',
          expect.stringContaining('період'),
          expect.objectContaining({ inline_keyboard: expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ callback_data: 'admin:summary:period:e1:today' })])]) }),
        );
      });

      it('picking a period shows earnings grouped by assembly, sourced from the real PayrollEntry ledger', async () => {
        tx.employee.findUnique.mockResolvedValue({ id: 'e1', fullName: 'Петро Іваненко' });
        tx.payrollEntry.findMany.mockResolvedValue([
          { productionOrderId: 'po1', amount: 30, unitsProduced: 5, sourceAllocation: null },
          { productionOrderId: 'po1', amount: 20, unitsProduced: 3, sourceAllocation: null },
        ]);
        tx.productionOrder.findMany.mockResolvedValue([{ id: 'po1', assemblyId: 'a1' }]);
        tx.assembly.findMany.mockResolvedValue([{ id: 'a1', article: 'ART-1', name: 'Виріб 1' }]);

        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:summary:period:e1:month', message: { chat: { id: 777 }, message_id: 1 } } });

        expect(telegram.sendMessage).toHaveBeenCalledWith(
          '777',
          expect.stringMatching(/Петро Іваненко[\s\S]*50\.00 €[\s\S]*ART-1/),
          expect.anything(),
        );
      });

      it('picking a period with nothing earned says so', async () => {
        tx.employee.findUnique.mockResolvedValue({ id: 'e1', fullName: 'Петро Іваненко' });
        tx.payrollEntry.findMany.mockResolvedValue([]);
        await service.handleUpdate({ callback_query: { id: 'cb1', data: 'admin:summary:period:e1:today', message: { chat: { id: 777 }, message_id: 1 } } });
        expect(telegram.sendMessage).toHaveBeenCalledWith('777', expect.stringContaining('немає підтверджених записів'), expect.anything());
      });
    });
  });

  describe('daily reminder (@Cron)', () => {
    it('reminds only ACTIVE, Telegram-paired employees with zero submissions today', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      pairingPrisma.company.findMany.mockResolvedValue([{ id: 'c1' }]);
      tx.employee.findMany.mockResolvedValue([
        { id: 'emp1', telegramChatId: '555' },
        { id: 'emp2', telegramChatId: '666' },
      ]);
      tx.productionExecution.findMany.mockResolvedValue([{ allocations: [{ employeeId: 'emp1' }] }]); // emp1 already submitted today

      await service.sendDailyReminders();

      expect(telegram.sendMessage).toHaveBeenCalledWith('666', expect.stringContaining('не подали'), expect.anything());
      expect(telegram.sendMessage).not.toHaveBeenCalledWith('555', expect.stringContaining('не подали'), expect.anything());
    });

    it('does nothing when TELEGRAM_BOT_TOKEN is unset', async () => {
      const prev = process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;
      await service.sendDailyReminders();
      expect(pairingPrisma.company.findMany).not.toHaveBeenCalled();
      process.env.TELEGRAM_BOT_TOKEN = prev;
    });
  });
});
