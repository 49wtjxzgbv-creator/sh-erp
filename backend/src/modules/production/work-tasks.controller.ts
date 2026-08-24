import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateWorkTaskDto, QueryWorkTasksDto, SetWorkTaskItemsDto, UpdateWorkTaskDto } from './dto/work-task.dto';
import { WorkTasksService } from './work-tasks.service';

@ApiTags('production')
@Controller({ path: 'work-tasks', version: '1' })
export class WorkTasksController {
  constructor(private readonly workTasksService: WorkTasksService) {}

  @Post()
  @RequirePermissions('work-tasks:manage')
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateWorkTaskDto) {
    return this.workTasksService.create(user, dto);
  }

  @Get()
  @RequirePermissions('work-tasks:manage')
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryWorkTasksDto) {
    return this.workTasksService.query(user, query);
  }

  @Get(':id')
  @RequirePermissions('work-tasks:manage')
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.workTasksService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('work-tasks:manage')
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateWorkTaskDto) {
    return this.workTasksService.update(user, id, dto);
  }

  @Post(':id/items')
  @RequirePermissions('work-tasks:manage')
  async setItems(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: SetWorkTaskItemsDto) {
    return this.workTasksService.setItems(user, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions('work-tasks:manage')
  async close(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.workTasksService.close(user, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('work-tasks:manage')
  async reopen(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.workTasksService.reopen(user, id);
  }

  @Delete(':id')
  @RequirePermissions('work-tasks:manage')
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    await this.workTasksService.remove(user, id);
    return { success: true };
  }
}
