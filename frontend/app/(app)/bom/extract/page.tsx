'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCreateAssembly, useExtractComponentsFromStep, useSetAssemblyComponents } from '@/lib/hooks/use-bom';
import { useExtractBomFromDrawing } from '@/lib/hooks/use-ai';
import { uploadFile, type FileDomain } from '@/lib/api-client/files';
import type { MatchedBomLine } from '@/lib/api-client/ai';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { useHasPermission } from '@/lib/hooks/use-roles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ProductPicker } from '@/components/domain/catalog/product-picker';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';
import { RequirePermission } from '@/components/domain/auth/require-permission';

const STEP_EXTENSION = /\.(step|stp)$/i;

/**
 * "Креслення → специфікація" (2026-10-31) — AI (PDF/scan) or exact STEP-
 * structure (no AI) extraction of a draft BOM from a technical drawing, so
 * nobody retypes a parts list by hand. Creates the real Assembly FIRST
 * (name required up front), then attaches the drawing to that real
 * assembly id and extracts — avoids the "FileAsset needs a real entityId"
 * problem a create-after-extract order would hit, and means nothing is
 * ever thrown away if the user abandons the flow partway through (same
 * risk profile the plain "new assembly" form already has today).
 */
export default function ExtractBomPage() {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const router = useRouter();
  const canCreateProduct = useHasPermission('products:write');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createAssembly = useCreateAssembly();
  const extractFromDrawing = useExtractBomFromDrawing();
  const extractFromStep = useExtractComponentsFromStep();

  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [assemblyId, setAssemblyId] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<'drawing' | 'step' | null>(null);
  const [lines, setLines] = useState<MatchedBomLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createLineIndex, setCreateLineIndex] = useState<number | null>(null);
  const setComponents = useSetAssemblyComponents(assemblyId ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);

  const extracting = createAssembly.isPending || extractFromDrawing.isPending || extractFromStep.isPending;

  async function handleExtract() {
    if (!name.trim() || !file) return;
    setError(null);
    const isStep = STEP_EXTENSION.test(file.name);
    try {
      const assembly = await createAssembly.mutateAsync({ name: name.trim() });
      setAssemblyId(assembly.id);

      const domain: FileDomain = isStep ? 'ASSEMBLY_3D_MODEL' : 'ASSEMBLY_DRAWING';
      const fileAsset = await uploadFile(file, { domain, entityType: 'Assembly', entityId: assembly.id });

      const result = isStep
        ? await extractFromStep.mutateAsync(fileAsset.id)
        : await extractFromDrawing.mutateAsync(fileAsset.id);
      setSourceKind(isStep ? 'step' : 'drawing');
      setLines(result.lines);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  function updateLine(index: number, patch: Partial<MatchedBomLine>) {
    setLines((prev) => (prev ? prev.map((line, i) => (i === index ? { ...line, ...patch } : line)) : prev));
  }

  const allResolved = lines !== null && lines.length > 0 && lines.every((l) => l.productId);

  async function handleSave() {
    if (!assemblyId || !lines || !allResolved) return;
    setSaveError(null);
    try {
      await setComponents.mutateAsync(lines.map((l) => ({ componentType: 'PRODUCT' as const, productId: l.productId, qtyPerUnit: l.qty })));
      router.push(`/bom/${assemblyId}/components`);
    } catch (err) {
      setSaveError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <RequirePermission permission="assemblies:write" redirectTo="/bom">
      <div className="max-w-3xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold">{t('extractTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('extractDescription')}</p>
        </div>

        {!lines && (
          <Card data-tour="bom-extract-upload-card">
            <CardHeader>
              <CardTitle className="text-base">{t('extractUploadTitle')}</CardTitle>
              <CardDescription>{t('extractUploadDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="extract-name">{t('name')}</Label>
                <Input id="extract-name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('extractFileLabel')}</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*,.step,.stp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
                />
                <p className="text-xs text-muted-foreground">{t('extractFileHint')}</p>
              </div>
              <Button onClick={handleExtract} loading={extracting} disabled={!name.trim() || !file}>
                {t('extractAction')}
              </Button>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>
        )}

        {lines && (
          <>
            <Card className="border-primary/40 bg-primary/5">
              <CardContent className="py-4 text-sm">
                {sourceKind === 'step' ? t('extractSourceStep') : t('extractSourceDrawing')}
              </CardContent>
            </Card>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('extractColName')}</TableHead>
                  <TableHead className="w-24">{t('extractColQty')}</TableHead>
                  <TableHead>{t('extractColDimensions')}</TableHead>
                  <TableHead>{t('extractColMatch')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input
                        value={line.rawName}
                        onChange={(e) => updateLine(i, { rawName: e.target.value })}
                        className="h-8 min-w-[12rem]"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0.0001}
                        step="any"
                        value={line.qty}
                        onChange={(e) => updateLine(i, { qty: Number(e.target.value) || 0 })}
                        className="h-8 w-20"
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{line.dimensions ?? '—'}</TableCell>
                    <TableCell>
                      {line.matched ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="success">{t('extractMatched')}</Badge>
                          <span className="text-xs text-muted-foreground">{line.article} — {line.matchedName}</span>
                        </div>
                      ) : (
                        <div className="w-56">
                          <ProductPicker
                            value={line.productId || undefined}
                            onChange={(productId, label) =>
                              updateLine(i, {
                                productId: productId ?? '',
                                matched: Boolean(productId),
                                matchedName: label?.split(' — ').slice(1).join(' — ') ?? '',
                              })
                            }
                            placeholder={t('extractPickProduct')}
                          />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {!line.matched && !line.productId && canCreateProduct && (
                        <Button variant="outline" size="sm" onClick={() => setCreateLineIndex(i)}>
                          {t('extractCreateProduct')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {!allResolved && <p className="text-xs text-muted-foreground">{t('extractUnresolvedHint')}</p>}
            {saveError && <p className="text-sm text-destructive">{saveError}</p>}

            <div className="flex gap-2">
              <Button onClick={handleSave} loading={setComponents.isPending} disabled={!allResolved}>
                {t('extractSave')}
              </Button>
              <Button variant="outline" onClick={() => router.push(assemblyId ? `/bom/${assemblyId}` : '/bom')}>
                {tc('cancel')}
              </Button>
            </div>
          </>
        )}

        {createLineIndex !== null && lines && (
          <CreateProductDialog
            open={createLineIndex !== null}
            onOpenChange={(open) => !open && setCreateLineIndex(null)}
            initialValues={{ name: lines[createLineIndex].rawName, initialQty: lines[createLineIndex].qty }}
            onCreated={(product) => {
              updateLine(createLineIndex, { matched: true, productId: product.id, article: product.article, matchedName: product.name });
              setCreateLineIndex(null);
            }}
          />
        )}
      </div>
    </RequirePermission>
  );
}
