'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Upload, MoreVertical, Pencil, Trash2, FileText } from 'lucide-react';
import { usePdfDocuments, useUploadPdfDocument, useRenamePdfDocument, useDeletePdfDocument } from '@/lib/hooks/use-pdf';
import type { PdfDocument } from '@/lib/api-client/pdf';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { LoadingBlock } from '@/components/ui/loading-block';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * "створи пдф редактор і переглядач такий як едобе акробат" (2026-10-17) —
 * the library landing page: upload a new PDF (or pick one already saved
 * here) and open it in the editor at /pdf/[id]. PdfDocument is its own
 * company-wide library, not tied to any other entity — see that model's
 * own schema comment.
 */
export default function PdfLibraryPage() {
  const t = useTranslations('pdf');
  const tc = useTranslations('common');
  const router = useRouter();
  const apiErrorMessage = useApiErrorMessage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents, isLoading } = usePdfDocuments();
  const uploadDocument = useUploadPdfDocument();
  const renameDocument = useRenamePdfDocument();
  const deleteDocument = useDeletePdfDocument();

  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<PdfDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<PdfDocument | null>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const doc = await uploadDocument.mutateAsync({ file, originalName: file.name });
      router.push(`/pdf/${doc.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleRename() {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await renameDocument.mutateAsync({ id: renameTarget.id, name: renameValue.trim() });
      setRenameTarget(null);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteDocument.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button onClick={() => fileInputRef.current?.click()} loading={uploadDocument.isPending}>
          <Upload className="mr-2 h-4 w-4" />
          {t('uploadAction')}
        </Button>
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileSelected} />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('library')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingBlock />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('size')}</TableHead>
                  <TableHead>{t('updatedAt')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!documents || documents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      {t('empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id} className="cursor-pointer" onClick={() => router.push(`/pdf/${doc.id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate" title={doc.name}>{doc.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatSize(doc.sizeBytes)}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(doc.updatedAt).toLocaleString()}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                setRenameTarget(doc);
                                setRenameValue(doc.name);
                              }}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              {t('rename')}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteTarget(doc)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              {tc('delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rename')}</DialogTitle>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button loading={renameDocument.isPending} onClick={handleRename}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('deleteConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{tc('cancel')}</Button>
            </DialogClose>
            <Button variant="destructive" loading={deleteDocument.isPending} onClick={handleDelete}>
              {tc('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
