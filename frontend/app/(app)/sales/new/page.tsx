'use client';

import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useCreateCustomerOrder } from '@/lib/hooks/use-sales';
import { useAssemblyCosts } from '@/lib/hooks/use-bom';
import { formatEur, fromDatetimeLocalValue } from '@/lib/utils';
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
import { HelpHint } from '@/components/ui/help-hint';

interface EditableItemRow {
  key: string;
  assemblyId?: string;
  qty: string;
  plannedStartAt: string;
  plannedEndAt: string;
  itemDeadline: string;
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
  const [plannedStartAt, setPlannedStartAt] = useState('');
  const [plannedCompletionAt, setPlannedCompletionAt] = useState('');
  const [plannedShipmentAt, setPlannedShipmentAt] = useState('');
  const [plannedDeliveryAt, setPlannedDeliveryAt] = useState('');
  const [deliveryCost, setDeliveryCost] = useState('');
  const [transportRiggingCost, setTransportRiggingCost] = useState('');
  const [otherCost, setOtherCost] = useState('');
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
  // Delivery/transport-rigging/other — entered directly, not BOM-derived —
  // count toward the same live total as the line estimates (mirrors
  // CustomerOrdersService#withPriceTotals' server-side fold for the list/
  // detail views once the order exists).
  const extraCosts = [deliveryCost, transportRiggingCost, otherCost]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  const extraCostsTotal = extraCosts.reduce((sum, v) => sum + v, 0);
  const hasExtraCosts = extraCosts.length > 0;

  const estimatedTotal =
    rowEstimates.some((v) => v != null) || hasExtraCosts
      ? rowEstimates.reduce((sum: number, v) => sum + (v ?? 0), 0) + extraCostsTotal
      : null;

  function addRow() {
    setRows((r) => [...r, { key: newRowKey(), qty: '', plannedStartAt: '', plannedEndAt: '', itemDeadline: '' }]);
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
      items.push({
        assemblyId: row.assemblyId,
        qty,
        plannedStartAt: fromDatetimeLocalValue(row.plannedStartAt),
        plannedEndAt: fromDatetimeLocalValue(row.plannedEndAt),
        itemDeadline: fromDatetimeLocalValue(row.itemDeadline),
      });
    }

    try {
      const order = await createOrder.mutateAsync({
        orderNumber: orderNumber || undefined,
        clientName: clientName.trim(),
        contactPerson: contactPerson || undefined,
        deadline: deadline || undefined,
        priority,
        plannedStartAt: fromDatetimeLocalValue(plannedStartAt),
        plannedCompletionAt: fromDatetimeLocalValue(plannedCompletionAt),
        plannedShipmentAt: fromDatetimeLocalValue(plannedShipmentAt),
        plannedDeliveryAt: fromDatetimeLocalValue(plannedDeliveryAt),
        deliveryCost: deliveryCost ? Number(deliveryCost) : undefined,
        transportRiggingCost: transportRiggingCost ? Number(transportRiggingCost) : undefined,
        otherCost: otherCost ? Number(otherCost) : undefined,
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
            <Input id="clientName" data-tour="sales-form-client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
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
          <div className="space-y-1.5" data-tour="sales-form-planned-dates">
            <Label htmlFor="plannedStartAt">{t('plannedStartAt')}</Label>
            <Input id="plannedStartAt" type="datetime-local" value={plannedStartAt} onChange={(e) => setPlannedStartAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plannedCompletionAt" className="flex items-center gap-1.5">
              {t('plannedCompletionAt')}
              <HelpHint title={t('plannedCompletionAt')} note="Можна змінити пізніше.">
                Коли планується завершити виконання цього замовлення. Цю дату потім бачить План-графік як плановий шар — окремо від фактичного прогресу виробництва.
              </HelpHint>
            </Label>
            <Input id="plannedCompletionAt" type="datetime-local" value={plannedCompletionAt} onChange={(e) => setPlannedCompletionAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plannedShipmentAt">{t('plannedShipmentAt')}</Label>
            <Input id="plannedShipmentAt" type="datetime-local" value={plannedShipmentAt} onChange={(e) => setPlannedShipmentAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plannedDeliveryAt">{t('plannedDeliveryAt')}</Label>
            <Input id="plannedDeliveryAt" type="datetime-local" value={plannedDeliveryAt} onChange={(e) => setPlannedDeliveryAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliveryCost">{t('deliveryCost')}</Label>
            <Input id="deliveryCost" type="number" step="any" min={0} value={deliveryCost} onChange={(e) => setDeliveryCost(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transportRiggingCost">{t('transportRiggingCost')}</Label>
            <Input
              id="transportRiggingCost"
              type="number"
              step="any"
              min={0}
              value={transportRiggingCost}
              onChange={(e) => setTransportRiggingCost(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="otherCost">{t('otherCost')}</Label>
            <Input id="otherCost" type="number" step="any" min={0} value={otherCost} onChange={(e) => setOtherCost(e.target.value)} />
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
                  <Fragment key={row.key}>
                    <TableRow>
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
                    {/* Optional per-line planning targets, only if they differ from the order's own (План-графік §4) — never auto-derived. */}
                    <TableRow className="border-0">
                      <TableCell colSpan={4} className="pt-0">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label htmlFor={`${row.key}-start`} className="text-xs text-muted-foreground">{t('itemPlannedStartAt')}</Label>
                            <Input id={`${row.key}-start`} type="datetime-local" value={row.plannedStartAt} onChange={(e) => updateRow(row.key, { plannedStartAt: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`${row.key}-end`} className="text-xs text-muted-foreground">{t('itemPlannedEndAt')}</Label>
                            <Input id={`${row.key}-end`} type="datetime-local" value={row.plannedEndAt} onChange={(e) => updateRow(row.key, { plannedEndAt: e.target.value })} />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`${row.key}-deadline`} className="text-xs text-muted-foreground">{t('itemDeadline')}</Label>
                            <Input id={`${row.key}-deadline`} type="datetime-local" value={row.itemDeadline} onChange={(e) => updateRow(row.key, { itemDeadline: e.target.value })} />
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </Fragment>
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
      <Button onClick={handleSubmit} loading={createOrder.isPending} data-tour="sales-form-save">
        {tc('create')}
      </Button>
    </div>
  );
}
