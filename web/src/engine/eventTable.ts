import { looksLikeCalendarGrid, parseCalendarGrid } from './calendarGrid';
import { parseEventRows } from './eventList';
import { splitRows } from './importTimetable';
import type { CalEvent } from './types';

export interface EventTableResult {
  /** 목록형(날짜 | 일정) 또는 달력형(월~금 칸) */
  format: 'list' | 'grid';
  events: CalEvent[];
  /** 달력형에서 읽은 날짜 칸 수 */
  days?: number;
  first?: string;
  last?: string;
}

/**
 * 시트에서 붙여넣거나 엑셀에서 읽은 학사일정 표. 모양을 보고 목록형·달력형을 알아서 고른다.
 * year는 학년도, semester는 학기 (2학기의 1~2월 날짜는 다음 해로).
 */
export function readEventTable(input: string | string[][], opts: { year: number; semester: 1 | 2 }): EventTableResult {
  const rows = typeof input === 'string' ? splitRows(input) : input.map((r) => r.map((c) => String(c ?? '')));
  if (looksLikeCalendarGrid(rows)) {
    const g = parseCalendarGrid(rows, opts);
    return { format: 'grid', events: g.events, days: g.days, first: g.first, last: g.last };
  }
  const events = parseEventRows(rows, opts.year).map((e) =>
    opts.semester === 2 && Number(e.start.slice(5, 7)) < 3
      ? { ...e, start: `${opts.year + 1}${e.start.slice(4)}`, end: `${opts.year + 1}${e.end.slice(4)}` }
      : e,
  );
  return { format: 'list', events };
}

/** 설정의 학기 시작일로 학년도·학기를 정한다 */
export function termOf(termStart: string): { year: number; semester: 1 | 2 } {
  return { year: Number(termStart.slice(0, 4)), semester: Number(termStart.slice(5, 7)) >= 7 ? 2 : 1 };
}

/** 결과를 한 줄로: "달력형 표 87일에서 일정 120건, 학기 안 118건" */
export function describeEventTable(format: 'list' | 'grid', total: number, inTerm: number, days?: number): string {
  const where = format === 'grid' ? `달력형 표${days ? ` ${days}일` : ''}에서` : '목록형 표에서';
  return `${where} 일정 ${total}건을 찾았고, 그중 학기 안 일정은 ${inTerm}건입니다.`;
}
