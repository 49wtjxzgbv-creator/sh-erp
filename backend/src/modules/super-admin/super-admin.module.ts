import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenancyModule } from '../tenancy/tenancy.module';
import { IdentityModule } from '../identity/identity.module';
import { SuperAdminPrismaService } from './super-admin-prisma.service';
import { SuperAdminAuditService } from './super-admin-audit.service';
import { SuperAdminGuard } from './super-admin-context';
import { SuperAdminPermissionGuard } from './super-admin-permission.guard';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminRefreshTokenService } from './super-admin-refresh-token.service';
import { SuperAdminAuthController } from './super-admin-auth.controller';
import { CompaniesAdminService } from './companies-admin.service';
import { CompaniesAdminController } from './companies-admin.controller';
import { UsersAdminService } from './users-admin.service';
import { UsersAdminController } from './users-admin.controller';
import { PlansAdminService } from './plans-admin.service';
import { PlansAdminController } from './plans-admin.controller';
import { AuditAdminController } from './audit-admin.controller';
import { LandingPageAdminService } from './landing-page-admin.service';
import { LandingPageMediaService } from './landing-page-media.service';
import { LandingPageAdminController } from './landing-page-admin.controller';

/**
 * Global System Administration — added during the 2026-08-05
 * production-readiness audit per an explicit owner requirement: a Super
 * Admin that is completely separate from Company Admin (see
 * schema.prisma's "Global System Administration" section header comment
 * for the full architectural rationale). Deliberately its own top-level
 * module, imported into AppModule alongside every other Phase-2-roadmap
 * module, NOT nested inside AuthorizationModule or TenancyModule — it is
 * not a variant of either, it sits above the whole per-company system.
 *
 * `JwtModule.register({})` here is intentionally secret-less at the module
 * level: every `sign()`/`verify()` call in this module passes its own
 * explicit `secret` (`SUPER_ADMIN_JWT_SECRET` for super-admin's own tokens)
 * — a second, real `JwtModule.register({ secret: ... })` registration would
 * just be a second unused default that's easy to accidentally rely on
 * later. Depends on `TenancyModule` only for `CompanyService` (manual
 * company creation reuses the exact same signup transaction as public
 * self-service signup, not a parallel implementation), and on
 * `IdentityModule` for `AuthService` — `CompaniesAdminService.impersonate`
 * mints a REAL regular-company session (access+refresh token pair) through
 * the exact same `issueTokenPair`/rotation/reuse-detection machinery a
 * normal login uses (P0 fix, 2026-08-20), not a hand-rolled JWT.
 */
@Module({
  imports: [JwtModule.register({}), TenancyModule, IdentityModule],
  controllers: [
    SuperAdminAuthController,
    CompaniesAdminController,
    UsersAdminController,
    PlansAdminController,
    AuditAdminController,
    LandingPageAdminController,
  ],
  providers: [
    SuperAdminPrismaService,
    SuperAdminAuditService,
    SuperAdminGuard,
    SuperAdminPermissionGuard,
    SuperAdminAuthService,
    SuperAdminRefreshTokenService,
    CompaniesAdminService,
    UsersAdminService,
    PlansAdminService,
    LandingPageAdminService,
    LandingPageMediaService,
  ],
})
export class SuperAdminModule {}
