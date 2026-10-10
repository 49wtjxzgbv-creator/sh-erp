'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Assembly, CreateAssemblyInput } from '@/lib/api-client/bom';
import { toNumber } from '@/lib/api-client/decimal';
import { useAssemblyBomArticles, useAssemblyBomActions } from '@/lib/hooks/use-bom';
import { queryProducts } from '@/lib/api-client/catalog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';
import { PendingPhotoField } from '@/components/domain/files/pending-photo-field';
import { EntityDocumentsField, isGlbFile } from '@/components/domain/files/entity-documents-field';
import { listFilesForEntities, getFileDownloadUrl, uploadFile } from '@/lib/api-client/files';
import { toast } from '@/lib/hooks/use-toast';
import { Entity3DModelField } from '@/components/domain/files/entity-3d-model-field';
import { EntitySuppliersEditor } from '@/components/domain/procurement/entity-suppliers-editor';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';
import { useCreateProductFromPart } from '@/components/domain/bom/use-create-product-from-part';

const assemblySchema = z.object({
  name: z.string().min(1),
  article: z.string().optional(),
  note: z.string().optional(),
  laborCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  packagingCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  deliveryCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  otherCostPerUnit: z.coerce.number().min(0).optional().or(z.literal('')),
  baseSalePriceEur: z.coerce.number().min(0).optional().or(z.literal('')),
  germanPriceEur: z.coerce.number().min(0).optional().or(z.literal('')),
});
export type AssemblyFormValues = z.infer<typeof assemblySchema>;

export function assemblyToFormValues(assembly?: Assembly): Partial<AssemblyFormValues> {
  if (!assembly) return {};
  return {
    name: assembly.name,
    article: assembly.article ?? undefined,
    note: assembly.note ?? undefined,
    laborCostPerUnit: toNumber(assembly.laborCostPerUnit) ?? undefined,
    packagingCostPerUnit: toNumber(assembly.packagingCostPerUnit) ?? undefined,
    deliveryCostPerUnit: toNumber(assembly.deliveryCostPerUnit) ?? undefined,
    otherCostPerUnit: toNumber(assembly.otherCostPerUnit) ?? undefined,
    baseSalePriceEur: toNumber(assembly.baseSalePriceEur) ?? undefined,
    germanPriceEur: toNumber(assembly.germanPriceEur) ?? undefined,
  };
}

export interface AssemblyFormProps {
  assembly?: Assembly;
  onSubmit: (values: CreateAssemblyInput) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  /** Only used in create mode (no `assembly` yet) — see PendingPhotoField. */
  pendingPhoto?: File | null;
  onPendingPhotoChange?: (file: File | null) => void;
  /** Create-mode only: seeds fields (e.g. name/article from a 3D-model "Складові вузли" candidate — see `useCreateAssemblyFromPart`) without a full `Assembly`. */
  initialValues?: Partial<AssemblyFormValues>;
  /** View-only for a role with `assemblies:read` but not `assemblies:write`. */
  readOnly?: boolean;
}

export function AssemblyForm({
  assembly,
  onSubmit,
  submitting,
  submitError,
  pendingPhoto,
  onPendingPhotoChange,
  initialValues,
  readOnly,
}: AssemblyFormProps) {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const tf = useTranslations('files');
  const tp = useTranslations('procurement');

  // "3D-модель — звірка з BOM" (2026-10-08): the assembly's own current
  // PRODUCT-type BOM lines, resolved to real articles — passed down to
  // Step3DViewer (via EntityDocumentsField) so it can flag which 3D-model
  // parts do/don't line up with what's actually in the specification.
  const { bomArticles } = useAssemblyBomArticles(assembly?.id);

  // "Якщо деталей якихось не має, то має бути кнопка додати до BOM
  // специфікації" + "потрібна кнопка додати все" + "однієї позиції там
  // може бути декілька штук а воно додає по одній" (2026-10-08): resolves
  // every requested article against this company's own catalog (exact
  // match, case-insensitive — `queryProducts`'s own `search` is a loose
  // `contains`, so this re-filters down to a real match) and appends
  // whichever ones matched as new PRODUCT lines in ONE write (via the
  // shared `useAssemblyBomActions` — see its own header comment for why
  // every article must go through a single `appendProductLines` call
  // rather than one call per article), each with qtyPerUnit set to how
  // many times that article's node actually appears in the 3D model
  // (Step3DViewer's own `qty`, counted from the tree — see its
  // `unmatchedArticleCounts` header comment), not a flat 1 — the user
  // still adjusts it afterward in «Склад (BOM)» if needed, same as any
  // other line. `setComponents`'s own `onSuccess` already invalidates
  // this assembly's components query, which is what `bomArticles` above is
  // derived from — no separate refetch wiring needed, the ✅ just appears
  // once the chain above re-renders with the new data.
  const { appendProductLines } = useAssemblyBomActions(assembly?.id);
  async function handleAddToBom(items: { article: string; qty: number }[]): Promise<{ notFound: string[] }> {
    const notFound: string[] = [];
    const productLines: { productId: string; qty: number }[] = [];
    for (const { article, qty } of items) {
      const matches = await queryProducts({ search: article, limit: 20 });
      const product = matches.items.find((p) => p.article.trim().toUpperCase() === article.trim().toUpperCase());
      if (product) productLines.push({ productId: product.id, qty });
      else notFound.push(article);
    }
    await appendProductLines(productLines);
    return { notFound };
  }

  // "а те чого немає в каталозі запропонувати створити новий товар" +
  // "потрібно щоб воно робило фото саме цієї деталі і додавало" +
  // "щоб до товару додавало gbl файл саме цієї позиції якої робить фото"
  // (2026-10-08): the 3D viewer bubbles up "create article X, named
  // roughly Y, qty Z, here's a photo AND the standalone .glb of just that
  // part" rather than owning the create-product UI itself (see
  // Step3DViewer's `onCreateProduct` header comment) — the shared
  // `useCreateProductFromPart` owns the actual dialog wiring (seeds its
  // photo field with the snapshot — still user-editable — and, once the
  // product is created, appends it to the BOM and uploads the .glb as
  // that new product's own document); this just forwards its handlers.
  const { requestCreate: handleCreateProduct, dialogProps: createProductDialogProps } = useCreateProductFromPart(appendProductLines);

  // "Камера та Примірка (AR)... у загальному 3D-перегляді, коли обрано
  // деталь" (2026-10-10): same exact-match catalog lookup as
  // `handleAddToBom` above (no catalog Product, no AR — there's nothing to
  // attach a standalone .glb to), then reuses whatever `.glb` the node
  // already has attached (same `PRODUCT_DOCUMENT` domain/convention as
  // "Прикріпити GLB" in assembly-parts-check-viewer.tsx) or uploads the one
  // Step3DViewer just exported if it doesn't.
  async function handleActivateAr(article: string, _name: string, glb: ArrayBuffer | null): Promise<string | null> {
    const matches = await queryProducts({ search: article, limit: 20 });
    const product = matches.items.find((p) => p.article.trim().toUpperCase() === article.trim().toUpperCase());
    if (!product) {
      toast.error(tf('arNoProduct', { article }));
      return null;
    }
    // "показується не весь виріб а по одній деталі" (2026-10-10): the
    // batch endpoint (unlike `listFilesForEntity`) returns presigned URLs
    // including `arOptimizedDownloadUrl` — the de-instanced variant AR
    // specifically needs, see GlbOptimizationService's header comment.
    const existingDocs = (await listFilesForEntities('Product', [product.id], 'PRODUCT_DOCUMENT'))[product.id] ?? [];
    const existingGlb = existingDocs.find((f) => isGlbFile(f.originalName));
    if (existingGlb) {
      return existingGlb.arOptimizedDownloadUrl || existingGlb.downloadUrl;
    }
    if (!glb) return null;
    const glbFile = new File([glb], `${product.article}.glb`, { type: 'model/gltf-binary' });
    const asset = await uploadFile(glbFile, { domain: 'PRODUCT_DOCUMENT', entityType: 'Product', entityId: product.id });
    // Freshly uploaded — GlbOptimizationService's own AR pass hasn't run
    // yet (fire-and-forget), so this first AR view necessarily uses the
    // raw upload until a later click/refetch picks up `arOptimizedDownloadUrl`.
    const { downloadUrl } = await getFileDownloadUrl(asset.id);
    return downloadUrl;
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AssemblyFormValues>({
    resolver: zodResolver(assemblySchema),
    defaultValues: { ...assemblyToFormValues(assembly), ...initialValues },
  });

  async function submit(values: AssemblyFormValues) {
    const numeric = (v: number | '' | undefined) => (v === '' || v === undefined ? undefined : v);
    await onSubmit({
      ...values,
      laborCostPerUnit: numeric(values.laborCostPerUnit),
      packagingCostPerUnit: numeric(values.packagingCostPerUnit),
      deliveryCostPerUnit: numeric(values.deliveryCostPerUnit),
      otherCostPerUnit: numeric(values.otherCostPerUnit),
      baseSalePriceEur: numeric(values.baseSalePriceEur),
      germanPriceEur: numeric(values.germanPriceEur),
    });
  }

  // Field `id`s match their zod schema keys (see `id="name"` below) — on
  // failed validation, scroll to the topmost errored field so a required-
  // field error doesn't go unnoticed when the user has scrolled to Save.
  function scrollToFirstError(formErrors: typeof errors) {
    const elements = Object.keys(formErrors)
      .map((key) => document.getElementById(key))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const topmost = elements.reduce((a, b) =>
      a.getBoundingClientRect().top <= b.getBoundingClientRect().top ? a : b,
    );
    topmost.scrollIntoView({ behavior: 'smooth', block: 'center' });
    topmost.focus({ preventScroll: true });
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit(submit, scrollToFirstError)} noValidate>
      <fieldset disabled={readOnly} className="contents">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('photo')}</CardTitle>
        </CardHeader>
        <CardContent>
          {assembly ? (
            <EntityPhotoField domain="ASSEMBLY_PHOTO" entityType="Assembly" entityId={assembly.id} />
          ) : (
            <PendingPhotoField value={pendingPhoto ?? null} onChange={onPendingPhotoChange ?? (() => {})} />
          )}
        </CardContent>
      </Card>

      {assembly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf('documents')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntityDocumentsField
              domain="ASSEMBLY_DOCUMENT"
              entityType="Assembly"
              entityId={assembly.id}
              bomArticles={bomArticles}
              onAddToBom={readOnly ? undefined : handleAddToBom}
              onCreateProduct={readOnly ? undefined : handleCreateProduct}
              onActivateAr={readOnly ? undefined : handleActivateAr}
            />
          </CardContent>
        </Card>
      )}

      {assembly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf('model3d')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Entity3DModelField domain="ASSEMBLY_3D_MODEL" entityType="Assembly" entityId={assembly.id} />
            <p className="mt-2 text-xs text-muted-foreground">{tf('model3dHint')}</p>
          </CardContent>
        </Card>
      )}

      {assembly && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tp('suppliers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntitySuppliersEditor entityType="Assembly" entityId={assembly.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('assemblyHeader')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('name')}</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{tc('requiredField')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="article">{t('article')}</Label>
            <Input id="article" {...register('article')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="note">{t('note')}</Label>
            <Textarea id="note" {...register('note')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="laborCostPerUnit">{t('laborCostPerUnit')}</Label>
            <Input id="laborCostPerUnit" type="number" step="any" {...register('laborCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="packagingCostPerUnit">{t('packagingCostPerUnit')}</Label>
            <Input id="packagingCostPerUnit" type="number" step="any" {...register('packagingCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliveryCostPerUnit">{t('deliveryCostPerUnit')}</Label>
            <Input id="deliveryCostPerUnit" type="number" step="any" {...register('deliveryCostPerUnit')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="otherCostPerUnit">{t('otherCostPerUnit')}</Label>
            <Input id="otherCostPerUnit" type="number" step="any" {...register('otherCostPerUnit')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('pricingHeader')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5 sm:max-w-xs">
            <Label htmlFor="baseSalePriceEur">{t('baseSalePriceEur')}</Label>
            <Input id="baseSalePriceEur" type="number" step="any" {...register('baseSalePriceEur')} />
            <p className="text-xs text-muted-foreground">{t('baseSalePriceEurHint')}</p>
          </div>
          <div className="mt-4 space-y-1.5 sm:max-w-xs">
            <Label htmlFor="germanPriceEur">{t('germanPriceEur')}</Label>
            <Input id="germanPriceEur" type="number" step="any" {...register('germanPriceEur')} />
            <p className="text-xs text-muted-foreground">{t('germanPriceEurHint')}</p>
          </div>
        </CardContent>
      </Card>
      </fieldset>
      {submitError && <p className="text-sm text-destructive">{submitError}</p>}
      {!readOnly && (
        <Button type="submit" loading={submitting}>
          {tc('save')}
        </Button>
      )}
      <CreateProductDialog {...createProductDialogProps} />
    </form>
  );
}
