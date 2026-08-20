import { AuditService } from './audit.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      auditEvent: { create: jest.fn() },
      tenant: {
        auditEvent: {
          findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]),
          count: jest.fn().mockResolvedValue(1),
        },
      },
      // record() now opens its own transaction and sets
      // app.current_company_id itself (real RLS enforcement on
      // audit_events means an insert with no company context set at all
      // is rejected) — the tx client reuses the same `auditEvent` mock
      // above so assertions on `prisma.auditEvent.create` keep working
      // unchanged.
      $transaction: jest.fn((cb: (tx: any) => Promise<void>) => cb({ $executeRawUnsafe: jest.fn(), auditEvent: prisma.auditEvent })),
    };
    service = new AuditService(prisma);
  });

  it('record() writes companyId, actorUserId, action, entityType/Id verbatim', async () => {
    await service.record({
      companyId: 'c1',
      actorUserId: 'u1',
      action: 'product.price_changed',
      entityType: 'Product',
      entityId: 'p1',
      before: { price: 10 },
      after: { price: 12 },
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'c1',
        actorUserId: 'u1',
        action: 'product.price_changed',
        entityType: 'Product',
        entityId: 'p1',
        before: { price: 10 },
        after: { price: 12 },
      }),
    });
  });

  it('record() defaults actorUserId to null for system/job-initiated events', async () => {
    await service.record({
      companyId: 'c1',
      action: 'stock.reconciled',
      entityType: 'InventorySession',
      entityId: 's1',
    });
    const call = prisma.auditEvent.create.mock.calls[0][0];
    expect(call.data.actorUserId).toBeNull();
  });

  it('query() applies entityType/action/actorUserId/date filters and pagination defaults', async () => {
    const result = await service.query({} as any, { entityType: 'Product', limit: 10, offset: 5 });
    expect(prisma.tenant.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityType: 'Product' }),
        take: 10,
        skip: 5,
      }),
    );
    expect(result).toEqual({ items: [{ id: 'e1' }], total: 1, limit: 10, offset: 5 });
  });

  it('query() defaults to limit 50, offset 0 when unspecified', async () => {
    await service.query({} as any, {});
    expect(prisma.tenant.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0 }),
    );
  });
});
