import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SupplierPortalAuthService } from './supplier-portal-auth.service';
import { SupplierPortalLoginDto } from './dto/supplier-portal-login.dto';

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
  @ApiResponse({ status: 200, description: 'Long-lived supplier portal access token (no refresh token by design).' })
  @ApiResponse({ status: 401, description: 'Invalid credentials, inactive account, or SUPPLIER_PORTAL_JWT_SECRET unset.' })
  async login(@Body() dto: SupplierPortalLoginDto) {
    return this.supplierPortalAuthService.login(dto);
  }
}
