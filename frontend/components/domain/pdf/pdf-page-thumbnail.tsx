'use client';

import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RotateCw, Trash2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { PdfSource, WorkingPage } from './types';

interface PdfPageThumbnailProps {
  page: WorkingPage;
  source: PdfSource;
  index: number;
  active: boolean;
  onSelect: () => void;
  onRotate: () => void;
  onDelete: () => void;
}

const THUMB_WIDTH = 140;

/** Drag-reorder thumbnail for one working page, reusing the @dnd-kit setup already established for BOM-line reordering elsewhere in the app. Renders its own small pdfjs preview independent of the main canvas — the thumbnail strip and the main editor view page through the document at different rates, so sharing a single render would thrash. */
export function PdfPageThumbnail({ page, source, index, active, onSelect, onRotate, onDelete }: PdfPageThumbnailProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(THUMB_WIDTH * 1.3);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfPage = await source.pdfjsDoc.getPage(page.sourceIndex + 1);
      if (cancelled) return;
      const rotation = (pdfPage.rotate + page.rotation + 360) % 360;
      const unscaled = pdfPage.getViewport({ scale: 1, rotation });
      const scale = THUMB_WIDTH / unscaled.width;
      const viewport = pdfPage.getViewport({ scale, rotation });
      setHeight(viewport.height);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      try {
        await pdfPage.render({ canvas, viewport }).promise;
      } catch {
        // Superseded by a later render (page rotated/reordered mid-flight) — safe to drop.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, page.sourceIndex, page.rotation]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative shrink-0 rounded-md border-2 p-1.5 transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border',
        isDragging && 'z-10 opacity-70',
      )}
    >
      <button type="button" onClick={onSelect} className="block" style={{ width: THUMB_WIDTH }}>
        <canvas ref={canvasRef} className="w-full border border-border bg-white shadow-sm" style={{ height }} />
      </button>
      <div className="mt-1 flex items-center justify-between px-0.5">
        <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground hover:text-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRotate} title="Повернути">
            <RotateCw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={onDelete} title="Видалити">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
