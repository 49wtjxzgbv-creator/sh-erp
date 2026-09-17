'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useShippableGoods, useCreateShipment } from '@/lib/hooks/use-sales';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { AssemblyCell } from '@/components/domain/sales/assembly-cell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

/**
 * "Відвантажити" (2026-09-17 user request — "організуй відвантаження по
 * замовленнях, щоб можна було обрати готові вироби замовлення всі чи
 * частково") — order-scoped alternative to the generic new-shipment form
 * (sales/shipments/new), which makes staff hunt one assembly at a time
 * through a bare serial list disconnected from any specific order. This
 * dialog is seeded from `useShippableGoods` (CustomerOrdersService
 * #getShippableGoods) — every top-level item's own IN_STOCK units, oldest
 * first — and lets staff pick a plain QUANTITY per line (0..available,
 * defaulting to "all") rather than individual serials, since finished
 * units of the same specification are interchangeable for shipping
 * purposes. On submit, the first N (FIFO) serials per line are resolved
 * into `finishedGoodIds` and handed to the exact same `POST /shipments`
 * mutation the generic form uses — no backend write path duplicated.
 */
export function OrderShipmentDialog({ orderId }: { orderId: string }) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const canShip = useHasPermission('shipments:manage');

  const [open, setOpen] = useState(false);
  const { data: lines, isLoading } = useShippableGoods(open ? orderId : undefined);
  const createShipment = useCreateShipment();

  const [qtyByItem, setQtyByItem] = useState<Record<string, string>>({});
  const [carrier, setCarrier] = useState('');
  const [waybillNumber, setWaybillNumber] = useState('');
  const [packageCount, setPackageCount] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Defaults every line to "ship all available" the moment it loads,
  // without clobbering a quantity the user already edited.
  useEffect(() => {
    if (!lines) return;
    setQtyByItem((prev) => {
      const next = { ...prev };
      for (const line of lines) {
        if (next[line.itemId] === undefined) next[line.itemId] = String(line.qtyAvailable);
      }
      return next;
    });
  }, [lines]);

  if (!canShip) return null;

  const shippableLines = (lines ?? []).filter((l) => l.qtyAvailable > 0);
  const totalSelected = shippableLines.reduce((sum, l) => {
    const qty = Math.max(0, Math.min(Math.floor(Number(qtyByItem[l.itemId] ?? 0) || 0), l.qtyAvailable));
    return sum + qty;
  }, 0);

  function resetForm() {
    setQtyByItem({});
    setCarrier('');
    setWaybillNumber('');
    setPackageCount('');
    setWeightKg('');
    setDimensions('');
    setComment('');
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    const finishedGoodIds = shippableLines.flatMap((line) => {
      const qty = Math.max(0, Math.min(Math.floor(Number(qtyByItem[line.itemId] ?? 0) || 0), line.qtyAvailable));
      return line.finishedGoods.slice(0, qty).map((g) => g.id);
    });
    if (finishedGoodIds.length === 0) {
      setError(t('invalidShipment'));
      return;
    }
    try {
      const shipment = await createShipment.mutateAsync({
        customerOrderId: orderId,
        carrier: carrier || undefined,
        waybillNumber: waybillNumber || undefined,
        packageCount: packageCount ? Number(packageCount) : undefined,
        weightKg: weightKg ? Number(weightKg) : undefined,
        dimensions: dimensions || undefined,
        comment: comment || undefined,
        finishedGoodIds,
      });
      setOpen(false);
      router.push(`/sales/shipments/${shipment.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('shipOrder')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('shipOrderDialogTitle')}</DialogTitle>
          <DialogDescription>{t('shipOrderDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{tc('loading')}</p>
          ) : shippableLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noShippableItems')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('assembly')}</TableHead>
                  <TableHead>{t('qtyAvailable')}</TableHead>
                  <TableHead>{t('qtyToShip')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shippableLines.map((line) => (
                  <TableRow key={line.itemId}>
                    <TableCell>
                      <AssemblyCell assemblyId={line.assemblyId} />
                    </TableCell>
                    <TableCell>{line.qtyAvailable}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={line.qtyAvailable}
                        step="1"
                        className="w-24"
                        value={qtyByItem[line.itemId] ?? String(line.qtyAvailable)}
                        onChange={(e) => setQtyByItem((prev) => ({ ...prev, [line.itemId]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {shippableLines.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="shipCarrier">{t('carrier')}</Label>
                <Input id="shipCarrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shipWaybill">{t('waybillNumber')}</Label>
                <Input id="shipWaybill" value={waybillNumber} onChange={(e) => setWaybillNumber(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shipPackageCount">{t('packageCount')}</Label>
                <Input id="shipPackageCount" type="number" min={1} step="1" value={packageCount} onChange={(e) => setPackageCount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shipWeightKg">{t('weightKg')}</Label>
                <Input id="shipWeightKg" type="number" min={0} step="any" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shipDimensions">{t('dimensions')}</Label>
                <Input id="shipDimensions" value={dimensions} onChange={(e) => setDimensions(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="shipComment">{t('comment')}</Label>
                <Textarea id="shipComment" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc('cancel')}</Button>
          </DialogClose>
          {shippableLines.length > 0 && (
            <Button loading={createShipment.isPending} disabled={totalSelected === 0} onClick={handleSubmit}>
              {t('shipOrder')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
