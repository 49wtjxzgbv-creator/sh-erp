'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useProductUsedInAssemblies } from '@/lib/hooks/use-catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export interface ProductUsedInAssembliesCardProps {
  productId: string;
}

/**
 * "зроби так що в кталозі товарів показувато до яких специфікацій
 * підвязаний товар, щоб такі речі самому дивитися а не тебе запитувати"
 * (2026-11-05) — read-only, no write path here; see ProductsService#getUsedInAssemblies.
 */
export function ProductUsedInAssembliesCard({ productId }: ProductUsedInAssembliesCardProps) {
  const t = useTranslations('catalog');
  const tBom = useTranslations('bom');
  const { data: usages, isLoading } = useProductUsedInAssemblies(productId);

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('usedInAssembliesTitle')}</CardTitle>
        <CardDescription>{t('usedInAssembliesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {usages && usages.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('article')}</TableHead>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{tBom('qtyPerUnit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usages.map((u) => (
                <TableRow key={u.assemblyId}>
                  <TableCell>{u.article ?? '—'}</TableCell>
                  <TableCell>
                    <Link href={`/bom/${u.assemblyId}`} className="text-primary hover:underline">
                      {u.name}
                    </Link>
                  </TableCell>
                  <TableCell>{toNumber(u.qtyPerUnit) ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t('usedInAssembliesEmpty')}</p>
        )}
      </CardContent>
    </Card>
  );
}
