'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { deleteFile, getFileDownloadUrl, type FileDomain } from '@/lib/api-client/files';
import { useFilesForEntity } from '@/lib/hooks/use-files';
import { FileUploadField } from './file-upload-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface Entity3DModelFieldProps {
  domain: FileDomain;
  entityType: string;
  entityId: string;
}

/**
 * "3D-модель збірки" (2026-10-08 user request) — a self-contained
 * interactive HTML export of the entity's 3D model (e.g. SolidWorks
 * "Publish eDrawings HTML": all geometry/JS inlined in one file, no
 * sibling resource files) — a different thing from the STEP/STP ->
 * GLB pipeline (StepConversionService), which is geometry-only and has
 * its own three.js viewer (Step3DViewer). "Newest wins" storage, same
 * convention as EntityPhotoField (no dedicated FK column for this —
 * FileAsset(entityType, entityId) is the only record of "the current
 * model"). Viewing renders the file in a SANDBOXED iframe
 * (`sandbox="allow-scripts"` only, deliberately WITHOUT
 * `allow-same-origin`): the embedded document needs to run its own
 * viewer JS, but must get a null/opaque origin — no access to this
 * app's cookies, localStorage, or DOM.
 */
export function Entity3DModelField({ domain, entityType, entityId }: Entity3DModelFieldProps) {
  const t = useTranslations('files');
  const qc = useQueryClient();
  const { data: files } = useFilesForEntity(entityType, entityId, domain);
  const current = files?.[0];
  const [viewerOpen, setViewerOpen] = useState(false);

  // Same 1hr-presign / 50min-stale convention as FileUploadField's own preview fetch.
  const { data: downloadUrl } = useQuery({
    queryKey: ['file-download-url', current?.id],
    queryFn: () => getFileDownloadUrl(current!.id).then((r) => r.downloadUrl),
    enabled: Boolean(current),
    staleTime: 50 * 60 * 1000,
  });

  return (
    <div className="space-y-2">
      <FileUploadField
        domain={domain}
        entityType={entityType}
        entityId={entityId}
        value={current?.id}
        accept=".htm,.html,text/html"
        preview={false}
        onChange={async (fileAssetId) => {
          if (fileAssetId === null && current) {
            await deleteFile(current.id);
          }
          qc.invalidateQueries({ queryKey: ['files', entityType, entityId] });
        }}
      />
      {current && (
        <Button type="button" variant="outline" size="sm" onClick={() => setViewerOpen(true)}>
          <Eye className="mr-2 h-4 w-4" />
          {t('view3dModel')}
        </Button>
      )}

      <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="truncate">{current?.originalName}</DialogTitle>
          </DialogHeader>
          {downloadUrl && (
            <iframe
              src={downloadUrl}
              sandbox="allow-scripts"
              className="h-[75vh] w-full rounded-md border-0"
              title={current?.originalName ?? '3D model'}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
