import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

@ApiTags('identity')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Sign in with email/password, scoped to one company.' })
  @ApiResponse({ status: 200, description: 'Access + refresh token pair.' })
  @ApiResponse({ status: 401, description: 'Invalid credentials, or no access to that company.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new access+refresh pair.' })
  @ApiResponse({ status: 200, description: 'New token pair.' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid, expired, or revoked.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: "Revoke a refresh token's entire rotation family (sign out everywhere that session was active)." })
  @ApiResponse({ status: 200, description: 'Family revoked (idempotent — no error if already invalid).' })
  async logout(@Body() dto: RefreshDto) {
    await this.authService.revokeFamily(dto.refreshToken);
    return { ok: true };
  }

  @Public()
  @Get('companies/:slug/public-info')
  @ApiOperation({
    summary:
      'Pre-login company discovery: basic company info + branding (logo/favicon), for rendering the login ' +
      'screen before authentication (Phase 1 §3.6 — deliberately not auth-gated, ADR-0009).',
  })
  @ApiResponse({ status: 200, description: 'Company info + branding (branding may be null if never configured).' })
  @ApiResponse({ status: 404, description: 'No company with this slug.' })
  async getPublicCompanyInfo(@Param('slug') slug: string) {
    return this.authService.getPublicCompanyInfo(slug);
  }
}
