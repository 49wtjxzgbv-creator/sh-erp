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
    telegramPendingQty: null as string | null,
  };

  beforeEach(() => {
    tx = {
      productionOrder: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      assembly: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      workTask: { findMany: jest.fn().mockResolvedValue([]) },
      productionExecution: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    pairingPrisma = {
      employee: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...employee, ...data })),
      },
    };
    prisma = { runInTenantTransaction: jest.fn((_ctx: unknown, work: (tx: unknown) => unknown) => work(tx)) };
    productionExecutionsService = { create: jest.fn() };
    filesService = { listForEntities: jest.fn().mockResolvedValue({}) };
    telegram = { sendMessage: jest.fn(), sendPhoto: jest.fn().mockResolvedValue(false), sendChatAction: jest.fn(), answerCallbackQuery: jest.fn(), setMyCommands: jest.fn() };
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

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'list:1', message: { chat: { id: 555 } } } });

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

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'order:po1', message: { chat: { id: 555 } } } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: 'po1', telegramPendingQty: null } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('кількість'));
    });

    it('rejects a selection for an order that is no longer IN_PROGRESS', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'COMPLETED' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'order:po1', message: { chat: { id: 555 } } } });

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

    it('typing a quantity shows a review card and does NOT submit yet', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5' } });

      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: '5' } });
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

    it('accepts a comma decimal (uk locale input) on the review card', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5,5' } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('5.5'), expect.anything());
    });

    it('rejects non-numeric input without touching the pending state or showing a review card', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: 'привіт' } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('додатне число'));
    });

    it('/cancel clears the pending state without submitting anything', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/cancel' } });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: null, telegramPendingQty: null } });
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

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 } } } });

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
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: null, telegramPendingQty: null } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('✅'), expect.anything());
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('3 з 10'), expect.anything());
    });

    it('relays a business-rule error (e.g. qty exceeds remaining), clears only the qty so the order stays selected for a retry', async () => {
      productionExecutionsService.create.mockRejectedValue(
        new CodedConflictException('PRODUCTION_EXECUTION_QTY_EXCEEDS_PLANNED', "Quantity exceeds this batch's remaining unitsPlanned (2.000 left)."),
      );

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:confirm', message: { chat: { id: 555 } } } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: null } });
      expect(pairingPrisma.employee.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ telegramPendingProductionOrderId: null }) }));
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('remaining unitsPlanned'));
    });

    it('submit:editqty clears only the qty and re-prompts, keeping the order selected', async () => {
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:editqty', message: { chat: { id: 555 } } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingQty: null } });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('кількість'));
    });

    it('submit:cancel clears both pending fields without submitting', async () => {
      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'submit:cancel', message: { chat: { id: 555 } } } });
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: null, telegramPendingQty: null } });
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
});
