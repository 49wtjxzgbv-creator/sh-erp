import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SupplierPortalAuthService } from './supplier-portal-auth.service';
import { SupplierPortalRegistrationService } from './supplier-portal-registration.service';
import { SupplierPortalLoginDto } from './dto/supplier-portal-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SwitchConnectionDto } from './dto/switch-connection.dto';
import { RegisterSupplierOrganizationDto } from './dto/register-supplier-organization.dto';

@ApiTags('supplier-portal')
@Controller({ path: 'supplier-portal/auth', version: '1' })
export class SupplierPortalAuthController {
  constructor(
    private readonly supplierPortalAuthService: SupplierPortalAuthService,
    private readonly registrationService: SupplierPortalRegistrationService,
  ) {}

  // @Public() means "skip the regular JwtAuthGuard/TenantScopeInterceptor
  // pipeline" — this route has no tenant context yet. It is NOT actually
  // open to the public: the login itself is the real gate.
  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Supplier Portal login — completely separate from Company Admin / regular user / Super Admin auth.' })
  @ApiResponse({ status: 200, description: 'Access + refresh token pair (P0 fix, 2026-08-20 — session now survives reload).' })
  @ApiResponse({ status: 401, description: 'Invalid credentials, inactive account, or SUPPLIER_PORTAL_JWT_SECRET unset.' })
  async login(@Body() dto: SupplierPortalLoginDto) {
    return this.supplierPortalAuthService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a Supplier Portal refresh token for a new access+refresh pair.' })
  @ApiResponse({ status: 200, description: 'New token pair.' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired, or revoked.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.supplierPortalAuthService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: "Revoke a Supplier Portal refresh token's entire rotation family." })
  @ApiResponse({ status: 200, description: 'Family revoked (idempotent — no error if already invalid).' })
  async logout(@Body() dto: RefreshDto) {
    await this.supplierPortalAuthService.logout(dto.refreshToken);
    return { ok: true };
  }

  // Same "identified by the refresh token itself, not a Bearer access
  // token" shape as /refresh and /logout above — deliberately, not
  // `@UseGuards(SupplierPortalGuard)` (2026-08-21 P0, ADR-0012): keeps this
  // endpoint consistent with the other two session-mutating routes rather
  // than introducing a mixed auth model for just this one.
  @Public()
  @Post('switch-connection')
  @ApiOperation({ summary: 'Switch this session\'s active company (SupplierConnection) — mints a new access+refresh pair, same rotation family, without a fresh login.' })
  @ApiResponse({ status: 200, description: 'New token pair scoped to the requested connection.' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid/expired/revoked, or account no longer active.' })
  @ApiResponse({ status: 404, description: "The target connection doesn't exist, isn't ACTIVE, or doesn't belong to this organization — never distinguished from each other." })
  async switchConnection(@Body() dto: SwitchConnectionDto) {
    return this.supplierPortalAuthService.switchConnection(dto.refreshToken, dto.connectionId);
  }

  // Genuinely open — no invite token gates this one (2026-08-21 P2). A
  // company finds the resulting account afterward by exact email
  // (SuppliersService#connectExisting) and sends a PENDING connection
  // request; the account accepts it once logged in. Throttled the same as
  // invite/:token/accept — same risk class (unauthenticated account
  // creation), arguably worse since there's no token to bound exposure.
  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Register a new Supplier Portal account with zero connections — a company finds it later by exact email.' })
  @ApiResponse({ status: 200, description: '{ email } — no session, nothing to scope one to yet.' })
  @ApiResponse({ status: 409, description: 'This email already has an account — log in instead.' })
  async register(@Body() dto: RegisterSupplierOrganizationDto) {
    return this.registrationService.registerStandalone(dto);
  }
}
