'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useImportProducts } from '@/lib/hooks/use-catalog';
import type { ImportProductsResult } from '@/lib/api-client/catalog';
import { ApiError } from '@/lib/api-client/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ImportProductsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * File picker + upload for the .xlsx bulk import — see
 * lib/api-client/catalog.ts#importProducts's header comment for why this is
 * a real multipart upload rather than the FileUploadField/R2-presign
 * pattern every other file in this app uses (this is a one-shot,
 * server-parsed data file, not a durable per-entity attachment, so no
 * FileDomain/entityId exists yet to attach it to).
 */
export function ImportProductsDialog({ open, onOpenChange }: ImportProductsDialogProps) {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const importMutation = useImportProducts();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportProductsResult | null>(null);

  function reset() {
    setFile(null);
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleImport() {
    if (!file) return;
    setError(null);
    try {
      const res = await importMutation.mutateAsync(file);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('error'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('importProducts')}</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm">
              {t('importResultSummary', { created: result.created, updated: result.updated })}
            </p>
            {result.errors.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-medium text-destructive">{t('importErrorsTitle', { count: result.errors.length })}</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {t('importRowError', { row: e.row, message: e.message })}
                  </p>
                ))}
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{tc('close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('importDescription')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button onClick={handleImport} loading={importMutation.isPending} disabled={!file}>
                {t('importProducts')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
