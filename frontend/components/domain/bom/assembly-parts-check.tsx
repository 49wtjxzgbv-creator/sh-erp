'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { is3DModelFile, isGlbFile } from '@/components/domain/files/entity-documents-field';
import { peekGlbNodeCount, MOBILE_NODE_COUNT_LIMIT } from '@/lib/glb-node-count';

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

// Same guard, same threshold, as `Step3DViewer`'s own `MOBILE_SIZE_LIMIT_BYTES`/`isMobileDevice`
// (step-3d-viewer.tsx) — duplicated rather than imported so this tab's static bundle doesn't
// pull in three.js just to decide whether to even lazy-load the heavy viewer below.
const MOBILE_SIZE_LIMIT_BYTES = 40 * 1024 * 1024;
function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
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
  const glbUrl = modelDoc ? (isGlbFile(modelDoc.originalName) ? modelDoc.downloadUrl : modelDoc.convertedDownloadUrl) : undefined;
  const tooLargeByBytes = Boolean(modelDoc && modelDoc.sizeBytes > MOBILE_SIZE_LIMIT_BYTES && isMobileDevice());

  // "так до цього ж працювало і це не тільки на мому телефоні... а на
  // всіх" (2026-10-09, real crash report): same node-count crash risk as
  // `Step3DViewer`'s own guard — a model can be small by byte size yet
  // still have tens of thousands of scene-graph nodes (a real 10MB file
  // had 34,257). `AssemblyPartsCheckViewer` must not even start lazy-
  // loading (which immediately downloads the whole file) until this
  // resolves on mobile — so this is its own 'checking' state, not just a
  // boolean flipped after the fact.
  const [mobileNodeCheck, setMobileNodeCheck] = useState<'checking' | 'safe' | 'blocked'>('checking');
  useEffect(() => {
    let cancelled = false;
    if (!glbUrl || tooLargeByBytes || !isMobileDevice()) {
      setMobileNodeCheck('safe');
      return;
    }
    setMobileNodeCheck('checking');
    peekGlbNodeCount(glbUrl).then((count) => {
      if (!cancelled) setMobileNodeCheck(count != null && count > MOBILE_NODE_COUNT_LIMIT ? 'blocked' : 'safe');
    });
    return () => {
      cancelled = true;
    };
  }, [glbUrl, tooLargeByBytes]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }
  if (!modelDoc) {
    return <p className="text-sm text-muted-foreground">{t('partsCheckNoModel')}</p>;
  }
  if (!glbUrl) {
    return <p className="text-sm text-muted-foreground">{t('partsCheckConverting')}</p>;
  }
  if (tooLargeByBytes || mobileNodeCheck === 'blocked') {
    return <p className="text-sm text-muted-foreground">{t('partsCheckTooLargeForMobile')}</p>;
  }
  if (mobileNodeCheck === 'checking') {
    return <p className="text-sm text-muted-foreground">{tc('loading')}</p>;
  }

  return <AssemblyPartsCheckViewer assemblyId={assemblyId} glbUrl={glbUrl} sizeBytes={modelDoc.sizeBytes} readOnly={readOnly} />;
}
