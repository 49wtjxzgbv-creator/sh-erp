'use client';

import { useParams } from 'next/navigation';
import { CuttingPlanDetail } from '@/components/domain/cutting/cutting-plan-detail';

export default function CuttingPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  return <CuttingPlanDetail planId={params.planId} />;
}
