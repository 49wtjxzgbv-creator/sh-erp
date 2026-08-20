import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('super-admin')
@Controller({ path: 'super-admin/auth', version: '1' })
export class SuperAdminAuthController {
  constructor(private readonly superAdminAuthService: SuperAdminAuthService) {}

  // @Public() here means "skip the regular JwtAuthGuard/TenantScopeInterceptor
  // pipeline" — this route has no tenant context and never will. It is NOT
  // actually open to the public: the login itself is the real gate.
  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Super Admin login — completely separate from Company Admin / regular user auth.' })
  @ApiResponse({ status: 200, description: 'Access + refresh token pair (P0 fix, 2026-08-20 — session now survives reload).' })
  @ApiResponse({ status: 401, description: 'Invalid credentials, inactive account, or SUPER_ADMIN_JWT_SECRET unset.' })
  async login(@Body() dto: SuperAdminLoginDto) {
    return this.superAdminAuthService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a Super Admin refresh token for a new access+refresh pair.' })
  @ApiResponse({ status: 200, description: 'New token pair.' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired, past its absolute ceiling, or revoked.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.superAdminAuthService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: "Revoke a Super Admin refresh token's entire rotation family." })
  @ApiResponse({ status: 200, description: 'Family revoked (idempotent — no error if already invalid).' })
  async logout(@Body() dto: RefreshDto) {
    await this.superAdminAuthService.logout(dto.refreshToken);
    return { ok: true };
  }
}
