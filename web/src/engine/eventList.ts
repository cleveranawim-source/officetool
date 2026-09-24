import { splitRows } from './importTimetable';
import type { CalEvent } from './types';

/**
 * 시트에 목록으로 적은 학사일정을 읽는다. 한 줄에 날짜와 일정 이름이 있으면 된다.
 *   2026-10-07 | (1,2학년) 중간고사
 *   10/13~10/15 | 2학기 중간고사
 *   2026. 11. 5. | 진로교육 1-7
 * 연도가 없는 날짜는 year를 쓴다.
 */
const FULL = /(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\.?/;
const SHORT = /(?<!\d)(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?(?!\d)/;

function toISO(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateCell(cell: string, year: number): { start: string; end: string } | null {
  const parts = cell.split(/\s*[~∼]\s*/);
  const one = (s: string, base?: string): string | null => {
    const f = s.match(FULL);
    if (f) return toISO(+f[1], +f[2], +f[3]);
    const m = s.match(SHORT);
    if (m) return toISO(year, +m[1], +m[2]);
    // "~15" 처럼 일만 적은 끝 날짜
    const d = s.match(/^(\d{1,2})\s*일?$/);
    if (d && base) return toISO(+base.slice(0, 4), +base.slice(5, 7), +d[1]);
    return null;
  };
  const start = one(parts[0]);
  if (!start) return null;
  const end = parts[1] ? one(parts[1], start) ?? start : start;
  return { start, end: end < start ? start : end };
}

export function parseEventList(text: string, year: number): CalEvent[] {
  const out: CalEvent[] = [];
  for (const row of splitRows(text)) {
    let date: { start: string; end: string } | null = null;
    let di = -1;
    for (let i = 0; i < row.length && !date; i++) {
      date = parseDateCell(row[i], year);
      if (date) di = i;
    }
    if (!date) continue;
    // 날짜 칸 안에 제목이 같이 있으면 날짜를 뺀 나머지를 제목으로
    const inCell = row[di]
      .replace(FULL, '')
      .replace(SHORT, '')
      // "~15", "~ 10/15" 같은 기간 끝 부분
      .replace(/^\s*[~∼]\s*(?:\d{4}\s*[-./년]\s*)?(?:\d{1,2}\s*[/.월]\s*)?\d{1,2}\s*일?\.?/, '')
      .replace(/^[\s\-–(),.]+/, '')
      .trim();
    const titles = [inCell, ...row.filter((_, i) => i !== di)].map((c) => c.trim()).filter((c) => c && !/^[월화수목금토일]$/.test(c));
    for (const title of titles) {
      out.push({ id: `list-${date.start}-${out.length}`, title, start: date.start, end: date.end, source: 'manual' });
    }
  }
  return out;
}

