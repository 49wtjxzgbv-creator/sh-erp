'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryProductionExecutions,
  getProductionExecution,
  createProductionExecution,
  patchProductionExecution,
  deleteProductionExecution,
  confirmProductionExecution,
  voidProductionExecution,
  correctProductionExecution,
  queryWorkTasks,
  getWorkTask,
  createWorkTask,
  updateWorkTask,
  setWorkTaskItems,
  closeWorkTask,
  reopenWorkTask,
  deleteWorkTask,
  type QueryProductionExecutionsInput,
  type CreateProductionExecutionInput,
  type PatchProductionExecutionInput,
  type CorrectProductionExecutionInput,
  type QueryWorkTasksInput,
  type CreateWorkTaskInput,
  type UpdateWorkTaskInput,
} from '@/lib/api-client/production-labor';

const executionsKey = (query: QueryProductionExecutionsInput) => ['production-executions', query] as const;
const executionKey = (id: string) => ['production-executions', id] as const;
const workTasksKey = (query: QueryWorkTasksInput) => ['work-tasks', query] as const;
const workTaskKey = (id: string) => ['work-tasks', id] as const;

/** Invalidates everything an execution write can affect: the execution lists/detail, its parent (ProductionOrder's laborCostEur consumption / WorkTask's fund consumption), and payroll (confirm/void generate PayrollEntry rows). */
function invalidateExecutionEffects(qc: ReturnType<typeof useQueryClient>, execution: { id: string; productionOrderId: string | null; workTaskId: string | null }) {
  qc.invalidateQueries({ queryKey: ['production-executions'] });
  qc.invalidateQueries({ queryKey: executionKey(execution.id) });
  if (execution.productionOrderId) {
    qc.invalidateQueries({ queryKey: ['production-orders', execution.productionOrderId] });
  }
  if (execution.workTaskId) {
    qc.invalidateQueries({ queryKey: ['work-tasks'] });
    qc.invalidateQueries({ queryKey: workTaskKey(execution.workTaskId) });
  }
  qc.invalidateQueries({ queryKey: ['payroll-entries'] });
  qc.invalidateQueries({ queryKey: ['payroll-summary'] });
}

export function useProductionExecutions(query: QueryProductionExecutionsInput) {
  return useQuery({ queryKey: executionsKey(query), queryFn: () => queryProductionExecutions(query) });
}

export function useProductionExecution(id: string | undefined) {
  return useQuery({
    queryKey: executionKey(id ?? ''),
    queryFn: () => getProductionExecution(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateProductionExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProductionExecutionInput) => createProductionExecution(dto),
    onSuccess: (execution) => invalidateExecutionEffects(qc, execution),
  });
}

export function usePatchProductionExecution(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: PatchProductionExecutionInput) => patchProductionExecution(id, dto),
    onSuccess: (execution) => invalidateExecutionEffects(qc, execution),
  });
}

export function useDeleteProductionExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteProductionExecution(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['production-executions'] }),
  });
}

export function useConfirmProductionExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => confirmProductionExecution(id),
    onSuccess: (execution) => invalidateExecutionEffects(qc, execution),
  });
}

export function useVoidProductionExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) => voidProductionExecution(id, note),
    onSuccess: (execution) => invalidateExecutionEffects(qc, execution),
  });
}

export function useCorrectProductionExecution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CorrectProductionExecutionInput }) => correctProductionExecution(id, dto),
    onSuccess: (execution) => invalidateExecutionEffects(qc, execution),
  });
}

// ---- GENERAL work (WorkTask) ----

export function useWorkTasks(query: QueryWorkTasksInput) {
  return useQuery({ queryKey: workTasksKey(query), queryFn: () => queryWorkTasks(query) });
}

export function useWorkTask(id: string | undefined) {
  return useQuery({
    queryKey: workTaskKey(id ?? ''),
    queryFn: () => getWorkTask(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateWorkTaskInput) => createWorkTask(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-tasks'] }),
  });
}

export function useUpdateWorkTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateWorkTaskInput) => updateWorkTask(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-tasks'] });
      qc.invalidateQueries({ queryKey: workTaskKey(id) });
    },
  });
}

export function useSetWorkTaskItems(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customerOrderItemIds: string[]) => setWorkTaskItems(id, customerOrderItemIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-tasks'] });
      qc.invalidateQueries({ queryKey: workTaskKey(id) });
    },
  });
}

export function useCloseWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => closeWorkTask(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['work-tasks'] });
      qc.invalidateQueries({ queryKey: workTaskKey(id) });
    },
  });
}

export function useReopenWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reopenWorkTask(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['work-tasks'] });
      qc.invalidateQueries({ queryKey: workTaskKey(id) });
    },
  });
}

export function useDeleteWorkTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work-tasks'] }),
  });
}
