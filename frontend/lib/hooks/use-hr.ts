'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  reactivateEmployee,
  recordPayrollEntry,
  queryPayrollEntries,
  getPayrollSummary,
  queryTeams,
  getTeam,
  createTeam,
  updateTeam,
  setTeamMembers,
  deleteTeam,
  queryPayrollPeriods,
  createPayrollPeriod,
  closePayrollPeriod,
  reopenPayrollPeriod,
  type QueryEmployeesInput,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
  type RecordPayrollEntryInput,
  type QueryPayrollEntriesInput,
  type PayrollSummaryQuery,
  type QueryTeamsInput,
  type QueryPayrollPeriodsInput,
  type CreatePayrollPeriodInput,
} from '@/lib/api-client/hr';

const employeesKey = (query: QueryEmployeesInput) => ['employees', query] as const;
const employeeKey = (id: string) => ['employees', id] as const;
const payrollEntriesKey = (query: QueryPayrollEntriesInput) => ['payroll-entries', query] as const;
const payrollSummaryKey = (query: PayrollSummaryQuery) => ['payroll-summary', query] as const;
const teamsKey = (query: QueryTeamsInput) => ['teams', query] as const;
const teamKey = (id: string) => ['teams', id] as const;
const payrollPeriodsKey = (query: QueryPayrollPeriodsInput) => ['payroll-periods', query] as const;

/** Grown from Task 46's minimal read-only slice into the full HR module's hooks — see lib/api-client/hr.ts header comment. */
export function useEmployees(query: QueryEmployeesInput) {
  return useQuery({ queryKey: employeesKey(query), queryFn: () => queryEmployees(query) });
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: employeeKey(id ?? ''),
    queryFn: () => getEmployee(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateEmployeeInput) => createEmployee(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useUpdateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateEmployeeInput) => updateEmployee(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: employeeKey(id) });
    },
  });
}

export function useDeactivateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deactivateEmployee(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: employeeKey(id) });
    },
  });
}

export function useReactivateEmployee(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => reactivateEmployee(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: employeeKey(id) });
    },
  });
}

export function usePayrollEntries(query: QueryPayrollEntriesInput) {
  return useQuery({ queryKey: payrollEntriesKey(query), queryFn: () => queryPayrollEntries(query) });
}

export function useRecordPayrollEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: RecordPayrollEntryInput) => recordPayrollEntry(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll-entries'] });
      qc.invalidateQueries({ queryKey: ['payroll-summary'] });
    },
  });
}

export function usePayrollSummary(query: PayrollSummaryQuery) {
  return useQuery({ queryKey: payrollSummaryKey(query), queryFn: () => getPayrollSummary(query) });
}

// ---- Teams ----

export function useTeams(query: QueryTeamsInput) {
  return useQuery({ queryKey: teamsKey(query), queryFn: () => queryTeams(query) });
}

export function useTeam(id: string | undefined) {
  return useQuery({
    queryKey: teamKey(id ?? ''),
    queryFn: () => getTeam(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createTeam(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  });
}

export function useUpdateTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => updateTeam(id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: teamKey(id) });
    },
  });
}

export function useSetTeamMembers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeIds: string[]) => setTeamMembers(id, employeeIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: teamKey(id) });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  });
}

// ---- Payroll periods ----

export function usePayrollPeriods(query: QueryPayrollPeriodsInput) {
  return useQuery({ queryKey: payrollPeriodsKey(query), queryFn: () => queryPayrollPeriods(query) });
}

export function useCreatePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePayrollPeriodInput) => createPayrollPeriod(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-periods'] }),
  });
}

export function useClosePayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => closePayrollPeriod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-periods'] }),
  });
}

export function useReopenPayrollPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reopenPayrollPeriod(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll-periods'] }),
  });
}
