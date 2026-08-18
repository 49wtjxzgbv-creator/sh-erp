'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Printer, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export interface PrintColumnOption {
  id: string;
  label: string;
}

// Deep print views (e.g. an order's full assembly/sub-assembly/product
// composition — customer-order-print.tsx's AssemblyCompositionSection)
// mount a chain of N+1 useAssembly/useAssemblyCost/useFilesForEntities
// queries where each level only starts fetching once its parent's data has
// arrived — a real, observed multi-second waterfall for a several-levels-
// deep BOM. If a stray query never settles, print still has to happen
// eventually rather than silently never firing.
const PRINT_MAX_WAIT_MS = 8000;

/**
 * Owns the "which columns / include photos" print-options state for one
 * print view, and the "print now with THIS state, not whatever was on
 * screen before" sequencing. `window.print()` fires from an effect keyed
 * on `printRequestId` rather than directly in the confirm handler — React
 * batches the column/photo state updates from the same handler into one
 * render, so the effect (which only runs after that render commits) is
 * guaranteed to see the print-ready DOM with the just-confirmed selection
 * applied, not a stale one from before the dialog closed.
 *
 * `window.print()` itself waits for `useIsFetching()` (every in-flight
 * React Query request app-wide) to drop to zero before firing — otherwise
 * a still-loading nested async cell (a product/assembly name still
 * resolving) gets captured blank in the printed/PDF output, which is
 * exactly what happened before this existed: names and article numbers
 * missing from a customer order's printed full composition because
 * window.print() fired on the very next render after confirm, without
 * waiting for the composition tree's own data to arrive.
 */
export function usePrintOptions({ columns, hasPhotos = false }: { columns: PrintColumnOption[]; hasPhotos?: boolean }) {
  const [open, setOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(columns.map((c) => c.id)));
  const [includePhotos, setIncludePhotos] = useState(hasPhotos);
  const [printRequestId, setPrintRequestId] = useState(0);
  const isFetching = useIsFetching();
  const printedRequestId = useRef(0);

  useEffect(() => {
    if (printRequestId === 0 || printRequestId === printedRequestId.current) return;
    if (isFetching > 0) return;
    printedRequestId.current = printRequestId;
    window.print();
  }, [printRequestId, isFetching]);

  // Safety net: print anyway once PRINT_MAX_WAIT_MS has passed, in case one
  // stray query never settles — a slightly-incomplete printout beats one
  // that silently never happens.
  useEffect(() => {
    if (printRequestId === 0 || printRequestId === printedRequestId.current) return;
    const timer = setTimeout(() => {
      if (printedRequestId.current !== printRequestId) {
        printedRequestId.current = printRequestId;
        window.print();
      }
    }, PRINT_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [printRequestId]);

  function confirm(nextVisibleColumns: Set<string>, nextIncludePhotos: boolean) {
    setVisibleColumns(nextVisibleColumns);
    setIncludePhotos(nextIncludePhotos);
    setOpen(false);
    setPrintRequestId((n) => n + 1);
  }

  return {
    open,
    setOpen,
    visibleColumns,
    includePhotos,
    confirm,
    isColumnVisible: (id: string) => visibleColumns.has(id),
  };
}

export interface PrintOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PrintColumnOption[];
  hasPhotos?: boolean;
  onConfirm: (visibleColumns: Set<string>, includePhotos: boolean) => void;
  triggerLabel: string;
}

/**
 * Trigger button + the actual options dialog. Column checkboxes and the
 * photo toggle re-seed to "everything on" each time the dialog opens (not
 * once at mount) so a cancel-then-reopen doesn't carry a half-picked state
 * from an abandoned attempt.
 */
export function PrintOptionsDialog({ open, onOpenChange, columns, hasPhotos, onConfirm, triggerLabel }: PrintOptionsDialogProps) {
  const tp = useTranslations('print');
  const tc = useTranslations('common');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(columns.map((c) => c.id)));
  const [photos, setPhotos] = useState(Boolean(hasPhotos));

  useEffect(() => {
    if (!open) return;
    setChecked(new Set(columns.map((c) => c.id)));
    setPhotos(Boolean(hasPhotos));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on open only, columns/hasPhotos are stable per print view
  }, [open]);

  function toggleColumn(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        <Settings2 className="mr-2 h-4 w-4" />
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tp('printOptionsTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm font-medium">{tp('columnsToInclude')}</p>
            <div className="space-y-2">
              {columns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={checked.has(c.id)}
                    onChange={() => toggleColumn(c.id)}
                  />
                  {c.label}
                </label>
              ))}
            </div>

            {hasPhotos && (
              <label className="flex items-center gap-2 border-t border-border pt-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={photos}
                  onChange={(e) => setPhotos(e.target.checked)}
                />
                {tp('includePhotos')}
              </label>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="button" onClick={() => onConfirm(checked, photos)}>
              <Printer className="mr-2 h-4 w-4" />
              {tp('printAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
