'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useUpdateCustomerOrder } from '@/lib/hooks/use-sales';
import { toDatetimeLocalValue, fromDatetimeLocalValue } from '@/lib/utils';
import { toNumber } from '@/lib/api-client/decimal';
import { useApiErrorMessage } from '@/lib/api-error-message';
import type { CustomerOrder, CustomerOrderPriority } from '@/lib/api-client/sales';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export interface EditCustomerOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: CustomerOrder;
}

/**
 * Header-only edit (mirrors sales/new's own field set, minus items — item
 * lines stay immutable once created, same constraint CustomerOrdersService's
 * update() and UpdateCustomerOrderDto document: cancel and recreate for a
 * genuine line change). Re-seeds from `order` every time the dialog opens,
 * not once at mount, so a cancel-then-reopen doesn't carry stale edits.
 */
export function EditCustomerOrderDialog({ open, onOpenChange, order }: EditCustomerOrderDialogProps) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const updateOrder = useUpdateCustomerOrder(order.id);

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOrderNumber(order.orderNumber ?? '');
    setClientName(order.clientName);
    setContactPerson(order.contactPerson ?? '');
    setDeadline(order.deadline ? order.deadline.slice(0, 10) : '');
    setPriority(order.priority);
    setPlannedStartAt(toDatetimeLocalValue(order.plannedStartAt));
    setPlannedCompletionAt(toDatetimeLocalValue(order.plannedCompletionAt));
    setPlannedShipmentAt(toDatetimeLocalValue(order.plannedShipmentAt));
    setPlannedDeliveryAt(toDatetimeLocalValue(order.plannedDeliveryAt));
    setDeliveryCost(toNumber(order.deliveryCost)?.toString() ?? '');
    setTransportRiggingCost(toNumber(order.transportRiggingCost)?.toString() ?? '');
    setOtherCost(toNumber(order.otherCost)?.toString() ?? '');
    setComment(order.comment ?? '');
    setError(null);
  }, [open, order]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientName.trim()) {
      setError(t('invalidOrder'));
      return;
    }
    try {
      await updateOrder.mutateAsync({
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
      });
      onOpenChange(false);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('editOrder')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-clientName">{t('clientName')}</Label>
              <Input id="edit-clientName" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-orderNumber">{t('orderNumber')}</Label>
              <Input id="edit-orderNumber" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-contactPerson">{t('contactPerson')}</Label>
              <Input id="edit-contactPerson" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-deadline">{t('deadline')}</Label>
              <Input id="edit-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('priority')}</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as CustomerOrderPriority)}>
                <SelectTrigger>
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
            <div className="space-y-1.5">
              <Label htmlFor="edit-plannedStartAt">{t('plannedStartAt')}</Label>
              <Input id="edit-plannedStartAt" type="datetime-local" value={plannedStartAt} onChange={(e) => setPlannedStartAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-plannedCompletionAt">{t('plannedCompletionAt')}</Label>
              <Input
                id="edit-plannedCompletionAt"
                type="datetime-local"
                value={plannedCompletionAt}
                onChange={(e) => setPlannedCompletionAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-plannedShipmentAt">{t('plannedShipmentAt')}</Label>
              <Input
                id="edit-plannedShipmentAt"
                type="datetime-local"
                value={plannedShipmentAt}
                onChange={(e) => setPlannedShipmentAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-plannedDeliveryAt">{t('plannedDeliveryAt')}</Label>
              <Input
                id="edit-plannedDeliveryAt"
                type="datetime-local"
                value={plannedDeliveryAt}
                onChange={(e) => setPlannedDeliveryAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-deliveryCost">{t('deliveryCost')}</Label>
              <Input id="edit-deliveryCost" type="number" step="any" min={0} value={deliveryCost} onChange={(e) => setDeliveryCost(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-transportRiggingCost">{t('transportRiggingCost')}</Label>
              <Input
                id="edit-transportRiggingCost"
                type="number"
                step="any"
                min={0}
                value={transportRiggingCost}
                onChange={(e) => setTransportRiggingCost(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-otherCost">{t('otherCost')}</Label>
              <Input id="edit-otherCost" type="number" step="any" min={0} value={otherCost} onChange={(e) => setOtherCost(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-comment">{t('comment')}</Label>
              <Textarea id="edit-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" loading={updateOrder.isPending}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
