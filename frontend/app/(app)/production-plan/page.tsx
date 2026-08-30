'use client';

import { useTranslations } from 'next-intl';
import { ProductionPlanOrdersList } from '@/components/domain/production/production-plan-orders-list';

/**
 * "План виробництва" (2026-08-30 user request) — own top-level sidebar
 * module, not a tab inside Виробництво. Content lives in the shared
 * ProductionPlanOrdersList (also reused by Виробництво → "По замовленнях",
 * restored per a later follow-up) — this file just supplies the module's
 * own heading and its own URL prefix for row/chart navigation.
 */
export default function ProductionPlanPage() {
  const t = useTranslations('productionPlan');
  return <ProductionPlanOrdersList basePath="/production-plan" title={t('title')} />;
}
