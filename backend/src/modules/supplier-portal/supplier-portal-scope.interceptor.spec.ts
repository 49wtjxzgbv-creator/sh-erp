import { firstValueFrom, of } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { SupplierPortalScopeInterceptor } from './supplier-portal-scope.interceptor';

/**
 * These tests exist specifically to prove the multi-company redesign's core
 * security claim (2026-08-21 P0, ADR-0012): a request is authorized against
 * a LIVE `SupplierConnection` row on every single call, never a JWT claim.
 * The "key test" the plan calls out by name is `revokes access the instant
 * a connection is revoked` below — it doesn't wait for token expiry or a
 * refresh; the very next request must already fail.
 */
describe('SupplierPortalScopeInterceptor', () => {
  let interceptor: SupplierPortalScopeInterceptor;
  let prisma: any;
  let authPrisma: any;

  function makeContext(supplierPortalUser?: any): ExecutionContext {
    const request: any = { supplierPortalUser };
    return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  }

  function makeNext(result: unknown = 'ok'): CallHandler {
    return { handle: () => of(result) };
  }

  beforeEach(() => {
    prisma = {
      // Mirrors the real runInTenantTransaction: runs the callback and returns its result — no real transaction/RLS in a unit test.
      runInTenantTransaction: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
    };
    authPrisma = {
      supplierConnection: { findUnique: jest.fn() },
    };
    interceptor = new SupplierPortalScopeInterceptor(prisma, authPrisma);
  });

  it('passes through untouched when there is no supplierPortalUser on the request (public routes: login/refresh/logout)', async () => {
    const result = await firstValueFrom(interceptor.intercept(makeContext(undefined), makeNext('public-result')));
    expect(result).toBe('public-result');
    expect(authPrisma.supplierConnection.findUnique).not.toHaveBeenCalled();
  });

  it('rejects (404, no DB lookup) a standalone self-registered account with a null activeConnectionId — nothing this interceptor guards makes sense without a real company scope (2026-08-21 P3)', async () => {
    const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: null };

    await expect(firstValueFrom(interceptor.intercept(makeContext(actor), makeNext()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND' }),
    });
    expect(authPrisma.supplierConnection.findUnique).not.toHaveBeenCalled();
    expect(prisma.runInTenantTransaction).not.toHaveBeenCalled();
  });

  it('resolves companyId/supplierId from the live connection and opens the tenant transaction for a valid, ACTIVE, own-organization connection', async () => {
    const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1' };
    authPrisma.supplierConnection.findUnique.mockResolvedValue({
      companyId: 'co1',
      supplierId: 's1',
      supplierOrganizationId: 'org1',
      status: 'ACTIVE',
      supplierOrganization: { portalUser: { active: true } },
    });

    const result = await firstValueFrom(interceptor.intercept(makeContext(actor), makeNext('ok')));

    expect(result).toBe('ok');
    expect(actor).toMatchObject({ companyId: 'co1', supplierId: 's1' });
    expect(prisma.runInTenantTransaction).toHaveBeenCalledWith({ companyId: 'co1', userId: 'u1' }, expect.any(Function));
  });

  it("KEY TEST — revokes access the instant a connection is revoked, without waiting for the access token to expire or for a refresh", async () => {
    const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1' };
    // The token itself is still perfectly valid/unexpired here — only the
    // underlying SupplierConnection row changed, simulating a company
    // revoking access mid-session. This is the whole point of a per-request
    // DB re-check instead of trusting a signed JWT claim.
    authPrisma.supplierConnection.findUnique.mockResolvedValue({
      companyId: 'co1',
      supplierId: 's1',
      supplierOrganizationId: 'org1',
      status: 'REVOKED',
      supplierOrganization: { portalUser: { active: true } },
    });

    await expect(firstValueFrom(interceptor.intercept(makeContext(actor), makeNext()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND' }),
    });
    expect(prisma.runInTenantTransaction).not.toHaveBeenCalled();
  });

  it('rejects (404-shaped) a connection belonging to a DIFFERENT organization than the token claims — a forged/replayed/stale activeConnectionId', async () => {
    const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1' };
    authPrisma.supplierConnection.findUnique.mockResolvedValue({
      companyId: 'co1',
      supplierId: 's1',
      supplierOrganizationId: 'org-someone-else',
      status: 'ACTIVE',
      supplierOrganization: { portalUser: { active: true } },
    });

    await expect(firstValueFrom(interceptor.intercept(makeContext(actor), makeNext()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND' }),
    });
  });

  it('rejects when the connection id no longer exists at all — indistinguishable from the cross-org case, on purpose', async () => {
    const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1' };
    authPrisma.supplierConnection.findUnique.mockResolvedValue(null);

    await expect(firstValueFrom(interceptor.intercept(makeContext(actor), makeNext()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND' }),
    });
  });

  it('rejects when the global SupplierPortalUser account itself has been deactivated, even if this one connection looks ACTIVE', async () => {
    const actor = { supplierPortalUserId: 'u1', supplierOrganizationId: 'org1', activeConnectionId: 'conn1' };
    authPrisma.supplierConnection.findUnique.mockResolvedValue({
      companyId: 'co1',
      supplierId: 's1',
      supplierOrganizationId: 'org1',
      status: 'ACTIVE',
      supplierOrganization: { portalUser: { active: false } },
    });

    await expect(firstValueFrom(interceptor.intercept(makeContext(actor), makeNext()))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SUPPLIER_PORTAL_CONNECTION_NOT_FOUND' }),
    });
  });
});
