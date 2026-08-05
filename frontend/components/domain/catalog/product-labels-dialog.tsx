'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProducts } from '@/lib/hooks/use-catalog';
import { PrintArea, PrintButton, PrintDocumentHeader } from '@/components/domain/print/print-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export interface ProductLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface SelectedLabel {
  productId: string;
  article: string;
  code: string | null;
  name: string;
  cell: string | null;
  copies: number;
}

/** Pure — repeats each selected product `copies` times into a flat print-ready list. Extracted so it's unit-testable without mounting the dialog. */
export function expandLabelCopies(selected: SelectedLabel[]): SelectedLabel[] {
  return selected.flatMap((s) => Array.from({ length: s.copies }, () => s));
}

/**
 * Product article label printing ("Друк артикулів" in legacy — file name
 * `Labels.gs` is misleading, it used to be QR-code generation and was fully
 * replaced with plain-text article printing after in-browser QR scanning
 * proved unreliable, see that file's own header comment). No real barcode
 * symbology (Code128/EAN) exists anywhere in the legacy system either — this
 * preserves the exact same plain-text-article convention, a deliberate
 * product decision carried forward, not a v2 simplification.
 *
 * Search + add-with-copy-count, independent of the main Catalog DataTable
 * (which has no row-selection support — adding it there would touch every
 * other list page using DataTable; this is a self-contained picker instead,
 * same reasoning as ProductPicker/AssemblyPicker/etc.).
 */
export function ProductLabelsDialog({ open, onOpenChange }: ProductLabelsDialogProps) {
  const t = useTranslations('catalog');
  const tp = useTranslations('print');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedLabel[]>([]);
  const { data } = useProducts({ search, limit: 20 });

  function addProduct(p: { id: string; article: string; code: string | null; name: string; cell: string | null }) {
    setSelected((prev) =>
      prev.some((s) => s.productId === p.id)
        ? prev
        : [...prev, { productId: p.id, article: p.article, code: p.code, name: p.name, cell: p.cell, copies: 1 }],
    );
  }

  function updateCopies(productId: string, copies: number) {
    setSelected((prev) => prev.map((s) => (s.productId === productId ? { ...s, copies: Math.max(1, copies) } : s)));
  }

  function removeProduct(productId: string) {
    setSelected((prev) => prev.filter((s) => s.productId !== productId));
  }

  function reset() {
    setSearch('');
    setSelected([]);
  }

  const labelInstances = expandLabelCopies(selected);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('printLabelsTitle')}</DialogTitle>
        </DialogHeader>

        <div className="no-print space-y-4">
          <Input placeholder={t('searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <div className="max-h-40 overflow-auto rounded-md border border-border">
              {data?.items.length ? (
                data.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-secondary"
                  >
                    <span>{p.article} — {p.name}</span>
                    <span className="text-xs text-muted-foreground">+</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-muted-foreground">—</div>
              )}
            </div>
          )}

          {selected.length > 0 && (
            <div className="space-y-2">
              {selected.map((s) => (
                <div key={s.productId} className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.article}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.name}</p>
                  </div>
                  <Input
                    type="number"
                    min={1}
                    value={s.copies}
                    onChange={(e) => updateCopies(s.productId, Number(e.target.value))}
                    className="w-20"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeProduct(s.productId)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <PrintArea>
          <PrintDocumentHeader title={tp('labelsTitle')} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 8,
            }}
          >
            {labelInstances.map((label, i) => (
              <div key={i} style={{ border: '1px dashed #999', borderRadius: 4, padding: 8 }}>
                {label.code && <div style={{ fontSize: 10 }}>{label.code}</div>}
                <div style={{ fontSize: '1.5em', fontWeight: 700 }}>{label.article}</div>
                <div style={{ fontSize: '0.85em' }}>{label.name}</div>
                {label.cell && <div style={{ fontSize: 10 }}>{t('cell')}: {label.cell}</div>}
              </div>
            ))}
          </div>
        </PrintArea>

        <DialogFooter className="no-print">
          <PrintButton label={tp('printLabels')} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
