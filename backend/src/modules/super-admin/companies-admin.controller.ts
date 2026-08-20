import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequireSuperAdminPermissions } from '../../common/decorators/super-admin-permissions.decorator';
import { SuperAdminGuard, CurrentSuperAdmin, RequestSuperAdmin } from './super-admin-context';
import { SuperAdminPermissionGuard } from './super-admin-permission.guard';
import { CompaniesAdminService } from './companies-admin.service';
import { CreateCompanyDto } from '../tenancy/dto/create-company.dto';
import { ImpersonateDto } from './dto/impersonate.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

// Every route here carries BOTH @Public() (opt out of the regular
// JwtAuthGuard/TenantScopeInterceptor pipeline — there is no tenant
// context for a global admin route) AND @UseGuards(SuperAdminGuard) (the
// actual, completely separate gate). This pairing is the whole point of
// the "окрема авторизація" requirement — see super-admin-context.ts's
// header comment for the full reasoning.
@ApiTags('super-admin')
@ApiBearerAuth()
@Public()
@UseGuards(SuperAdminGuard)
@Controller({ path: 'super-admin/companies', version: '1' })
export class CompaniesAdminController {
  constructor(private readonly companiesAdminService: CompaniesAdminService) {}

  @Get()
  @ApiOperation({ summary: '[Super Admin] List every company on the platform.' })
  async list(@Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.companiesAdminService.list({
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '[Super Admin] One company, with its subscription and members.' })
  async findOne(@Param('id') id: string) {
    return this.companiesAdminService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: '[Super Admin] Create a company manually — same flow as public self-service signup.' })
  async create(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Body() dto: CreateCompanyDto) {
    return this.companiesAdminService.create(actor, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: '[Super Admin] Rename a company or change its slug.' })
  async update(
    @CurrentSuperAdmin() actor: RequestSuperAdmin,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companiesAdminService.update(actor, id, dto);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: "[Super Admin] Remove a user's membership from this company (not the User account itself)." })
  async removeMembership(
    @CurrentSuperAdmin() actor: RequestSuperAdmin,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.companiesAdminService.removeMembership(actor, id, userId);
  }

  @Post(':id/block')
  @ApiOperation({ summary: '[Super Admin] Suspend a company — every user in it is rejected on their next request.' })
  async block(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.companiesAdminService.block(actor, id);
  }

  @Post(':id/unblock')
  @ApiOperation({ summary: '[Super Admin] Reactivate a suspended company.' })
  async unblock(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.companiesAdminService.unblock(actor, id);
  }

  @Post(':id/impersonate')
  @UseGuards(SuperAdminPermissionGuard)
  @RequireSuperAdminPermissions('companies:impersonate')
  @ApiOperation({
    summary:
      "[Super Admin] Mint a real, short-lived regular-company session (access + refresh token) for this company " +
      "(defaults to the company's original owner if no userId given). Refresh token is capped by a hard, " +
      'non-extendable ceiling (IMPERSONATION_SESSION_TTL_HOURS) — re-impersonate once it expires. Requires the ' +
      "'companies:impersonate' Super Admin permission.",
  })
  async impersonate(
    @CurrentSuperAdmin() actor: RequestSuperAdmin,
    @Param('id') id: string,
    @Body() dto: ImpersonateDto,
  ) {
    return this.companiesAdminService.impersonate(actor, id, dto);
  }
}
