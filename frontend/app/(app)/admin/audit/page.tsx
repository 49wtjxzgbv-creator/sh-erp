'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuditEvents } from '@/lib/hooks/use-audit';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { LoadingBlock } from '@/components/ui/loading-block';

const PAGE_SIZE = 50;

/**
 * Viewer for the generic audit trail (`AuditEvent`, replaces the legacy
 * free-text History sheet's catch-all half — Phase 1 §3.2). Every module
 * has been writing to this since Module 2; this is the first page that
 * reads it back.
 */
export default function AdminAuditPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useAuditEvents({
    entityType: entityType || undefined,
    action: action || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="audit-entityType">{t('entityType')}</Label>
          <Input
            id="audit-entityType"
            placeholder="ProductionOrder"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setOffset(0);
            }}
            className="w-48"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-action">{t('action')}</Label>
          <Input
            id="audit-action"
            placeholder="production_order.started"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
            className="w-64"
          />
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('action')}</TableHead>
                <TableHead>{t('entityType')}</TableHead>
                <TableHead>{t('entityId')}</TableHead>
                <TableHead>{t('actor')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-xs">{new Date(event.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{event.action}</TableCell>
                  <TableCell>{event.entityType}</TableCell>
                  <TableCell className="font-mono text-xs">{event.entityId}</TableCell>
                  <TableCell className="text-xs">{event.actorUserId ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('totalEvents', { count: data?.total ?? 0 })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                {tc('back')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!data || offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                {tc('next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
