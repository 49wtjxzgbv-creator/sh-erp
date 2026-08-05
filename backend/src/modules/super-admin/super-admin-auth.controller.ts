import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';

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
  @ApiResponse({ status: 200, description: 'Short-lived super-admin access token (no refresh token by design).' })
  @ApiResponse({ status: 401, description: 'Invalid credentials, inactive account, or SUPER_ADMIN_JWT_SECRET unset.' })
  async login(@Body() dto: SuperAdminLoginDto) {
    return this.superAdminAuthService.login(dto);
  }
}
