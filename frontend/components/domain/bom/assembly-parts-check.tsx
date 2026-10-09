'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { is3DModelFile, isGlbFile } from '@/components/domain/files/entity-documents-field';

const AssemblyPartsCheckViewer = dynamic(
  () => import('./assembly-parts-check-viewer').then((m) => m.AssemblyPartsCheckViewer),
  { ssr: false, loading: () => <ViewerLoading /> },
);

function ViewerLoading() {
  const tc = useTranslations('common');
  return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
}

export interface AssemblyPartsCheckProps {
  assemblyId: string;
  readOnly?: boolean;
}

/**
 * "потрібно в специфікації щоб кожен раз не відкривати glb файл а була
 * вкладка аналізувати де весь склад прописаний" (2026-10-08): a dedicated
 * tab (`/bom/[id]/parts-check`, see the route's own page + the layout's
 * `tabsFor`) showing every distinct part the assembly's uploaded 3D model
 * contains as a flat, always-visible list — split into "у каталозі"
 * (already a real Product — add straight to the spec) and "немає в
 * каталозі" (no matching Product yet — create one, prefilled from the
 * part, then it's added automatically) — instead of the interactive
 * tree+3D-canvas dialog you have to deliberately open from Документи
 * every time (that dialog is untouched, still reachable from there, for
 * when the interactive highlighting/click-to-select IS what's wanted).
 *
 * This wrapper only resolves WHICH uploaded document is the 3D model
 * (same `ASSEMBLY_DOCUMENT` domain, same is-it-a-glb-or-a-converted-step
 * check `EntityDocumentsField` itself uses) — the actual three.js parsing
 * + per-part snapshot rendering lives in the lazily-loaded
 * `AssemblyPartsCheckViewer`, kept out of this tab's own bundle (and
 * every other BOM tab's) until the user actually opens this one.
 */
export function AssemblyPartsCheck({ assemblyId, readOnly }: AssemblyPartsCheckProps) {
  const t = useTranslations('bom');
  const tc = useTranslations('common');
  const { data: byEntity, isLoading } = useFilesForEntities('Assembly', [assemblyId], 'ASSEMBLY_DOCUMENT');
  const files = byEntity?.[assemblyId] ?? [];
  const modelDoc = files.find((f) => is3DModelFile(f.originalName));
  const glbUrl = modelDoc
    ? isGlbFile(modelDoc.originalName)
      ? (modelDoc.optimizedDownloadUrl ?? modelDoc.downloadUrl)
      : modelDoc.convertedDownloadUrl
    : undefined;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }
  if (!modelDoc) {
    return <p className="text-sm text-muted-foreground">{t('partsCheckNoModel')}</p>;
  }
  if (!glbUrl) {
    return <p className="text-sm text-muted-foreground">{t('partsCheckConverting')}</p>;
  }

  return <AssemblyPartsCheckViewer assemblyId={assemblyId} glbUrl={glbUrl} readOnly={readOnly} />;
}
