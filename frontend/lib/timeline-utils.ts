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

/** Monday-aligned week boundaries within [from, to] — the finer gridline inside each month, so a bar's rough position can be read down to the week without needing exact dates. Capped at 400 iterations (~7.5 years) as a sanity guard, same style as timelineMonthMarks' 36-month cap. */
export function timelineWeekMarks(from: Date, to: Date): Date[] {
  const marks: Date[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const day = cursor.getDay();
  cursor.setDate(cursor.getDate() + (day === 0 ? -6 : 1 - day)); // snap back to Monday
  let guard = 0;
  while (cursor <= to && guard < 400) {
    if (cursor >= from) marks.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
    guard += 1;
  }
  return marks;
}

/** One mark per calendar day (midnight) within [from, to] — the finest gridline, used by the Planner Gantt's Day/Week scales and for weekend shading. Capped at 3660 iterations (~10 years). */
export function timelineDayMarks(from: Date, to: Date): Date[] {
  const marks: Date[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let guard = 0;
  while (cursor <= to && guard < 3660) {
    marks.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return marks;
}

/** One mark per hour boundary within [from, to] — the Planner Gantt's Day scale. Capped at 24*14 (two weeks) since an hour-level view is only ever shown over a short window. */
export function timelineHourMarks(from: Date, to: Date): Date[] {
  const marks: Date[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours());
  let guard = 0;
  while (cursor <= to && guard < 24 * 14) {
    marks.push(new Date(cursor));
    cursor.setHours(cursor.getHours() + 1);
    guard += 1;
  }
  return marks;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** Monday of the calendar week containing `date`, at midnight — same Monday-alignment convention as timelineWeekMarks. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

/** 1st of the calendar month containing `date`, at midnight. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * "німці все рахують тижнями... почали виготовляти 28 тижня" (2026-11-24):
 * ISO-8601 week number (1–53) — the convention German clients/suppliers
 * use throughout this app's own product names (see any "Achse"/"Scheibe"
 * article in the catalog). Standard algorithm: snap to this date's own
 * Thursday (ISO weeks belong to the year containing their Thursday, which
 * is what makes the last/first week of a year unambiguous), then count
 * weeks from the first Thursday of that Thursday's year.
 */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const isoDay = (d.getUTCDay() + 6) % 7; // Monday=0..Sunday=6
  d.setUTCDate(d.getUTCDate() - isoDay + 3); // this week's Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstIsoDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstIsoDay + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}
