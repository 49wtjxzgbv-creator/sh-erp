'use client';

import { useQuery } from '@tanstack/react-query';
import { search } from '@/lib/api-client/search';

export function useGlobalSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => search(query),
    enabled: query.trim().length >= 2,
    staleTime: 30 * 1000,
  });
}
