'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAssembly } from '@/lib/hooks/use-bom';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Avatar } from '@/components/ui/avatar';
import { FinishedGoodsTable } from '@/components/domain/production/finished-goods-table';

/** Reached by clicking a grouped row on Склад → В роботі — every not-yet-confirmed serialized unit of just this one assembly. */
export default function InProgressGoodsByAssemblyPage() {
  const params = useParams<{ assemblyId: string }>();
  const t = useTranslations('inventory');
  const tp = useTranslations('production');

  const { data: assembly } = useAssembly(params.assemblyId);
  const { data: photosByAssembly } = useFilesForEntities('Assembly', [params.assemblyId], 'ASSEMBLY_PHOTO');

  return (
    <div className="space-y-4">
      <Link href="/inventory/in-progress" className="text-sm text-muted-foreground hover:underline">
        {t('backToInProgressSummary')}
      </Link>
      <div className="flex items-center gap-3">
        <Avatar src={photosByAssembly?.[params.assemblyId]?.[0]?.downloadUrl} size="lg" />
        <div>
          <h2 className="text-lg font-semibold">{assembly?.name ?? params.assemblyId}</h2>
          {assembly?.article && <p className="text-sm text-muted-foreground">{tp('assembly')}: {assembly.article}</p>}
        </div>
      </div>
      <FinishedGoodsTable assemblyId={params.assemblyId} scope="IN_PROGRESS" />
    </div>
  );
}
