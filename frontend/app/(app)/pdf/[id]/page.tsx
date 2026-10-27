'use client';

import '@/lib/pdfjs-worker';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getDocument } from 'pdfjs-dist';

/**
 * Without these, pdfjs's getTextContent() — the "Редагувати" tool's entire hit-testing
 * mechanism — silently returns an EMPTY text layer for a page whose font isn't embedded
 * (e.g. a plain pdf-lib-generated PDF using a StandardFont) or that needs a non-Latin
 * encoding map, rather than throwing — see scripts/copy-pdfjs-worker.js's own header
 * comment for the full story and the real reproduction case this was found from.
 */
const PDFJS_LOAD_OPTIONS = { cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/' };
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  ArrowLeft,
  MousePointer2,
  Highlighter,
  StickyNote,
  Pencil,
  Type,
  Edit3,
  ImagePlus,
  RotateCw,
  Trash2,
  FilePlus2,
  ZoomIn,
  ZoomOut,
  Save,
  Download,
  Search,
  ChevronUp,
  ChevronDown,
  X,
  Undo2,
  Redo2,
} from 'lucide-react';
import { usePdfDocuments, usePdfDocumentContent, useUploadPdfDocument } from '@/lib/hooks/use-pdf';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingBlock } from '@/components/ui/loading-block';
import { cn } from '@/lib/utils';
import { PdfPageCanvas } from '@/components/domain/pdf/pdf-page-canvas';
import { PdfPageThumbnail } from '@/components/domain/pdf/pdf-page-thumbnail';
import { hexToRgb01, newId, type Annotation, type AnnotationTool, type PdfSource, type TextFontFamily, type WorkingPage } from '@/components/domain/pdf/types';
import { extractTextRuns } from '@/components/domain/pdf/extract-text-runs';
import { buildPageSearchIndex, findMatchesInPage } from '@/components/domain/pdf/pdf-search';

/** See scripts/copy-pdf-font.js's own header comment for why these two specific files (not a pdf-lib StandardFont). */
const TEXT_FONT_FILES: Record<TextFontFamily, string> = {
  sans: '/fonts/pdf-editor-sans.woff',
  serif: '/fonts/pdf-editor-serif.woff',
};

/**
 * "створи пдф редактор і переглядач такий як едобе акробат" (2026-10-17) —
 * the editor itself. pdfjs-dist renders; pdf-lib does every real edit
 * (reorder/rotate/delete/merge pages, bake annotations) and produces the
 * bytes for Save (overwrite this library entry) or Download. See
 * components/domain/pdf/types.ts for why annotation coordinates live in
 * the page's intrinsic PDF-point space.
 */
interface SearchMatch {
  pageKey: string;
  rect: { x: number; y: number; width: number; height: number };
}
/** Everything undo/redo needs to restore — `sources` is deliberately excluded: its pdfjs/pdf-lib objects are never mutated in place after load, so an undone merge just stops being referenced by `pages` (a harmless orphan entry), and a redo of that merge becomes visible again with no re-parsing needed. */
interface HistorySnapshot {
  pages: WorkingPage[];
  annotations: Annotation[];
}
export default function PdfEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('pdf');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const addImageInputRef = useRef<HTMLInputElement>(null);

  const { data: documents } = usePdfDocuments();
  const { data: content, isLoading: contentLoading } = usePdfDocumentContent(id);
  const uploadDocument = useUploadPdfDocument();

  const doc = documents?.find((d) => d.id === id);

  const [sources, setSources] = useState<Record<string, PdfSource>>({});
  const [pages, setPages] = useState<WorkingPage[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);
  const [tool, setTool] = useState<AnnotationTool>('select');
  const [zoom, setZoom] = useState(1.1);
  const [activePageKey, setActivePageKey] = useState<string | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  /** The query `searchMatches` was last computed for — null means the current `searchQuery` hasn't been searched yet, so Enter should run a fresh search rather than jump to the next match. */
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const initialized = useRef(false);
  /** Fetched once per family and reused across every export — see copy-pdf-font.js's own header comment for why a StandardFont can't be used here at all (Cyrillic). */
  const fontBytesRef = useRef<Partial<Record<TextFontFamily, ArrayBuffer>>>({});

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!content || initialized.current) return;
    initialized.current = true;
    (async () => {
      try {
        const bytes = new Uint8Array(content);
        const pdfjsDoc = await getDocument({ data: bytes.slice(), ...PDFJS_LOAD_OPTIONS }).promise;
        const pdfLibDoc = await PDFDocument.load(bytes.slice());
        const sourceId = 'main';
        setSources({ [sourceId]: { id: sourceId, pdfjsDoc, pdfLibDoc } });
        const initialPages: WorkingPage[] = Array.from({ length: pdfjsDoc.numPages }, (_, i) => ({
          key: newId(),
          sourceId,
          sourceIndex: i,
          rotation: 0,
        }));
        setPages(initialPages);
        setActivePageKey(initialPages[0]?.key ?? null);
      } catch (err) {
        setError(apiErrorMessage(err, tc('error')));
      }
    })();
  }, [content, apiErrorMessage, tc]);

  const activePage = pages.find((p) => p.key === activePageKey) ?? null;
  const activeSource = activePage ? sources[activePage.sourceId] : null;
  const activePageIndex = activePage ? pages.indexOf(activePage) : -1;

  function goToPage(key: string) {
    setActivePageKey(key);
    setSelectedAnnotationId(null);
  }

  /** Scans every working page (not just the active one) — see types.ts/pdf-search.ts for why matching has to span text-run boundaries. Re-scans from scratch on each call rather than caching: cheap for this app's typical document sizes, and avoids the invalidation headache of a cache keyed on `pages`/`sources` that can change via merge/delete/reorder. */
  async function runSearch(query: string) {
    if (!query.trim()) return;
    setSearching(true);
    const found: SearchMatch[] = [];
    for (const wp of pages) {
      const source = sources[wp.sourceId];
      if (!source) continue;
      try {
        const pdfPage = await source.pdfjsDoc.getPage(wp.sourceIndex + 1);
        const runs = await extractTextRuns(pdfPage);
        const index = buildPageSearchIndex(runs);
        for (const m of findMatchesInPage(index, query)) {
          found.push({ pageKey: wp.key, rect: m.rect });
        }
      } catch (err) {
        // Same "nice to have, degrades gracefully" reasoning as pdf-page-canvas.tsx's own text-layer extraction — one problematic page shouldn't abort search on the rest.
        console.error('PDF search failed on one page', err);
      }
    }
    setSearchMatches(found);
    setSearchActiveIndex(0);
    setSearchedQuery(query);
    setSearching(false);
    if (found.length > 0 && found[0].pageKey !== activePageKey) goToPage(found[0].pageKey);
  }

  function goToMatch(index: number) {
    if (searchMatches.length === 0) return;
    const wrapped = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setSearchActiveIndex(wrapped);
    const match = searchMatches[wrapped];
    if (match.pageKey !== activePageKey) goToPage(match.pageKey);
  }

  /** Called at the start of every content-mutating action (same list that already calls setDirty(true)), BEFORE that action's own setPages/setAnnotations — reads the CURRENT (pre-mutation) values via closure, same as every other mutator here does. */
  function pushUndo() {
    setPast((p) => [...p, { pages, annotations }]);
    setFuture([]);
  }

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, { pages, annotations }]);
    setPages(prev.pages);
    setAnnotations(prev.annotations);
    setSelectedAnnotationId(null);
    if (!prev.pages.some((p) => p.key === activePageKey)) setActivePageKey(prev.pages[0]?.key ?? null);
    setDirty(true);
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, { pages, annotations }]);
    setPages(next.pages);
    setAnnotations(next.annotations);
    setSelectedAnnotationId(null);
    if (!next.pages.some((p) => p.key === activePageKey)) setActivePageKey(next.pages[0]?.key ?? null);
    setDirty(true);
  }

  function handleAddAnnotation(annotation: Annotation) {
    pushUndo();
    setAnnotations((prev) => [...prev, annotation]);
    setDirty(true);
  }

  function handleUpdateAnnotation(annotationId: string, patch: Partial<Annotation>) {
    pushUndo();
    setAnnotations((prev) => prev.map((a) => (a.id === annotationId ? ({ ...a, ...patch } as Annotation) : a)));
    setDirty(true);
  }

  function handleDeleteAnnotation(annotationId: string) {
    pushUndo();
    setAnnotations((prev) => prev.filter((a) => a.id !== annotationId));
    setSelectedAnnotationId(null);
    setDirty(true);
  }

  function rotateActivePage() {
    if (!activePageKey) return;
    pushUndo();
    setPages((prev) => prev.map((p) => (p.key === activePageKey ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
    setDirty(true);
  }

  function rotatePage(key: string) {
    pushUndo();
    setPages((prev) => prev.map((p) => (p.key === key ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
    setDirty(true);
  }

  function deletePage(key: string) {
    if (pages.length <= 1) {
      setError(t('cannotDeleteLastPage'));
      return;
    }
    pushUndo();
    const idx = pages.findIndex((p) => p.key === key);
    const nextPages = pages.filter((p) => p.key !== key);
    setPages(nextPages);
    setAnnotations((prev) => prev.filter((a) => a.pageKey !== key));
    if (activePageKey === key) {
      setActivePageKey(nextPages[Math.min(idx, nextPages.length - 1)]?.key ?? null);
      setSelectedAnnotationId(null);
    }
    setDirty(true);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    pushUndo();
    setPages((prev) => {
      const oldIndex = prev.findIndex((p) => p.key === active.id);
      const newIndex = prev.findIndex((p) => p.key === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
    setDirty(true);
  }

  async function handleMergeFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const pdfjsDoc = await getDocument({ data: bytes.slice() }).promise;
      const pdfLibDoc = await PDFDocument.load(bytes.slice());
      const sourceId = newId();
      pushUndo();
      setSources((prev) => ({ ...prev, [sourceId]: { id: sourceId, pdfjsDoc, pdfLibDoc } }));
      const newPages: WorkingPage[] = Array.from({ length: pdfjsDoc.numPages }, (_, i) => ({
        key: newId(),
        sourceId,
        sourceIndex: i,
        rotation: 0,
      }));
      setPages((prev) => [...prev, ...newPages]);
      setDirty(true);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  /** Places a user-picked photo on the active page as a normal draggable/resizable 'image' annotation — the exact same data shape the "Редагувати" tool's cut-and-move produces, so there's nothing special about an inserted-vs-cut image downstream (export, drag, delete all already handle it). */
  async function handleAddImageFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activePage || !activeSource) return;
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
        reader.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Image failed to load'));
        el.src = dataUrl;
      });

      // Normalize to PNG via a canvas round-trip — pdf-lib needs to know up front whether to
      // embedPng or embedJpg, and this handles any browser-supported source format uniformly
      // (same normalization the "Редагувати" tool's cut-and-move already does for captured pixels).
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context unavailable');
      ctx.drawImage(img, 0, 0);
      const pngDataUrl = canvas.toDataURL('image/png');

      const pdfPage = await activeSource.pdfjsDoc.getPage(activePage.sourceIndex + 1);
      const [, , pageWidth, pageHeight] = pdfPage.view;
      const scale = Math.min(1, (pageWidth * 0.5) / img.naturalWidth, (pageHeight * 0.5) / img.naturalHeight);
      const width = img.naturalWidth * scale;
      const height = img.naturalHeight * scale;
      const x = (pageWidth - width) / 2;
      const y = (pageHeight - height) / 2;

      const annotationId = newId();
      handleAddAnnotation({ id: annotationId, pageKey: activePage.key, type: 'image', x, y, width, height, dataUrl: pngDataUrl });
      setSelectedAnnotationId(annotationId);
      setTool('select');
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  /** Builds the final document from the working page order/rotation plus baked annotations — the single pipeline behind both Save and Download, so they can never silently diverge. */
  async function exportDocument(): Promise<Uint8Array<ArrayBuffer>> {
    const output = await PDFDocument.create();
    output.registerFontkit(fontkit);

    // Embedded lazily, only for families actually used on this export — most documents never touch "serif".
    const embeddedFonts: Partial<Record<TextFontFamily, Awaited<ReturnType<typeof output.embedFont>>>> = {};
    async function getFont(family: TextFontFamily) {
      const cached = embeddedFonts[family];
      if (cached) return cached;
      let bytes = fontBytesRef.current[family];
      if (!bytes) {
        bytes = await fetch(TEXT_FONT_FILES[family]).then((r) => r.arrayBuffer());
        fontBytesRef.current[family] = bytes;
      }
      const font = await output.embedFont(bytes as ArrayBuffer);
      embeddedFonts[family] = font;
      return font;
    }

    for (const wp of pages) {
      const source = sources[wp.sourceId];
      const [copied] = await output.copyPages(source.pdfLibDoc, [wp.sourceIndex]);
      output.addPage(copied);
      const baseRotation = copied.getRotation().angle;
      copied.setRotation(degrees((baseRotation + wp.rotation + 360) % 360));

      for (const ann of annotations.filter((a) => a.pageKey === wp.key)) {
        if (ann.type === 'highlight') {
          copied.drawRectangle({ x: ann.x, y: ann.y, width: ann.width, height: ann.height, color: rgb(1, 0.92, 0.23), opacity: 0.35 });
        } else if (ann.type === 'draw') {
          for (let i = 0; i < ann.points.length - 1; i++) {
            copied.drawLine({ start: ann.points[i], end: ann.points[i + 1], thickness: 2.5, color: rgb(0.94, 0.27, 0.27) });
          }
        } else if (ann.type === 'note') {
          const font = await getFont('sans');
          const lines = ann.text.split('\n');
          const lineHeight = 11;
          const boxHeight = lines.length * lineHeight + 8;
          copied.drawRectangle({
            x: ann.x,
            y: ann.y - boxHeight,
            width: 160,
            height: boxHeight,
            color: rgb(1, 0.98, 0.8),
            borderColor: rgb(0.79, 0.63, 0.02),
            borderWidth: 1,
          });
          lines.forEach((line, i) => {
            copied.drawText(line, { x: ann.x + 4, y: ann.y - (i + 1) * lineHeight, size: 9, font, color: rgb(0.2, 0.2, 0.2) });
          });
        } else if (ann.type === 'redact') {
          // Opaque cover over the ORIGINAL content stream's glyphs/pixels — this is what makes
          // "editing" existing text/images possible at all without rewriting that stream (see
          // this component's own header comment and types.ts's comment on this variant).
          copied.drawRectangle({ x: ann.x, y: ann.y, width: ann.width, height: ann.height, color: rgb(1, 1, 1) });
        } else if (ann.type === 'text') {
          const font = await getFont(ann.fontFamily);
          const { r, g, b } = hexToRgb01(ann.color);
          const lineHeight = ann.fontSize * 1.2;
          ann.text.split('\n').forEach((line, i) => {
            copied.drawText(line, { x: ann.x, y: ann.y - i * lineHeight, size: ann.fontSize, font, color: rgb(r, g, b) });
          });
        } else if (ann.type === 'image') {
          const embedded = await output.embedPng(ann.dataUrl);
          copied.drawImage(embedded, { x: ann.x, y: ann.y, width: ann.width, height: ann.height });
        }
      }
    }
    return new Uint8Array(await output.save());
  }

  async function handleSave() {
    setError(null);
    try {
      const bytes = await exportDocument();
      await uploadDocument.mutateAsync({
        file: new Blob([bytes], { type: 'application/pdf' }),
        originalName: doc?.name ?? 'document.pdf',
        existingDocumentId: id,
      });
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      console.error('PDF save failed', err);
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleDownload() {
    setError(null);
    try {
      const bytes = await exportDocument();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc?.name ?? 'document.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download failed', err);
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  const toolButtons: { tool: AnnotationTool; icon: typeof MousePointer2; labelKey: string }[] = [
    { tool: 'select', icon: MousePointer2, labelKey: 'toolSelect' },
    { tool: 'text', icon: Type, labelKey: 'toolText' },
    { tool: 'edit', icon: Edit3, labelKey: 'toolEdit' },
    { tool: 'highlight', icon: Highlighter, labelKey: 'toolHighlight' },
    { tool: 'note', icon: StickyNote, labelKey: 'toolNote' },
    { tool: 'draw', icon: Pencil, labelKey: 'toolDraw' },
  ];

  if (contentLoading || pages.length === 0) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/pdf')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('library')}
        </Button>
        <LoadingBlock />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-theme(spacing.14))] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-1 pb-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/pdf')} title={t('library')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{doc?.name ?? '…'}</h1>
        {dirty && <span className="text-xs text-muted-foreground">{t('unsavedChanges')}</span>}
        {!dirty && savedAt && <span className="text-xs text-muted-foreground">{t('savedJustNow')}</span>}
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" />
          {t('download')}
        </Button>
        <Button size="sm" onClick={handleSave} loading={uploadDocument.isPending}>
          <Save className="mr-2 h-4 w-4" />
          {t('save')}
        </Button>
      </div>

      {error && <p className="px-1 py-2 text-sm text-destructive">{error}</p>}
      {tool === 'edit' && <p className="px-1 pt-2 text-xs text-muted-foreground">{t('editToolHint')}</p>}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-1 py-2">
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {toolButtons.map(({ tool: toolName, icon: Icon, labelKey }) => (
            <Button
              key={toolName}
              variant={tool === toolName ? 'secondary' : 'ghost'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTool(toolName)}
              title={t(labelKey)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={past.length === 0} title={t('undo')}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={future.length === 0} title={t('redo')}>
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} title={t('zoomOut')}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(3, z + 0.15))} title={t('zoomIn')}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <Button variant="outline" size="sm" onClick={rotateActivePage} disabled={!activePageKey}>
          <RotateCw className="mr-2 h-4 w-4" />
          {t('rotatePage')}
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => activePageKey && deletePage(activePageKey)} disabled={!activePageKey}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('deletePage')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => mergeInputRef.current?.click()}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {t('mergeFile')}
        </Button>
        <input ref={mergeInputRef} type="file" accept="application/pdf" className="hidden" onChange={handleMergeFileSelected} />

        <Button variant="outline" size="sm" onClick={() => addImageInputRef.current?.click()} disabled={!activePageKey}>
          <ImagePlus className="mr-2 h-4 w-4" />
          {t('toolAddImage')}
        </Button>
        <input ref={addImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleAddImageFileSelected} />

        <Button variant={searchOpen ? 'secondary' : 'outline'} size="sm" onClick={() => setSearchOpen((v) => !v)}>
          <Search className="mr-2 h-4 w-4" />
          {t('toolSearch')}
        </Button>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {activePageIndex + 1} / {pages.length}
        </span>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border px-1 py-2">
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchedQuery(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              if (searchQuery !== searchedQuery) runSearch(searchQuery);
              else goToMatch(searchActiveIndex + 1);
            }}
            placeholder={t('searchPlaceholder')}
            className="max-w-xs"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToMatch(searchActiveIndex - 1)} disabled={searchMatches.length === 0}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToMatch(searchActiveIndex + 1)} disabled={searchMatches.length === 0}>
            <ChevronDown className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {searching
              ? '…'
              : searchedQuery === null
                ? ''
                : searchMatches.length === 0
                  ? t('searchNoResults')
                  : t('searchMatchCount', { current: searchActiveIndex + 1, total: searchMatches.length })}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => {
              setSearchOpen(false);
              setSearchMatches([]);
              setSearchedQuery(null);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto bg-secondary/30 p-6">
          <div className="flex justify-center">
            {activePage && activeSource && (
              <PdfPageCanvas
                page={activePage}
                source={activeSource}
                zoom={zoom}
                tool={tool}
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                onAddAnnotation={handleAddAnnotation}
                onUpdateAnnotation={handleUpdateAnnotation}
                onSelectAnnotation={setSelectedAnnotationId}
                onDeleteAnnotation={handleDeleteAnnotation}
                searchHighlightRect={searchMatches[searchActiveIndex]?.pageKey === activePage.key ? searchMatches[searchActiveIndex].rect : null}
              />
            )}
          </div>
        </div>

        <div className="w-44 shrink-0 overflow-y-auto border-l border-border bg-surface p-2">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pages.map((p) => p.key)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col items-center gap-1">
                {pages.map((p, i) => {
                  const source = sources[p.sourceId];
                  if (!source) return null;
                  return (
                    <PdfPageThumbnail
                      key={p.key}
                      page={p}
                      source={source}
                      index={i}
                      active={p.key === activePageKey}
                      onSelect={() => goToPage(p.key)}
                      onRotate={() => rotatePage(p.key)}
                      onDelete={() => deletePage(p.key)}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
