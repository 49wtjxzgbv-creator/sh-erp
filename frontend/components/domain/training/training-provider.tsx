'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { TrainingCourse, TrainingStep } from './training-types';
import { recordSandboxEntity } from './training-sandbox';

const PROGRESS_KEY = 'sh-erp-training-progress';
const WELCOME_KEY = 'sh-erp-training-welcome-seen';

interface CourseProgress {
  completedStepIds: string[];
  lastStepIndex: number;
}
type ProgressMap = Record<string, CourseProgress>;

interface TrainingContextValue {
  courses: TrainingCourse[];
  activeCourse: TrainingCourse | null;
  activeStep: TrainingStep | null;
  activeStepIndex: number;
  progress: ProgressMap;
  startCourse: (courseId: string, fromStepIndex?: number) => void;
  next: () => void;
  back: () => void;
  exit: () => void;
  restartCourse: (courseId: string) => void;
  courseProgress: (courseId: string) => { done: number; total: number };
  overallProgress: () => { done: number; total: number };
  hasSeenWelcome: boolean;
  dismissWelcome: () => void;
}

const TrainingContext = createContext<TrainingContextValue | null>(null);

export function TrainingProvider({ courses, children }: { courses: TrainingCourse[]; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [hasSeenWelcome, setHasSeenWelcome] = useState(true); // default true until we've checked, so the banner never flashes for a returning user

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      if (raw) setProgress(JSON.parse(raw));
      setHasSeenWelcome(window.localStorage.getItem(WELCOME_KEY) === '1');
    } catch {
      // Storage can throw in private-browsing/quota-exceeded edge cases — training just starts fresh each visit.
    }
  }, []);

  const persist = useCallback((nextMap: ProgressMap) => {
    setProgress(nextMap);
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(nextMap));
    } catch {
      // Not worth surfacing — progress just won't survive a reload.
    }
  }, []);

  const dismissWelcome = useCallback(() => {
    setHasSeenWelcome(true);
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // Non-fatal — the banner may reappear next visit, acceptable.
    }
  }, []);

  const activeCourse = useMemo(() => courses.find((c) => c.id === activeCourseId) ?? null, [courses, activeCourseId]);
  const activeStep = activeCourse?.steps[activeStepIndex] ?? null;

  const startCourse = useCallback(
    (courseId: string, fromStepIndex = 0) => {
      const course = courses.find((c) => c.id === courseId);
      if (!course) return;
      setActiveCourseId(courseId);
      setActiveStepIndex(Math.min(Math.max(fromStepIndex, 0), course.steps.length - 1));
    },
    [courses],
  );

  const restartCourse = useCallback(
    (courseId: string) => {
      const rest = { ...progress };
      delete rest[courseId];
      persist(rest);
      startCourse(courseId, 0);
    },
    [progress, persist, startCourse],
  );

  const markCurrentDone = useCallback(() => {
    if (!activeCourse || !activeStep) return;
    const existing = progress[activeCourse.id] ?? { completedStepIds: [], lastStepIndex: 0 };
    if (existing.completedStepIds.includes(activeStep.id)) return;
    persist({
      ...progress,
      [activeCourse.id]: { completedStepIds: [...existing.completedStepIds, activeStep.id], lastStepIndex: activeStepIndex },
    });
  }, [activeCourse, activeStep, activeStepIndex, progress, persist]);

  const next = useCallback(() => {
    if (!activeCourse) return;
    markCurrentDone();
    setActiveStepIndex((i) => {
      if (i + 1 < activeCourse.steps.length) return i + 1;
      setActiveCourseId(null);
      return i;
    });
  }, [activeCourse, markCurrentDone]);

  const back = useCallback(() => {
    setActiveStepIndex((i) => Math.max(0, i - 1));
  }, []);

  const exit = useCallback(() => {
    if (activeCourse) {
      const existing = progress[activeCourse.id] ?? { completedStepIds: [], lastStepIndex: 0 };
      persist({ ...progress, [activeCourse.id]: { ...existing, lastStepIndex: activeStepIndex } });
    }
    setActiveCourseId(null);
  }, [activeCourse, activeStepIndex, progress, persist]);

  // Drive real navigation whenever the active STEP changes (not on every
  // pathname change — that would fight the checkpoint effect below, which
  // relies on the user/app navigating to a route this effect doesn't own).
  useEffect(() => {
    if (activeStep && pathname !== activeStep.route) {
      router.push(activeStep.route);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep?.id]);

  // Practice-step completion signal: this app's real create-forms only
  // navigate to the record's own detail route on a successful API call
  // (confirmed per-module during the training-system audit), so "we landed
  // on the expected route" is a genuine, if coarse, verification — not a
  // guess. Demo steps have no checkpoint and are unaffected.
  useEffect(() => {
    if (!activeStep?.checkpoint) return;
    if (activeStep.checkpoint.type === 'route' && pathname.startsWith(activeStep.checkpoint.route) && pathname !== activeStep.route) {
      if (activeStep.sandboxEntity) {
        const id = pathname.split('/').filter(Boolean).pop();
        if (id) recordSandboxEntity(activeStep.sandboxEntity, id);
      }
      next();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function courseProgress(courseId: string) {
    const course = courses.find((c) => c.id === courseId);
    const done = progress[courseId]?.completedStepIds.length ?? 0;
    return { done, total: course?.steps.length ?? 0 };
  }

  function overallProgress() {
    return courses.reduce(
      (acc, c) => {
        const p = courseProgress(c.id);
        return { done: acc.done + p.done, total: acc.total + p.total };
      },
      { done: 0, total: 0 },
    );
  }

  const value = useMemo<TrainingContextValue>(
    () => ({
      courses,
      activeCourse,
      activeStep,
      activeStepIndex,
      progress,
      startCourse,
      next,
      back,
      exit,
      restartCourse,
      courseProgress,
      overallProgress,
      hasSeenWelcome,
      dismissWelcome,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courses, activeCourse, activeStep, activeStepIndex, progress, hasSeenWelcome],
  );

  return <TrainingContext.Provider value={value}>{children}</TrainingContext.Provider>;
}

export function useTraining() {
  const ctx = useContext(TrainingContext);
  if (!ctx) throw new Error('useTraining must be used within TrainingProvider');
  return ctx;
}
