import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SuperAdminPermissionGuard } from './super-admin-permission.guard';
import { RequestSuperAdmin } from './super-admin-context';

function mockContext(superAdmin: RequestSuperAdmin | undefined): ExecutionContext {
  const request = { superAdmin };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
    // What permissions are "required" is driven by the mocked Reflector
    // below, not by anything read off getHandler()/getClass() here — they
    // just need to be callable, since the real Reflector.getAllAndOverride
    // takes them as arguments.
  } as unknown as ExecutionContext;
}

describe('SuperAdminPermissionGuard — P0 fix (2026-08-20)', () => {
  function guardWithRequired(required: string[] | undefined): SuperAdminPermissionGuard {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    return new SuperAdminPermissionGuard(reflector);
  }

  it('allows the request through when the route declares no @RequireSuperAdminPermissions at all', () => {
    const guard = guardWithRequired(undefined);
    const ctx = mockContext({ superAdminId: 'sa1', email: 'a@b.c', permissions: [] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the request through when the admin holds the required permission', () => {
    const guard = guardWithRequired(['companies:impersonate']);
    const ctx = mockContext({ superAdminId: 'sa1', email: 'a@b.c', permissions: ['companies:impersonate', 'audit:read'] });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects with 403 when the admin lacks the required permission', () => {
    const guard = guardWithRequired(['companies:impersonate']);
    const ctx = mockContext({ superAdminId: 'sa1', email: 'a@b.c', permissions: ['audit:read'] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects with 403 when request.superAdmin is missing entirely (defensive — SuperAdminGuard should always run first)', () => {
    const guard = guardWithRequired(['companies:impersonate']);
    const ctx = mockContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
