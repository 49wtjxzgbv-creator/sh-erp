'use client';

import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAssemblyVersion } from '@/lib/hooks/use-bom';
import { toNumber } from '@/lib/api-client/decimal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export default function AssemblyVersionDetailPage() {
  const params = useParams<{ id: string; versionId: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data: version, isLoading } = useAssemblyVersion(params.id, params.versionId);

  if (isLoading || !version) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">
        {t('versionNumber')} #{version.versionNumber} — {new Date(version.createdAt).toLocaleString()}
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('componentType')}</TableHead>
            <TableHead>{t('component')}</TableHead>
            <TableHead>{t('qtyPerUnit')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!version.components || version.components.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            version.components.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.componentType === 'PRODUCT' ? t('componentTypeProduct') : t('componentTypeAssembly')}</TableCell>
                <TableCell className="max-w-[240px] truncate">{c.productId ?? c.subAssemblyId}</TableCell>
                <TableCell>{toNumber(c.qtyPerUnit)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
