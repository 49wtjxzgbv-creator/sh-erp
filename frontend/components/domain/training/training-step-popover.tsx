'use client';

import { X, ChevronLeft, ChevronRight, SkipForward, RotateCcw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TrainingCourse, TrainingStep } from './training-types';

export interface TrainingStepPopoverProps {
  course: TrainingCourse;
  step: TrainingStep;
  stepIndex: number;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
  onRestart: () => void;
  /** Positioning is owned by TrainingOverlay — this component is purely presentational. */
  style?: React.CSSProperties;
}

/**
 * The step "card" content — kept as a separate presentational component
 * from TrainingOverlay (which owns spotlight/backdrop + position math) so
 * the actual lesson UI (title/what/why/instruction/controls) stays simple
 * to read and test independent of viewport-geometry code.
 */
export function TrainingStepPopover({ course, step, stepIndex, onNext, onBack, onExit, onRestart, style }: TrainingStepPopoverProps) {
  const total = course.steps.length;
  const isPractice = step.mode === 'practice';
  const isLast = stepIndex === total - 1;
  const isFirst = stepIndex === 0;
  // Practice steps with a route checkpoint wait for the real navigation to
  // fire `next()` themselves (see training-provider.tsx) — showing a manual
  // "Далі" alongside that would let the user skip the actual practice
  // action, defeating the point.
  const waitingOnCheckpoint = isPractice && Boolean(step.checkpoint);

  return (
    <div
      style={style}
      className="pointer-events-auto z-[60] w-80 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {course.title} · крок {stepIndex + 1} з {total}
        </span>
        <button
          type="button"
          onClick={onExit}
          aria-label="Закрити навчання"
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2 px-4 py-3">
        <h3 className="text-sm font-semibold">{step.title}</h3>
        <p className="text-sm text-muted-foreground">{step.what}</p>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Навіщо: </span>
          {step.why}
        </p>
        {isPractice && step.instruction && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <span className="font-medium text-foreground">Спробуйте самі: </span>
            {step.instruction}
          </div>
        )}
        {waitingOnCheckpoint && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Крок завершиться автоматично, щойно ви виконаєте дію.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={isFirst}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Назад
          </Button>
          <Button variant="ghost" size="sm" onClick={onRestart} title="Почати курс спочатку">
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Повторити
          </Button>
        </div>
        <div className="flex gap-1">
          {!waitingOnCheckpoint && (
            <Button variant="ghost" size="sm" onClick={onNext}>
              <SkipForward className="mr-1 h-3.5 w-3.5" />
              Пропустити
            </Button>
          )}
          {!waitingOnCheckpoint && (
            <Button size="sm" onClick={onNext}>
              {isLast ? 'Завершити' : 'Далі'}
              {!isLast && <ChevronRight className="ml-1 h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
