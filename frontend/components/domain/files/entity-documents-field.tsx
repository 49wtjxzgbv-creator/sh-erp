'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Upload, X, FileText, Box, Image as ImageIcon, File as FileIcon, Download, Eye } from 'lucide-react';
import { uploadFile, deleteFile, type FileDomain, type FileAssetWithUrl } from '@/lib/api-client/files';
import { useFilesForEntities } from '@/lib/hooks/use-files';
import { Button } from '@/components/ui/button';
import { PhotoLightbox } from '@/components/ui/photo-lightbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const Step3DViewer = dynamic(() => import('./step-3d-viewer').then((m) => m.Step3DViewer), {
  ssr: false,
  loading: () => <StepViewerLoading />,
});

function StepViewerLoading() {
  const t = useTranslations('files');
  return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('loadingModel')}</p>;
}

function isStepFile(name: string): boolean {
  return /\.(step|stp)$/i.test(name);
}
function isPdfFile(mimeType: string, name: string): boolean {
  return mimeType === 'application/pdf' || /\.pdf$/i.test(name);
}
function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function fileIcon(file: FileAssetWithUrl) {
  if (isImageFile(file.mimeType)) return ImageIcon;
  if (isStepFile(file.originalName)) return Box;
  if (isPdfFile(file.mimeType, file.originalName)) return FileText;
  return FileIcon;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface EntityDocumentsFieldProps {
  domain: FileDomain;
  entityType: string;
  entityId: string;
  /** Defaults to a broad, non-photo-specific set — this widget is for supplementary documents (drawings, datasheets, CAD models), not the entity's single "hero" photo (that's `EntityPhotoField`). */
  accept?: string;
}

/**
 * List-of-documents widget for Product/Assembly — unlike `EntityPhotoField`
 * (one photo, newest wins), every upload here is kept as its own row. Uses
 * `useFilesForEntities` (the batch endpoint) with a single-element id array
 * rather than `useFilesForEntity`, purely to get `downloadUrl` attached to
 * each row in one request instead of one `/download-url` call per document.
 */
export function EntityDocumentsField({ domain, entityType, entityId, accept = 'application/pdf,.step,.stp,image/*' }: EntityDocumentsFieldProps) {
  const t = useTranslations('files');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [stepDoc, setStepDoc] = useState<FileAssetWithUrl | null>(null);

  const { data: byEntity, isLoading } = useFilesForEntities(entityType, [entityId], domain);
  const files = byEntity?.[entityId] ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['files-batch', entityType] });
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadFile(file, { domain, entityType, entityId });
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('error'));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(file: FileAssetWithUrl) {
    await deleteFile(file.id);
    invalidate();
  }

  function handleView(file: FileAssetWithUrl) {
    if (isImageFile(file.mimeType)) {
      setLightboxSrc(file.downloadUrl);
    } else if (isStepFile(file.originalName)) {
      setStepDoc(file);
    } else if (isPdfFile(file.mimeType, file.originalName)) {
      window.open(file.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  }

  function isViewable(file: FileAssetWithUrl): boolean {
    return isImageFile(file.mimeType) || isStepFile(file.originalName) || isPdfFile(file.mimeType, file.originalName);
  }

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileSelected} />

      {!isLoading && files.length === 0 && <p className="text-sm text-muted-foreground">{t('noDocuments')}</p>}

      {files.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {files.map((file) => {
            const Icon = fileIcon(file);
            return (
              <li key={file.id} className="flex items-center gap-3 px-3 py-2">
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={file.originalName}>
                    {file.originalName}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.sizeBytes)}</p>
                </div>
                {isViewable(file) && (
                  <button
                    type="button"
                    onClick={() => handleView(file)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t('view')}
                  >
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
                >
                  <Download className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(file)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={tc('delete')}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
        <Upload className="mr-2 h-4 w-4" />
        {t('addDocument')}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}

      <Dialog open={Boolean(stepDoc)} onOpenChange={(open) => !open && setStepDoc(null)}>
        <DialogContent className="flex h-[85vh] w-[95vw] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{stepDoc?.originalName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {stepDoc && <Step3DViewer url={stepDoc.downloadUrl} glbUrl={stepDoc.convertedDownloadUrl} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
