import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SupplierPortalAuthService } from './supplier-portal-auth.service';
import { SupplierPortalLoginDto } from './dto/supplier-portal-login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('supplier-portal')
@Controller({ path: 'supplier-portal/auth', version: '1' })
export class SupplierPortalAuthController {
  constructor(private readonly supplierPortalAuthService: SupplierPortalAuthService) {}

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
}
