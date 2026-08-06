import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { LegacyImportService } from './legacy-import.service';
import { StartImportDto } from './dto/start-import.dto';

@ApiTags('legacy-import')
@Controller({ path: 'legacy-import', version: '1' })
export class LegacyImportController {
  constructor(private readonly legacyImportService: LegacyImportService) {}

  @Post('validate')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Wizard step 2 — dry-run: fetch + transform against the Apps Script Web App, no database writes. Returns counts + warnings.' })
  async validate(@CurrentUser() user: RequestUser, @Body() dto: StartImportDto) {
    return this.legacyImportService.validate(user, dto);
  }

  @Post('jobs')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Wizard step 3 — starts the real import as a background job, returns immediately with the job id to poll.' })
  async startImport(@CurrentUser() user: RequestUser, @Body() dto: StartImportDto) {
    return this.legacyImportService.startImport(user, dto);
  }

  @Get('jobs')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Recent import job history for this company.' })
  async listJobs(@CurrentUser() user: RequestUser) {
    return this.legacyImportService.listJobs(user);
  }

  @Get('jobs/:id')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Poll a single import job\'s status/progress/report.' })
  async getJob(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.legacyImportService.getJob(user, id);
  }
}
