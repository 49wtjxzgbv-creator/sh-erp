import { apiClient } from './http';
import type { DecimalString } from './decimal';

/**
 * Typed wrappers for backend/src/modules/billing/ (BillingController, path
 * `billing`). Field shapes copied verbatim from billing.service.ts/
 * plans.service.ts and schema.prisma's Plan/CompanySubscription models.
 *
 * This is a genuine Phase 0 stub, not a simplified port of something
 * real in the legacy system (the legacy Apps Script app had no billing at
 * all) — confirmed from billing.service.ts's own header comment:
 * `updatePlan` records which plan a company is on but collects no payment
 * and calls no Stripe API. There is no checkout flow to build here, only a
 * plan-switch action and a read of the current subscription.
 *
 * `GET /billing/plans` has no permission gate at all (every authenticated
 * role can see pricing tiers) — distinct from `GET /billing/subscription`
 * and `PUT /billing/subscription`, both gated on `company:billing`.
 *
 * `Plan.monthlyPriceEur` is a real Prisma-row Decimal field →
 * `DecimalString` as usual. `Plan.limits` is a free-form JSON object
 * (`{maxUsers, maxProducts, ...}` by convention, not a fixed shape) —
 * typed loosely on purpose, render whatever keys are present rather than
 * assuming a fixed set.
 */

export interface Plan {
  id: string;
  key: string;
  name: string;
  monthlyPriceEur: DecimalString;
  limits: Record<string, number | string | boolean>;
}

export function listPlans(): Promise<Plan[]> {
  return apiClient.get<Plan[]>('billing/plans');
}

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export interface CompanySubscription {
  companyId: string;
  planId: string;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string;
  plan: Plan;
}

export function getSubscription(): Promise<CompanySubscription> {
  return apiClient.get<CompanySubscription>('billing/subscription');
}

export type PlanKey = 'starter' | 'growth' | 'enterprise';

export function updateSubscription(planKey: PlanKey): Promise<CompanySubscription> {
  return apiClient.put<CompanySubscription>('billing/subscription', { planKey });
}
