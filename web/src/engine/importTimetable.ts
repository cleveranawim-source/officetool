import type { ClassTimetable, Slot, Timetable } from './types';

/**
 * 학교 시간표 파일을 읽는다. 시간표 프로그램마다 모양이 달라 두 가지 배치를 알아본다.
 *
 * (가) 가로형 "전체 학반 시간표": 한 반이 한 줄
 *        학반 | 월 … | 화 … |
 *             | 1 2 3 … | 1 2 … |
 *        1-1  | 수학 과학 …        ← 과목 줄
 *             | 김미 박정 …        ← 교사 줄 (없어도 됨)
 *
 * (나) 블록형 "학반별 시간표": 한 반이 한 덩어리
 *        1-1 담임이름
 *            | 월 | 화 | 수 | 목 | 금
 *        1   | 수학 | 운동 | …       ← 과목 줄
 *            | 김미연 | 이서윤 | …   ← 교사 줄 (없어도 됨)
 *        2   | …
 *
 * 칸 하나에 "국어\n김철수", "국어(김철수)"처럼 과목과 교사가 같이 있어도 된다.
 * 블록 수업 표시: 가로 "─▷", 세로 "│", "▽", "〃" → 앞 교시와 같은 수업.
 */

/** CSV 또는 TSV(시트에서 복사) 텍스트를 줄·칸으로. 따옴표 안의 줄바꿈도 한 칸으로 본다. */
export function splitRows(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'));
  const delim = src.includes('\t') && (firstLine.includes('\t') || !firstLine.includes(',')) ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) {
      row.push(cur.trim());
      cur = '';
    } else if (ch === '\n') {
      row.push(cur.trim());
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  row.push(cur.trim());
  rows.push(row);
  return rows;
}

const DAY_NAMES = ['월', '화', '수', '목', '금'];
const CLASS_ID = /^([1-6])\s*-\s*(\d{1,2})(?:\s*반)?$/;
const CLASS_IN_TEXT = /(?:^|\s)([1-6])\s*-\s*(\d{1,2})(?:\s*반)?(?:\s+(\S+))?/;
const CONTINUE = /^(─+▷|─+|→|▷|│|\||▽|↓|〃|-->|\.\.\.)$/;
const PERIOD = /^([1-9])(?:\s*교시)?$/;

export interface ImportResult {
  timetable: Timetable;
  layout: 'wide' | 'blocks' | 'neis';
  warnings: string[];
}

/** 과목 칸과 교사 칸을 하나의 수업으로 */
function toSlot(subjectCell: string, teacherCell: string): Slot {
  let s = (subjectCell ?? '').trim();
  let t = (teacherCell ?? '').trim();
  const nl = s.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (nl.length >= 2) {
    s = nl[0];
    t ||= nl[1];
  } else {
    const m = s.match(/^(.+?)\s*[(\[]([^)\]]+)[)\]]$/);
    if (m) {
      s = m[1].trim();
      t ||= m[2].trim();
    }
  }
  return { s, t };
}

function isDayHeader(row: string[]): boolean {
  return DAY_NAMES.every((d) => row.some((c) => c.replace(/요일$/, '') === d));
}

function dayIndexOf(cell: string): number {
  return DAY_NAMES.indexOf(cell.replace(/요일$/, ''));
}

export function importClassTimetable(text: string, school = '', term = ''): ImportResult {
  return importRows(splitRows(text), school, term);
}

export function importRows(rawRows: string[][], school = '', term = ''): ImportResult {
  const rows = rawRows.map((r) => r.map((c) => String(c ?? '').trim()));
  const headerIdx = rows.findIndex(isDayHeader);
  if (headerIdx === -1) throw new Error('월·화·수·목·금이 적힌 머리글 줄을 찾지 못했습니다. 시간표의 요일 줄까지 함께 넣어 주세요.');

  // 요일 머리글 바로 아래 줄이 교시 번호면 가로형, 아니면 블록형
  const next = rows[headerIdx + 1] ?? [];
  const numbers = next.filter((c) => /^\d$/.test(c)).length;
  return numbers >= 5 ? importWide(rows, headerIdx, school, term) : importBlocks(rows, school, term);
}

/* ---------- (가) 가로형 ---------- */
function importWide(rows: string[][], headerIdx: number, school: string, term: string): ImportResult {
  const warnings: string[] = [];
  const header = rows[headerIdx];
  const periodRow = rows[headerIdx + 1] ?? [];
  const columns: { day: number; col: number }[] = [];
  const days: number[] = [];
  DAY_NAMES.forEach((_, di) => {
    const col = header.findIndex((c) => dayIndexOf(c) === di);
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
    const id = `${m[1]}-${Number(m[2])}`;
    const week: Slot[][] = days.map(() => []);
    for (const { day, col } of columns) week[day].push(toSlot(subj[col], tch[col]));
    fillBlocks(week, id, warnings);
    const homeroomCol = subj.findIndex((v, i) => i > 0 && CLASS_ID.test(v));
    classes.push({ id, grade: Number(m[1]), homeroom: homeroomCol > 0 ? subj[homeroomCol + 1] || undefined : undefined, week });
    if (tch.length) r++;
  }
  if (!classes.length) throw new Error('"1-1" 같은 학반 줄을 찾지 못했습니다.');
  return { timetable: { school, term, days, classes }, layout: 'wide', warnings };
}

/* ---------- (나) 블록형 ---------- */
function importBlocks(rows: string[][], school: string, term: string): ImportResult {
  const warnings: string[] = [];
  const classes: ClassTimetable[] = [];
  const maxPeriods = [0, 0, 0, 0, 0];

  for (let h = 0; h < rows.length; h++) {
    if (!isDayHeader(rows[h])) continue;
    // 머리글 위쪽 몇 줄에서 "1-1 담임" 찾기
    let id: string | null = null;
    let homeroom: string | undefined;
    for (let up = h; up >= Math.max(0, h - 4) && !id; up--) {
      for (const cell of rows[up]) {
        const m = cell.match(CLASS_IN_TEXT);
        if (m) {
          id = `${m[1]}-${Number(m[2])}`;
          homeroom = m[3];
          break;
        }
      }
    }
    if (!id) continue;
    const dayCols = DAY_NAMES.map((d) => rows[h].findIndex((c) => dayIndexOf(c) === DAY_NAMES.indexOf(d)));
    const week: Slot[][] = DAY_NAMES.map(() => []);
    let r = h + 1;
    while (r < rows.length && !isDayHeader(rows[r])) {
      const pm = rows[r][0]?.match(PERIOD);
      if (!pm) {
        if (rows[r].some((c) => CLASS_IN_TEXT.test(c) && !PERIOD.test(c))) break;
        r++;
        continue;
      }
      const p = Number(pm[1]);
      const subj = rows[r];
      const tch = rows[r + 1] && !rows[r + 1][0] ? rows[r + 1] : [];
      dayCols.forEach((col, di) => {
        const slot = toSlot(subj[col], tch[col]);
        week[di][p - 1] = slot;
      });
      r += tch.length ? 2 : 1;
    }
    // 뒤쪽 빈 교시는 수업 없음으로 잘라낸다
    for (let di = 0; di < 5; di++) {
      const w = week[di];
      for (let i = 0; i < w.length; i++) w[i] ??= { s: '', t: '' };
      while (w.length && !w[w.length - 1].s) w.pop();
      maxPeriods[di] = Math.max(maxPeriods[di], w.length);
    }
    fillBlocks(week, id, warnings);
    classes.push({ id, grade: Number(id.split('-')[0]), homeroom, week });
    h = r - 1;
  }
  if (!classes.length) throw new Error('"1-1" 같은 학반 이름과 요일 머리글이 있는 블록을 찾지 못했습니다.');
  classes.sort((a, b) => a.grade - b.grade || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
  return { timetable: { school, term, days: maxPeriods, classes }, layout: 'blocks', warnings };
}

/**
 * 블록 수업 표시("─▷", "│", "▽")를 앞 교시 수업으로 채운다.
 * 병합된 칸이 비어서 들어온 경우도 뒤 교시가 이어지면 앞 교시로 채운다.
 */
function fillBlocks(week: Slot[][], id: string, warnings: string[]) {
  week.forEach((day, di) => {
    for (let i = 0; i < day.length; i++) {
      const cur = day[i];
      const prev = day[i - 1];
      if (CONTINUE.test(cur.s) && prev) {
        day[i] = { s: prev.s, t: cur.t && !CONTINUE.test(cur.t) ? cur.t : prev.t };
      } else if (!cur.s && prev?.s && i < day.length - 1) {
        day[i] = { ...prev };
        warnings.push(`${id} ${DAY_NAMES[di]} ${i + 1}교시 빈 칸을 앞 교시(${prev.s})로 채웠습니다.`);
      } else if (!cur.s) {
        warnings.push(`${id} ${DAY_NAMES[di]} ${i + 1}교시가 비어 있습니다.`);
      }
    }
  });
}
