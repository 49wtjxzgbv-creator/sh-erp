import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard, CurrentSuperAdmin, RequestSuperAdmin } from './super-admin-context';
import { UsersAdminService } from './users-admin.service';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';

@ApiTags('super-admin')
@ApiBearerAuth()
@Public()
@UseGuards(SuperAdminGuard)
@Controller({ path: 'super-admin/users', version: '1' })
export class UsersAdminController {
  constructor(private readonly usersAdminService: UsersAdminService) {}

  @Get()
  @ApiOperation({ summary: '[Super Admin] List every user on the platform, across all companies.' })
  async list(@Query('search') search?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.usersAdminService.list({
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post(':id/reset-password')
  @ApiOperation({
    summary:
      "[Super Admin] Set a new password for a user (never reveals the existing one — passwords are one-way " +
      'hashed, there is nothing to reveal). Returns the new plaintext password once, to relay to the user.',
  })
  async resetPassword(
    @CurrentSuperAdmin() actor: RequestSuperAdmin,
    @Param('id') id: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.usersAdminService.resetPassword(actor, id, dto);
  }

  @Post(':id/block')
  @ApiOperation({ summary: '[Super Admin] Block a user — rejected on next request, across every company they belong to.' })
  async block(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.usersAdminService.setActive(actor, id, false);
  }

  @Post(':id/unblock')
  @ApiOperation({ summary: '[Super Admin] Reactivate a blocked user.' })
  async unblock(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Param('id') id: string) {
    return this.usersAdminService.setActive(actor, id, true);
  }
}
