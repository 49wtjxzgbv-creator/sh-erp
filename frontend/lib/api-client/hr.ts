import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * backend/src/modules/hr/ (EmployeesController, PayrollController). Started
 * in Task 46 as a minimal read-only slice to power Production's
 * worker-assignment picker (components/domain/hr/employee-picker.tsx);
 * grown here into the full module per Task 49's instruction, not duplicated
 * into a second file — field shapes are copied verbatim from the real DTOs
 * throughout, both the original slice and everything added below.
 *
 * Note: every /employees route, including GET, requires `employees:manage`
 * (not a separate `employees:read`) per the current permissions catalogue —
 * a user who can create production orders but lacks that permission will
 * get a 403 from the worker picker specifically. This is the real backend
 * contract, not a frontend oversight; flagged here since it's easy to
 * mistake for a bug.
 *
 * Employees are deactivate-only, never hard-deleted (Phase 1 §3.5,
 * confirmed from employees.service.ts's own header comment) — this
 * preserves payroll linkage, since `PayrollEntry.employee` is `onDelete:
 * Restrict` and would reject a hard delete at the DB layer anyway. There is
 * deliberately no `deleteEmployee` function here.
 */

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';

export interface Employee {
  id: string;
  companyId: string;
  fullName: string;
  position: string | null;
  phone: string | null;
  hireDate: string | null;
  notes: string | null;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface QueryEmployeesInput {
  search?: string;
  status?: EmployeeStatus;
  limit?: number;
  offset?: number;
}

export interface PaginatedEmployees {
  items: Employee[];
  total: number;
  limit: number;
  offset: number;
}

export function queryEmployees(query: QueryEmployeesInput = {}): Promise<PaginatedEmployees> {
  return apiClient.get<PaginatedEmployees>('employees', { query: query as Record<string, string | number> });
}

export function getEmployee(id: string): Promise<Employee> {
  return apiClient.get<Employee>(`employees/${id}`);
}

export interface CreateEmployeeInput {
  fullName: string;
  position?: string;
  phone?: string;
  hireDate?: string;
  notes?: string;
}

export type UpdateEmployeeInput = Partial<CreateEmployeeInput>;

export function createEmployee(dto: CreateEmployeeInput): Promise<Employee> {
  return apiClient.post<Employee>('employees', dto);
}
export function updateEmployee(id: string, dto: UpdateEmployeeInput): Promise<Employee> {
  return apiClient.patch<Employee>(`employees/${id}`, dto);
}
/** Never hard-deleted — see file header. */
export function deactivateEmployee(id: string): Promise<Employee> {
  return apiClient.post<Employee>(`employees/${id}/deactivate`);
}
export function reactivateEmployee(id: string): Promise<Employee> {
  return apiClient.post<Employee>(`employees/${id}/reactivate`);
}

/** PIECEWORK is system-generated only, by ProductionExecutionsService#confirm (production-labor module, see lib/api-client/production-labor.ts) — never postable through recordManualEntry. */
export type PayrollEntryType = 'PIECEWORK' | 'ADVANCE' | 'BONUS' | 'PENALTY';
export const MANUAL_PAYROLL_ENTRY_TYPES = ['ADVANCE', 'BONUS', 'PENALTY'] as const;
export type ManualPayrollEntryType = (typeof MANUAL_PAYROLL_ENTRY_TYPES)[number];

export interface PayrollEntry {
  id: string;
  companyId: string;
  employeeId: string;
  type: PayrollEntryType;
  productionOrderId: string | null;
  unitsProduced: DecimalString | null;
  /** Signed — advances/penalties negative, bonuses/piecework positive (Phase 1 §2 convention). Already signed correctly by the backend; never re-sign this client-side. */
  amount: DecimalString;
  entryDate: string;
  comment: string | null;
  createdById: string;
  createdAt: string;
}

export interface RecordPayrollEntryInput {
  employeeId: string;
  type: ManualPayrollEntryType;
  /** Positive magnitude only — the backend applies the ADVANCE/PENALTY-negative, BONUS-positive sign convention itself. */
  amount: number;
  entryDate?: string;
  comment?: string;
}

export interface QueryPayrollEntriesInput {
  employeeId?: string;
  type?: PayrollEntryType;
  limit?: number;
  offset?: number;
}

export interface PaginatedPayrollEntries {
  items: PayrollEntry[];
  total: number;
  limit: number;
  offset: number;
}

export function recordPayrollEntry(dto: RecordPayrollEntryInput): Promise<PayrollEntry> {
  return apiClient.post<PayrollEntry>('payroll/entries', dto);
}
export function queryPayrollEntries(query: QueryPayrollEntriesInput = {}): Promise<PaginatedPayrollEntries> {
  return apiClient.get<PaginatedPayrollEntries>('payroll/entries', { query: query as Record<string, string | number> });
}

export interface PayrollSummaryLine {
  employeeId: string;
  employeeName: string;
  /** Real JSON numbers — a computed report, not Prisma rows (like BOM's cost/availability split). See lib/api-client/decimal.ts's convention note. */
  piecework: number;
  advances: number;
  bonuses: number;
  penalties: number;
  netTotal: number;
  defectCount: number;
}

export interface PayrollSummaryQuery {
  from?: string;
  to?: string;
}

/** Per-employee totals by type, plus a QC-defect count cross-referenced through assigned production orders (Phase 1 §6.5). */
export function getPayrollSummary(query: PayrollSummaryQuery = {}): Promise<PayrollSummaryLine[]> {
  return apiClient.get<PayrollSummaryLine[]>('payroll/summary', { query: query as Record<string, string> });
}

// ---- Teams (production-labor module, 2026-08-24) ----
// backend/src/modules/hr/teams.controller.ts. A team is a preset of worker
// composition only — never a payroll unit. Renaming/re-rostering a team
// never touches any ProductionExecution's own already-recorded allocations.

export interface TeamMember {
  id: string;
  companyId: string;
  teamId: string;
  employeeId: string;
  employee?: Employee;
}

export interface Team {
  id: string;
  companyId: string;
  name: string;
  createdAt: string;
  members?: TeamMember[];
}

export interface QueryTeamsInput {
  limit?: number;
  offset?: number;
}

export interface PaginatedTeams {
  items: Team[];
  total: number;
  limit: number;
  offset: number;
}

export function queryTeams(query: QueryTeamsInput = {}): Promise<PaginatedTeams> {
  return apiClient.get<PaginatedTeams>('teams', { query: query as Record<string, string | number> });
}
export function getTeam(id: string): Promise<Team> {
  return apiClient.get<Team>(`teams/${id}`);
}
export function createTeam(name: string): Promise<Team> {
  return apiClient.post<Team>('teams', { name });
}
export function updateTeam(id: string, name: string): Promise<Team> {
  return apiClient.patch<Team>(`teams/${id}`, { name });
}
/** Full replace, mirrors setProductionOrderWorkers. */
export function setTeamMembers(id: string, employeeIds: string[]): Promise<Team> {
  return apiClient.post<Team>(`teams/${id}/members`, { employeeIds });
}
export function deleteTeam(id: string): Promise<{ success: true }> {
  return apiClient.delete<{ success: true }>(`teams/${id}`);
}

// ---- Payroll periods (production-labor module, 2026-08-24) ----
// backend/src/modules/hr/payroll-periods.controller.ts. Closing a period
// blocks new/confirmed/voided payroll-affecting entries (manual PayrollEntry
// AND ProductionExecution create/confirm/void) dated inside it.

export type PayrollPeriodStatus = 'OPEN' | 'CLOSED';

export interface PayrollPeriod {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollPeriodStatus;
  closedById: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface CreatePayrollPeriodInput {
  periodStart: string;
  periodEnd: string;
}

export interface QueryPayrollPeriodsInput {
  limit?: number;
  offset?: number;
}

export interface PaginatedPayrollPeriods {
  items: PayrollPeriod[];
  total: number;
  limit: number;
  offset: number;
}

export function queryPayrollPeriods(query: QueryPayrollPeriodsInput = {}): Promise<PaginatedPayrollPeriods> {
  return apiClient.get<PaginatedPayrollPeriods>('payroll-periods', { query: query as Record<string, string | number> });
}
export function createPayrollPeriod(dto: CreatePayrollPeriodInput): Promise<PayrollPeriod> {
  return apiClient.post<PayrollPeriod>('payroll-periods', dto);
}
export function closePayrollPeriod(id: string): Promise<PayrollPeriod> {
  return apiClient.post<PayrollPeriod>(`payroll-periods/${id}/close`);
}
export function reopenPayrollPeriod(id: string): Promise<PayrollPeriod> {
  return apiClient.post<PayrollPeriod>(`payroll-periods/${id}/reopen`);
}
