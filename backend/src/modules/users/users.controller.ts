import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateMembershipRoleDto } from './dto/update-membership.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: "List this company's members (user + role)." })
  async list(@CurrentUser() user: RequestUser) {
    return this.usersService.list(user);
  }

  @Post('invite')
  @RequirePermissions('users:invite')
  @ApiOperation({
    summary:
      'Add a person to this company. If the email already has an account (possibly in another company), only a new membership is created; otherwise a new account is created with a temporary password (returned once, and emailed if SMTP is configured).',
  })
  async invite(@CurrentUser() user: RequestUser, @Body() dto: InviteUserDto) {
    return this.usersService.invite(user, dto);
  }

  @Patch(':userId/role')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: "Change a member's role within this company." })
  async updateRole(@CurrentUser() user: RequestUser, @Param('userId') userId: string, @Body() dto: UpdateMembershipRoleDto) {
    return this.usersService.updateRole(user, userId, dto);
  }

  @Post(':userId/deactivate')
  @RequirePermissions('users:manage')
  @ApiOperation({ summary: "Revoke a member's access to this company (cannot remove yourself or the last remaining member)." })
  async deactivate(@CurrentUser() user: RequestUser, @Param('userId') userId: string) {
    return this.usersService.deactivate(user, userId);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change your own password — no special permission required beyond being authenticated.' })
  async changeOwnPassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeOwnPassword(user, dto);
  }
}
