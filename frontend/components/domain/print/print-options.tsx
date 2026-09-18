'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Printer, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Avatar } from '@/components/ui/avatar';

export interface PrintColumnOption {
  id: string;
  label: string;
}

/** A selectable print ROW (2026-09-18 — "обирати які позиції друкувати"), e.g. one BOM component line. `id` only needs to be unique within one print view (an array index is fine). */
export interface PrintRowOption {
  id: string;
  label: string;
  /** Optional thumbnail shown before the label (2026-09-18 follow-up — "перед артикулами додай також фото специфікацій"), same small Avatar every other picker/checklist in this app already uses. Omitted entirely when a caller has no photo for that row. */
  photoUrl?: string;
}

// Deep print views (e.g. an order's full assembly/sub-assembly/product
// composition — customer-order-print.tsx's AssemblyCompositionSection)
// mount a chain of N+1 useAssembly/useAssemblyCost/useFilesForEntities
// queries where each level only starts fetching once its parent's data has
// arrived — a real, observed multi-second waterfall for a several-levels-
// deep BOM (confirmed live: a real 6-assembly order pulled 150+ individual
// product requests and still hadn't finished at the 8s mark this constant
// used to be). If a stray query never settles, print still has to happen
// eventually rather than silently never firing — this is only the ceiling
// for that case, not the typical wait (the isFetching===0 gate below fires
// as soon as everything's actually settled, often well under this).
const PRINT_MAX_WAIT_MS = 20000;

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
 *
 * `printAreaId` (real regression, 2026-08-25): a page can host more than
 * one `<PrintArea>` at once — production/[id]/page.tsx always mounts both
 * AssemblySpecPrint's and PickListPrint's (the second only once the order
 * has started). `@media print`'s visibility trick used to target the bare
 * `.print-area` class, so BOTH became visible AND `position: absolute;
 * inset: 0` simultaneously the moment either one printed — two full
 * documents stacked exactly on top of each other, rows visibly
 * overlapping. Confirmed live: exactly 2 `.print-area` elements coexist on
 * that page once an order is started. `useId()` gives each `usePrintOptions`
 * call (and therefore each print view) a stable, page-wide-unique id;
 * right before firing `window.print()`, every OTHER print area is
 * explicitly deactivated and only this one is marked active (see
 * `print-area.tsx` + globals.css's `.print-area--active` rule). Every
 * `<PrintArea>` starts marked active by default (see print-area.tsx) so a
 * page with only one print view — every page except production/[id] —
 * behaves exactly as before, including a bare Ctrl+P with no button ever
 * clicked.
 */
export function usePrintOptions({
  columns,
  hasPhotos = false,
  id,
}: {
  columns: PrintColumnOption[];
  hasPhotos?: boolean;
  /**
   * Stable override for `printAreaId` (2026-09-16 fix — "коли натискаю
   * переглянути нічого не відображається"). `useId()`'s auto-generated
   * fallback below is only guaranteed stable WITHIN one mount, for its
   * original purpose (matching a live DOM node's data attribute right
   * before `window.print()`) — it is NOT guaranteed to reproduce the same
   * value on a SEPARATE fresh mount, which is exactly what a preview does
   * (PreviewButton opens a brand new tab, a full fresh React render). Round-
   * tripping that value through the URL (`?printAreaId=...`) and expecting
   * the new tab's own `useId()` call to land on the identical string was
   * the actual bug — pass a caller-authored constant here (unique among
   * whatever OTHER print areas share this same page, not globally) whenever
   * this view also uses `PreviewButton`.
   */
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(columns.map((c) => c.id)));
  const [includePhotos, setIncludePhotos] = useState(hasPhotos);
  // `null` = "never explicitly confirmed a row selection" -> every row
  // prints. Deliberately NOT seeded from a `rows` list at hook-call time the
  // way `visibleColumns` seeds from `columns`: `rows` for a view like
  // AssemblySpecPrint only exists once its own async data has loaded, well
  // after this hook's first render, so a `useState(() => new Set(rows...))`
  // initializer would permanently freeze on an empty Set from before that
  // data arrived. `PrintOptionsDialog` re-seeds ITS OWN row checkboxes from
  // the (by-then-loaded) `rows` prop fresh every time it opens instead — see
  // its own effect — so by the time `confirm` ever supplies a concrete Set
  // here, it always reflects the real row list.
  const [visibleRows, setVisibleRows] = useState<Set<string> | null>(null);
  const [printRequestId, setPrintRequestId] = useState(0);
  const isFetching = useIsFetching();
  const printedRequestId = useRef(0);
  const generatedId = useId();
  const printAreaId = id ?? generatedId;

  const activateOnlyThisPrintArea = useCallback(() => {
    document.querySelectorAll('.print-area').forEach((el) => {
      el.classList.toggle('print-area--active', el.getAttribute('data-print-area-id') === printAreaId);
    });
  }, [printAreaId]);

  useEffect(() => {
    if (printRequestId === 0 || printRequestId === printedRequestId.current) return;
    if (isFetching > 0) return;
    printedRequestId.current = printRequestId;
    activateOnlyThisPrintArea();
    window.print();
  }, [printRequestId, isFetching, activateOnlyThisPrintArea]);

  // Safety net: print anyway once PRINT_MAX_WAIT_MS has passed, in case one
  // stray query never settles — a slightly-incomplete printout beats one
  // that silently never happens.
  useEffect(() => {
    if (printRequestId === 0 || printRequestId === printedRequestId.current) return;
    const timer = setTimeout(() => {
      if (printedRequestId.current !== printRequestId) {
        printedRequestId.current = printRequestId;
        activateOnlyThisPrintArea();
        window.print();
      }
    }, PRINT_MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [printRequestId, activateOnlyThisPrintArea]);

  function confirm(nextVisibleColumns: Set<string>, nextIncludePhotos: boolean, nextVisibleRows?: Set<string>) {
    setVisibleColumns(nextVisibleColumns);
    setIncludePhotos(nextIncludePhotos);
    if (nextVisibleRows) setVisibleRows(nextVisibleRows);
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
    isRowVisible: (id: string) => visibleRows === null || visibleRows.has(id),
    printAreaId,
  };
}

export interface PrintOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PrintColumnOption[];
  hasPhotos?: boolean;
  /** Optional per-row checklist (2026-09-18 — "обирати які позиції друкувати"), e.g. one BOM component line per row. Omit entirely for views with nothing row-level to pick. */
  rows?: PrintRowOption[];
  onConfirm: (visibleColumns: Set<string>, includePhotos: boolean, visibleRows: Set<string>) => void;
  triggerLabel: string;
}

/**
 * Trigger button + the actual options dialog. Column checkboxes, the photo
 * toggle, and the optional row checklist all re-seed to "everything on"
 * each time the dialog opens (not once at mount) so a cancel-then-reopen
 * doesn't carry a half-picked state from an abandoned attempt — the row
 * checklist re-seeding from `rows` on every open is also what makes it safe
 * to use even though `rows` itself only becomes non-empty once its own
 * async data has loaded well after mount (see usePrintOptions's own
 * `visibleRows` doc comment).
 */
export function PrintOptionsDialog({ open, onOpenChange, columns, hasPhotos, rows, onConfirm, triggerLabel }: PrintOptionsDialogProps) {
  const tp = useTranslations('print');
  const tc = useTranslations('common');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(columns.map((c) => c.id)));
  const [photos, setPhotos] = useState(Boolean(hasPhotos));
  const [checkedRows, setCheckedRows] = useState<Set<string>>(() => new Set((rows ?? []).map((r) => r.id)));
  // Only reserve the thumbnail slot at all when at least one row actually
  // has a photo — a caller whose rows never set `photoUrl` shouldn't get a
  // checklist full of bare fallback-icon placeholders.
  const rowsHavePhotos = (rows ?? []).some((r) => r.photoUrl !== undefined);

  useEffect(() => {
    if (!open) return;
    setChecked(new Set(columns.map((c) => c.id)));
    setPhotos(Boolean(hasPhotos));
    setCheckedRows(new Set((rows ?? []).map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed on open only, columns/hasPhotos/rows are stable-enough per print view
  }, [open]);

  function toggleColumn(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRow(id: string) {
    setCheckedRows((prev) => {
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

            {rows && rows.length > 0 && (
              <div className="border-t border-border pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">{tp('rowsToInclude')}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setCheckedRows(new Set(rows.map((r) => r.id)))}
                    >
                      {tp('selectAll')}
                    </button>
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setCheckedRows(new Set())}>
                      {tp('selectNone')}
                    </button>
                  </div>
                </div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {rows.map((r) => (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-input"
                        checked={checkedRows.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                      />
                      {rowsHavePhotos && <Avatar src={r.photoUrl} size="sm" />}
                      <span className="truncate" title={r.label}>
                        {r.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="button" onClick={() => onConfirm(checked, photos, checkedRows)}>
              <Printer className="mr-2 h-4 w-4" />
              {tp('printAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
