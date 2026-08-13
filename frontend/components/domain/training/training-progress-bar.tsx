'use client';

import { CheckCircle2, CircleDot, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTraining } from './training-provider';

function statusOf(done: number, total: number): 'done' | 'partial' | 'none' {
  if (total > 0 && done >= total) return 'done';
  if (done > 0) return 'partial';
  return 'none';
}

/** Overall "X із Y кроків завершено" bar — used at the top of the Training Center. */
export function TrainingOverallProgress() {
  const { overallProgress } = useTraining();
  const { done, total } = overallProgress();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Прогрес навчання</span>
        <span className="text-muted-foreground">
          {done} із {total} кроків · {pct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Per-course row with a ✓/◐/○ status icon, used in the Training Center's course list. */
export function TrainingCourseStatus({ courseId, className }: { courseId: string; className?: string }) {
  const { courseProgress } = useTraining();
  const { done, total } = courseProgress(courseId);
  const status = statusOf(done, total);

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      {status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
      {status === 'partial' && <CircleDot className="h-3.5 w-3.5 text-warning" />}
      {status === 'none' && <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className="text-muted-foreground">
        {done}/{total}
      </span>
    </span>
  );
}
