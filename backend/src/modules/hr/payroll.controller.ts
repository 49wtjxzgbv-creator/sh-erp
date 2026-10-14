import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PayrollSummaryQueryDto, QueryPayrollEntriesDto, RecordPayrollEntryDto, VoidPayrollEntryDto } from './dto/payroll-entry.dto';
import { PayrollService } from './payroll.service';

@ApiTags('hr')
@Controller({ path: 'payroll', version: '1' })
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('entries')
  @RequirePermissions('payroll:manage')
  @ApiOperation({ summary: 'Record a manual advance/bonus/penalty entry. Piecework entries are system-generated only, via ProductionExecutionsService#confirm.' })
  async recordManualEntry(@CurrentUser() user: RequestUser, @Body() dto: RecordPayrollEntryDto) {
    return this.payrollService.recordManualEntry(user, dto);
  }

  @Post('entries/:id/void')
  @RequirePermissions('payroll:manage')
  @ApiOperation({
    summary:
      'Void a manual advance/bonus/penalty entry with a compensating opposite-signed entry — the table has no ' +
      'UPDATE/DELETE grants at all, so this is the only way to correct one. PIECEWORK entries are voided through ' +
      'ProductionExecutionsService#void_ instead.',
  })
  async voidManualEntry(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: VoidPayrollEntryDto) {
    return this.payrollService.voidManualEntry(user, id, dto.note);
  }

  @Get('entries')
  @RequirePermissions('payroll:manage')
  @ApiOperation({ summary: 'List payroll ledger entries, paginated.' })
  async query(@CurrentUser() user: RequestUser, @Query() query: QueryPayrollEntriesDto) {
    return this.payrollService.query(user, query);
  }

  @Get('summary')
  @RequirePermissions('payroll:manage')
  @ApiOperation({
    summary:
      'Per-employee payroll totals by type, plus a QC defect count cross-referenced through their assigned ' +
      'production orders (Phase 1 §6.5).',
  })
  async summary(@CurrentUser() user: RequestUser, @Query() query: PayrollSummaryQueryDto) {
    return this.payrollService.getPayrollSummaryReport(user, query);
  }
}
