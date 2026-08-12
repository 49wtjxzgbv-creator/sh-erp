'use client';

import { useQuery } from '@tanstack/react-query';
import { search } from '@/lib/api-client/search';

/**
 * `enabled` is driven by the dropdown's own open state (see
 * `GlobalSearch`), not by query length — an empty query still returns a
 * real page of results (search.service.ts's "most recently touched" default
 * ordering), so the dropdown has positions to show the instant it opens,
 * before the user types anything.
 */
export function useGlobalSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => search(query),
    enabled,
    staleTime: 30 * 1000,
  });
}
