/**
 * Shared by every hand-built Gantt-style chart in this app (no calendar/
 * Gantt library anywhere in the project — a deliberate choice, see
 * schedule-timeline.tsx's header comment). Pure functions: month header and
 * every bar are positioned via `left`/`width` percentages computed from the
 * same `from`/`to` range, so they always line up regardless of how many
 * days are in a given month.
 */

export function timelinePercent(date: Date, from: Date, to: Date): number {
  const total = to.getTime() - from.getTime();
  if (total <= 0) return 0;
  const clamped = Math.min(Math.max(date.getTime(), from.getTime()), to.getTime());
  return ((clamped - from.getTime()) / total) * 100;
}

export function timelineMonthMarks(from: Date, to: Date): { label: string; start: Date }[] {
  const marks: { label: string; start: Date }[] = [];
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  let guard = 0;
  while (cursor <= to && guard < 36) {
    marks.push({ label: cursor.toLocaleDateString('uk-UA', { month: 'short' }), start: new Date(cursor) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    guard += 1;
  }
  return marks;
}
