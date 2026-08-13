import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { QuerySuppliersDto } from './dto/query-suppliers.dto';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { SupplierPortalInviteDto } from './dto/supplier-portal-invite.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags('procurement')
@Controller({ path: 'suppliers', version: '1' })
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Create a supplier.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(user, dto);
  }

  @Get()
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Search/list suppliers, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QuerySuppliersDto) {
    return this.suppliersService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('suppliers:read')
  @ApiOperation({ summary: 'Get one supplier.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.suppliersService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Update a supplier.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Soft-delete a supplier. No in-use guard, by design — matches the legacy behavior (Phase 1 §3.4).' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.suppliersService.remove(user, id);
  }

  @Post(':id/portal-invite')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Create (or reset) this supplier’s Supplier Portal login — separate from this app’s own auth, see SupplierPortalModule.' })
  async invitePortal(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SupplierPortalInviteDto) {
    return this.suppliersService.invitePortal(user, id, dto);
  }

  @Post(':id/portal-deactivate')
  @RequirePermissions('suppliers:write')
  @ApiOperation({ summary: 'Deactivate this supplier’s Supplier Portal login (does not delete it — portal-invite reactivates).' })
  async deactivatePortal(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.suppliersService.deactivatePortal(user, id);
  }
}
