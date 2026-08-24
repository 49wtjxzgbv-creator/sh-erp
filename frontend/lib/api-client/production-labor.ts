import { apiClient } from './http';
import type { DecimalString } from './decimal';
import type { CustomerOrderItem } from './sales';

/**
 * Production-labor module (2026-08-24) — backend/src/modules/production/
 * production-executions.{service,controller}.ts and work-tasks.{service,
 * controller}.ts. Field shapes copied verbatim from dto/production-execution.dto.ts
 * and dto/work-task.dto.ts.
 *
 * Locked invariants this client's callers must respect (see those service
 * files' own header comments for the full spec):
 *  - A ProductionExecution's `totalAmount` is NEVER sent by the client for a
 *    PRODUCT execution (productionOrderId set) — it's always server-computed
 *    from qtyCompleted / unitsPlanned x laborCostEur. Only GENERAL executions
 *    (workTaskId set) send totalAmount.
 *  - PERCENT/HOURS only ever split the already-computed totalAmount across
 *    workers — they never determine the fund's total size.
 *  - A CONFIRMED execution is never edited: use void/correct instead.
 */

export type ProductionExecutionMethod = 'SOLO' | 'TEAM' | 'MULTI_WORKER';
export type ExecutionAllocationMode = 'PERCENT' | 'HOURS';
export type ProductionExecutionStatus = 'DRAFT' | 'CONFIRMED' | 'VOIDED';

export interface ProductionExecutionAllocation {
  id: string;
  companyId: string;
  executionId: string;
  employeeId: string;
  percent: DecimalString | null;
  hours: DecimalString | null;
  amount: DecimalString;
}

export interface ProductionExecution {
  id: string;
  companyId: string;
  productionOrderId: string | null;
  workTaskId: string | null;
  performedAt: string;
  qtyCompleted: DecimalString | null;
  method: ProductionExecutionMethod;
  teamId: string | null;
  allocationMode: ExecutionAllocationMode;
  /** PRODUCT: server-computed. GENERAL: whatever was entered on create/patch. */
  totalAmount: DecimalString;
  status: ProductionExecutionStatus;
  recordedById: string;
  confirmedById: string | null;
  confirmedAt: string | null;
  note: string | null;
  supersedesId: string | null;
  createdAt: string;
  allocations: ProductionExecutionAllocation[];
}

export interface ProductionExecutionAllocationInput {
  employeeId: string;
  /** Required when allocationMode=PERCENT. */
  percent?: number;
  /** Required when allocationMode=HOURS — a coefficient, never an hourly wage. */
  hours?: number;
}

export interface CreateProductionExecutionInput {
  /** Exactly one of productionOrderId/workTaskId. */
  productionOrderId?: string;
  workTaskId?: string;
  performedAt: string;
  /** Required for PRODUCT; informational for GENERAL. */
  qtyCompleted?: number;
  method: ProductionExecutionMethod;
  teamId?: string;
  allocationMode: ExecutionAllocationMode;
  /** GENERAL only — omit for PRODUCT, the backend rejects it if sent there. */
  totalAmount?: number;
  allocations: ProductionExecutionAllocationInput[];
  note?: string;
}

export type PatchProductionExecutionInput = Partial<Omit<CreateProductionExecutionInput, 'productionOrderId' | 'workTaskId'>>;

/** Body for the replacement created by a correction — same shape as create minus the parent, which is inherited from the execution being corrected. */
export type CorrectProductionExecutionInput = Omit<CreateProductionExecutionInput, 'productionOrderId' | 'workTaskId'>;

export interface QueryProductionExecutionsInput {
  productionOrderId?: string;
  workTaskId?: string;
  status?: ProductionExecutionStatus;
  limit?: number;
  offset?: number;
}

export interface PaginatedProductionExecutions {
  items: ProductionExecution[];
  total: number;
  limit: number;
  offset: number;
}

export function queryProductionExecutions(query: QueryProductionExecutionsInput = {}): Promise<PaginatedProductionExecutions> {
  return apiClient.get<PaginatedProductionExecutions>('production-executions', { query: query as Record<string, string | number> });
}
export function getProductionExecution(id: string): Promise<ProductionExecution> {
  return apiClient.get<ProductionExecution>(`production-executions/${id}`);
}
export function createProductionExecution(dto: CreateProductionExecutionInput): Promise<ProductionExecution> {
  return apiClient.post<ProductionExecution>('production-executions', dto);
}
/** DRAFT-only — 409 once CONFIRMED. */
export function patchProductionExecution(id: string, dto: PatchProductionExecutionInput): Promise<ProductionExecution> {
  return apiClient.patch<ProductionExecution>(`production-executions/${id}`, dto);
}
/** DRAFT-only hard delete — a CONFIRMED execution must be voided instead. */
export function deleteProductionExecution(id: string): Promise<{ success: true }> {
  return apiClient.delete<{ success: true }>(`production-executions/${id}`);
}
/** The only place PayrollEntry PIECEWORK rows are generated. */
export function confirmProductionExecution(id: string): Promise<ProductionExecution> {
  return apiClient.post<ProductionExecution>(`production-executions/${id}/confirm`);
}
/** CONFIRMED-only — creates compensating PayrollEntry rows, flips status to VOIDED. History stays fully visible. */
export function voidProductionExecution(id: string, note?: string): Promise<ProductionExecution> {
  return apiClient.post<ProductionExecution>(`production-executions/${id}/void`, { note });
}
/** Void + create the replacement in one step. The replacement is left DRAFT — confirm it separately. */
export function correctProductionExecution(id: string, dto: CorrectProductionExecutionInput): Promise<ProductionExecution> {
  return apiClient.post<ProductionExecution>(`production-executions/${id}/correct`, dto);
}

// ---- GENERAL work (WorkTask) ----

export type WorkTaskStatus = 'OPEN' | 'CLOSED';

export interface WorkTaskItem {
  id: string;
  companyId: string;
  workTaskId: string;
  customerOrderItemId: string;
  /** Present on findOne/query (backend includes it) — the tagged line itself, for display. */
  customerOrderItem?: CustomerOrderItem;
}

export interface WorkTask {
  id: string;
  companyId: string;
  title: string;
  fund: DecimalString;
  status: WorkTaskStatus;
  createdById: string;
  createdAt: string;
  items?: WorkTaskItem[];
}

export interface CreateWorkTaskInput {
  title: string;
  fund: number;
}

export interface UpdateWorkTaskInput {
  title?: string;
  /** Cannot be lowered below what CONFIRMED executions have already drawn from it — 409 otherwise. */
  fund?: number;
}

export interface QueryWorkTasksInput {
  status?: WorkTaskStatus;
  limit?: number;
  offset?: number;
}

export interface PaginatedWorkTasks {
  items: WorkTask[];
  total: number;
  limit: number;
  offset: number;
}

export function queryWorkTasks(query: QueryWorkTasksInput = {}): Promise<PaginatedWorkTasks> {
  return apiClient.get<PaginatedWorkTasks>('work-tasks', { query: query as Record<string, string | number> });
}
export function getWorkTask(id: string): Promise<WorkTask> {
  return apiClient.get<WorkTask>(`work-tasks/${id}`);
}
export function createWorkTask(dto: CreateWorkTaskInput): Promise<WorkTask> {
  return apiClient.post<WorkTask>('work-tasks', dto);
}
export function updateWorkTask(id: string, dto: UpdateWorkTaskInput): Promise<WorkTask> {
  return apiClient.patch<WorkTask>(`work-tasks/${id}`, dto);
}
/** Full replace — purely informational tags, reporting only, never read by any fund/allocation calculation. */
export function setWorkTaskItems(id: string, customerOrderItemIds: string[]): Promise<WorkTask> {
  return apiClient.post<WorkTask>(`work-tasks/${id}/items`, { customerOrderItemIds });
}
export function closeWorkTask(id: string): Promise<WorkTask> {
  return apiClient.post<WorkTask>(`work-tasks/${id}/close`);
}
export function reopenWorkTask(id: string): Promise<WorkTask> {
  return apiClient.post<WorkTask>(`work-tasks/${id}/reopen`);
}
/** 409 if any executions have been recorded against this task. */
export function deleteWorkTask(id: string): Promise<{ success: true }> {
  return apiClient.delete<{ success: true }>(`work-tasks/${id}`);
}
