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
  };

  beforeEach(() => {
    tx = {
      productionOrder: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      assembly: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      productionExecution: { update: jest.fn() },
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
    telegram = { sendMessage: jest.fn(), sendPhoto: jest.fn().mockResolvedValue(false), answerCallbackQuery: jest.fn() };
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
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('Готово'));
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

  describe('search (paired, idle)', () => {
    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
    });

    it('filters IN_PROGRESS orders by article/name substring and sends each as its own message with a single "Обрати" button', async () => {
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
      // no ASSEMBLY_PHOTO for a1 (filesService mock returns {}) -> falls back to a text message with the same single button
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        '555',
        expect.stringContaining('409219.L'),
        expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ callback_data: 'order:po1' })]] }),
      );
    });

    it('sends a photo (2026-10-01 user request — "щоб при виборі виробу було також фото") when the assembly has an ASSEMBLY_PHOTO, with the same "Обрати" button as a caption', async () => {
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
      // sendPhoto succeeded -> no text-only fallback for this item
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
    it('sets telegramPendingProductionOrderId and prompts for a quantity', async () => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...employee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });

      await service.handleUpdate({ callback_query: { id: 'cb1', data: 'order:po1', message: { chat: { id: 555 } } } });

      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: 'po1' } });
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

  describe('quantity submission (paired, pending order set)', () => {
    const pendingEmployee = { ...employee, telegramPendingProductionOrderId: 'po1' };

    beforeEach(() => {
      pairingPrisma.employee.findFirst.mockResolvedValue({ ...pendingEmployee });
      tx.productionOrder.findUnique.mockResolvedValue({ id: 'po1', assemblyId: 'a1', status: 'IN_PROGRESS' });
      tx.assembly.findUnique.mockResolvedValue({ id: 'a1', article: '409219.L', name: 'Förderband' });
    });

    it('creates a SOLO/PERCENT-100 DRAFT execution via ProductionExecutionsService, flags submittedViaTelegram, and clears the pending state', async () => {
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5' } });

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
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: null } });
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('✅'));
    });

    it('accepts a comma decimal (uk locale input)', async () => {
      productionExecutionsService.create.mockResolvedValue({ id: 'exec1' });
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '5,5' } });
      expect(productionExecutionsService.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ qtyCompleted: 5.5 }));
    });

    it('rejects non-numeric input without touching the pending state or calling create()', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: 'привіт' } });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('додатне число'));
    });

    it('relays a business-rule error (e.g. qty exceeds remaining) and keeps the pending state for a retry', async () => {
      productionExecutionsService.create.mockRejectedValue(
        new CodedConflictException('PRODUCTION_EXECUTION_QTY_EXCEEDS_PLANNED', "Quantity exceeds this batch's remaining unitsPlanned (2.000 left)."),
      );

      await service.handleUpdate({ message: { chat: { id: 555 }, text: '999' } });

      expect(pairingPrisma.employee.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith('555', expect.stringContaining('remaining unitsPlanned'));
    });

    it('/cancel clears the pending state without submitting anything', async () => {
      await service.handleUpdate({ message: { chat: { id: 555 }, text: '/cancel' } });
      expect(productionExecutionsService.create).not.toHaveBeenCalled();
      expect(pairingPrisma.employee.update).toHaveBeenCalledWith({ where: { id: 'emp1' }, data: { telegramPendingProductionOrderId: null } });
    });
  });
});
