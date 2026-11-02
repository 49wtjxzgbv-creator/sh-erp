'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { is3DModelFile, isGlbFile, isPdfFileByName, isImageFileByName } from './entity-documents-field';
import { PhotoLightbox } from '@/components/ui/photo-lightbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const Step3DViewer = dynamic(() => import('./step-3d-viewer').then((m) => m.Step3DViewer), { ssr: false });

export interface PreviewableFile {
  id: string;
  originalName: string;
  downloadUrl: string;
}

/**
 * "має бути передогляд всіх цих файлів у програмі" (2026-11-02) — generic,
 * read-only in-app preview for a bare {id, originalName, downloadUrl}
 * (no upload/delete context, unlike EntityDocumentsField, which this
 * mirrors the dispatch logic of). No mimeType in hand here, so detection
 * is extension-only (isPdfFileByName/isImageFileByName, siblings of
 * EntityDocumentsField's own mimeType-aware checks). A directly-uploaded
 * .glb's `downloadUrl` already points at usable glb bytes — no
 * convertedDownloadUrl needed, this is never a STEP-conversion product.
 * Anything not recognized falls back to the plain download-in-new-tab
 * behavior this component replaces.
 */
export function FilePreviewButton({ file, className }: { file: PreviewableFile; className?: string }) {
  const [open3D, setOpen3D] = useState(false);
  const [openPdf, setOpenPdf] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  function handleClick() {
    if (is3DModelFile(file.originalName)) {
      setOpen3D(true);
    } else if (isImageFileByName(file.originalName)) {
      setLightboxSrc(file.downloadUrl);
    } else if (isPdfFileByName(file.originalName)) {
      setOpenPdf(true);
    } else {
      window.open(file.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? 'truncate text-left text-sm text-primary underline-offset-2 hover:underline'}
        title={file.originalName}
        onClick={handleClick}
      >
        {file.originalName}
      </button>

      {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      <Dialog open={open3D} onOpenChange={setOpen3D}>
        <DialogContent className="flex h-[85vh] w-[95vw] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{file.originalName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {open3D && <Step3DViewer url={file.downloadUrl} glbUrl={isGlbFile(file.originalName) ? file.downloadUrl : undefined} />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={openPdf} onOpenChange={setOpenPdf}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-5xl flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{file.originalName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {openPdf && <iframe src={file.downloadUrl} title={file.originalName} className="h-full w-full rounded-md border border-border" />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
