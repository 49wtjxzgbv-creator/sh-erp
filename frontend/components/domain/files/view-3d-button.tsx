'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Box } from 'lucide-react';
import type { FileAssetWithUrl } from '@/lib/api-client/files';
import { isGlbFile } from './entity-documents-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const Step3DViewer = dynamic(() => import('./step-3d-viewer').then((m) => m.Step3DViewer), {
  ssr: false,
  loading: () => <StepViewerLoading />,
});

function StepViewerLoading() {
  const t = useTranslations('files');
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('loadingModel')}</p>;
}

/** Same phone-detection duplicated at every call site that needs it (entity-documents-field.tsx, ar-view-button.tsx) — not worth sharing across a bundle split this deliberate. */
function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * "додай в каталозі і специфікації бум до кожної позиції кнопку
 * переглянути 3д" (2026-10-12): a read-only quick-look for a LIST ROW's
 * own attached 3D model — catalog/page.tsx and bom/page.tsx both already
 * batch-fetch each row's files for the photo column, so this just needs
 * the one matching `FileAssetWithUrl` handed in, not a whole
 * `EntityDocumentsField` (which expects a single entity's upload/delete
 * context, not a list of rows). Mirrors EntityDocumentsField's own
 * `modelDoc` dialog (url/glbUrl/arGlbUrl resolution included) minus the
 * BOM-cross-reference/add-to-bom/create-product/rename props — a list row
 * has no "this one BOM" or "this one product" write context to forward
 * those into.
 */
export function View3DButton({ file, className }: { file: FileAssetWithUrl; className?: string }) {
  const t = useTranslations('files');
  const [open, setOpen] = useState(false);

  const glbUrl = isGlbFile(file.originalName)
    ? (isMobileDevice() && file.mobileOptimizedDownloadUrl) || file.optimizedDownloadUrl || file.downloadUrl
    : file.convertedDownloadUrl;
  const arGlbUrl = isGlbFile(file.originalName) ? file.arOptimizedDownloadUrl : file.convertedDownloadUrl;

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        <Box className="mr-1 h-3.5 w-3.5" />
        {t('view3d')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] w-[95vw] max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle className="truncate">{file.originalName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {open && <Step3DViewer url={file.downloadUrl} glbUrl={glbUrl} arGlbUrl={arGlbUrl} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
