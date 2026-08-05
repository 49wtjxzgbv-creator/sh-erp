'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useAssemblyVersions } from '@/lib/hooks/use-bom';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';

export default function AssemblyVersionsPage() {
  const params = useParams<{ id: string }>();
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data: versions, isLoading } = useAssemblyVersions(params.id);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('versionNumber')}</TableHead>
          <TableHead>{t('createdAt')}</TableHead>
          <TableHead className="w-24">{tc('actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow>
            <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
              {tc('loading')}
            </TableCell>
          </TableRow>
        ) : !versions || versions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
              {tc('noResults')}
            </TableCell>
          </TableRow>
        ) : (
          versions.map((v) => (
            <TableRow key={v.id}>
              <TableCell>#{v.versionNumber}</TableCell>
              <TableCell>{new Date(v.createdAt).toLocaleString()}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/bom/${params.id}/versions/${v.id}`}>{t('viewVersion')}</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
