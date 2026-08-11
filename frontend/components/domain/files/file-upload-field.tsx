'use client';

import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Upload, X, FileIcon } from 'lucide-react';
import { uploadFile, getFileDownloadUrl, type FileAsset, type FileDomain } from '@/lib/api-client/files';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

/**
 * Shared "attach a file" widget — presign → direct-to-R2 PUT → confirm
 * (lib/api-client/files.ts#uploadFile), used by branding now and by every
 * later module that attaches photos/documents (Production/QC photos,
 * Procurement invoices, Sales documents, HR employee photos). Deliberately
 * has no crop/preview-editing UX — just upload, show what's attached,
 * allow clearing — later modules can wrap it for anything fancier.
 */
export interface FileUploadFieldProps {
  domain: FileDomain;
  entityType: string;
  entityId: string;
  /** Currently-attached FileAsset id, if any (e.g. CompanyBranding.siteLogoFileId). */
  value: string | null | undefined;
  onChange: (fileAssetId: string | null) => void;
  accept?: string;
  isPublic?: boolean;
  /** Shows an actual `<img>` thumbnail (via a fetched presigned download URL) instead of the generic filename+icon row. Defaults to true whenever `accept` targets images — pass `false` explicitly for non-image attachments that happen to use an image-like accept string, or `true` to force it. */
  preview?: boolean;
}

export function FileUploadField({
  domain,
  entityType,
  entityId,
  value,
  onChange,
  accept = 'image/*',
  isPublic,
  preview = accept.startsWith('image/'),
}: FileUploadFieldProps) {
  const tc = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<FileAsset | null>(null);

  // 1hr presigned URL TTL server-side (files.service.ts's DOWNLOAD_URL_TTL_SECONDS)
  // — refetch a little before that so a long-open form never shows a broken image.
  const { data: downloadUrl } = useQuery({
    queryKey: ['file-download-url', value],
    queryFn: () => getFileDownloadUrl(value as string).then((r) => r.downloadUrl),
    enabled: preview && Boolean(value),
    staleTime: 50 * 60 * 1000,
  });

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const asset = await uploadFile(file, { domain, entityType, entityId, isPublic });
      setLastUploaded(asset);
      onChange(asset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('error'));
    } finally {
      setUploading(false);
    }
  }

  function clear() {
    setLastUploaded(null);
    onChange(null);
  }

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileSelected} />
      {preview ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="rounded-md ring-offset-background transition-opacity hover:opacity-80 disabled:opacity-50"
            aria-label={tc('edit')}
          >
            <Avatar src={downloadUrl} size="2xl" />
          </button>
          <div className="flex flex-col gap-1">
            <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              {value ? tc('edit') : tc('create')}
            </Button>
            {value && (
              <button type="button" onClick={clear} className="text-left text-xs text-muted-foreground hover:text-foreground">
                {tc('delete')}
              </button>
            )}
          </div>
        </div>
      ) : value ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{lastUploaded?.originalName ?? value}</span>
          <button type="button" onClick={clear} className="ml-auto shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          {tc('create')}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
