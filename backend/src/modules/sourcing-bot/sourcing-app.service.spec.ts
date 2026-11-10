import { SourcingAppService } from './sourcing-app.service';

describe('SourcingAppService (2026-11-10 — Mini App API)', () => {
  let prisma: any;
  let filesService: any;
  let aiSettingsService: any;
  let geminiAdapter: any;
  let deepSeekAdapter: any;
  let tx: any;
  let service: SourcingAppService;

  const identity = { userId: 'u1', companyId: 'c1', fullName: 'Іван', isAdmin: false };

  beforeEach(() => {
    tx = {
      sourcingCategory: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      product: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      productSupplier: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      sourcingCandidateSupplier: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
      sourcingOutreach: { update: jest.fn(), create: jest.fn() },
      assembly: { findMany: jest.fn().mockResolvedValue([]) },
      assemblyComponent: { findMany: jest.fn().mockResolvedValue([]) },
      sourcingNote: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), deleteMany: jest.fn() },
      sourcingPriceProposal: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    };
    prisma = { runInTenantTransaction: jest.fn((_ctx: unknown, work: (tx: unknown) => unknown) => work(tx)) };
    filesService = {
      getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://example.test/photo.jpg' }),
      listForEntities: jest.fn().mockResolvedValue({}),
    };
    aiSettingsService = {
      getProvider: jest.fn().mockResolvedValue('gemini'),
      getEffectiveApiKey: jest.fn().mockResolvedValue('test-gemini-key'),
    };
    geminiAdapter = { generateContent: jest.fn().mockResolvedValue({ message: { role: 'model', parts: [{ text: 'Перекладена назва' }] } }) };
    deepSeekAdapter = { generateContent: jest.fn().mockResolvedValue({ message: { role: 'model', parts: [{ text: 'Перекладена назва (DeepSeek)' }] } }) };
    service = new SourcingAppService(prisma, filesService, aiSettingsService, geminiAdapter, deepSeekAdapter);
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
        { id: 'p1', article: '0013', name: 'Шуруповерт', germanPriceExclVat: 10, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: 15, weightPerUnitKg: 1.5, _count: { suppliers: 2 } },
      ]);

      const result = await service.getCategoryProducts(identity as any, 'cat1', 'шуруп', 0);

      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ sourcingCategoryId: 'cat1', OR: expect.any(Array) }) });
      expect(result.total).toBe(45);
      expect(result.hasMore).toBe(true);
      expect(result.items[0]).toMatchObject({ id: 'p1', article: '0013', supplierCount: 2, weightKg: 1.5 });
      expect(result.items[0].prices).toEqual([
        { field: 'germanPriceExclVat', icon: '🇩🇪', label: 'DE без ПДВ', value: 10 },
        { field: 'sellPriceEur', icon: '💰', label: 'Наша ціна продажу', value: 15 },
      ]);
    });

    // "до кожного товару ще додати вагу" (2026-11-11)
    it('is null when the product has no weight set', async () => {
      tx.product.findMany.mockResolvedValue([
        { id: 'p1', article: '0013', name: 'Шуруповерт', germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null, weightPerUnitKg: null, _count: { suppliers: 0 } },
      ]);
      const result = await service.getCategoryProducts(identity as any, 'cat1', undefined, 0);
      expect(result.items[0].weightKg).toBeNull();
    });

    it('the "all" sentinel id browses every category\'s products, not just one (2026-11-10 — "категорія всі")', async () => {
      await service.getCategoryProducts(identity as any, 'all', undefined, 0);
      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ sourcingCategoryId: { not: null } }) });
    });

    // "фільтри в списку товарів — лише без жодного постачальника / лише без ціни" (2026-11-10)
    it('filter=noSupplier adds a suppliers:{none:{}} clause', async () => {
      await service.getCategoryProducts(identity as any, 'cat1', undefined, 0, 'noSupplier');
      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ suppliers: { none: {} } }) });
    });

    it('filter=noPrice adds a sellPriceEur:null clause', async () => {
      await service.getCategoryProducts(identity as any, 'cat1', undefined, 0, 'noPrice');
      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ sellPriceEur: null }) });
    });

    it('an unrecognized filter value is ignored (no extra clause)', async () => {
      await service.getCategoryProducts(identity as any, 'cat1', undefined, 0, 'bogus');
      const where = tx.product.count.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('suppliers');
      expect(where).not.toHaveProperty('sellPriceEur');
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
        germanPriceExclVat: 10, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: 15, weightPerUnitKg: 0.35,
      });
      tx.productSupplier.findMany.mockResolvedValue([{ price: 12, supplierOfferedPrice: 11, supplier: { id: 's1', name: 'ARGIP' } }]);
      tx.fileAsset.findMany.mockResolvedValue([{ id: 'file1' }]);
      tx.sourcingCandidateSupplier.findMany.mockResolvedValue([{ id: 'cand1', name: 'НовийПостач', region: null, location: null, phone: null, email: null, website: null, whatTheyDo: null, outreach: { status: 'CONTACTED' } }]);
      tx.sourcingCategory.findUnique.mockResolvedValue({ id: 'cat1', name: 'А. Метизи', rfqTemplate: 'Доброго дня!' });

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(result.realSuppliers).toEqual([{ id: 's1', name: 'ARGIP', ourPrice: 12, supplierOfferedPrice: 11, pendingProposal: null }]);
      expect(result.candidateSuppliers[0]).toMatchObject({ id: 'cand1', status: 'CONTACTED', statusLabel: '✉️ Написали' });
      expect(result.category).toEqual({ id: 'cat1', name: 'А. Метизи', rfqTemplate: 'Доброго дня!' });
      expect(result.photoUrls).toEqual(['https://example.test/photo.jpg']);
      expect(result.modelUrl).toBeNull();
      expect(result.weightKg).toBe(0.35);
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
        p1: [{ id: 'f1', originalName: 'part.glb', downloadUrl: 'https://example.test/part.glb', optimizedDownloadUrl: 'https://example.test/part-optimized.glb' }],
      });

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(filesService.listForEntities).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', companyId: 'c1' }), 'Product', ['p1'], ['PRODUCT_DOCUMENT']);
      expect(result.modelUrl).toBe('https://example.test/part-optimized.glb');
    });

    it('pulls in PDF/DXF documents (2026-11-10 — "щоб у картку товару підтягувався пдф файл і dxf") without listing the model file again as a document', async () => {
      tx.product.findUnique.mockResolvedValue({ id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: null, germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null });
      filesService.listForEntities.mockResolvedValue({
        p1: [
          { id: 'f1', originalName: 'part.glb', downloadUrl: 'https://example.test/part.glb' },
          { id: 'f2', originalName: 'drawing.pdf', downloadUrl: 'https://example.test/drawing.pdf' },
          { id: 'f3', originalName: 'part.dxf', downloadUrl: 'https://example.test/part.dxf' },
          { id: 'f4', originalName: 'readme.txt', downloadUrl: 'https://example.test/readme.txt' },
        ],
      });

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(result.modelUrl).toBe('https://example.test/part.glb');
      expect(result.documents).toEqual([
        { id: 'f2', name: 'drawing.pdf', url: 'https://example.test/drawing.pdf' },
        { id: 'f3', name: 'part.dxf', url: 'https://example.test/part.dxf' },
      ]);
    });

    // "в описі також має писати до якого виробу специфікації він належить"
    // (2026-11-10)
    it('lists every виріб (Assembly) this product is a direct component of, deduped, with photo', async () => {
      tx.product.findUnique.mockResolvedValue({ id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: null, germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null });
      tx.assemblyComponent.findMany.mockResolvedValue([
        { assembly: { id: 'asm1', name: 'Моноблок А', article: 'M-A' } },
        { assembly: { id: 'asm1', name: 'Моноблок А', article: 'M-A' } }, // same assembly twice (e.g. two BOM lines) — must not duplicate
        { assembly: { id: 'asm2', name: 'Моноблок Б', article: null } },
      ]);
      tx.fileAsset.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.entityType === 'Assembly' && where.entityId?.in?.includes('asm1') ? [{ id: 'photo1', entityId: 'asm1' }] : []),
      );

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(tx.assemblyComponent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: 'p1', componentType: 'PRODUCT', assembly: { deletedAt: null } } }),
      );
      expect(result.usedInAssemblies).toEqual([
        { id: 'asm1', name: 'Моноблок А', article: 'M-A', photoUrl: 'https://example.test/photo.jpg' },
        { id: 'asm2', name: 'Моноблок Б', article: null, photoUrl: null },
      ]);
    });

    // "нотатки до товару/постачальника... видимий усій команді" (2026-11-10)
    it('includes the team-shared note when one exists, null otherwise', async () => {
      tx.product.findUnique.mockResolvedValue({ id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: null, germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null });
      tx.sourcingNote.findMany.mockResolvedValue([{ entityId: 'p1', note: 'Перевірити зразок перед замовленням', updatedAt: new Date() }]);

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(tx.sourcingNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { entityType: 'Product', entityId: { in: ['p1'] } } }),
      );
      expect(result.note).toBe('Перевірити зразок перед замовленням');
    });

    // "правка ціни щоб було тільки через підтвердження в основній erp" (2026-11-10)
    it('attaches the pending price proposal (if any) onto its own real supplier', async () => {
      tx.product.findUnique.mockResolvedValue({ id: 'p1', article: '0013', name: 'Шуруповерт', sourcingCategoryId: null, germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null });
      tx.productSupplier.findMany.mockResolvedValue([{ price: 12, supplierOfferedPrice: null, supplier: { id: 's1', name: 'ARGIP' } }]);
      tx.sourcingPriceProposal.findMany.mockResolvedValue([{ supplierId: 's1', proposedPriceEur: 14.5, note: 'подешевшало' }]);

      const result = await service.getProductDetail(identity as any, 'p1');

      expect(tx.sourcingPriceProposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId: 'p1', status: 'PENDING' } }),
      );
      expect(result.realSuppliers[0].pendingProposal).toEqual({ proposedPriceEur: 14.5, note: 'подешевшало' });
    });
  });

  describe('getAssemblies (2026-11-10 — "пошук товарів не по категоріям а по виробах")', () => {
    it('maps _count.components to a plain componentCount, with no photo', async () => {
      tx.assembly.findMany.mockResolvedValue([{ id: 'asm1', name: 'Моноблок А', article: 'M-A', _count: { components: 7 } }]);
      const result = await service.getAssemblies(identity as any);
      expect(result).toEqual([{ id: 'asm1', name: 'Моноблок А', article: 'M-A', componentCount: 7, photoUrl: null }]);
    });

    it('includes a photoUrl when the assembly has an ASSEMBLY_PHOTO (2026-11-10 — "у списку виробів також має бути фото виробу")', async () => {
      tx.assembly.findMany.mockResolvedValue([{ id: 'asm1', name: 'Моноблок А', article: 'M-A', _count: { components: 7 } }]);
      tx.fileAsset.findMany.mockResolvedValue([{ id: 'file1', entityId: 'asm1' }]);
      const result = await service.getAssemblies(identity as any);
      expect(tx.fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ entityType: 'Assembly', domain: 'ASSEMBLY_PHOTO' }) }));
      expect(result[0].photoUrl).toBe('https://example.test/photo.jpg');
    });
  });

  describe('getAssemblyProducts', () => {
    it('collects direct PRODUCT lines', async () => {
      tx.assemblyComponent.findMany.mockResolvedValue([
        { componentType: 'PRODUCT', productId: 'p1', subAssemblyId: null },
        { componentType: 'PRODUCT', productId: 'p2', subAssemblyId: null },
      ]);
      tx.product.count.mockResolvedValue(2);
      tx.product.findMany.mockResolvedValue([
        { id: 'p1', article: 'A1', name: 'Деталь 1', germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null, _count: { suppliers: 0 } },
        { id: 'p2', article: 'A2', name: 'Деталь 2', germanPriceExclVat: null, germanPriceInclVat: null, localPriceExclVat: null, localPriceInclVat: null, sellPriceEur: null, _count: { suppliers: 0 } },
      ]);

      const result = await service.getAssemblyProducts(identity as any, 'asm1', undefined, 0);

      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ id: { in: expect.arrayContaining(['p1', 'p2']) } }) });
      expect(result.items).toHaveLength(2);
    });

    it('filter=noSupplier/noPrice composes with the flattened id list', async () => {
      tx.assemblyComponent.findMany.mockResolvedValue([{ componentType: 'PRODUCT', productId: 'p1', subAssemblyId: null }]);
      await service.getAssemblyProducts(identity as any, 'asm1', undefined, 0, 'noSupplier');
      expect(tx.product.count).toHaveBeenCalledWith({ where: expect.objectContaining({ suppliers: { none: {} } }) });
    });

    it('recurses through ASSEMBLY lines to collect sub-assembly products too', async () => {
      tx.assemblyComponent.findMany.mockImplementation(({ where }: { where: { assemblyId: string } }) => {
        if (where.assemblyId === 'parent') {
          return Promise.resolve([
            { componentType: 'PRODUCT', productId: 'p1', subAssemblyId: null },
            { componentType: 'ASSEMBLY', productId: null, subAssemblyId: 'child' },
          ]);
        }
        if (where.assemblyId === 'child') {
          return Promise.resolve([{ componentType: 'PRODUCT', productId: 'p2', subAssemblyId: null }]);
        }
        return Promise.resolve([]);
      });
      tx.product.count.mockResolvedValue(2);
      tx.product.findMany.mockResolvedValue([]);

      await service.getAssemblyProducts(identity as any, 'parent', undefined, 0);

      const where = tx.product.count.mock.calls[0][0].where;
      expect(where.id.in).toEqual(expect.arrayContaining(['p1', 'p2']));
      expect(where.id.in).toHaveLength(2);
    });

    it('a circular BOM does not loop forever — same cycle-guard shape as AssembliesService#flattenRequirements', async () => {
      tx.assemblyComponent.findMany.mockImplementation(({ where }: { where: { assemblyId: string } }) => {
        if (where.assemblyId === 'a') return Promise.resolve([{ componentType: 'ASSEMBLY', productId: null, subAssemblyId: 'b' }]);
        if (where.assemblyId === 'b') return Promise.resolve([{ componentType: 'ASSEMBLY', productId: null, subAssemblyId: 'a' }]);
        return Promise.resolve([]);
      });

      await expect(service.getAssemblyProducts(identity as any, 'a', undefined, 0)).resolves.toBeDefined();
    });

    it('returns an empty page without querying products when the assembly has none', async () => {
      tx.assemblyComponent.findMany.mockResolvedValue([]);
      const result = await service.getAssemblyProducts(identity as any, 'asm1', undefined, 0);
      expect(result).toEqual({ items: [], total: 0, page: 0, pageSize: 30, hasMore: false });
      expect(tx.product.count).not.toHaveBeenCalled();
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

    // "цей повний список товарів який відкриваємо у постачальника має бути
    // з фото" (2026-11-10)
    it('attaches a thumbnail photoUrl per product, null when none uploaded', async () => {
      tx.productSupplier.findMany.mockResolvedValue([
        { price: 10, supplierOfferedPrice: null, supplier: { id: 's1', name: 'ARGIP', phone: null, email: null }, product: { id: 'p1', article: 'A1', name: 'Товар 1' } },
        { price: 20, supplierOfferedPrice: null, supplier: { id: 's1', name: 'ARGIP', phone: null, email: null }, product: { id: 'p2', article: 'A2', name: 'Товар 2' } },
      ]);
      tx.fileAsset.findMany.mockResolvedValue([{ id: 'photo1', entityId: 'p1' }]);

      const result = await service.getSuppliers(identity as any);

      const [p1, p2] = result[0].products;
      expect(p1.photoUrl).toBe('https://example.test/photo.jpg');
      expect(p2.photoUrl).toBeNull();
    });

    it('includes the team-shared note on the supplier, null when none exists', async () => {
      tx.productSupplier.findMany.mockResolvedValue([
        { price: 10, supplierOfferedPrice: null, supplier: { id: 's1', name: 'ARGIP', phone: null, email: null }, product: { id: 'p1', article: 'A1', name: 'Товар 1' } },
      ]);
      tx.sourcingNote.findMany.mockResolvedValue([{ entityId: 's1', note: 'Повільна доставка', updatedAt: new Date() }]);

      const result = await service.getSuppliers(identity as any);

      expect(tx.sourcingNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { entityType: 'Supplier', entityId: { in: ['s1'] } } }),
      );
      expect(result[0].note).toBe('Повільна доставка');
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

  describe('createPriceProposal (2026-11-10 — "правка ціни щоб було тільки через підтвердження в основній erp")', () => {
    it('refuses a non-admin, without touching the database', async () => {
      await expect(
        service.createPriceProposal({ ...identity, isAdmin: false } as any, 'p1', 's1', 14.5, undefined),
      ).rejects.toMatchObject({ response: { code: 'SOURCING_PRICE_PROPOSAL_FORBIDDEN' } });
      expect(tx.sourcingPriceProposal.create).not.toHaveBeenCalled();
    });

    it('an admin creates a PENDING proposal — never touches ProductSupplier.price', async () => {
      tx.sourcingPriceProposal.create.mockResolvedValue({ id: 'prop1', status: 'PENDING' });

      const result = await service.createPriceProposal({ ...identity, isAdmin: true } as any, 'p1', 's1', 14.5, 'подешевшало');

      expect(tx.sourcingPriceProposal.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ productId: 'p1', supplierId: 's1', proposedPriceEur: 14.5, note: 'подешевшало', proposedByUserId: 'u1' }) }),
      );
      expect(tx.productSupplier.update).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'prop1', status: 'PENDING' });
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

  describe('translateName (2026-11-10 — "додай можливість перекладу назв товарів на українську")', () => {
    it('uses the platform/company Gemini key and returns the translated text', async () => {
      const result = await service.translateName(identity as any, 'Rillenkugellager-6205-2RS');

      expect(aiSettingsService.getProvider).toHaveBeenCalledWith('c1');
      expect(aiSettingsService.getEffectiveApiKey).toHaveBeenCalledWith('c1');
      expect(geminiAdapter.generateContent).toHaveBeenCalledWith(
        [{ role: 'user', parts: [{ text: expect.stringContaining('Rillenkugellager-6205-2RS') }] }],
        'test-gemini-key',
      );
      expect(result).toEqual({ translated: 'Перекладена назва' });
    });

    // "переклад не працює" (2026-11-10 follow-up) — a company that switched
    // to DeepSeek was still being routed through GeminiAdapter with a
    // Gemini-only key lookup, which silently failed. Routes through
    // DeepSeekAdapter instead whenever that's the company's own provider.
    it('routes through DeepSeekAdapter when that is the company\'s configured provider', async () => {
      aiSettingsService.getProvider.mockResolvedValue('deepseek');
      aiSettingsService.getEffectiveApiKey.mockResolvedValue('test-deepseek-key');

      const result = await service.translateName(identity as any, 'Rillenkugellager-6205-2RS');

      expect(deepSeekAdapter.generateContent).toHaveBeenCalledWith(
        [{ role: 'user', parts: [{ text: expect.stringContaining('Rillenkugellager-6205-2RS') }] }],
        'test-deepseek-key',
      );
      expect(geminiAdapter.generateContent).not.toHaveBeenCalled();
      expect(result).toEqual({ translated: 'Перекладена назва (DeepSeek)' });
    });

    it('throws a coded error when the provider returns no text at all', async () => {
      geminiAdapter.generateContent.mockResolvedValue({ message: { role: 'model', parts: [] } });
      await expect(service.translateName(identity as any, 'test')).rejects.toMatchObject({ response: { code: 'SOURCING_TRANSLATE_EMPTY' } });
    });
  });

  describe('upsertNote (2026-11-10 — "нотатки до товару/постачальника... видимий усій команді")', () => {
    it('upserts a non-empty note by the company/entityType/entityId compound key', async () => {
      const result = await service.upsertNote(identity as any, 'Product', 'p1', '  Перевірити зразок  ');

      expect(tx.sourcingNote.upsert).toHaveBeenCalledWith({
        where: { companyId_entityType_entityId: { companyId: 'c1', entityType: 'Product', entityId: 'p1' } },
        create: { entityType: 'Product', entityId: 'p1', note: 'Перевірити зразок', updatedByUserId: 'u1' },
        update: { note: 'Перевірити зразок', updatedByUserId: 'u1' },
      });
      expect(result).toEqual({ note: 'Перевірити зразок' });
    });

    it('a blank/whitespace-only note deletes the row instead of storing an empty string', async () => {
      const result = await service.upsertNote(identity as any, 'Supplier', 's1', '   ');

      expect(tx.sourcingNote.deleteMany).toHaveBeenCalledWith({ where: { entityType: 'Supplier', entityId: 's1' } });
      expect(tx.sourcingNote.upsert).not.toHaveBeenCalled();
      expect(result).toEqual({ note: null });
    });
  });
});
