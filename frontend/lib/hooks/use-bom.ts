'use client';

import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryAssemblies,
  getAssembly,
  getAssembliesByIds,
  createAssembly,
  updateAssembly,
  deleteAssembly,
  getAssemblyComponents,
  setAssemblyComponents,
  getAssemblySuppliers,
  setAssemblySuppliers,
  getAssemblyVersions,
  getAssemblyVersion,
  calculateAssemblyCost,
  checkAssemblyAvailability,
  getSubAssembliesNeeded,
  produceAssembly,
  type QueryAssembliesInput,
  type CreateAssemblyInput,
  type UpdateAssemblyInput,
  type AssemblyComponentLineInput,
  type SetAssemblySupplierInput,
  type ProduceAssemblyInput,
} from '@/lib/api-client/bom';

const assembliesKey = (query: QueryAssembliesInput) => ['assemblies', query] as const;
const assemblyKey = (id: string) => ['assemblies', id] as const;
const componentsKey = (id: string) => ['assemblies', id, 'components'] as const;
const suppliersKey = (id: string) => ['assemblies', id, 'suppliers'] as const;
const versionsKey = (id: string) => ['assemblies', id, 'versions'] as const;
const versionKey = (id: string, versionId: string) => ['assemblies', id, 'versions', versionId] as const;
const costKey = (id: string) => ['assemblies', id, 'cost'] as const;

export function useAssemblies(query: QueryAssembliesInput) {
  return useQuery({ queryKey: assembliesKey(query), queryFn: () => queryAssemblies(query) });
}

export function useAssembly(id: string | undefined) {
  return useQuery({
    queryKey: assemblyKey(id ?? ''),
    queryFn: () => getAssembly(id as string),
    enabled: Boolean(id),
  });
}

/** Many assemblies in one call, keyed by id — mirrors useProductsByIds's shape. */
export function useAssembliesByIds(ids: string[]) {
  const sortedIds = [...ids].sort();
  return useQuery({
    queryKey: ['assemblies', 'batch', sortedIds] as const,
    queryFn: async () => {
      const assemblies = await getAssembliesByIds(sortedIds);
      return new Map(assemblies.map((a) => [a.id, a]));
    },
    enabled: sortedIds.length > 0,
  });
}

export function useCreateAssembly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAssemblyInput) => createAssembly(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assemblies'] }),
  });
}

export function useUpdateAssembly(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateAssemblyInput) => updateAssembly(id, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assemblies'] });
      qc.invalidateQueries({ queryKey: assemblyKey(id) });
    },
  });
}

export function useDeleteAssembly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAssembly(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assemblies'] }),
  });
}

export function useAssemblyComponents(assemblyId: string | undefined) {
  return useQuery({
    queryKey: componentsKey(assemblyId ?? ''),
    queryFn: () => getAssemblyComponents(assemblyId as string),
    enabled: Boolean(assemblyId),
  });
}

export function useSetAssemblyComponents(assemblyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (components: AssemblyComponentLineInput[]) => setAssemblyComponents(assemblyId, components),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: componentsKey(assemblyId) });
      qc.invalidateQueries({ queryKey: versionsKey(assemblyId) });
      qc.invalidateQueries({ queryKey: costKey(assemblyId) });
      qc.invalidateQueries({ queryKey: assemblyKey(assemblyId) });
    },
  });
}

export function useAssemblySuppliers(assemblyId: string | undefined) {
  return useQuery({
    queryKey: suppliersKey(assemblyId ?? ''),
    queryFn: () => getAssemblySuppliers(assemblyId as string),
    enabled: Boolean(assemblyId),
  });
}

export function useSetAssemblySuppliers(assemblyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (suppliers: SetAssemblySupplierInput[]) => setAssemblySuppliers(assemblyId, suppliers),
    onSuccess: () => qc.invalidateQueries({ queryKey: suppliersKey(assemblyId) }),
  });
}

export function useAssemblyVersions(assemblyId: string | undefined) {
  return useQuery({
    queryKey: versionsKey(assemblyId ?? ''),
    queryFn: () => getAssemblyVersions(assemblyId as string),
    enabled: Boolean(assemblyId),
  });
}

export function useAssemblyVersion(assemblyId: string | undefined, versionId: string | undefined) {
  return useQuery({
    queryKey: versionKey(assemblyId ?? '', versionId ?? ''),
    queryFn: () => getAssemblyVersion(assemblyId as string, versionId as string),
    enabled: Boolean(assemblyId && versionId),
  });
}

export function useAssemblyCost(assemblyId: string | undefined) {
  return useQuery({
    queryKey: costKey(assemblyId ?? ''),
    queryFn: () => calculateAssemblyCost(assemblyId as string),
    enabled: Boolean(assemblyId),
  });
}

/**
 * Same endpoint/cache entries as `useAssemblyCost` (shares `costKey`, so a
 * page using both never double-fetches an assembly this hook already has),
 * just batched via `useQueries` for a small dynamic list — e.g. pricing
 * every line of a sales order being built. No dedicated backend batch
 * endpoint: `assemblies/:id/cost` is already a cheap, on-demand pure
 * computation (not backed by heavy I/O), and order lines are always a
 * handful, not hundreds, so N small requests is proportionate here.
 */
export function useAssemblyCosts(assemblyIds: (string | undefined)[]) {
  return useQueries({
    queries: assemblyIds.map((id) => ({
      queryKey: costKey(id ?? ''),
      queryFn: () => calculateAssemblyCost(id as string),
      enabled: Boolean(id),
    })),
  });
}

/** Not cached as a query — availability is checked on demand for a specific candidate qty, not a stable resource to refetch in the background. */
export function useCheckAvailability() {
  return useMutation({
    mutationFn: ({ assemblyId, qty }: { assemblyId: string; qty: number }) => checkAssemblyAvailability(assemblyId, qty),
  });
}

/** On demand, same reasoning as useCheckAvailability above — checked fresh each time the planning dialog opens for a specific assembly+qty, not a background-refetched resource. */
export function useSubAssembliesNeeded() {
  return useMutation({
    mutationFn: ({ assemblyId, qty }: { assemblyId: string; qty: number }) => getSubAssembliesNeeded(assemblyId, qty),
  });
}

/**
 * "Does this assembly have ANY sub-assembly, at any depth" — a cheap,
 * qty-independent existence probe (fixed qty=1: presence/absence of an
 * ASSEMBLY-type BOM line doesn't depend on how many units are being built)
 * used to decide whether to auto-open SubAssemblyPlanningDialog when a
 * sales-order line's assembly is picked, without popping the dialog open
 * for the common case of an assembly with no sub-assemblies at all.
 */
/** Same `useQueries` shape as useAssemblyCosts above, for the same reason: a dynamic-length row list can't call a plain useQuery in a loop directly (Rules of Hooks). */
export function useHasSubAssembliesMany(assemblyIds: (string | undefined)[]) {
  return useQueries({
    queries: assemblyIds.map((id) => ({
      queryKey: ['sub-assemblies-needed-probe', id ?? ''],
      queryFn: async () => (await getSubAssembliesNeeded(id as string, 1)).length > 0,
      enabled: Boolean(id),
    })),
  });
}

export function useProduceAssembly(assemblyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: ProduceAssemblyInput) => produceAssembly(assemblyId, dto),
    onSuccess: () => {
      // Producing consumes real stock — every stock view elsewhere in the
      // app (Inventory levels/history) is now stale too.
      qc.invalidateQueries({ queryKey: ['stock-levels'] });
      qc.invalidateQueries({ queryKey: ['stock-history'] });
    },
  });
}
