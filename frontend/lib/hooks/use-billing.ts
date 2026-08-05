'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listPlans, getSubscription, updateSubscription, type PlanKey } from '@/lib/api-client/billing';

const plansKey = ['billing-plans'] as const;
const subscriptionKey = ['billing-subscription'] as const;

export function usePlans() {
  return useQuery({ queryKey: plansKey, queryFn: () => listPlans() });
}

export function useSubscription() {
  return useQuery({ queryKey: subscriptionKey, queryFn: () => getSubscription() });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planKey: PlanKey) => updateSubscription(planKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: subscriptionKey }),
  });
}
