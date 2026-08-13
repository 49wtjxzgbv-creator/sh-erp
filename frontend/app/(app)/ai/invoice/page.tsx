'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRecognizeInvoice } from '@/lib/hooks/use-ai';
import type { InvoiceRecognitionLine } from '@/lib/api-client/ai';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

/**
 * Supplier invoice photo/scan → structured line items, fuzzy-matched
 * against existing Products (ai.service.ts#recognizeInvoice). Deliberately
 * does NOT use `FileUploadField`/the presign-PUT-confirm flow — the backend
 * wants the raw base64 inline for a direct multimodal model call and never
 * persists the image as a FileAsset (see lib/api-client/ai.ts's header
 * comment) — so this page reads the file itself via FileReader.
 */
export default function AiInvoicePage() {
  const t = useTranslations('ai');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const recognize = useRecognizeInvoice();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<{ base64: string; mimeType: string; name: string; dataUrl: string } | null>(null);
  const [lines, setLines] = useState<InvoiceRecognitionLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLines(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      setPreview({ base64, mimeType: f.type, name: f.name, dataUrl });
    };
    reader.readAsDataURL(f);
  }

  async function handleRecognize() {
    if (!preview) return;
    setError(null);
    try {
      const result = await recognize.mutateAsync({ base64Image: preview.base64, mimeType: preview.mimeType });
      setLines(result);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  function handleReset() {
    setPreview(null);
    setLines(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('invoiceRecognition')}</CardTitle>
          <CardDescription>{t('invoiceRecognitionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.dataUrl} alt={preview.name} className="max-h-64 rounded-md border border-border" />
          )}
          <div className="flex gap-2">
            <Button onClick={handleRecognize} loading={recognize.isPending} disabled={!preview}>
              {t('recognize')}
            </Button>
            {(preview || lines) && (
              <Button variant="outline" onClick={handleReset}>
                {tc('cancel')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {lines && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('rawName')}</TableHead>
              <TableHead>{t('qty')}</TableHead>
              <TableHead>{t('matchStatus')}</TableHead>
              <TableHead>{t('matchedProduct')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line, i) => (
              <TableRow key={i}>
                <TableCell>{line.rawName}</TableCell>
                <TableCell>{line.qty}</TableCell>
                <TableCell>
                  {line.matched ? (
                    <Badge variant="success">{t('matched')}</Badge>
                  ) : (
                    <Badge variant="warning">{t('notMatched')}</Badge>
                  )}
                </TableCell>
                <TableCell>{line.matched ? `${line.article} — ${line.matchedName}` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
