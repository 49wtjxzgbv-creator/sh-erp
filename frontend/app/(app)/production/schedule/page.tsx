'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  useProductionSchedule,
  useCreateProductionScheduleSlot,
  useUpdateProductionScheduleSlot,
  useDeleteProductionScheduleSlot,
  useConvertProductionScheduleSlot,
} from '@/lib/hooks/use-production';
import type { ScheduleSlotLine } from '@/lib/api-client/production';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { ScheduleTimeline } from '@/components/domain/production/schedule-timeline';
import { AssemblyPicker } from '@/components/domain/bom/assembly-picker';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingBlock } from '@/components/ui/loading-block';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function ProductionSchedulePage() {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());

  const from = useMemo(() => new Date(year, 0, 1), [year]);
  const to = useMemo(() => new Date(year, 11, 31, 23, 59, 59), [year]);

  const { data, isLoading } = useProductionSchedule({ from: from.toISOString(), to: to.toISOString() });

  const [createOpen, setCreateOpen] = useState(false);
  const [editSlot, setEditSlot] = useState<ScheduleSlotLine | null>(null);

  if (isLoading || !data) {
    return <LoadingBlock />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-16 text-center text-lg font-medium">{year}</span>
          <Button variant="outline" size="icon" onClick={() => setYear((y) => y + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t('addSlot')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <SlotForm onDone={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          <ScheduleTimeline
            orders={data.orders}
            slots={data.slots}
            from={from}
            to={to}
            onOrderClick={(id) => router.push(`/production/${id}`)}
            onSlotClick={(slot) => setEditSlot(slot)}
          />
        </CardContent>
      </Card>

      <Dialog open={Boolean(editSlot)} onOpenChange={(open) => !open && setEditSlot(null)}>
        <DialogContent>
          {editSlot && <SlotForm slot={editSlot} onDone={() => setEditSlot(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Shared create/edit form for a planning slot — with edit also offering delete and "convert to real order". */
function SlotForm({ slot, onDone }: { slot?: ScheduleSlotLine; onDone: () => void }) {
  const t = useTranslations('production');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const create = useCreateProductionScheduleSlot();
  const update = useUpdateProductionScheduleSlot(slot?.id ?? '');
  const remove = useDeleteProductionScheduleSlot();
  const convert = useConvertProductionScheduleSlot();

  const [assemblyId, setAssemblyId] = useState<string | undefined>(slot?.assemblyId ?? undefined);
  const [title, setTitle] = useState(slot?.title ?? '');
  const [plannedUnits, setPlannedUnits] = useState(slot?.plannedUnits != null ? String(slot.plannedUnits) : '');
  const [startAt, setStartAt] = useState(slot ? toDateInput(new Date(slot.startAt)) : '');
  const [endAt, setEndAt] = useState(slot ? toDateInput(new Date(slot.endAt)) : '');
  const [error, setError] = useState<string | null>(null);

  const busy = create.isPending || update.isPending || remove.isPending || convert.isPending;

  async function handleSubmit() {
    setError(null);
    if (!title.trim() || !startAt || !endAt) {
      setError(t('invalidSlot'));
      return;
    }
    const dto = {
      assemblyId,
      title: title.trim(),
      plannedUnits: plannedUnits ? Number(plannedUnits) : undefined,
      startAt: new Date(startAt).toISOString(),
      endAt: new Date(endAt).toISOString(),
    };
    try {
      if (slot) {
        await update.mutateAsync(dto);
      } else {
        await create.mutateAsync(dto);
      }
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    if (!slot) return;
    setError(null);
    try {
      await remove.mutateAsync(slot.id);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleConvert() {
    if (!slot) return;
    setError(null);
    try {
      await convert.mutateAsync(slot.id);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{slot ? t('editSlot') : t('addSlot')}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>{t('assemblyOptional')}</Label>
          <AssemblyPicker value={assemblyId} onChange={setAssemblyId} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slot-title">{t('slotTitle')}</Label>
          <Input id="slot-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="slot-units">{t('plannedUnits')}</Label>
            <Input id="slot-units" type="number" step="any" min={0} value={plannedUnits} onChange={(e) => setPlannedUnits(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="slot-start">{t('startDate')}</Label>
            <Input id="slot-start" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-end">{t('endDate')}</Label>
            <Input id="slot-end" type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <div className="flex gap-2">
          {slot && (
            <>
              <Button variant="destructive" size="sm" loading={remove.isPending} onClick={handleDelete}>
                {tc('delete')}
              </Button>
              <Button variant="outline" size="sm" loading={convert.isPending} onClick={handleConvert}>
                {t('convertToOrder')}
              </Button>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm">{tc('cancel')}</Button>
          </DialogClose>
          <Button size="sm" loading={create.isPending || update.isPending} onClick={handleSubmit}>
            {tc('save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
