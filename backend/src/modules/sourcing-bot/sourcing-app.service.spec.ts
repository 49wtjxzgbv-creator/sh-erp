import { SourcingAppService } from './sourcing-app.service';

describe('SourcingAppService (2026-11-10 — Mini App API)', () => {
  let prisma: any;
  let filesService: any;
  let tx: any;
  let service: SourcingAppService;

  const identity = { userId: 'u1', companyId: 'c1', fullName: 'Іван', isAdmin: false };

  beforeEach(() => {
    tx = {
      sourcingCategory: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      product: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      productSupplier: { findMany: jest.fn().mockResolvedValue([]) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      sourcingCandidateSupplier: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      sourcingOutreach: { update: jest.fn(), create: jest.fn() },
    };
    prisma = { runInTenantTransaction: jest.fn((_ctx: unknown, work: (tx: unknown) => unknown) => work(tx)) };
    filesService = {
      getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.test/photo.jpg' }),
      listForEntities: jest.fn().mockResolvedValue({}),
    };
    service = new SourcingAppService(prisma, filesService);
  });

  describe('getCategories', () => {
    it('maps _count.products to a plain productCount', async () => {
      tx.sourcingCategory.findMany.mockResolvedValue([{ id: 'cat1', code: 'A', name: 'А. Метизи', _count: { products: 112 } }]);
      const result = await service.getCategories(identity as any);
      expect(result).toEqual([{ id: 'cat1', code: 'A', name: 'А. Метизи', productCount: 112 }]);
    });
  });

  describe('getCategoryProducts', () => {
    it('includes the search term in the where clause and reports hasMore from the total', async () => {
      tx.product.count.mockResolvedValue(45);
      tx.product.findMany.mockResolvedValue([
        { id: 'p1', article: '0013', name: 'Шуруповерт', germanPriceExclVat: 10, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: 15, _count: { suppliers: 2 } },
      ]);

      const result = await service.getCategoryProducts(identity as any, 'cat1', 'шуруп', 0);

      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ sourcingCategoryId: 'cat1', OR: expect.any(Array) }) });
      expect(result.total).toBe(45);
      expect(result.hasMore).toBe(true);
      expect(result.items[0]).toMatchObject({ id: 'p1', article: '0013', supplierCount: 2 });
      expect(result.items[0].prices).toEqual([
        { field: 'germanPriceExclVat', icon: '🇩🇪', label: 'DE без ПДВ', value: 10 },
        { field: 'sellPriceEur', icon: '💰', label: 'Наша ціна продажу', value: 15 },
      ]);
    });

    it('the "all" sentinel id browses every category\'s products, not just one (2026-11-10 — "категорія всі")', async () => {
      await service.getCategoryProducts(identity as any, 'all', undefined, 0);
      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ sourcingCategoryId: { not: null } }) });
    });
  });

  describe('getProductDetail', () => {
    it('throws SOURCING_PRODUCT_NOT_FOUND when the product does not exist', async () => {
      tx.product.findUnique.mockResolvedValue(null);
      await expect(service.getProductDetail(identity as any, 'missing')).rejects.toMatchObject({ response: { code: 'SOURCING_PRODUCT_NOT_FOUND' } });
    });

    it('assembles prices, real supplier prices, and category candidate suppliers', async () => {
      tx.product.findUnique.mockResolvedValue({
        id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: 'cat1',
        germanPriceExclVat: 10, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: 15,
      });
      tx.productSupplier.findMany.mockResolvedValue([{ price: 12, supplierOfferedPrice: 11, supplier: { id: 's1', name: 'ARGIP' } }]);
      tx.fileAsset.findMany.mockResolvedValue([{ id: 'file1' }]);
      tx.sourcingCandidateSupplier.findMany.mockResolvedValue([{ id: 'cand1', name: 'НовийПостач', region: null, location: null, phone: null, email: null, website: null, whatTheyDo: null, outreach: { status: 'CONTACTED' } }]);
      tx.sourcingCategory.findUnique.mockResolvedValue({ id: 'cat1', name: 'А. Метизи', rfqTemplate: 'Доброго дня!' });

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(result.realSuppliers).toEqual([{ id: 's1', name: 'ARGIP', ourPrice: 12, supplierOfferedPrice: 11 }]);
      expect(result.candidateSuppliers[0]).toMatchObject({ id: 'cand1', status: 'CONTACTED', statusLabel: '✉️ Написали' });
      expect(result.category).toEqual({ id: 'cat1', name: 'А. Метизи', rfqTemplate: 'Доброго дня!' });
      expect(result.photoUrls).toEqual(['https://example.test/photo.jpg']);
      expect(result.modelUrl).toBeNull();
    });

    it('returns every uploaded photo (not just the newest), newest first', async () => {
      tx.product.findUnique.mockResolvedValue({ id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: null, germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null });
      tx.fileAsset.findMany.mockResolvedValue([{ id: 'file-new' }, { id: 'file-old' }]);
      filesService.getDownloadUrl.mockImplementation((_actor: unknown, fileAssetId: string) =>
        Promise.resolve({ downloadUrl: `https://example.test/${fileAssetId}.jpg` }),
      );

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(result.photoUrls).toEqual(['https://example.test/file-new.jpg', 'https://example.test/file-old.jpg']);
    });

    it('resolves a 3D model URL when the product has a usable PRODUCT_DOCUMENT .glb (optimized variant preferred)', async () => {
      tx.product.findUnique.mockResolvedValue({ id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: null, germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null });
      filesService.listForEntities.mockResolvedValue({
        p1: [{ originalName: 'part.glb', downloadUrl: 'https://example.test/part.glb', optimizedDownloadUrl: 'https://example.test/part-optimized.glb' }],
      });

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(filesService.listForEntities).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', companyId: 'c1' }), 'Product', ['p1'], ['PRODUCT_DOCUMENT']);
      expect(result.modelUrl).toBe('https://example.test/part-optimized.glb');
    });
  });

  describe('getSuppliers', () => {
    it('groups multiple linked products under the same supplier', async () => {
      tx.productSupplier.findMany.mockResolvedValue([
        { price: 10, supplierOfferedPrice: null, supplier: { id: 's1', name: 'ARGIP', phone: null, email: null }, product: { id: 'p1', article: 'A1', name: 'Товар 1' } },
        { price: 20, supplierOfferedPrice: null, supplier: { id: 's1', name: 'ARGIP', phone: null, email: null }, product: { id: 'p2', article: 'A2', name: 'Товар 2' } },
      ]);
      const result = await service.getSuppliers(identity as any);
      expect(result).toHaveLength(1);
      expect(result[0].products).toHaveLength(2);
    });
  });

  describe('getCandidates', () => {
    it('passes the categoryId filter through to the query', async () => {
      await service.getCandidates(identity as any, 'cat1', undefined);
      expect(tx.sourcingCandidateSupplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ categoryId: 'cat1' }) }),
      );
    });
  });

  describe('createCandidate (2026-11-10 — "має бути можливість додавати можливих постачальників")', () => {
    it('refuses a non-admin, without touching the database', async () => {
      await expect(
        service.createCandidate({ ...identity, isAdmin: false } as any, { categoryId: 'cat1', name: 'Новий' } as any),
      ).rejects.toMatchObject({ response: { code: 'SOURCING_CANDIDATE_CREATE_FORBIDDEN' } });
      expect(tx.sourcingCandidateSupplier.create).not.toHaveBeenCalled();
    });

    it('an admin creates the candidate plus its NOT_CONTACTED outreach row', async () => {
      tx.sourcingCandidateSupplier.create.mockResolvedValue({ id: 'cand1' });
      const result = await service.createCandidate({ ...identity, isAdmin: true } as any, {
        categoryId: 'cat1',
        name: 'Новий Постач',
        phone: '+380501112233',
      } as any);

      expect(tx.sourcingCandidateSupplier.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ categoryId: 'cat1', name: 'Новий Постач', phone: '+380501112233', source: 'user_added' }) }),
      );
      expect(tx.sourcingOutreach.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ candidateSupplierId: 'cand1', status: 'NOT_CONTACTED' }) }),
      );
      expect(result).toEqual({ id: 'cand1' });
    });
  });

  describe('updateOutreach', () => {
    it('a status change stamps contactedByUserId/contactedAt', async () => {
      await service.updateOutreach(identity as any, 'cand1', { status: 'CONTACTED' } as any);
      const call = tx.sourcingOutreach.update.mock.calls[0][0];
      expect(call.data).toMatchObject({ status: 'CONTACTED', contactedByUserId: 'u1' });
      expect(call.data.contactedAt).toBeInstanceOf(Date);
    });

    it('a note-only update does NOT stamp contactedByUserId/contactedAt', async () => {
      await service.updateOutreach(identity as any, 'cand1', { note: 'подзвонили, думають' } as any);
      const call = tx.sourcingOutreach.update.mock.calls[0][0];
      expect(call.data).toEqual({ lastNote: 'подзвонили, думають' });
    });

    it('a quoted price with no explicit status auto-sets QUOTE_RECEIVED, mirroring the bot', async () => {
      await service.updateOutreach(identity as any, 'cand1', { quotedPriceEur: 150.5 } as any);
      const call = tx.sourcingOutreach.update.mock.calls[0][0];
      expect(call.data).toMatchObject({ quotedPriceEur: 150.5, status: 'QUOTE_RECEIVED' });
    });

    it('an explicit status wins over the quote auto-status', async () => {
      await service.updateOutreach(identity as any, 'cand1', { status: 'WON', quotedPriceEur: 150.5 } as any);
      const call = tx.sourcingOutreach.update.mock.calls[0][0];
      expect(call.data.status).toBe('WON');
    });
  });

  describe('getStatusOverview', () => {
    it('counts candidates per status, defaulting missing outreach to NOT_CONTACTED', async () => {
      tx.sourcingCandidateSupplier.findMany.mockResolvedValue([
        { id: 'c1', name: 'A', category: { name: 'Cat' }, outreach: { status: 'CONTACTED' } },
        { id: 'c2', name: 'B', category: { name: 'Cat' }, outreach: null },
      ]);
      const result = await service.getStatusOverview(identity as any);
      expect(result.counts.CONTACTED).toBe(1);
      expect(result.counts.NOT_CONTACTED).toBe(1);
      expect(result.items).toHaveLength(2);
    });
  });
});
