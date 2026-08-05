import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { SuperAdminGuard, CurrentSuperAdmin, RequestSuperAdmin } from './super-admin-context';
import { PlansAdminService } from './plans-admin.service';
import { UpsertPlanDto } from './dto/upsert-plan.dto';

@ApiTags('super-admin')
@ApiBearerAuth()
@Public()
@UseGuards(SuperAdminGuard)
@Controller({ path: 'super-admin/plans', version: '1' })
export class PlansAdminController {
  constructor(private readonly plansAdminService: PlansAdminService) {}

  @Get()
  @ApiOperation({ summary: '[Super Admin] List every plan tier.' })
  async list() {
    return this.plansAdminService.list();
  }

  @Post()
  @ApiOperation({ summary: '[Super Admin] Create or update a plan tier (upsert by key).' })
  async upsert(@CurrentSuperAdmin() actor: RequestSuperAdmin, @Body() dto: UpsertPlanDto) {
    return this.plansAdminService.upsert(actor, dto);
  }
}
