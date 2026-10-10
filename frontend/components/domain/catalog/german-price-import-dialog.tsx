'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePreviewGermanPriceImport, useApplyGermanPriceImport } from '@/lib/hooks/use-catalog';
import type { GermanPricePreviewResult } from '@/lib/api-client/catalog';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface GermanPriceImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "нам потрібно не оновлювати наші ціни а поруч з нашими писати ці ціни
 * щоб бачити різницю" (2026-10-10): recognizes article+price rows from a
 * supplier .pdf/.xlsx and writes them into the existing
 * `Product.germanPriceExclVat` field only — `sellPriceEur`/`localPrice*`
 * (our own price/cost) are never touched. Two-step flow (preview, then an
 * explicit confirm) rather than a one-shot import like `ImportProductsDialog`
 * — this one matches by exact article code against the live catalog, so
 * showing "570 matched, 12 unmatched, 3 ambiguous" and the actual old→new
 * diff per row before writing anything is what makes a wrong recognition
 * (e.g. a misread OCR-adjacent digit) catchable before it lands, not after.
 */
export function GermanPriceImportDialog({ open, onOpenChange }: GermanPriceImportDialogProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const previewMutation = usePreviewGermanPriceImport();
  const applyMutation = useApplyGermanPriceImport();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<GermanPricePreviewResult | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<number | null>(null);

  function reset() {
    setFile(null);
    setError(null);
    setPreview(null);
    setExcluded(new Set());
    setApplied(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handlePreview() {
    if (!file) return;
    setError(null);
    try {
      setPreview(await previewMutation.mutateAsync(file));
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleApply() {
    if (!preview) return;
    setError(null);
    const updates = preview.matched
      .filter((m) => !excluded.has(m.productId))
      .map((m) => ({ productId: m.productId, price: m.recognizedPrice }));
    try {
      const res = await applyMutation.mutateAsync(updates);
      setApplied(res.updated);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  function toggle(productId: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  const includedCount = preview ? preview.matched.length - excluded.size : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('germanPriceImportTitle')}</DialogTitle>
        </DialogHeader>

        {applied !== null ? (
          <div className="space-y-4">
            <p className="text-sm">{t('germanPriceImportApplied', { count: applied })}</p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
            </DialogFooter>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('germanPriceImportPreviewSummary', {
                matched: preview.matched.length,
                unmatched: preview.unmatched.length,
                ambiguous: preview.ambiguous.length,
              })}
            </p>
            {preview.matched.length > 0 && (
              <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="w-8 p-2" />
                      <th className="p-2">{t('article')}</th>
                      <th className="p-2">{t('name')}</th>
                      <th className="p-2 text-right">{t('germanPriceImportCurrent')}</th>
                      <th className="p-2 text-right">{t('germanPriceImportRecognized')}</th>
                      <th className="p-2 text-right">{t('germanPriceImportDiff')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.matched.map((m) => (
                      <tr key={m.productId} className="border-b border-border/50">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={!excluded.has(m.productId)}
                            onChange={() => toggle(m.productId)}
                            aria-label={m.article}
                          />
                        </td>
                        <td className="max-w-[8rem] truncate p-2" title={m.article}>{m.article}</td>
                        <td className="max-w-[12rem] truncate p-2" title={m.productName}>{m.productName}</td>
                        <td className="p-2 text-right tabular-nums">{m.currentPrice === null ? '—' : m.currentPrice.toFixed(2)}</td>
                        <td className="p-2 text-right tabular-nums">{m.recognizedPrice.toFixed(2)}</td>
                        <td
                          className={cn(
                            'p-2 text-right tabular-nums',
                            m.diff !== null && m.diff !== 0 && (m.diff > 0 ? 'text-success' : 'text-destructive'),
                          )}
                        >
                          {m.diff === null ? '—' : (m.diff > 0 ? '+' : '') + m.diff.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.unmatched.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('germanPriceImportUnmatched', { count: preview.unmatched.length })}</summary>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                  {preview.unmatched.map((u) => (
                    <li key={u.article}>{u.article} — {u.recognizedPrice.toFixed(2)}</li>
                  ))}
                </ul>
              </details>
            )}
            {preview.ambiguous.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t('germanPriceImportAmbiguous', { count: preview.ambiguous.length })}</summary>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                  {preview.ambiguous.map((a) => (
                    <li key={a.article}>{a.article} — {a.prices.map((p) => p.toFixed(2)).join(' / ')}</li>
                  ))}
                </ul>
              </details>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>{tc('cancel')}</Button>
              <Button onClick={handleApply} loading={applyMutation.isPending} disabled={includedCount === 0}>
                {t('germanPriceImportApply', { count: includedCount })}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('germanPriceImportDescription')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={handlePreview} loading={previewMutation.isPending} disabled={!file}>
                {t('germanPriceImportRecognize')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
