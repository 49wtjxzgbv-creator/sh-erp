import { SourcingBotService } from './sourcing-bot.service';
import { renderHtmlToPdf } from '../../common/pdf/html-to-pdf';

jest.mock('../../common/pdf/html-to-pdf');
const mockRenderHtmlToPdf = renderHtmlToPdf as jest.MockedFunction<typeof renderHtmlToPdf>;

describe('SourcingBotService (2026-11-09 — procurement sourcing bot)', () => {
  let service: SourcingBotService;
  let pairingPrisma: any;
  let prisma: any;
  let filesService: any;
  let telegram: any;
  let tx: any;

  const chatId = '999';
  const user = {
    id: 'u1',
    fullName: 'Іван Петренко',
    sourcingBotChatId: null as string | null,
    sourcingBotPairingCode: 'ABC123',
    sourcingBotPairingCodeExpiresAt: new Date(Date.now() + 10 * 60_000),
  };

  let nextUpdateId = 1;

  function msg(text: string) {
    return { update_id: nextUpdateId++, message: { chat: { id: Number(chatId) }, text } };
  }

  function cb(data: string, messageId = 1) {
    return { update_id: nextUpdateId++, callback_query: { id: 'cbq1', data, message: { chat: { id: Number(chatId) }, message_id: messageId } } };
  }

  beforeEach(() => {
    process.env.SOURCING_BOT_COMPANY_ID = 'c1';
    tx = {
      sourcingCategory: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      product: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
      productSupplier: { findMany: jest.fn().mockResolvedValue([]) },
      fileAsset: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      sourcingCandidateSupplier: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      sourcingOutreach: { update: jest.fn(), create: jest.fn() },
    };
    pairingPrisma = {
      user: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...user, ...data })) },
      companyMembership: { findFirst: jest.fn().mockResolvedValue({ companyId: 'c1', roleId: 'role1' }) },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role1', permissions: [] }) },
    };
    prisma = { runInTenantTransaction: jest.fn((_ctx: unknown, work: (tx: unknown) => unknown) => work(tx)) };
    filesService = {
      getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.test/photo.jpg' }),
      getFileAssetBytes: jest.fn().mockResolvedValue({ bytes: Buffer.from('fake'), mimeType: 'image/jpeg', originalName: 'photo.jpg' }),
    };
    telegram = {
      getUpdates: jest.fn().mockResolvedValue([]),
      sendMessage: jest.fn(),
      sendPhoto: jest.fn().mockResolvedValue(false),
      sendDocument: jest.fn().mockResolvedValue(true),
      answerCallbackQuery: jest.fn(),
      editMessageText: jest.fn(),
    };
    mockRenderHtmlToPdf.mockReset().mockResolvedValue(Buffer.from('%PDF-fake'));
    service = new SourcingBotService(pairingPrisma, prisma, filesService, telegram);
  });

  describe('/start pairing', () => {
    it('invalid code sends an error, writes nothing', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue(null);
      await service.handleUpdate(msg('/start WRONG'));
      expect(pairingPrisma.user.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Невірний код'));
    });

    it('expired code refuses pairing and does not clear it', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...user, sourcingBotPairingCodeExpiresAt: new Date(Date.now() - 1000) });
      await service.handleUpdate(msg('/start ABC123'));
      expect(pairingPrisma.user.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('прострочено'));
    });

    it('chat already linked to a DIFFERENT user refuses pairing', async () => {
      pairingPrisma.user.findFirst
        .mockResolvedValueOnce(user) // lookup by code
        .mockResolvedValueOnce({ ...user, id: 'someone-else' }); // existing-chat check
      await service.handleUpdate(msg('/start ABC123'));
      expect(pairingPrisma.user.update).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('уже прив\'язано'));
    });

    it('valid code pairs the chat, clears the code, and shows the main menu', async () => {
      pairingPrisma.user.findFirst
        .mockResolvedValueOnce(user) // lookup by code
        .mockResolvedValueOnce(null); // no existing chat link
      tx.sourcingCategory.findMany.mockResolvedValue([{ id: 'cat1', name: 'А. Метизи' }]);

      await service.handleUpdate(msg('/start ABC123'));

      expect(pairingPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { sourcingBotChatId: chatId, sourcingBotPairingCode: null, sourcingBotPairingCodeExpiresAt: null },
      });
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Готово'), expect.anything());
      // code lookup + existing-chat check + one more re-resolve for the main menu that follows (cache was cleared on pairing)
      expect(pairingPrisma.user.findFirst).toHaveBeenCalledTimes(3);
    });
  });

  describe('company resolution — targets the configured SOURCING_BOT_COMPANY_ID specifically', () => {
    it('a user with exactly one membership resolves normally', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...user, sourcingBotChatId: chatId });
      tx.sourcingCategory.findMany.mockResolvedValue([]);

      await service.handleUpdate(msg('/start'));

      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Вітаю'), expect.anything());
    });

    it('a user with no membership in the configured sourcing-bot company is treated as not paired — other memberships they hold are irrelevant', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...user, sourcingBotChatId: chatId });
      // Has a membership somewhere else (e.g. a different company in this same ERP installation), but NOT in SOURCING_BOT_COMPANY_ID ('c1').
      pairingPrisma.companyMembership.findFirst.mockResolvedValue(null);

      await service.handleUpdate(msg('/start'));

      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('/start КОД'));
    });
  });

  async function pairAndClear() {
    pairingPrisma.user.findFirst.mockResolvedValue({ ...user, sourcingBotChatId: chatId });
  }

  describe('outreach status transitions', () => {
    beforeEach(pairAndClear);

    it.each([
      ['CONTACTED', 'setstatus:cand1:CONTACTED'],
      ['RESPONDED', 'setstatus:cand1:RESPONDED'],
      ['REJECTED', 'setstatus:cand1:REJECTED'],
      ['WON', 'setstatus:cand1:WON'],
    ])('tapping the %s button updates the outreach row and stamps the acting user', async (status, callbackData) => {
      tx.sourcingCandidateSupplier.findUnique.mockResolvedValue({ id: 'cand1', categoryId: 'cat1', name: 'Test Co', outreach: { status } });

      await service.handleUpdate(cb(callbackData));

      expect(tx.sourcingOutreach.update).toHaveBeenCalledWith({
        where: { companyId_candidateSupplierId: { companyId: 'c1', candidateSupplierId: 'cand1' } },
        data: { status, contactedByUserId: 'u1', contactedAt: expect.any(Date) },
      });
    });
  });

  describe('note flow', () => {
    beforeEach(pairAndClear);

    it('prompts for text then saves it as the outreach lastNote', async () => {
      await service.handleUpdate(cb('note:cand1'));
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('нотатку'));

      tx.sourcingCandidateSupplier.findUnique.mockResolvedValue({ id: 'cand1', categoryId: 'cat1', name: 'Test Co', outreach: {} });
      await service.handleUpdate(msg('дзвонив, обіцяв прайс завтра'));

      expect(tx.sourcingOutreach.update).toHaveBeenCalledWith({
        where: { companyId_candidateSupplierId: { companyId: 'c1', candidateSupplierId: 'cand1' } },
        data: { lastNote: 'дзвонив, обіцяв прайс завтра' },
      });
    });
  });

  describe('quote price + note flow', () => {
    beforeEach(pairAndClear);

    it('rejects non-numeric price input and stays in the same step', async () => {
      await service.handleUpdate(cb('quote:cand1'));
      await service.handleUpdate(msg('дорого'));
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Не схоже на число'));
      expect(tx.sourcingOutreach.update).not.toHaveBeenCalled();
    });

    it('two steps (price, then note) save both fields and set status to QUOTE_RECEIVED', async () => {
      await service.handleUpdate(cb('quote:cand1'));
      await service.handleUpdate(msg('150,50'));
      tx.sourcingCandidateSupplier.findUnique.mockResolvedValue({ id: 'cand1', categoryId: 'cat1', name: 'Test Co', outreach: {} });
      await service.handleUpdate(msg('з ПДВ'));

      expect(tx.sourcingOutreach.update).toHaveBeenCalledWith({
        where: { companyId_candidateSupplierId: { companyId: 'c1', candidateSupplierId: 'cand1' } },
        data: { status: 'QUOTE_RECEIVED', quotedPriceEur: 150.5, quotedPriceNote: 'з ПДВ', contactedByUserId: 'u1', contactedAt: expect.any(Date) },
      });
    });
  });

  describe('fix price flow', () => {
    beforeEach(pairAndClear);

    it('updates the real Product field directly, not a shadow copy', async () => {
      await service.handleUpdate(cb('fixprice:prod1:germanPriceExclVat'));
      await service.handleUpdate(msg('123.45'));

      expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 'prod1' }, data: { germanPriceExclVat: 123.45 } });
    });

    it('"-" clears the field instead of parsing it as a number', async () => {
      await service.handleUpdate(cb('fixprice:prod1:sellPriceEur'));
      await service.handleUpdate(msg('-'));

      expect(tx.product.update).toHaveBeenCalledWith({ where: { id: 'prod1' }, data: { sellPriceEur: null } });
    });
  });

  describe('admin-only add-candidate', () => {
    it('non-admin tapping ➕ gets refused, no pending state started', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...user, sourcingBotChatId: chatId });
      pairingPrisma.role.findUnique.mockResolvedValue({ id: 'role1', permissions: [] });

      await service.handleUpdate(cb('addcandidate:cat1'));

      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('тільки адміністратор'));
      // the free-text that would have been the candidate payload is NOT consumed as one, since no pending state was set
      await service.handleUpdate(msg('Якась компанія; Київ; +380...'));
      expect(tx.sourcingCandidateSupplier.create).not.toHaveBeenCalled();
    });

    it('admin (purchase-orders:manage) can add a new candidate from one semicolon-separated message', async () => {
      pairingPrisma.user.findFirst.mockResolvedValue({ ...user, sourcingBotChatId: chatId });
      pairingPrisma.role.findUnique.mockResolvedValue({ id: 'role1', permissions: [{ permission: { key: 'purchase-orders:manage' } }] });
      tx.sourcingCandidateSupplier.create.mockResolvedValue({ id: 'newcand', name: 'Нова Фірма' });
      tx.sourcingCategory.findUnique.mockResolvedValue({ id: 'cat1', name: 'А. Метизи', candidates: [] });

      await service.handleUpdate(cb('addcandidate:cat1'));
      await service.handleUpdate(msg('Нова Фірма; Київ; +380671112233; info@nova.ua; nova.ua; метизи'));

      expect(tx.sourcingCandidateSupplier.create).toHaveBeenCalledWith({
        data: {
          categoryId: 'cat1',
          name: 'Нова Фірма',
          location: 'Київ',
          phone: '+380671112233',
          email: 'info@nova.ua',
          website: 'nova.ua',
          whatTheyDo: 'метизи',
          source: 'user_added',
        },
      });
      expect(tx.sourcingOutreach.create).toHaveBeenCalledWith({ data: { candidateSupplierId: 'newcand', status: 'NOT_CONTACTED' } });
    });
  });

  describe('product detail (2026-11-09 — "мав на увазі фото товару... ціни існуючих постачальників")', () => {
    beforeEach(pairAndClear);

    it('sends the photo via sendPhoto when the product has a PRODUCT_PHOTO FileAsset, with our prices AND every linked real supplier price', async () => {
      tx.product.findUnique.mockResolvedValue({
        id: 'prod1',
        article: 'K00285',
        name: 'Linsen-Flanschkopf-Schraube',
        sourcingCategoryId: 'cat1',
        germanPriceExclVat: 0.08,
        germanPriceInclVat: null,
        localPriceExclVat: null,
        localPriceInclVat: null,
        sellPriceEur: 0.15,
      });
      tx.productSupplier.findMany.mockResolvedValue([{ price: 0.1, supplierOfferedPrice: 0.09, supplier: { name: 'ARGIP' } }]);
      tx.fileAsset.findFirst.mockResolvedValue({ id: 'file1' });
      telegram.sendPhoto.mockResolvedValue(true);

      await service.handleUpdate(cb('product:prod1'));

      expect(filesService.getDownloadUrl).toHaveBeenCalledWith({ userId: 'u1', companyId: 'c1' }, 'file1');
      expect(telegram.sendPhoto).toHaveBeenCalledWith(
        chatId,
        'https://example.test/photo.jpg',
        expect.stringMatching(/ARGIP.*наша ціна.*постачальник пропонує/s),
        expect.anything(),
      );
      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('falls back to a plain text message when there is no photo', async () => {
      tx.product.findUnique.mockResolvedValue({
        id: 'prod1',
        article: 'K00285',
        name: 'Linsen-Flanschkopf-Schraube',
        sourcingCategoryId: 'cat1',
        germanPriceExclVat: null,
        germanPriceInclVat: null,
        localPriceExclVat: null,
        localPriceInclVat: null,
        sellPriceEur: null,
      });

      await service.handleUpdate(cb('product:prod1'));

      expect(telegram.sendPhoto).not.toHaveBeenCalled();
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('K00285'), expect.anything());
    });

    it('lists the product\'s own category candidate suppliers too (2026-11-09 — "додай ще до кожної картки товару можливі постачальники")', async () => {
      tx.product.findUnique.mockResolvedValue({
        id: 'prod1',
        article: 'K00285',
        name: 'Linsen-Flanschkopf-Schraube',
        sourcingCategoryId: 'cat1',
        germanPriceExclVat: null,
        germanPriceInclVat: null,
        localPriceExclVat: null,
        localPriceInclVat: null,
        sellPriceEur: null,
      });
      tx.sourcingCandidateSupplier.findMany.mockResolvedValue([
        { id: 'cand1', name: 'UKR-METIZ', outreach: { status: 'CONTACTED' } },
        { id: 'cand2', name: 'Діабаз Груп', outreach: null },
      ]);

      await service.handleUpdate(cb('product:prod1'));

      expect(tx.sourcingCandidateSupplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { categoryId: 'cat1', deletedAt: null } }),
      );
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringMatching(/Можливі постачальники.*UKR-METIZ.*Діабаз Груп/s),
        expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            [{ text: '🆕 UKR-METIZ', callback_data: 'cand:cand1' }],
            [{ text: '🆕 Діабаз Груп', callback_data: 'cand:cand2' }],
          ]),
        }),
      );
    });
  });

  describe('supplier browsing (2026-11-09)', () => {
    beforeEach(pairAndClear);

    it('lists distinct real suppliers linked to tracked products', async () => {
      tx.productSupplier.findMany.mockResolvedValue([
        { supplierId: 's1', supplier: { name: 'ARGIP' } },
        { supplierId: 's2', supplier: { name: 'Sturtz' } },
      ]);

      await service.handleUpdate(msg('🏭 Постачальники'));

      expect(telegram.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.anything(),
        { inline_keyboard: [[{ text: '🏭 ARGIP', callback_data: 'supplier:s1:0' }], [{ text: '🏭 Sturtz', callback_data: 'supplier:s2:0' }]] },
      );
    });
  });

  describe('search by article (2026-11-09)', () => {
    beforeEach(pairAndClear);

    it('tapping 🔎 Пошук prompts, then the next message searches article/name among tracked products', async () => {
      await service.handleUpdate(msg('🔎 Пошук за артикулом'));
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Введіть'));

      tx.product.findMany.mockResolvedValue([{ id: 'prod1', article: 'K00285', name: 'Linsen-Flanschkopf-Schraube' }]);
      await service.handleUpdate(msg('K00285'));

      expect(tx.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourcingCategoryId: { not: null },
            OR: [{ article: { contains: 'K00285', mode: 'insensitive' } }, { name: { contains: 'K00285', mode: 'insensitive' } }],
          }),
        }),
      );
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        chatId,
        expect.stringContaining('Знайдено'),
        { inline_keyboard: [[{ text: '📦 K00285 — Linsen-Flanschkopf-Schraube', callback_data: 'product:prod1' }]] },
      );
    });
  });

  describe('catalog export (2026-11-09 — "щоб генерувало файл з усіма товарами там фото артикул назву всіх постачальників і ціни")', () => {
    beforeEach(pairAndClear);

    it('renders a PDF covering the WHOLE catalog (not just tracked products), embeds photos as data URIs, and sends it as a document', async () => {
      tx.product.findMany.mockResolvedValue([
        {
          id: 'prod1',
          article: 'K00285',
          name: 'Linsen-Flanschkopf-Schraube',
          sourcingCategoryId: 'cat1',
          germanPriceExclVat: 0.08,
          germanPriceInclVat: null,
          localPriceExclVat: null,
          localPriceInclVat: null,
          sellPriceEur: 0.15,
          sourcingCategory: { name: 'А. Метизи' },
          suppliers: [{ price: 0.1, supplierOfferedPrice: 0.09, supplier: { name: 'ARGIP' } }],
        },
        {
          id: 'prod2',
          article: 'X999',
          name: 'No photo item',
          sourcingCategoryId: null,
          germanPriceExclVat: null,
          germanPriceInclVat: null,
          localPriceExclVat: null,
          localPriceInclVat: null,
          sellPriceEur: null,
          sourcingCategory: null,
          suppliers: [],
        },
      ]);
      tx.sourcingCandidateSupplier.findMany.mockResolvedValue([{ categoryId: 'cat1', name: 'UKR-METIZ' }]);
      tx.fileAsset.findMany.mockResolvedValue([{ entityId: 'prod1', storageKey: 'tenants/c1/product_photo/prod1/x.jpg', mimeType: 'image/jpeg' }]);
      // Raw R2 bytes, fetched directly by storageKey (NOT through
      // FilesService — that would need tenant context that's no longer
      // active once this transaction has closed, see the method's own
      // comment) — same async-iterable Body shape AWS SDK v3 returns.
      (service as any).r2.send = jest.fn().mockResolvedValue({ Body: (async function* () { yield Buffer.from('fake-image-bytes'); })() });

      await service.handleUpdate(msg('📄 Файл з усіма товарами'));

      // Scoped to ALL products (no sourcingCategoryId filter) — "чому тільки 156 коли в каталозі 327".
      expect(tx.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null } }));
      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Генерую'));
      expect((service as any).r2.send).toHaveBeenCalled();

      const [renderedHtml] = mockRenderHtmlToPdf.mock.calls[0];
      expect(renderedHtml).toContain('K00285');
      expect(renderedHtml).toContain('data:image/jpeg;base64,');
      // New "Можливі постачальники" column (2026-11-09) — category-scoped candidates, not product-scoped.
      expect(tx.sourcingCandidateSupplier.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { categoryId: { in: ['cat1'] }, deletedAt: null } }));
      expect(renderedHtml).toContain('Можливі постачальники');
      expect(renderedHtml).toContain('UKR-METIZ');

      expect(telegram.sendDocument).toHaveBeenCalledWith(
        chatId,
        expect.anything(),
        expect.stringMatching(/^catalog-export-\d{4}-\d{2}-\d{2}\.pdf$/),
        expect.stringContaining('2 товарів, 1 з фото'),
      );
      const buffer = telegram.sendDocument.mock.calls[0][1];
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('reports empty state when the catalog is empty, without rendering a PDF', async () => {
      tx.product.findMany.mockResolvedValue([]);

      await service.handleUpdate(msg('📄 Файл з усіма товарами'));

      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('немає жодного'));
      expect(mockRenderHtmlToPdf).not.toHaveBeenCalled();
      expect(telegram.sendDocument).not.toHaveBeenCalled();
    });

    it('tells the user and does not send anything if PDF rendering itself fails', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'prod1', article: 'K1', name: 'X', germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null, sourcingCategory: null, suppliers: [] },
      ]);
      mockRenderHtmlToPdf.mockRejectedValue(new Error('chromium crashed'));

      await service.handleUpdate(msg('📄 Файл з усіма товарами'));

      expect(telegram.sendMessage).toHaveBeenCalledWith(chatId, expect.stringContaining('Не вдалося згенерувати'));
      expect(telegram.sendDocument).not.toHaveBeenCalled();
    });
  });
});
