import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SupplierPortalAuthPrismaService } from './supplier-portal-auth-prisma.service';
import { SupplierPortalGuard } from './supplier-portal-context';
import { SupplierPortalScopeInterceptor } from './supplier-portal-scope.interceptor';
import { SupplierPortalAuthService } from './supplier-portal-auth.service';
import { SupplierPortalRefreshTokenService } from './supplier-portal-refresh-token.service';
import { SupplierPortalAuthController } from './supplier-portal-auth.controller';
import { SupplierPortalService } from './supplier-portal.service';
import { SupplierPortalController } from './supplier-portal.controller';

/**
 * Portal for external suppliers — completely separate from Company Admin
 * (regular tenant users) and from SuperAdmin, per ADR-0011 (mirrors
 * ADR-0010's rationale for the same "not a User flag" decision). Deliberately
 * its own top-level module, not nested inside ProcurementModule — the
 * invite/deactivate management endpoints for staff DO live on
 * ProcurementModule's SuppliersController (they run through the normal,
 * already-tenant-scoped app_user path), but everything a *supplier*
 * themselves can reach lives here, behind its own guard/token.
 *
 * `JwtModule.register({})` is intentionally secret-less at the module level
 * — every `sign()`/`verify()` call passes its own explicit `secret`
 * (`SUPPLIER_PORTAL_JWT_SECRET`), same reasoning as SuperAdminModule's
 * identical setup.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [SupplierPortalAuthController, SupplierPortalController],
  providers: [
    SupplierPortalAuthPrismaService,
    SupplierPortalGuard,
    SupplierPortalScopeInterceptor,
    SupplierPortalAuthService,
    SupplierPortalRefreshTokenService,
    SupplierPortalService,
  ],
})
export class SupplierPortalModule {}
