'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useInventorySessions, useStartInventorySession } from '@/lib/hooks/use-inventory';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { RequirePermission } from '@/components/domain/auth/require-permission';

export default function InventorySessionsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const { data: sessions, isLoading } = useInventorySessions();
  const startSession = useStartInventorySession();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      const session = await startSession.mutateAsync({ name: name.trim(), comment: comment || undefined });
      setOpen(false);
      setName('');
      setComment('');
      router.push(`/inventory/sessions/${session.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="inventory-sessions:manage" redirectTo="/inventory">
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t('newSession')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('newSession')}</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleStart}>
              <Input placeholder={t('sessionName')} value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder={t('comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="submit" loading={startSession.isPending} disabled={!name.trim()}>
                  {t('startSession')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sessionName')}</TableHead>
            <TableHead>{tc('actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('loading')}
              </TableCell>
            </TableRow>
          ) : !sessions || sessions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={2} className="py-6 text-center text-muted-foreground">
                {tc('noResults')}
              </TableCell>
            </TableRow>
          ) : (
            sessions.map((session) => (
              <TableRow key={session.id} className="cursor-pointer" onClick={() => router.push(`/inventory/sessions/${session.id}`)}>
                <TableCell>{session.name}</TableCell>
                <TableCell>
                  <Badge variant={session.status === 'COMPLETED' ? 'success' : 'outline'}>
                    {session.status === 'COMPLETED' ? t('statusCompleted') : t('statusInProgress')}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
    </RequirePermission>
  );
}
