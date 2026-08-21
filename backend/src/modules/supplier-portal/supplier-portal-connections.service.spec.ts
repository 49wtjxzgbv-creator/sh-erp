import { SupplierPortalConnectionsService } from './supplier-portal-connections.service';

describe('SupplierPortalConnectionsService', () => {
  let service: SupplierPortalConnectionsService;
  let prisma: any;
  const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1' } as any;

  beforeEach(() => {
    prisma = {
      supplierConnection: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new SupplierPortalConnectionsService(prisma);
  });

  describe('list', () => {
    it("scopes to the caller's own organization and only ACTIVE/PENDING connections", async () => {
      prisma.supplierConnection.findMany.mockResolvedValue([
        { id: 'c1', companyId: 'co1', status: 'ACTIVE', invitedAt: new Date('2026-01-01'), company: { name: 'Acme' } },
      ]);

      const result = await service.list(actor);

      expect(prisma.supplierConnection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierOrganizationId: 'org1', status: { in: ['ACTIVE', 'PENDING'] } } }),
      );
      expect(result).toEqual([{ id: 'c1', companyId: 'co1', companyName: 'Acme', status: 'ACTIVE', invitedAt: new Date('2026-01-01') }]);
    });
  });

  describe('accept / decline — cross-organization isolation', () => {
    it('accept rejects a connection belonging to a DIFFERENT organization (404, never distinguished from not-found)', async () => {
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'c1', supplierOrganizationId: 'org-other', status: 'PENDING' });
      await expect(service.accept(actor, 'c1')).rejects.toThrow('does not exist');
      expect(prisma.supplierConnection.update).not.toHaveBeenCalled();
    });

    it('accept rejects a connection that is not PENDING (e.g. already ACTIVE or REVOKED)', async () => {
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'c1', supplierOrganizationId: 'org1', status: 'ACTIVE' });
      await expect(service.accept(actor, 'c1')).rejects.toThrow('does not exist');
    });

    it('accept sets status ACTIVE for a genuinely own PENDING connection', async () => {
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'c1', supplierOrganizationId: 'org1', status: 'PENDING' });
      prisma.supplierConnection.update.mockResolvedValue({ id: 'c1', companyId: 'co1', status: 'ACTIVE', company: { name: 'Acme' } });

      const result = await service.accept(actor, 'c1');

      expect(prisma.supplierConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'ACTIVE', respondedAt: expect.any(Date) },
        include: { company: { select: { name: true } } },
      });
      expect(result).toEqual({ id: 'c1', companyId: 'co1', companyName: 'Acme', status: 'ACTIVE' });
    });

    it('decline rejects a connection belonging to a DIFFERENT organization', async () => {
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'c1', supplierOrganizationId: 'org-other', status: 'PENDING' });
      await expect(service.decline(actor, 'c1')).rejects.toThrow('does not exist');
    });

    it('decline sets status REVOKED for a genuinely own PENDING connection', async () => {
      prisma.supplierConnection.findUnique.mockResolvedValue({ id: 'c1', supplierOrganizationId: 'org1', status: 'PENDING' });
      prisma.supplierConnection.update.mockResolvedValue({ id: 'c1', status: 'REVOKED' });

      const result = await service.decline(actor, 'c1');

      expect(prisma.supplierConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'REVOKED', respondedAt: expect.any(Date), revokedAt: expect.any(Date) },
      });
      expect(result).toEqual({ id: 'c1', status: 'REVOKED' });
    });
  });
});
