import { LowStockDigestService } from './low-stock-digest.service';

describe('LowStockDigestService — ported from dailyLowStockDigest_ (Automation.gs)', () => {
  let service: LowStockDigestService;
  let prisma: any;
  let emailService: any;
  const user = { userId: 'u1', companyId: 'c1', email: 'a@b.com', roleId: 'r1' };

  beforeEach(() => {
    prisma = {
      tenant: {
        product: { findMany: jest.fn().mockResolvedValue([]) },
        stockMovement: { findMany: jest.fn().mockResolvedValue([]) },
        companySettings: { findUnique: jest.fn() },
      },
    };
    emailService = { send: jest.fn().mockResolvedValue({ sent: true }) };
    service = new LowStockDigestService(prisma, emailService);
  });

  describe('buildDigestContent', () => {
    it('reports "all clear" when nothing is low and nothing is forecast to run out soon', async () => {
      const content = await service.buildDigestContent();
      expect(content.lowStockCount).toBe(0);
      expect(content.imminentForecastCount).toBe(0);
      expect(content.body).toContain('Усе в нормі');
    });

    it('lists products below minQty', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([
        { id: 'p1', article: 'A1', name: 'Bolt', qty: 2, minQty: 10 },
        { id: 'p2', article: 'A2', name: 'Nut', qty: 20, minQty: 5 }, // not low
      ]);
      const content = await service.buildDigestContent();
      expect(content.lowStockCount).toBe(1);
      expect(content.body).toContain('A1 — Bolt: 2 (мін. 10)');
    });

    it('only includes forecast lines whose daysUntilEmpty is within the 14-day digest horizon', async () => {
      prisma.tenant.product.findMany.mockResolvedValue([
        { id: 'p1', article: 'FAST', name: 'Fast burner', qty: 10, minQty: 0 }, // consumes fast -> within 14 days
        { id: 'p2', article: 'SLOW', name: 'Slow burner', qty: 10000, minQty: 0 }, // consumes slowly -> beyond 14 days
      ]);
      // 60-day lookback: FAST consumed 600 units total -> 10/day -> 10 qty / 10/day = 1 day left.
      // SLOW consumed 60 units total -> 1/day -> 10000 qty / 1/day = 10000 days left.
      prisma.tenant.stockMovement.findMany.mockResolvedValue([
        { productId: 'p1', qtyDelta: -600 },
        { productId: 'p2', qtyDelta: -60 },
      ]);

      const content = await service.buildDigestContent();
      expect(content.imminentForecastCount).toBe(1);
      expect(content.body).toContain('FAST');
      expect(content.body).not.toContain('SLOW');
    });
  });

  describe('sendDigestForCompany', () => {
    it('does not send when the digest is disabled', async () => {
      prisma.tenant.companySettings.findUnique.mockResolvedValue({ dailyDigestEnabled: false, dailyDigestEmail: 'a@b.com' });
      const result = await service.sendDigestForCompany(user);
      expect(result.sent).toBe(false);
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('does not send when no destination email is configured, even if enabled', async () => {
      prisma.tenant.companySettings.findUnique.mockResolvedValue({ dailyDigestEnabled: true, dailyDigestEmail: null });
      const result = await service.sendDigestForCompany(user);
      expect(result.sent).toBe(false);
      expect(emailService.send).not.toHaveBeenCalled();
    });

    it('builds and sends the digest when enabled with a destination email', async () => {
      prisma.tenant.companySettings.findUnique.mockResolvedValue({ dailyDigestEnabled: true, dailyDigestEmail: 'owner@acme.test' });

      const result = await service.sendDigestForCompany(user);

      expect(emailService.send).toHaveBeenCalledWith('owner@acme.test', expect.stringContaining('SH ERP'), expect.any(String));
      expect(result.sent).toBe(true);
    });
  });
});
