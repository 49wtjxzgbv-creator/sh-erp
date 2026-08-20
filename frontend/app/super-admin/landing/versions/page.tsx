'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/domain/shell/confirm-dialog';
import { landingPageAdminApi } from '@/lib/super-admin/landing-page-api';

interface VersionRow {
  id: string;
  versionNumber: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  createdAt: string;
}

export default function LandingPageVersionsPage() {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<VersionRow | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

  useEffect(() => {
    landingPageAdminApi.listVersions().then(setVersions);
  }, []);

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      await landingPageAdminApi.restoreVersion(restoreTarget.id);
      setRestoredMessage(`Версію №${restoreTarget.versionNumber} скопійовано в чернетку. Перейдіть у редактор, щоб переглянути й опублікувати.`);
    } finally {
      setRestoring(false);
      setRestoreTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Історія публікацій</h1>
        <Link href="/super-admin/landing" className="text-sm text-slate-400 hover:text-slate-200">
          Назад до редактора
        </Link>
      </div>

      {restoredMessage && (
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm text-slate-200">
          {restoredMessage} <Link href="/super-admin/landing" className="underline">Відкрити редактор</Link>
        </div>
      )}

      <Card className="border-slate-800 bg-slate-900 text-slate-100">
        <CardHeader>
          <CardTitle className="text-base">Опубліковані та архівні версії</CardTitle>
        </CardHeader>
        <CardContent>
          {!versions ? (
            <p className="text-sm text-slate-400">Завантаження…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-slate-400">Ще жодної публікації не було.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Версія</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Опубліковано</TableHead>
                  <TableHead className="text-right">Дії</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>№{v.versionNumber}</TableCell>
                    <TableCell>
                      <Badge variant={v.status === 'PUBLISHED' ? 'default' : 'secondary'}>{v.status === 'PUBLISHED' ? 'Опубліковано' : 'Архів'}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-400">{v.publishedAt ? new Date(v.publishedAt).toLocaleString('uk-UA') : '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setRestoreTarget(v)}>
                        Відновити в чернетку
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title="Відновити цю версію?"
        description={`Вміст версії №${restoreTarget?.versionNumber} буде скопійовано в поточну чернетку, замінивши незбережені зміни. Сторінка НЕ опублікується автоматично — потрібно буде натиснути "Опублікувати" в редакторі.`}
        onConfirm={handleRestore}
        confirmLabel="Відновити"
        confirming={restoring}
      />
    </div>
  );
}
