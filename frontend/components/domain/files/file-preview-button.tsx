'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Eye, Download } from 'lucide-react';
import { is3DModelFile, isGlbFile, isPdfFileByName, isImageFileByName } from './entity-documents-field';
import { PhotoLightbox } from '@/components/ui/photo-lightbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const Step3DViewer = dynamic(() => import('./step-3d-viewer').then((m) => m.Step3DViewer), { ssr: false });

export interface PreviewableFile {
  id: string;
  originalName: string;
  downloadUrl: string;
}

function isPreviewable(name: string): boolean {
  return is3DModelFile(name) || isImageFileByName(name) || isPdfFileByName(name);
}

/**
 * "там де файли має бути кнопка передогляд і кнопка завантажити"
 * (2026-11-02) — filename as plain text + two explicit icon buttons,
 * mirroring `EntityDocumentsField`'s own eye/download pair exactly
 * (`files.view`/`files.download` i18n keys reused directly) rather than
 * one ambiguous "click the name" control. The eye button only renders for
 * a type this component can actually preview (image/pdf/3d) — same
 * `isViewable` gating EntityDocumentsField applies — download always
 * renders, a real `<a download>` link rather than `window.open`, so the
 * browser's native save-file flow handles it instead of just opening a
 * new tab.
 */
export function FilePreviewButton({ file, className }: { file: PreviewableFile; className?: string }) {
  const t = useTranslations('files');
  const [open3D, setOpen3D] = useState(false);
  const [openPdf, setOpenPdf] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  function handlePreview() {
    if (is3DModelFile(file.originalName)) {
      setOpen3D(true);
    } else if (isImageFileByName(file.originalName)) {
      setLightboxSrc(file.downloadUrl);
    } else if (isPdfFileByName(file.originalName)) {
      setOpenPdf(true);
    }
  }

  return (
    <div className={className ?? 'flex items-center gap-2'}>
      <span className="min-w-0 flex-1 truncate text-sm" title={file.originalName}>
        {file.originalName}
      </span>
      {isPreviewable(file.originalName) && (
        <button type="button" onClick={handlePreview} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t('view')} title={t('view')}>
          <Eye className="h-4 w-4" />
        </button>
      )}
      <a
        href={file.downloadUrl}
        download={file.originalName}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={t('download')}
        title={t('download')}
      >
        <Download className="h-4 w-4" />
      </a>

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
    </div>
  );
}
