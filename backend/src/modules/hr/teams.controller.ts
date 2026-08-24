import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateTeamDto, QueryTeamsDto, SetTeamMembersDto, UpdateTeamDto } from './dto/team.dto';
import { TeamsService } from './teams.service';

@ApiTags('hr')
@Controller({ path: 'teams', version: '1' })
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Post()
  @RequirePermissions('teams:manage')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateTeamDto) {
    return this.teamsService.create(user, dto);
  }

  @Get()
  @RequirePermissions('teams:manage')
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryTeamsDto) {
    return this.teamsService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('teams:manage')
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.teamsService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('teams:manage')
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teamsService.update(user, id, dto);
  }

  @Post(':id/members')
  @RequirePermissions('teams:manage')
  async setMembers(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetTeamMembersDto) {
    return this.teamsService.setMembers(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('teams:manage')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.teamsService.remove(user, id);
    return { success: true };
  }
}
