'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, X } from 'lucide-react';
import { useProducts } from '@/lib/hooks/use-catalog';
import { PrintArea, PrintButton } from '@/components/domain/print/print-area';
import { ProductLabelsPrintContent } from './product-labels-print-content';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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

  /**
   * Unlike every other print entry point, this dialog's selection (which
   * products, how many copies each) lives only in local React state, not a
   * URL a fresh tab could reload — so the preview serializes it into the
   * URL itself (`productId:copies`, comma-separated) instead of just
   * reopening the current route with `?print=1` the way PreviewButton
   * does. catalog/page.tsx's own `?print=1&labels=...` branch decodes this
   * and renders ProductLabelsPrintContent from real product data.
   */
  function openPreview() {
    const payload = selected.map((s) => `${s.productId}:${s.copies}`).join(',');
    const url = new URL(window.location.origin + '/catalog');
    url.searchParams.set('print', '1');
    url.searchParams.set('labels', payload);
    window.open(url.toString(), '_blank', 'noopener');
  }

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
          <ProductLabelsPrintContent labelInstances={labelInstances} />
        </PrintArea>

        <DialogFooter className="no-print">
          <PrintButton label={tp('printLabels')} />
          {selected.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={openPreview}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {tp('previewAction')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
