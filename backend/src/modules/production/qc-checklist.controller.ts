import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateQcChecklistItemDto } from './dto/qc-checklist-item.dto';
import { QcChecklistService } from './qc-checklist.service';

@ApiTags('quality')
@Controller({ path: 'qc-checklist-items', version: '1' })
export class QcChecklistController {
  constructor(private readonly checklistService: QcChecklistService) {}

  @Post()
  @RequirePermissions('qc-checklist:manage')
  @ApiOperation({ summary: 'Add a QC checklist item at the end of the list.' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateQcChecklistItemDto) {
    return this.checklistService.create(user, dto);
  }

  @Get()
  @RequirePermissions('qc:record')
  @ApiOperation({ summary: 'List QC checklist items in order.' })
  async list(@CurrentUser() user: RequestUser) {
    return this.checklistService.list(user);
  }

  @Delete(':id')
  @RequirePermissions('qc-checklist:manage')
  @ApiOperation({ summary: 'Remove a QC checklist item.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.checklistService.remove(user, id);
  }
}
