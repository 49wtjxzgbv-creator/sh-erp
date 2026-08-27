import { QuotationsService } from './quotations.service';
import { QuotationPricingService } from './quotation-pricing.service';

const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

function makeFakePrisma() {
  const db = {
    customer: new Map<string, any>(),
    assembly: new Map<string, any>(),
    product: new Map<string, any>(),
    quotationTemplate: new Map<string, any>(),
    quotation: new Map<string, any>(),
    quotationVersion: new Map<string, any>(),
    quotationVersionItem: new Map<string, any>(),
    company: new Map<string, any>(),
    role: new Map<string, any>(),
    customerOrder: new Map<string, any>(),
  };
  let n = 0;
  const nextId = (prefix: string) => `${prefix}-${++n}`;

  const hydrateVersion = (v: any) => ({
    ...v,
    items: [...db.quotationVersionItem.values()]
      .filter((i) => i.quotationVersionId === v.id)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  });

  const tenant = {
    customer: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.customer.get(id) ?? null)),
    },
    assembly: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.assembly.get(id) ?? null)),
    },
    product: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.product.get(id) ?? null)),
    },
    company: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.company.get(id) ?? null)),
    },
    role: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.role.get(id) ?? null)),
    },
    quotationTemplate: {
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.quotationTemplate.get(id) ?? null)),
      findFirst: jest.fn(() => Promise.resolve([...db.quotationTemplate.values()].find((t) => t.isDefault) ?? null)),
    },
    quotation: {
      create: jest.fn(({ data }: any) => {
        const row = { id: nextId('q'), status: 'DRAFT', ...data };
        db.quotation.set(row.id, row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn(({ where: { id } }: any) => {
        const row = db.quotation.get(id);
        if (!row) return Promise.resolve(null);
        const versions = [...db.quotationVersion.values()]
          .filter((v) => v.quotationId === id)
          .sort((a, b) => b.versionNumber - a.versionNumber)
          .map(hydrateVersion);
        return Promise.resolve({ ...row, customer: db.customer.get(row.customerId) ?? null, versions });
      }),
      findMany: jest.fn(({ where, take = 50, skip = 0 }: any) => {
        let rows = [...db.quotation.values()];
        if (where?.status) rows = rows.filter((r) => r.status === where.status);
        if (where?.customerId) rows = rows.filter((r) => r.customerId === where.customerId);
        rows = rows
          .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
          .slice(skip, skip + take)
          .map((row) => ({
            ...row,
            customer: db.customer.get(row.customerId) ?? { name: '' },
            versions: [...db.quotationVersion.values()].filter((v) => v.quotationId === row.id).sort((a, b) => b.versionNumber - a.versionNumber).slice(0, 1),
          }));
        return Promise.resolve(rows);
      }),
      count: jest.fn(() => Promise.resolve(db.quotation.size)),
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = db.quotation.get(id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    quotationVersion: {
      create: jest.fn(({ data }: any) => {
        const row = { id: nextId('qv'), sentAt: null, viewedAt: null, acceptedAt: null, rejectedAt: null, ...data };
        db.quotationVersion.set(row.id, row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where: { quotationId } }: any) => {
        const rows = [...db.quotationVersion.values()].filter((v) => v.quotationId === quotationId).sort((a, b) => b.versionNumber - a.versionNumber);
        return Promise.resolve(rows[0] ?? null);
      }),
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = db.quotationVersion.get(id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    quotationVersionItem: {
      create: jest.fn(({ data }: any) => {
        const row = { id: nextId('qvi'), ...data };
        db.quotationVersionItem.set(row.id, row);
        return Promise.resolve(row);
      }),
      deleteMany: jest.fn(({ where: { quotationVersionId } }: any) => {
        for (const [id, row] of db.quotationVersionItem) if (row.quotationVersionId === quotationVersionId) db.quotationVersionItem.delete(id);
        return Promise.resolve({ count: 0 });
      }),
      findMany: jest.fn(({ where: { quotationVersionId } }: any) =>
        Promise.resolve([...db.quotationVersionItem.values()].filter((i) => i.quotationVersionId === quotationVersionId).sort((a, b) => a.sortOrder - b.sortOrder)),
      ),
      findUnique: jest.fn(({ where: { id } }: any) => Promise.resolve(db.quotationVersionItem.get(id) ?? null)),
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = db.quotationVersionItem.get(id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    customerOrder: {
      update: jest.fn(({ where: { id }, data }: any) => {
        const row = db.customerOrder.get(id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };

  return { prisma: { tenant }, db, nextId };
}

function makeService() {
  const { prisma, db, nextId } = makeFakePrisma();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  let numberCounter = 0;
  const numbering = { nextQuotationNumber: jest.fn(() => Promise.resolve(`КП-2026-${String(++numberCounter).padStart(4, '0')}`)) };
  const pricing = new QuotationPricingService();
  const assemblies = { calculateCost: jest.fn() };
  const pdf = { generateAndStore: jest.fn().mockResolvedValue('pdf-file-1') };

  db.company.set('c1', { id: 'c1', name: 'Acme' });
  // full permission grant by default — tests that need the stripped view override this role's permissions directly
  db.role.set('r1', { permissions: [{ permission: { key: 'quotations:view-margin' } }] });
  db.customer.set('cust-1', { id: 'cust-1', name: 'Client LLC' });

  const customerOrdersService = {
    // Minimal stand-in for the real CustomerOrdersService#create (sales/customer-orders.service.ts)
    // — enough of its DTO contract (orderNumber/customerId/clientName/deliveryCost/otherCost/comment/items)
    // to exercise convertToOrder's own mapping logic without dragging in that service's full dependency graph.
    create: jest.fn((_user: any, dto: any) => {
      const order = { id: nextId('co'), orderNumber: dto.orderNumber, customerId: dto.customerId, clientName: dto.clientName, deliveryCost: dto.deliveryCost ?? null, otherCost: dto.otherCost ?? null, comment: dto.comment, items: dto.items };
      db.customerOrder.set(order.id, order);
      return Promise.resolve(order);
    }),
  };
  const renderer = { renderHtml: jest.fn(() => '<html>fake</html>') };
  const files = { getDownloadUrl: jest.fn().mockResolvedValue({ downloadUrl: 'https://files.example.com/logo.png' }) };

  const service = new QuotationsService(prisma as any, audit as any, numbering as any, pricing, assemblies as any, pdf as any, customerOrdersService as any, renderer as any, files as any);
  return { service, db, audit, numbering, assemblies, pdf, customerOrdersService, renderer, files, nextId };
}

describe('QuotationsService', () => {
  it('create makes a DRAFT quotation with a version-1 DRAFT version', async () => {
    const { service } = makeService();
    const result = await service.create(user, { customerId: 'cust-1' } as any);
    expect(result.status).toBe('DRAFT');
    expect(result.currentVersion.versionNumber).toBe(1);
    expect(result.currentVersion.sentAt).toBeNull();
  });

  describe('saveItems — resolution and editability', () => {
    it('resolves an ASSEMBLY item using live cost + baseSalePriceEur at save time', async () => {
      const { service, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'Cabinet X', baseSalePriceEur: 12000 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 8000, breakdown: [] });

      const q = await service.create(user, { customerId: 'cust-1' } as any);
      const saved = await service.saveItems(user, q.id, {
        items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'MARKUP_PERCENT', pricingPercent: 25 }],
      } as any);

      const item = saved.currentVersion.items[0];
      expect(item.nameSnapshot).toBe('Cabinet X');
      expect(Number(item.costSnapshot)).toBe(8000);
      expect(Number(item.basePriceSnapshot)).toBe(12000);
      expect(Number(item.unitPrice)).toBe(10000); // 8000 * 1.25 — markup, not margin
      expect(saved.currentVersion.total).toBe(10000);
    });

    it('a stray belowCostApproved on the input is ignored — resolveItem always starts a fresh item unapproved', async () => {
      const { service, db } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      const saved = await service.saveItems(user, q.id, {
        items: [{ kind: 'CUSTOM', nameSnapshot: 'Custom line', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 10, belowCostApproved: true } as any],
      } as any);
      expect(saved.currentVersion.items[0].belowCostApproved).toBe(false);
    });

    it('saveItems/updateVersionTerms reject once the current version is locked (sentAt set)', async () => {
      const { service, db } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'CUSTOM', nameSnapshot: 'X', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 10 }] } as any);
      await service.send(user, q.id);

      await expect(service.saveItems(user, q.id, { items: [{ kind: 'CUSTOM', nameSnapshot: 'Y', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 20 }] } as any)).rejects.toThrow();
      await expect(service.updateVersionTerms(user, q.id, { notes: 'nope' } as any)).rejects.toThrow();
    });
  });

  describe('send() — below-cost gate and PDF-linked locking', () => {
    it('blocks send when a below-cost line has not been approved', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, {
        items: [{ kind: 'CUSTOM', nameSnapshot: 'Underpriced', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 50 }],
      } as any);
      // No cost was supplied for a CUSTOM line, so simulate a below-cost item directly via a second save with an ASSEMBLY line.
      const { service: svc2, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 500, breakdown: [] });
      const q2 = await svc2.create(user, { customerId: 'cust-1' } as any);
      await svc2.saveItems(user, q2.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 100 }] } as any);

      await expect(svc2.send(user, q2.id)).rejects.toThrow();
    });

    it('send() succeeds once the below-cost line is explicitly approved, and locks the version', async () => {
      const { service, db, assemblies, pdf } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 500, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      const saved = await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 100 }] } as any);
      const itemId = saved.currentVersion.items[0].id;

      await service.approveBelowCost(user, q.id, itemId);
      const result = await service.send(user, q.id);

      expect(result.status).toBe('SENT');
      expect(result.currentVersion.sentAt).not.toBeNull();
      expect(result.currentVersion.pdfFileId).toBe('pdf-file-1');
      expect(pdf.generateAndStore).toHaveBeenCalledTimes(1);
    });

    it('rejects sending a version with no items', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await expect(service.send(user, q.id)).rejects.toThrow();
    });
  });

  describe('snapshot independence — a sent version must never change when the live Assembly changes afterward', () => {
    it('costSnapshot/basePriceSnapshot/nameSnapshot on a SENT version stay frozen after the Assembly is edited', async () => {
      const { service, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'Cabinet X', baseSalePriceEur: 12000 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 8000, breakdown: [] });

      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'BASE_PRICE' }] } as any);
      const sent = await service.send(user, q.id);
      const frozenItem = sent.currentVersion.items[0];

      // Now the live Assembly changes underneath — name, cost, and base price all move.
      const assembly = db.assembly.get('asm-1');
      assembly.name = 'Cabinet X — v2 redesign';
      assembly.baseSalePriceEur = 20000;
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 15000, breakdown: [] });

      const reread = await service.findOne(user, q.id);
      const rereadItem = reread.currentVersion.items[0];
      expect(rereadItem.id).toBe(frozenItem.id);
      expect(rereadItem.nameSnapshot).toBe('Cabinet X');
      expect(Number(rereadItem.costSnapshot)).toBe(8000);
      expect(Number(rereadItem.basePriceSnapshot)).toBe(12000);
      expect(Number(rereadItem.unitPrice)).toBe(12000);
    });
  });

  describe('createNewVersion — the only path to edit after SENT', () => {
    it('appends versionNumber+1 as a fresh DRAFT, copies items, and leaves the sent version untouched', async () => {
      const { service, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 60, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 2, pricingSource: 'BASE_PRICE' }] } as any);
      const sent = await service.send(user, q.id);
      const sentVersionId = sent.currentVersion.id;

      const withNewVersion = await service.createNewVersion(user, q.id);
      expect(withNewVersion.status).toBe('DRAFT');
      expect(withNewVersion.currentVersion.versionNumber).toBe(2);
      expect(withNewVersion.currentVersion.sentAt).toBeNull();
      expect(withNewVersion.currentVersion.items).toHaveLength(1);
      expect(withNewVersion.currentVersion.items[0].nameSnapshot).toBe('A');

      const oldVersion = withNewVersion.versionHistory.find((v: any) => v.id === sentVersionId);
      expect(oldVersion.sentAt).not.toBeNull();
      expect(oldVersion.versionNumber).toBe(1);
    });

    it('refuses to create a new version while the current one is still an editable draft', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await expect(service.createNewVersion(user, q.id)).rejects.toThrow();
    });
  });

  describe('duplicate — a genuinely new document, not a new version', () => {
    it('creates a new id/number/DRAFT version-1 document, with items copied and re-unapproved', async () => {
      const { service, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 500, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      const saved = await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 100 }] } as any);
      await service.approveBelowCost(user, q.id, saved.currentVersion.items[0].id);

      const dup = await service.duplicate(user, q.id);
      expect(dup.id).not.toBe(q.id);
      expect(dup.number).not.toBe(saved.number);
      expect(dup.status).toBe('DRAFT');
      expect(dup.currentVersion.versionNumber).toBe(1);
      expect(dup.currentVersion.items[0].belowCostApproved).toBe(false);
      expect(dup.duplicatedFromId).toBe(q.id);
    });
  });

  describe('accept/reject/markViewed — decide against the specific current version', () => {
    it('markViewed transitions SENT to VIEWED and stamps the current version, then is a no-op on repeat', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'CUSTOM', nameSnapshot: 'X', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 10 }] } as any);
      await service.send(user, q.id);

      const viewed = await service.markViewed(user, q.id);
      expect(viewed.status).toBe('VIEWED');
      expect(viewed.currentVersion.viewedAt).not.toBeNull();

      const again = await service.markViewed(user, q.id);
      expect(again.status).toBe('VIEWED');
    });

    it('accept stamps acceptedAt on the current version and sets status ACCEPTED', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'CUSTOM', nameSnapshot: 'X', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 10 }] } as any);
      await service.send(user, q.id);

      const accepted = await service.accept(user, q.id);
      expect(accepted.status).toBe('ACCEPTED');
      expect(accepted.currentVersion.acceptedAt).not.toBeNull();
    });

    it('reject cannot be called on a DRAFT quotation that was never sent', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await expect(service.reject(user, q.id)).rejects.toThrow();
    });
  });

  describe('findOne — internal cost/margin fields are stripped without quotations:view-margin', () => {
    it('strips costSnapshot/basePriceSnapshot/pricingPercent for a role lacking quotations:view-margin, keeps unitPrice/total', async () => {
      const { service, db, assemblies } = makeService();
      db.role.set('r1', { permissions: [] }); // no quotations:view-margin
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 12000 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 8000, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'BASE_PRICE' }] } as any);

      const result = await service.findOne(user, q.id);
      const item = result.currentVersion.items[0];
      expect(item.costSnapshot).toBeNull();
      expect(item.basePriceSnapshot).toBeNull();
      expect(Number(item.unitPrice)).toBe(12000);
    });
  });

  describe('previewHtml — §8: same renderer as send(), works on a still-editable DRAFT', () => {
    it('renders the current version even before it has ever been sent', async () => {
      const { service, db, assemblies, renderer } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 60, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'BASE_PRICE' }] } as any);

      const html = await service.previewHtml(user, q.id);
      expect(html).toBe('<html>fake</html>');
      expect(renderer.renderHtml).toHaveBeenCalledWith(
        expect.objectContaining({ number: q.number, items: [expect.objectContaining({ nameSnapshot: 'A', unitPrice: 100 })] }),
      );
    });

    it('reflects the SAME data after send() — no separate "unsaved" preview state', async () => {
      const { service, db, assemblies, renderer } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 60, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'BASE_PRICE' }] } as any);
      await service.send(user, q.id);

      renderer.renderHtml.mockClear();
      const html = await service.previewHtml(user, q.id);
      expect(html).toBe('<html>fake</html>');
      expect(renderer.renderHtml).toHaveBeenCalledTimes(1);
    });
  });

  describe('convertToOrder — §12: accepted-version snapshot, never live prices', () => {
    it('creates a CustomerOrder from ASSEMBLY lines, folds DELIVERY into deliveryCost and CUSTOM into otherCost+comment', async () => {
      const { service, db, assemblies, customerOrdersService } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'Cabinet', baseSalePriceEur: 1000 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 600, breakdown: [] });

      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, {
        items: [
          { kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 3, pricingSource: 'BASE_PRICE' },
          { kind: 'DELIVERY', nameSnapshot: 'Доставка', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 200 },
          { kind: 'CUSTOM', nameSnapshot: 'Монтаж під ключ', quantity: 1, pricingSource: 'CUSTOM', customUnitPrice: 300 },
        ],
      } as any);
      await service.send(user, q.id);
      await service.accept(user, q.id);

      const { customerOrderId, warnings } = await service.convertToOrder(user, q.id);
      expect(warnings).toEqual([]);
      expect(customerOrdersService.create).toHaveBeenCalledTimes(1);
      const dto = customerOrdersService.create.mock.calls[0][1];
      expect(dto.items).toEqual([{ assemblyId: 'asm-1', qty: 3 }]);
      expect(dto.deliveryCost).toBe(200);
      expect(dto.otherCost).toBe(300);
      expect(dto.comment).toContain('Монтаж під ключ');

      const order = db.customerOrder.get(customerOrderId);
      expect(order.customerId).toBe('cust-1');

      const reloaded = await service.findOne(user, q.id);
      expect(reloaded.convertedCustomerOrderId).toBe(customerOrderId);
    });

    it('skips a deleted Assembly with a warning instead of failing the whole conversion', async () => {
      const { service, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'Cabinet', baseSalePriceEur: 1000, deletedAt: null });
      db.assembly.set('asm-2', { id: 'asm-2', name: 'Doomed shelf', baseSalePriceEur: 200, deletedAt: new Date() });
      assemblies.calculateCost.mockImplementation((_user: any, assemblyId: string) =>
        Promise.resolve({ assemblyId, costPerUnit: assemblyId === 'asm-1' ? 600 : 100, breakdown: [] }),
      );

      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, {
        items: [
          { kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'BASE_PRICE' },
          { kind: 'ASSEMBLY', assemblyId: 'asm-2', quantity: 1, pricingSource: 'BASE_PRICE' },
        ],
      } as any);
      await service.send(user, q.id);
      await service.accept(user, q.id);

      const { warnings } = await service.convertToOrder(user, q.id);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Doomed shelf');
    });

    it('refuses to convert a quotation that is not ACCEPTED', async () => {
      const { service } = makeService();
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await expect(service.convertToOrder(user, q.id)).rejects.toThrow();
    });

    it('refuses to convert the same quotation twice', async () => {
      const { service, db, assemblies } = makeService();
      db.assembly.set('asm-1', { id: 'asm-1', name: 'A', baseSalePriceEur: 100 });
      assemblies.calculateCost.mockResolvedValue({ assemblyId: 'asm-1', costPerUnit: 50, breakdown: [] });
      const q = await service.create(user, { customerId: 'cust-1' } as any);
      await service.saveItems(user, q.id, { items: [{ kind: 'ASSEMBLY', assemblyId: 'asm-1', quantity: 1, pricingSource: 'BASE_PRICE' }] } as any);
      await service.send(user, q.id);
      await service.accept(user, q.id);
      await service.convertToOrder(user, q.id);

      await expect(service.convertToOrder(user, q.id)).rejects.toThrow();
    });
  });
});
