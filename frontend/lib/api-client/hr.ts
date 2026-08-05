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

/** PIECEWORK is system-generated only, from ProductionOrdersService.start() (Module 6) — never postable through recordManualEntry. */
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
