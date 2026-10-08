'use client';

import { useMemo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  queryAssemblies,
  getAssembly,
  getAssembliesByIds,
  createAssembly,
  updateAssembly,
  deleteAssembly,
  duplicateAssembly,
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
import { toNumber } from '@/lib/api-client/decimal';
import { useProductsByIds } from '@/lib/hooks/use-catalog';

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

export function useDuplicateAssembly() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => duplicateAssembly(id),
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
 * used to decide whether to show the "Підвироби" button when a sales-order
 * line's assembly is picked (2026-08-27: opt-in button, no longer
 * auto-opens the dialog — see sales/new/page.tsx).
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

/**
 * The assembly's own current PRODUCT-type BOM lines, resolved to real
 * articles — originally written once inline in `assembly-form.tsx` to
 * feed Step3DViewer's ✅/⚠️ cross-reference (via EntityDocumentsField),
 * now also used by the "Деталі (3D)" tab to know which of the model's
 * parts are already in this BOM (vs. just in the catalog).
 */
export function useAssemblyBomArticles(assemblyId: string | undefined) {
  const { data: components } = useAssemblyComponents(assemblyId);
  const productIds = useMemo(
    () => Array.from(new Set((components ?? []).filter((c) => c.componentType === 'PRODUCT' && c.productId).map((c) => c.productId as string))),
    [components],
  );
  const { data: productsById } = useProductsByIds(productIds);
  const bomArticles = useMemo(
    () => Array.from(productsById?.values() ?? []).map((p) => p.article).filter(Boolean),
    [productsById],
  );
  return { components, productIds, productsById, bomArticles };
}

/**
 * Shared "append PRODUCT lines to this assembly's BOM, preserving
 * everything already there" logic — originally written once inline in
 * `assembly-form.tsx` for the 3D-model "add to BOM"/"create product"
 * flows, now also used by the standalone "Деталі (3D)" tab
 * (`assembly-parts-check.tsx`), which needs the exact same
 * read-current-lines-then-replace-with-everything-plus-new behavior.
 * `setAssemblyComponents` REPLACES the whole line list, so any caller
 * doing more than one append in a row must batch them into ONE
 * `appendProductLines` call (passing every new line together) rather than
 * calling it repeatedly back-to-back — a second call before the first's
 * own query invalidation lands would read a stale `components` snapshot
 * and silently drop the first call's addition.
 */
export function useAssemblyBomActions(assemblyId: string | undefined) {
  const { data: components } = useAssemblyComponents(assemblyId);
  const setComponents = useSetAssemblyComponents(assemblyId ?? '');

  async function appendProductLines(items: { productId: string; qty: number }[]): Promise<void> {
    if (items.length === 0) return;
    const existingLines: AssemblyComponentLineInput[] = (components ?? []).map((c) => ({
      componentType: c.componentType,
      productId: c.productId ?? undefined,
      subAssemblyId: c.subAssemblyId ?? undefined,
      warehouseId: c.warehouseId ?? undefined,
      qtyPerUnit: toNumber(c.qtyPerUnit) ?? 0,
    }));
    const newLines: AssemblyComponentLineInput[] = items.map(({ productId, qty }) => ({
      componentType: 'PRODUCT',
      productId,
      qtyPerUnit: qty,
    }));
    await setComponents.mutateAsync([...existingLines, ...newLines]);
  }

  return { components, appendProductLines, isAppending: setComponents.isPending };
}
