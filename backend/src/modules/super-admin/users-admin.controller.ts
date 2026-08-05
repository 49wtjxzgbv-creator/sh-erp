import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard } from './super-admin-context';
import { UsersAdminService } from './users-admin.service';

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
}
