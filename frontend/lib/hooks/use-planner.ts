'use client';

import { useQuery } from '@tanstack/react-query';
import { getPlannerBoard, getPlannerKpis, type QueryPlannerBoardInput } from '@/lib/api-client/planner';

const boardKey = (query: QueryPlannerBoardInput) => ['planner-board', query] as const;
const kpisKey = (query: QueryPlannerBoardInput) => ['planner-kpis', query] as const;

export function usePlannerBoard(query: QueryPlannerBoardInput) {
  return useQuery({ queryKey: boardKey(query), queryFn: () => getPlannerBoard(query) });
}

export function usePlannerKpis(query: QueryPlannerBoardInput) {
  return useQuery({ queryKey: kpisKey(query), queryFn: () => getPlannerKpis(query) });
}
