import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LegacyImportService } from './legacy-import.service';
import { StartConnectionDto } from './dto/start-connection.dto';
import { CompletePairingDto } from './dto/complete-pairing.dto';
import { RunImportDto } from './dto/run-import.dto';
import { StartJobDto } from './dto/start-job.dto';

@ApiTags('legacy-import')
@Controller({ path: 'legacy-import', version: '1' })
export class LegacyImportController {
  constructor(private readonly legacyImportService: LegacyImportService) {}

  @Get('providers')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Registered connector providers (today: Google Apps Script only) — drives the "+ Додати джерело" provider picker.' })
  async listProviders() {
    return this.legacyImportService.listProviders();
  }

  @Get('connections')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'All import connections (sources) for this company.' })
  async listConnections(@CurrentUser() user: RequestUser) {
    return this.legacyImportService.listConnections(user);
  }

  @Post('connections')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Starts connecting a new source — for a pairing-style provider, returns a pairing code to show the user.' })
  async startConnection(@CurrentUser() user: RequestUser, @Body() dto: StartConnectionDto) {
    return this.legacyImportService.startConnection(user, dto);
  }

  @Get('connections/:id')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Poll a single connection\'s pairing/health status.' })
  async getConnection(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.legacyImportService.getConnection(user, id);
  }

  @Post('connections/:id/health-check')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'On-demand "Перевірити з\'єднання" — reachability, protocol version, capabilities, Sheets/Drive access.' })
  async healthCheck(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.legacyImportService.healthCheck(user, id);
  }

  @Post('connections/:id/revoke')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: '"Відключити" — forgets the credential (and best-effort asks the connector to forget it too), without deleting the connection\'s history.' })
  async revokeConnection(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.legacyImportService.revokeConnection(user, id);
  }

  @Post('connections/:id/reconnect')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: '"Перепідключити" — fresh pairing code on the SAME connection, no need to recreate the Apps Script project.' })
  async reconnectConnection(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.legacyImportService.reconnectConnection(user, id);
  }

  /**
   * Public — called by the connector itself (anonymous script, not a
   * logged-in SH ERP user), authorized purely by knowledge of the
   * one-time pairing code. See LegacyImportService.completePairing's
   * header comment and ImportPairingPrismaService for why this bypasses
   * the normal JWT+tenant-context path entirely.
   */
  @Public()
  @Post('connections/pair')
  @ApiOperation({ summary: 'Called by the connector to complete the device-pairing handshake — no auth beyond the pairing code itself.' })
  async completePairing(@Body() dto: CompletePairingDto) {
    return this.legacyImportService.completePairing(dto);
  }

  @Post('validate')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Dry-run: fetch + transform against a paired connection, no database writes. Returns the full preview report (counts, conflicts, warnings, blocking errors).' })
  async validate(@CurrentUser() user: RequestUser, @Body() dto: RunImportDto) {
    return this.legacyImportService.validate(user, dto);
  }

  @Post('jobs')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Starts the real import as a background job, returns immediately with the job id to poll. Refused server-side if a fresh dry-run reports blocking errors.' })
  async startImport(@CurrentUser() user: RequestUser, @Body() dto: StartJobDto) {
    return this.legacyImportService.startImport(user, dto);
  }

  @Get('jobs')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Import job history for this company, optionally filtered to one connection.' })
  async listJobs(@CurrentUser() user: RequestUser, @Query('connectionId') connectionId?: string) {
    return this.legacyImportService.listJobs(user, connectionId);
  }

  @Get('jobs/:id')
  @RequirePermissions('legacy-import:manage')
  @ApiOperation({ summary: 'Poll a single import job\'s status/progress/report.' })
  async getJob(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.legacyImportService.getJob(user, id);
  }
}
