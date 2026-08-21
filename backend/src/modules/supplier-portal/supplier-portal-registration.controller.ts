import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SupplierPortalRegistrationService } from './supplier-portal-registration.service';
import { AcceptSupplierInviteDto } from './dto/accept-invite.dto';

/**
 * Self-service registration (2026-08-21 P1, ADR-0013) — genuinely
 * unauthenticated (no `SupplierPortalGuard`, there is no token to verify
 * yet): the invite token itself, not a Bearer/JWT, is the real gate here.
 * First `@Throttle()` usage anywhere in this codebase — the global 100/60s
 * per-IP baseline (`app.module.ts`) is not tight enough for an endpoint that
 * lets someone guess an existing supplier's password. The real backstop is
 * still the invite token's short TTL + single-use consumption, not the
 * throttle alone (a leaked/forwarded link isn't bound to one IP) — see
 * ADR-0013.
 */
@ApiTags('supplier-portal')
@Controller({ path: 'supplier-portal/auth/invite', version: '1' })
@Public()
export class SupplierPortalRegistrationController {
  constructor(private readonly registration: SupplierPortalRegistrationService) {}

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Preview an invite link before redeeming it — company/supplier name for the registration page banner.' })
  @ApiResponse({ status: 200, description: '{ companyName, supplierName }' })
  @ApiResponse({ status: 404, description: 'Invalid, expired, consumed, or revoked — never distinguished.' })
  async preview(@Param('token') token: string) {
    return this.registration.preview(token);
  }

  @Post(':token/accept')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Redeem an invite link — creates a new Supplier Portal account or connects an existing one to this company.' })
  @ApiResponse({ status: 200, description: 'Full access+refresh session, same shape as login.' })
  @ApiResponse({ status: 401, description: 'Existing account, wrong password.' })
  @ApiResponse({ status: 404, description: 'Invalid, expired, consumed, revoked, or already-connected supplier — never distinguished.' })
  async accept(@Param('token') token: string, @Body() dto: AcceptSupplierInviteDto) {
    return this.registration.accept(token, dto);
  }
}
