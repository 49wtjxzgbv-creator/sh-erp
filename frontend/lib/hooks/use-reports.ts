'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getReorderSuggestions,
  getWarehouseValuation,
  getMonthlyProductionRollup,
  type ReorderSuggestionsQuery,
  type MonthlyProductionRollupQuery,
} from '@/lib/api-client/reports';

/** All three reports are read-only — no mutations, so no useMutation hooks in this file. */
export function useReorderSuggestions(query: ReorderSuggestionsQuery) {
  return useQuery({ queryKey: ['reports', 'reorder-suggestions', query], queryFn: () => getReorderSuggestions(query) });
}

export function useWarehouseValuation() {
  return useQuery({ queryKey: ['reports', 'warehouse-valuation'], queryFn: () => getWarehouseValuation() });
}

export function useMonthlyProductionRollup(query: MonthlyProductionRollupQuery) {
  return useQuery({ queryKey: ['reports', 'monthly-production-rollup', query], queryFn: () => getMonthlyProductionRollup(query) });
}
