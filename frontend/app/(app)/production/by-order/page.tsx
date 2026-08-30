'use client';

import { ProductionPlanOrdersList } from '@/components/domain/production/production-plan-orders-list';

/**
 * "По замовленнях" (2026-08-27, moved to its own "План виробництва" sidebar
 * module 2026-08-30, restored here as a Виробництво tab the same day per a
 * follow-up user request — both entry points now render the exact same
 * shared ProductionPlanOrdersList, just linking into a different base URL
 * so each stays in its own module). No own <h1> — Виробництво's layout
 * already renders one.
 */
export default function ProductionByOrderPage() {
  return <ProductionPlanOrdersList basePath="/production/by-order" />;
}
