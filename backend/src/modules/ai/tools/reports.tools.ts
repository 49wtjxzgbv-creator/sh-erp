import { Injectable } from '@nestjs/common';
import { ReportsService } from '../../reports/reports.service';
import { PayrollService } from '../../hr/payroll.service';
import { AiTool, AiToolContext } from './ai-tool.interface';

/** Ported from AI_TOOLS_.getWarehouseSummary — reuses Module 10's ReportsService.getWarehouseValuation rather than re-implementing the 5-price aggregation. */
@Injectable()
export class GetWarehouseSummaryTool implements AiTool {
  readonly key = 'getWarehouseSummary';
  readonly description = 'Загальна вартість складу за різними типами цін, кількість позицій.';
  readonly parameters = { type: 'object', properties: {} };

  constructor(private readonly reportsService: ReportsService) {}

  async execute(_args: Record<string, any>, context: AiToolContext): Promise<any> {
    return this.reportsService.getWarehouseValuation(context.user);
  }
}

/**
 * Ported from AI_TOOLS_.getPayrollSummary — self-restricts to callers
 * holding `payroll:manage` (the same permission the payroll endpoints
 * themselves require), mirroring the legacy `if (user.role !== 'admin')`
 * check in `executeAiTool_`. Reuses Module 9's PayrollService rather than
 * re-implementing the QC-defect cross-reference.
 */
@Injectable()
export class GetPayrollSummaryTool implements AiTool {
  readonly key = 'getPayrollSummary';
  readonly description = 'Зведення по зарплаті працівників за період (тільки для адміністратора).';
  readonly parameters = {
    type: 'object',
    properties: { dateFrom: { type: 'string' }, dateTo: { type: 'string' } },
  };

  constructor(private readonly payrollService: PayrollService) {}

  async execute(args: Record<string, any>, context: AiToolContext): Promise<any> {
    if (!context.permissions.has('payroll:manage')) {
      return { error: 'Ця інформація доступна лише адміністратору.' };
    }
    return this.payrollService.getPayrollSummaryReport(context.user, { from: args.dateFrom || undefined, to: args.dateTo || undefined });
  }
}
