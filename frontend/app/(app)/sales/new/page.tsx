'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useCreateCustomerOrder } from '@/lib/hooks/use-sales';
import { useAssemblyCosts } from '@/lib/hooks/use-bom';
import { formatEur } from '@/lib/utils';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CustomerOrderItemInput, CustomerOrderPriority } from '@/lib/api-client/sales';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface EditableItemRow {
  key: string;
  assemblyId?: string;
  qty: string;
}

let rowKeySeq = 0;
function newRowKey() {
  rowKeySeq += 1;
  return `co-item-row-${rowKeySeq}`;
}

export default function NewCustomerOrderPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const createOrder = useCreateCustomerOrder();

  const [orderNumber, setOrderNumber] = useState('');
  const [clientName, setClientName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<CustomerOrderPriority>('NORMAL');
  const [comment, setComment] = useState('');
  const [rows, setRows] = useState<EditableItemRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // "Оцінена ціна" — a live estimate from each assembly's current BOM cost
  // (sellPriceEur-based, the one price basis every calculation in this app
  // is pinned to), not a stored value: nothing about a not-yet-created
  // order is frozen yet. `assemblies/:id/cost` is cheap/on-demand, and an
  // order rarely has more than a handful of lines, so one small request
  // per row (via useAssemblyCosts) is proportionate — see that hook.
  const costResults = useAssemblyCosts(rows.map((r) => r.assemblyId));
  const rowEstimates = rows.map((row, i) => {
    const qty = Number(row.qty);
    const cost = costResults[i]?.data;
    return row.assemblyId && cost && qty > 0 ? cost.costPerUnit * qty : null;
  });
  const estimatedTotal = rowEstimates.some((v) => v != null)
    ? rowEstimates.reduce((sum: number, v) => sum + (v ?? 0), 0)
    : null;

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), qty: '' }]);
  }
  function removeRow(key: string) {
    setRows((r) => r.filter((row) => row.key !== key));
  }
  function updateRow(key: string, patch: Partial<EditableItemRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function handleSubmit() {
    setError(null);
    if (!clientName.trim()) {
      setError(t('invalidOrder'));
      return;
    }
    if (rows.length === 0) {
      setError(t('invalidRow'));
      return;
    }
    const items: CustomerOrderItemInput[] = [];
    for (const row of rows) {
      const qty = Number(row.qty);
      if (!row.assemblyId || !qty || qty <= 0) {
        setError(t('invalidRow'));
        return;
      }
      items.push({ assemblyId: row.assemblyId, qty });
    }

    try {
      const order = await createOrder.mutateAsync({
        orderNumber: orderNumber || undefined,
        clientName: clientName.trim(),
        contactPerson: contactPerson || undefined,
        deadline: deadline || undefined,
        priority,
        comment: comment || undefined,
        items,
      });
      router.replace(`/sales/${order.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('newOrder')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('orderHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="clientName">{t('clientName')}</Label>
            <Input id="clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="orderNumber">{t('orderNumber')}</Label>
            <Input id="orderNumber" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactPerson">{t('contactPerson')}</Label>
            <Input id="contactPerson" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deadline">{t('deadline')}</Label>
            <Input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t('priority')}</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as CustomerOrderPriority)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LOW">{t('priorityLOW')}</SelectItem>
                <SelectItem value="NORMAL">{t('priorityNORMAL')}</SelectItem>
                <SelectItem value="HIGH">{t('priorityHIGH')}</SelectItem>
                <SelectItem value="URGENT">{t('priorityURGENT')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="comment">{t('comment')}</Label>
            <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assembly')}</TableHead>
                <TableHead className="w-32">{t('qty')}</TableHead>
                <TableHead className="w-32">{t('estimatedPrice')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    {tc('noResults')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <AssemblyPicker value={row.assemblyId} onChange={(id) => updateRow(row.key, { assemblyId: id })} />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        value={row.qty}
                        onChange={(e) => updateRow(row.key, { qty: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {rowEstimates[i] != null ? formatEur(rowEstimates[i]!) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
              {estimatedTotal != null && (
                <TableRow className="border-t-2 border-border font-medium">
                  <TableCell colSpan={2}>{t('estimatedTotal')}</TableCell>
                  <TableCell colSpan={2}>{formatEur(estimatedTotal)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addLine')}
          </Button>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={handleSubmit} loading={createOrder.isPending}>
        {tc('create')}
      </Button>
    </div>
  );
}
