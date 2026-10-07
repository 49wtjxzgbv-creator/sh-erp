'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import type { Assembly, AssemblyComponentLineInput, CreateAssemblyInput } from '@/lib/api-client/bom';
import type { Product } from '@/lib/api-client/catalog';
import { toNumber } from '@/lib/api-client/decimal';
import { useAssemblyComponents, useSetAssemblyComponents } from '@/lib/hooks/use-bom';
import { useProductsByIds } from '@/lib/hooks/use-catalog';
import { queryProducts } from '@/lib/api-client/catalog';
import { uploadFile } from '@/lib/api-client/files';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EntityPhotoField } from '@/components/domain/files/entity-photo-field';
import { PendingPhotoField } from '@/components/domain/files/pending-photo-field';
import { EntityDocumentsField } from '@/components/domain/files/entity-documents-field';
import { Entity3DModelField } from '@/components/domain/files/entity-3d-model-field';
import { EntitySuppliersEditor } from '@/components/domain/procurement/entity-suppliers-editor';
import { CreateProductDialog } from '@/components/domain/catalog/create-product-dialog';

/** Converts Step3DViewer's captured `data:image/png;base64,...` snapshot into a real File for PendingPhotoField/uploadFile — synchronous, no `fetch(dataUrl)` round trip needed for a same-process base64 string. */
function dataUrlToFile(dataUrl: string, filename: string): File | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mimeType });
}

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
type AssemblyFormValues = z.infer<typeof assemblySchema>;

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
  const { data: components } = useAssemblyComponents(assembly?.id);
  const productIds = useMemo(
    () => Array.from(new Set((components ?? []).filter((c) => c.componentType === 'PRODUCT' && c.productId).map((c) => c.productId as string))),
    [components],
  );
  const { data: productsById } = useProductsByIds(productIds);
  const bomArticles = useMemo(
    () => Array.from(productsById?.values() ?? []).map((p) => p.article).filter(Boolean),
    [productsById],
  );

  // "Якщо деталей якихось не має, то має бути кнопка додати до BOM
  // специфікації" + "потрібна кнопка додати все" + "однієї позиції там
  // може бути декілька штук а воно додає по одній" (2026-10-08): resolves
  // every requested article against this company's own catalog (exact
  // match, case-insensitive — `queryProducts`'s own `search` is a loose
  // `contains`, so this re-filters down to a real match) and appends
  // whichever ones matched as new PRODUCT lines in ONE `setComponents`
  // write, each with qtyPerUnit set to how many times that article's node
  // actually appears in the 3D model (Step3DViewer's own `qty`, counted
  // from the tree — see its `unmatchedArticleCounts` header comment), not
  // a flat 1 — the user still adjusts it afterward in «Склад (BOM)» if
  // needed, same as any other line. Doing every article in a single write
  // (rather than one call per article) is required, not just an
  // optimization: `setAssemblyComponents` REPLACES the whole line list
  // from a snapshot of `components`, so calling it repeatedly back-to-back
  // before the snapshot refreshes would silently drop everything but the
  // last addition. `setComponents`'s own `onSuccess` already invalidates
  // this assembly's components query, which is what `bomArticles` above is
  // derived from — no separate refetch wiring needed, the ✅ just appears
  // once the chain above re-renders with the new data.
  const setComponents = useSetAssemblyComponents(assembly?.id ?? '');
  function existingComponentLines(): AssemblyComponentLineInput[] {
    return (components ?? []).map((c) => ({
      componentType: c.componentType,
      productId: c.productId ?? undefined,
      subAssemblyId: c.subAssemblyId ?? undefined,
      warehouseId: c.warehouseId ?? undefined,
      qtyPerUnit: toNumber(c.qtyPerUnit) ?? 0,
    }));
  }
  async function appendProductLines(items: { productId: string; qty: number }[]): Promise<void> {
    if (items.length === 0) return;
    const newLines: AssemblyComponentLineInput[] = items.map(({ productId, qty }) => ({
      componentType: 'PRODUCT',
      productId,
      qtyPerUnit: qty,
    }));
    await setComponents.mutateAsync([...existingComponentLines(), ...newLines]);
  }
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
  // Step3DViewer's `onCreateProduct` header comment) — this owns the
  // actual dialog, seeds its photo field with the snapshot (still
  // user-editable — see CreateProductDialog's own `initialPhoto`
  // comment), and once the product is created: appends it straight away
  // by id with that same qty (no need to re-search the catalog for the
  // article we just created it with), and uploads the .glb as that new
  // product's own document (`PRODUCT_DOCUMENT`, same domain/field
  // `ProductForm` already renders for every product) — non-fatal on
  // failure, same as the photo upload inside CreateProductDialog itself:
  // the product and its BOM line are already saved by that point, so a
  // failed document upload shouldn't strand the user, they can re-attach
  // it from the product's own page.
  const [pendingNewProduct, setPendingNewProduct] = useState<{
    article: string;
    name: string;
    qty: number;
    photo: File | null;
    glb: ArrayBuffer | null;
  } | null>(null);
  function handleCreateProduct(
    article: string,
    suggestedName: string,
    qty: number,
    photoDataUrl: string | null,
    glb: ArrayBuffer | null,
  ) {
    const photo = photoDataUrl ? dataUrlToFile(photoDataUrl, `${article}.png`) : null;
    setPendingNewProduct({ article, name: suggestedName, qty, photo, glb });
  }
  async function handleProductCreated(product: Product) {
    const qty = pendingNewProduct?.qty ?? 1;
    const article = pendingNewProduct?.article ?? product.article;
    const glb = pendingNewProduct?.glb ?? null;
    setPendingNewProduct(null);
    await appendProductLines([{ productId: product.id, qty }]);
    if (glb) {
      const glbFile = new File([glb], `${article}.glb`, { type: 'model/gltf-binary' });
      await uploadFile(glbFile, { domain: 'PRODUCT_DOCUMENT', entityType: 'Product', entityId: product.id }).catch(() => undefined);
    }
  }

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AssemblyFormValues>({
    resolver: zodResolver(assemblySchema),
    defaultValues: assemblyToFormValues(assembly),
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
      <CreateProductDialog
        key={pendingNewProduct?.article ?? 'none'}
        open={pendingNewProduct !== null}
        onOpenChange={(open) => !open && setPendingNewProduct(null)}
        initialValues={pendingNewProduct ? { article: pendingNewProduct.article, name: pendingNewProduct.name } : undefined}
        initialPhoto={pendingNewProduct?.photo ?? null}
        onCreated={handleProductCreated}
      />
    </form>
  );
}
