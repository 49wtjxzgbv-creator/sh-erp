'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, X, FileIcon } from 'lucide-react';
import { uploadFile, type FileAsset, type FileDomain } from '@/lib/api-client/files';
import { Button } from '@/components/ui/button';

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
}

export function FileUploadField({
  domain,
  entityType,
  entityId,
  value,
  onChange,
  accept = 'image/*',
  isPublic,
}: FileUploadFieldProps) {
  const tc = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUploaded, setLastUploaded] = useState<FileAsset | null>(null);

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

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileSelected} />
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm">
          <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{lastUploaded?.originalName ?? value}</span>
          <button
            type="button"
            onClick={() => {
              setLastUploaded(null);
              onChange(null);
            }}
            className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
          >
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
