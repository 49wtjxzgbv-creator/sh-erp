'use client';

import { useTranslations } from 'next-intl';
import { GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTraining } from './training-provider';

/** "Навчитися працювати з цим" — launches the given course from step 0, regardless of prior progress (a deliberate re-entry point, distinct from the Training Center's "continue where you left off"). */
export function LearnThisButton({ courseId, label }: { courseId: string; label?: string }) {
  const t = useTranslations('training');
  const { startCourse } = useTraining();

  return (
    <Button variant="outline" size="sm" onClick={() => startCourse(courseId, 0)}>
      <GraduationCap className="mr-2 h-4 w-4" />
      {label ?? t('learnThis')}
    </Button>
  );
}
