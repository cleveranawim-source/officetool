import { addDays, toDate, weekdayIndex } from './dates';
import { splitRows } from './importTimetable';
import type { CalEvent } from './types';

/**
 * 달력 모양 학사일정표를 읽는다 (구글 시트·엑셀).
 *
 *   월 | 주 | 월(6교시) | 화(7교시) | 수 | 목 | 금 | 토
 *   3  | 1  | 4         | 5♥1       | 6  | 7  | 8  | 9      ← 날짜 줄
 *      |    | 개학식1   | 안전교육2 |    |    |    |        ← 그날 일정 (여러 줄 가능)
 *      |    | 교직원예배|           |    |    |    |
 *   …
 *
 * 날짜 칸의 숫자는 "그 요일에 해당하는 그 날"로 풀어서 정한다. 앞 날짜 다음으로
 * 요일과 일(日)이 모두 맞는 첫 날을 고르므로, 한 주가 두 달에 걸쳐도(30 1 2 …),
 * 해가 바뀌어도 날짜가 틀리지 않는다.
 */

const DAY_CHARS = ['월', '화', '수', '목', '금', '토', '일'];
/** 날짜 칸: 앞의 1~31 숫자, 뒤에 붙은 자유학기 표시(♥1 등)나 일정 글자는 따로 */
const DATE_CELL = /^\s*(\d{1,2})(?![\d.(\-~가-힣]|\s*(?:학년|학기|교시|월|년|일|차|회|시|명))\s*(.*)$/s;
/** 엑셀·시트에서 날짜 값 그대로 온 칸 (2026-03-04) */
const ISO_CELL = /^\s*(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\s*(.*)$/s;
const MARKS = /[♥♠♣♡♤♧◆◇●○■□★☆※]\s*\d*/g;
const SKIP_ROW = /^(수업일|수업\s*일수|범례|합계|비고)/;

export interface GridOptions {
  /** 학년도 (예: 2026) */
  year: number;
  /** 1학기면 2월 중순부터, 2학기면 7월 중순부터 날짜를 찾는다 */
  semester: 1 | 2;
}

export interface GridResult {
  events: CalEvent[];
  /** 읽은 날짜 범위 */
  first?: string;
  last?: string;
  days: number;
}

/**
 * 요일 머리글 줄인가: 월·화·수·목·금이 이웃한 칸에 차례로 있어야 한다.
 * (맨 앞 "월"(달) 칸이 월요일로 잘못 잡히지 않게)
 */
function weekdayColumns(row: string[]): Map<number, number> | null {
  const dayOf = (cell: string | undefined) => {
    const m = (cell ?? '').trim().match(/^([월화수목금토일])(?:요일)?(?:\s*\(.*\))?$/);
    return m ? DAY_CHARS.indexOf(m[1]) : -1;
  };
  for (let i = 0; i + 4 < row.length; i++) {
    if ([0, 1, 2, 3, 4].every((w) => dayOf(row[i + w]) === w)) {
      const map = new Map<number, number>();
      for (let w = 0; w < 7 && dayOf(row[i + w]) === w; w++) map.set(i + w, w);
      return map;
    }
  }
  return null;
}

export function looksLikeCalendarGrid(rows: string[][]): boolean {
  return rows.some((r) => weekdayColumns(r) !== null);
}

/** 제목에서 "2024학년도 1학기"를 찾아 기본값을 덮어쓴다 */
function titleHints(rows: string[][], opts: GridOptions): GridOptions {
  const text = rows.slice(0, 5).flat().join(' ');
  const y = text.match(/(20\d\d)\s*학년도/);
  const s = text.match(/([12])\s*학기/);
  return { year: y ? Number(y[1]) : opts.year, semester: s ? (Number(s[1]) as 1 | 2) : opts.semester };
}

/** 앞 날짜 다음으로 요일과 일이 맞는 첫 날 (최대 limit일 뒤까지) */
function nextMatching(after: string, dom: number, weekday: number, limit = 70): string | null {
  let d = addDays(after, 1);
  for (let i = 0; i < limit; i++, d = addDays(d, 1)) {
    if (toDate(d).getUTCDate() === dom && weekdayIndex(d) === weekday) return d;
  }
  return null;
}

/** 날짜 칸 읽기: 일(日) 숫자, 정확한 날짜(있으면), 뒤에 붙은 글자 */
function dateCell(cell: string | undefined): { dom: number; iso?: string; rest: string } | null {
  const t = cell ?? '';
  const iso = t.match(ISO_CELL);
  if (iso) return { dom: Number(iso[3]), iso: `${iso[1]}-${iso[2]}-${iso[3]}`, rest: iso[4] };
  const m = t.match(DATE_CELL);
  return m ? { dom: Number(m[1]), rest: m[2] } : null;
}

function cleanEventText(t: string): string[] {
  return t
    .split(/\n+/)
    .map((line) => line.replace(MARKS, ' ').replace(/\s+/g, ' ').trim())
    // 숫자만 있는 줄(수업일 수 등)은 버리되 "6(1)" 같은 교시 옮김 표기는 남긴다
    .filter((line) => line && (/^[1-9]\s*\(\s*[1-9]\s*\)$/.test(line) || !/^[\d\s~∼\-–.,()]+$/.test(line)));
}

export function parseCalendarGrid(input: string | string[][], options: GridOptions): GridResult {
  const rows = typeof input === 'string' ? splitRows(input) : input.map((r) => r.map((c) => String(c ?? '')));
  const opts = titleHints(rows, options);
  const events: CalEvent[] = [];
  const seen = new Set<string>();
  let cols: Map<number, number> | null = null;
  /** 요일 칸 왼쪽의 "월"(달) 머리글 칸. 없으면 "12월"처럼 월을 붙여 쓴 칸만 달 표시로 본다 */
  let monthCol = -1;
  // 첫 날짜를 찾기 시작할 기준
  let last = opts.semester === 1 ? `${opts.year}-02-10` : `${opts.year}-07-10`;
  /** 지금 일정 줄이 속한 날짜: 칸(열) → 날짜 */
  let current = new Map<number, string>();
  let first: string | undefined;
  let days = 0;

  const add = (date: string, text: string) => {
    for (const title of cleanEventText(text)) {
      const key = `${date}|${title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ id: `grid-${date}-${events.length}`, title, start: date, end: date, source: 'manual' });
    }
  };

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const header = weekdayColumns(row);
    if (header) {
      // 두 번째 표(2학기 등)가 이어 붙어 있으면: 바로 위 제목의 학기로 기준을 옮긴다
      const title = rows.slice(Math.max(0, ri - 3), ri).flat().join(' ');
      const y = title.match(/(20\d\d)\s*학년도/);
      const sem = title.match(/([12])\s*학기/);
      if (sem) {
        const year = y ? Number(y[1]) : opts.year;
        const anchor = sem[1] === '1' ? `${year}-02-10` : `${year}-07-10`;
        if (anchor > last) last = anchor;
      }
      cols = header;
      const firstDay = Math.min(...header.keys());
      monthCol = row.slice(0, firstDay).findIndex((c) => /^\s*(월|달)\s*$/.test(c ?? ''));
      current = new Map();
      continue;
    }
    if (!cols) continue;
    if (SKIP_ROW.test((row[0] ?? '').trim()) || SKIP_ROW.test((row[1] ?? '').trim())) {
      current = new Map();
      continue;
    }

    // 날짜 줄인가: 요일 칸 3개 이상이 숫자로 시작하고, 그 숫자가 하루씩 늘어난다 (30 → 1은 달 바뀜)
    const nums = [...cols]
      .sort((a, b) => a[0] - b[0])
      .map(([col]) => dateCell(row[col]))
      .filter((d) => d !== null)
      .map((d) => d.dom);
    const consecutive = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1 || (v === 1 && nums[i - 1] >= 28));
    if (nums.length >= 3 && nums.every((v) => v >= 1 && v <= 31) && consecutive) {
      current = new Map();
      // 왼쪽 "월" 칸의 달 표시(12, 4월 등): 방학처럼 건너뛴 기간이 있어도 그 달에서 다시 찾는다
      // ("주" 칸의 주차 숫자는 달로 보지 않는다)
      const firstCol = Math.min(...cols.keys());
      const label = row
        .slice(0, firstCol)
        .map((c, i) => (c ?? '').trim().match(i === monthCol ? /^(\d{1,2})\s*월?$/ : /^(\d{1,2})\s*월$/))
        .find((m) => m && Number(m[1]) >= 1 && Number(m[1]) <= 12);
      let limit = 70;
      if (label) {
        const month = Number(label![1]);
        const cur = Number(last.slice(5, 7));
        if (month !== cur && month !== (cur % 12) + 1) {
          let y = Number(last.slice(0, 4));
          if (month < cur) y++;
          const jump = addDays(`${y}-${String(month).padStart(2, '0')}-01`, -8);
          if (jump > last) last = jump;
        }
      } else limit = 370;
      for (const [col, wd] of [...cols].sort((a, b) => a[0] - b[0])) {
        const cell = dateCell(row[col]);
        if (!cell) continue;
        const date = cell.iso && weekdayIndex(cell.iso) === wd ? cell.iso : nextMatching(last, cell.dom, wd, limit);
        if (!date) continue;
        last = date;
        first ??= date;
        days++;
        if (wd > 4) continue; // 토·일 일정은 수업과 무관
        current.set(col, date);
        if (cell.rest) add(date, cell.rest);
      }
      continue;
    }

    // 일정 줄: 직전 날짜 줄의 같은 칸 날짜로
    for (const [col, date] of current) {
      const cell = row[col];
      if (cell && cell.trim()) add(date, cell);
    }
  }
  // 날짜순 (같은 날은 표에 적힌 순서)
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.start.localeCompare(b.e.start) || a.i - b.i).map((x) => x.e);
  return { events: sorted, first, last: first ? last : undefined, days };
}

