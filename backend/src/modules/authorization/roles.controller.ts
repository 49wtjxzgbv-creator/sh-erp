import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateRoleDto, UpdateRoleDto } from './dto/upsert-role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('roles:manage')
  @ApiOperation({ summary: "List this company's roles with their permission grants." })
  async list(@CurrentUser() user: RequestUser) {
    return this.rolesService.list(user);
  }

  @Get('permissions-catalogue')
  @RequirePermissions('roles:manage')
  @ApiOperation({ summary: 'The fixed, global permission catalogue — every key a role can be granted.' })
  async permissionsCatalogue() {
    return this.rolesService.permissionsCatalogue();
  }

  @Post()
  @RequirePermissions('roles:manage')
  @ApiOperation({ summary: 'Create a custom role.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateRoleDto) {
    return this.rolesService.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('roles:manage')
  @ApiOperation({ summary: 'Update a role — name, description, and/or permission grants. Works on default (isSystem) roles too.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('roles:manage')
  @ApiOperation({ summary: 'Delete a custom role (blocked for default/system roles and roles still assigned to a member).' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.rolesService.remove(user, id);
  }
}
