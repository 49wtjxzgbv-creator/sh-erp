import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantScopeInterceptor } from '../../common/interceptors/tenant-scope.interceptor';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

// JwtAuthGuard (cheap, no DB access) still runs as a Guard. Permission
// checking moved to TenantScopeInterceptor — see its header comment for
// why: it's also the thing that activates Postgres RLS per request, which
// only an Interceptor's next.handle() wrapping can do correctly.
// Secure-by-default is preserved: @Public() and the absence of
// @RequirePermissions() remain the explicit opt-outs.
//
// RolesController added in the production-readiness pass — RolesService
// existed since Module 1 but was signup-seeding-only (see its own header
// comment); this is what finally exposes the custom-roles CRUD surface the
// `roles:manage` permission was seeded for from the very beginning.
@Module({
  controllers: [RolesController],
  providers: [
    RolesService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
  ],
  exports: [RolesService],
})
export class AuthorizationModule {}
