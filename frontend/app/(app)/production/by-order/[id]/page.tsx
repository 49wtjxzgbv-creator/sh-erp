'use client';

import { useParams } from 'next/navigation';
import { ProductionPlanOrderDetail } from '@/components/domain/production/production-plan-order-detail';

/** Виробництво → "По замовленнях" order detail — content lives in the shared ProductionPlanOrderDetail (also reused by "План виробництва"). */
export default function ProductionByOrderDetailPage() {
  const params = useParams<{ id: string }>();
  return <ProductionPlanOrderDetail orderId={params.id} />;
}
