import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SupplierPortalGuard, CurrentSupplierPortalUser, RequestSupplierPortalUser } from './supplier-portal-context';
import { SupplierPortalConnectionsService } from './supplier-portal-connections.service';

/**
 * Deliberately guarded by `SupplierPortalGuard` ONLY — no
 * `SupplierPortalScopeInterceptor` here (2026-08-21 P0, ADR-0012): that
 * interceptor's whole job is opening a single-company RLS transaction for
 * `activeConnectionId`, which makes no sense for "list every company this
 * organization is connected to." These 3 routes only ever need
 * `supplierOrganizationId`, which the Guard already sets from the token.
 */
@ApiTags('supplier-portal')
@Controller({ path: 'supplier-portal/connections', version: '1' })
@Public()
@UseGuards(SupplierPortalGuard)
export class SupplierPortalConnectionsController {
  constructor(private readonly connections: SupplierPortalConnectionsService) {}

  @Get()
  @ApiOperation({ summary: "List this Supplier Organization's ACTIVE and PENDING connections (companies)." })
  @ApiResponse({ status: 200, description: 'Connections with company name and status.' })
  async list(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser) {
    return this.connections.list(actor);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept a PENDING connection invitation from a company.' })
  @ApiResponse({ status: 200, description: 'Connection is now ACTIVE.' })
  @ApiResponse({ status: 404, description: "Not PENDING, or doesn't belong to this organization — never distinguished." })
  async accept(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.connections.accept(actor, id);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Decline a PENDING connection invitation from a company.' })
  @ApiResponse({ status: 200, description: 'Connection is now REVOKED.' })
  @ApiResponse({ status: 404, description: "Not PENDING, or doesn't belong to this organization — never distinguished." })
  async decline(@CurrentSupplierPortalUser() actor: RequestSupplierPortalUser, @Param('id') id: string) {
    return this.connections.decline(actor, id);
  }
}
