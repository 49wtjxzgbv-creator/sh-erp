'use client';

import { useParams } from 'next/navigation';
import { CuttingPlanDetail } from '@/components/domain/cutting/cutting-plan-detail';

export default function AssemblyCuttingPlanDetailPage() {
  const params = useParams<{ id: string; planId: string }>();
  return <CuttingPlanDetail planId={params.planId} />;
}
