'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { superAdminApi } from '@/lib/super-admin/api';

interface SuperAdminActionRow {
  id: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  createdAt: string;
  superAdmin: { email: string; fullName: string };
}

interface AuditEventRow {
  id: string;
  companyId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export default function SuperAdminAuditPage() {
  const t = useTranslations('superAdmin');
  const [actions, setActions] = useState<SuperAdminActionRow[]>([]);
  const [events, setEvents] = useState<AuditEventRow[]>([]);

  useEffect(() => {
    superAdminApi.get<{ items: SuperAdminActionRow[] }>('super-admin/audit/super-admin-actions').then((r) => setActions(r.items));
    superAdminApi.get<{ items: AuditEventRow[] }>('super-admin/audit/events').then((r) => setEvents(r.items));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('auditHeading')}</h1>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">{t('superAdminActions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('superAdminColumn')}</TableHead>
                <TableHead>{t('action')}</TableHead>
                <TableHead>{t('target')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-slate-400">{new Date(a.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{a.superAdmin.email}</TableCell>
                  <TableCell>{a.action}</TableCell>
                  <TableCell className="text-slate-400">
                    {a.targetType ? `${a.targetType}:${a.targetId}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {actions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500">
                    {t('noActionsYet')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">{t('tenantEvents')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('company')}</TableHead>
                <TableHead>{t('action')}</TableHead>
                <TableHead>{t('entity')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-slate-400">{new Date(e.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-slate-400">{e.companyId}</TableCell>
                  <TableCell>{e.action}</TableCell>
                  <TableCell className="text-slate-400">
                    {e.entityType}:{e.entityId}
                  </TableCell>
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500">
                    {t('noEventsYet')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
