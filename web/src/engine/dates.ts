/** 시간대 영향을 받지 않도록 날짜는 모두 'YYYY-MM-DD' 문자열과 UTC 정오로 다룬다. */

export function toDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

/** 0=월 … 6=일 */
export function weekdayIndex(iso: string): number {
  return (toDate(iso).getUTCDay() + 6) % 7;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function diffDays(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
}

const WD = ['월', '화', '수', '목', '금', '토', '일'];

/** '10/13(화)' */
export function fmtShort(iso: string): string {
  const d = toDate(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WD[weekdayIndex(iso)]})`;
}

export function fmtRange(start: string, end: string): string {
  return start === end ? fmtShort(start) : `${fmtShort(start)}~${fmtShort(end)}`;
}
