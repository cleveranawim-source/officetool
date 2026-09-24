import type { ClassTimetable, Slot, Timetable } from './types';

/**
 * "전체 학반 시간표" 시트를 복사해 붙여넣은 텍스트(TSV) 또는 CSV를 읽는다.
 *
 * 형식 (시간표 프로그램 출력 그대로):
 *   학반 | 월 … | 화 … | … | 학반 | 담임
 *        | 1 2 3 4 5 6 | 1 2 … 7 | …
 *   1-1  | 수학 과학 …              ← 과목 줄
 *        | 김미 박정 …              ← 교사 줄
 * "─▷"는 앞 교시와 같은 수업(블록 수업)을 뜻한다.
 */

export function splitRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tab = lines.some((l) => l.includes('\t'));
  return lines.map((line) => (tab ? line.split('\t') : parseCsvLine(line)).map((c) => c.trim()));
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const DAY_NAMES = ['월', '화', '수', '목', '금'];
const CLASS_ID = /^([1-6])\s*-\s*(\d{1,2})$/;
const CONTINUE = /^(─▷|→|▷|-->|\.\.\.)$/;

export interface ImportResult {
  timetable: Timetable;
  warnings: string[];
}

export function importClassTimetable(text: string, school = '', term = ''): ImportResult {
  const rows = splitRows(text);
  const warnings: string[] = [];

  // 요일 머리글 줄 찾기
  const headerIdx = rows.findIndex((r) => DAY_NAMES.every((d) => r.includes(d)));
  if (headerIdx === -1) throw new Error('월·화·수·목·금 머리글 줄을 찾지 못했습니다. 시트의 머리글까지 함께 복사하세요.');
  const header = rows[headerIdx];
  const periodRow = rows[headerIdx + 1] ?? [];

  // 각 요일이 시작하는 열과 교시 수
  const starts = DAY_NAMES.map((d) => header.indexOf(d));
  const columns: { day: number; col: number }[] = [];
  const days: number[] = [];
  starts.forEach((col, di) => {
    let n = 0;
    for (let c = col; c < periodRow.length; c++) {
      const v = Number(periodRow[c]);
      if (!Number.isInteger(v) || v < 1) break;
      if (c > col && v <= n) break;
      n = v;
      columns.push({ day: di, col: c });
    }
    days.push(n);
  });
  if (days.some((n) => n === 0)) throw new Error('교시 번호 줄(1 2 3 …)을 읽지 못했습니다.');

  const classes: ClassTimetable[] = [];
  for (let r = headerIdx + 2; r < rows.length; r++) {
    const m = rows[r][0]?.match(CLASS_ID);
    if (!m) continue;
    const subj = rows[r];
    const tch = rows[r + 1] && !rows[r + 1][0] ? rows[r + 1] : [];
    const week: Slot[][] = days.map(() => []);
    let prev: Slot | null = null;
    for (const { day, col } of columns) {
      const s = (subj[col] ?? '').trim();
      let slot: Slot;
      if (CONTINUE.test(s) && prev) slot = { ...prev };
      else slot = { s, t: (tch[col] ?? '').trim() };
      if (!slot.s) warnings.push(`${m[0]} ${DAY_NAMES[day]} ${week[day].length + 1}교시가 비어 있습니다.`);
      week[day].push(slot);
      prev = slot;
    }
    const homeroomCol = subj.findIndex((v, i) => i > 0 && CLASS_ID.test(v));
    classes.push({
      id: `${m[1]}-${Number(m[2])}`,
      grade: Number(m[1]),
      homeroom: homeroomCol > 0 ? subj[homeroomCol + 1] || undefined : undefined,
      week,
    });
    if (tch.length) r++;
  }
  if (!classes.length) throw new Error('"1-1" 같은 학반 줄을 찾지 못했습니다.');
  return { timetable: { school, term, days, classes }, warnings };
}
