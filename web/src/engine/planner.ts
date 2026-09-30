import { addDays, diffDays, eachDay, fmtShort, toDate, weekdayIndex } from './dates';
import { holidayName } from './holidays';
import { classifyTitle, DEFAULT_RULES, type RuleSet } from './parseEvents';
import type { CalEvent, EventKind } from './types';

/**
 * 학사일정 1차안 엔진.
 *
 * 작년 일정을 날짜 그대로 옮기지 않는다. 일정마다 "무엇에 맞춰 잡힌 날인지"(기준)를 찾고,
 * 그 기준을 새 학년도 달력에서 다시 푼다. 공휴일·방학·다른 큰 행사와 겹치면 가까운 날을
 * 후보로 내고 "확인 필요"로 남긴다. 자동으로 확정하지 않는다.
 */

/** 한 학년도의 수업 기간 (방학식·종업식 날 포함) */
export interface Terms {
  sem1Start: string;
  sem1End: string;
  sem2Start: string;
  sem2End: string;
}
type Edge = keyof Terms;
const EDGE_LABEL: Record<Edge, string> = { sem1Start: '1학기 첫날', sem1End: '1학기 마지막 날', sem2Start: '2학기 첫날', sem2End: '2학기 마지막 날' };

export type PlanStatus =
  /** 기준대로 옮김 */
  | 'ok'
  /** 겹쳐서 가까운 날로 옮김 (작은 일정) */
  | 'moved'
  /** 교사가 봐야 함: 큰 일정이 겹쳤거나 기준이 애매함 */
  | 'check'
  /** 새로 제안 (징검다리 재량휴업일) */
  | 'suggested';

export interface PlanItem {
  id: string;
  title: string;
  start: string;
  end: string;
  kind: EventKind;
  grades?: number[];
  /** 작년 날짜 (새로 제안한 일정은 없음) */
  from?: { start: string; end: string };
  /** 어떤 기준으로 옮겼는지 (사람이 읽는 말) */
  anchor: string;
  status: PlanStatus;
  reason: string;
  /** 다른 후보 날짜 (시작일) */
  alternatives?: string[];
  /** 매주 반복 일정 묶음 */
  series?: string;
  /** 작년에 학기 밖(방학 중)에 있던 일정: 방학 중이어도 괜찮다 */
  offTerm?: boolean;
}

export interface PlanStats {
  total: number;
  sem1: number;
  sem2: number;
  /** 요일별 수업일수 (월~금) */
  byWeekday: number[];
  /** 법정 최소 수업일수 */
  minimum: number;
}

export interface Plan {
  fromYear: number;
  toYear: number;
  lastTerms: Terms;
  terms: Terms;
  items: PlanItem[];
  /** 새 학년도 징검다리 재량휴업 후보 (제안에 안 넣은 것 포함) */
  bridgeOptions: string[];
  stats: PlanStats;
  notes: string[];
}

export const LEGAL_MIN_DAYS = 190;

/* ---------- 달력 도우미 ---------- */

const isWeekend = (d: string) => weekdayIndex(d) > 4;
const dom = (d: string) => toDate(d).getUTCDate();
const monthOf = (d: string) => toDate(d).getUTCMonth() + 1;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** 학년도 안의 달 → 달력 연도 (1·2월은 다음 해) */
const calYear = (schoolYear: number, month: number) => (month <= 2 ? schoolYear + 1 : schoolYear);

/** 그 달 n번째 w요일 (n = -1이면 마지막) */
function nthWeekday(y: number, m: number, w: number, n: number): string {
  if (n < 0) {
    let d = iso(y, m, daysInMonth(y, m));
    while (weekdayIndex(d) !== w) d = addDays(d, -1);
    return d;
  }
  let d = iso(y, m, 1);
  while (weekdayIndex(d) !== w) d = addDays(d, 1);
  return addDays(d, 7 * (n - 1));
}

function nthOf(d: string): { n: number } {
  return { n: Math.ceil(dom(d) / 7) };
}

const WD = '월화수목금토일';
function nthLabel(d: string, useLast: boolean): string {
  const { n } = nthOf(d);
  return `${monthOf(d)}월 ${useLast ? '마지막' : `${n}째`} ${WD[weekdayIndex(d)]}요일`;
}

/** 작년 날짜를 "그 달 n째 w요일"로 보고 새 학년도에서 푼다 (5째 주는 "마지막 주"로) */
function mapNth(d: string, toYear: number): { date: string; label: string } {
  const m = monthOf(d);
  const useLast = nthOf(d).n >= 5;
  const date = nthWeekday(calYear(toYear, m), m, weekdayIndex(d), useLast ? -1 : nthOf(d).n);
  return { date, label: nthLabel(d, useLast) };
}

/** 공휴일·주말인가 */
const isPublicOff = (d: string) => isWeekend(d) || !!holidayName(d);

function inTerms(d: string, t: Terms): boolean {
  return (d >= t.sem1Start && d <= t.sem1End) || (d >= t.sem2Start && d <= t.sem2End);
}

/** 앞뒤가 쉬는 날인 평일 (징검다리) */
function isBridge(d: string, offExtra: Set<string>): boolean {
  if (isPublicOff(d)) return false;
  const off = (x: string) => isPublicOff(x) || offExtra.has(x);
  return off(addDays(d, -1)) && off(addDays(d, 1));
}

/* ---------- 작년 학기 경계 찾기 ---------- */

const firstSchoolDay = (from: string) => {
  let d = from;
  while (isPublicOff(d)) d = addDays(d, 1);
  return d;
};

/**
 * 작년 일정에서 학기 경계를 찾는다. 이름(개학·입학·방학식·종업식)을 먼저 보고,
 * 없으면 흔한 날(3월 첫 평일, 7월 하순, 8월 하순, 12월 말)로.
 */
export function detectTerms(events: CalEvent[], year: number): Terms {
  const find = (re: RegExp, from: string, to: string, pick: 'first' | 'last') => {
    const hits = events.filter((e) => re.test(e.title) && e.start >= from && e.start <= to).map((e) => e.start).sort();
    return pick === 'first' ? hits[0] : hits[hits.length - 1];
  };
  const y1 = year + 1;
  return {
    sem1Start: find(/개학|입학식|시업/, `${year}-02-25`, `${year}-03-15`, 'first') ?? firstSchoolDay(`${year}-03-02`),
    sem1End: find(/방학식/, `${year}-07-01`, `${year}-08-10`, 'last') ?? `${year}-07-20`,
    sem2Start: find(/개학/, `${year}-08-01`, `${year}-09-10`, 'first') ?? `${year}-08-20`,
    sem2End: find(/종업|졸업식|방학식/, `${year}-12-01`, `${y1}-02-28`, 'last') ?? `${year}-12-31`,
  };
}

/** 작년 학기 경계를 새 학년도로: 3월 첫날은 첫 평일, 나머지는 "n째 w요일", 12/31처럼 달 마지막 평일이면 그대로 */
export function suggestTerms(last: Terms, toYear: number): Terms {
  const lastWeekdayOfMonth = (d: string) => {
    let x = iso(toDate(d).getUTCFullYear(), monthOf(d), daysInMonth(toDate(d).getUTCFullYear(), monthOf(d)));
    while (isPublicOff(x)) x = addDays(x, -1);
    return x;
  };
  const map = (d: string) => {
    if (d === lastWeekdayOfMonth(d)) {
      const m = monthOf(d);
      return lastWeekdayOfMonth(iso(calYear(toYear, m), m, 1));
    }
    let t = mapNth(d, toYear).date;
    while (isPublicOff(t)) t = addDays(t, 1);
    return t;
  };
  return {
    sem1Start: firstSchoolDay(`${toYear}-03-02`),
    sem1End: map(last.sem1End),
    sem2Start: map(last.sem2Start),
    sem2End: map(last.sem2End),
  };
}

/* ---------- 작년 일정 정리 ---------- */

interface Span {
  title: string;
  start: string;
  end: string;
  kind: EventKind;
  grades?: number[];
  /** 같은 이름 반복 묶음 */
  n: number;
}

/** 다시 만드는 일정(법정 공휴일·방학)은 뺀다 */
function isRegenerated(title: string, kind: EventKind): boolean {
  if (kind === 'vacation') return true;
  if (kind !== 'holiday') return false;
  return !/재량|자율|개교|휴업/.test(title);
}

/** 같은 날 같은 이름은 하나로, 이어진 평일의 같은 이름은 한 덩어리로 */
function toSpans(events: CalEvent[], rules: RuleSet): Span[] {
  const byTitle = new Map<string, CalEvent[]>();
  for (const e of events) {
    const t = e.title.trim();
    if (!t) continue;
    byTitle.set(t, [...(byTitle.get(t) ?? []), e]);
  }
  const spans: Span[] = [];
  for (const [title, list] of byTitle) {
    const rule = classifyTitle(title, rules);
    if (isRegenerated(title, rule.kind)) continue;
    const days = [...new Set(list.flatMap((e) => eachDay(e.start, e.end)))].sort();
    let cur: Span | null = null;
    for (const d of days) {
      // 금 → 월, 또는 하루 뒤면 이어진 것으로 (주말 일정은 따로)
      const gap = cur ? diffDays(cur.end, d) : 99;
      const joined = cur && (gap === 1 || (gap <= 3 && weekdayIndex(cur.end) === 4 && weekdayIndex(d) === 0));
      if (cur && joined && (rule.kind === 'exam' || rule.kind === 'fullday' || rule.kind === 'holiday')) cur.end = d;
      else {
        cur = { title, start: d, end: d, kind: rule.kind, grades: rule.grades, n: 0 };
        spans.push(cur);
      }
    }
  }
  const count = new Map<string, number>();
  for (const s of spans) count.set(s.title, (count.get(s.title) ?? 0) + 1);
  for (const s of spans) s.n = count.get(s.title)!;
  return spans.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** 매주(또는 격주) 같은 요일 반복인가 */
function weeklyStep(starts: string[]): number | null {
  if (starts.length < 4) return null;
  const w = weekdayIndex(starts[0]);
  if (!starts.every((d) => weekdayIndex(d) === w)) return null;
  const gaps = starts.slice(1).map((d, i) => diffDays(starts[i], d)).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median === 7 || median === 14 ? median : null;
}

/* ---------- 배치 ---------- */

const MAJOR: EventKind[] = ['exam', 'fullday'];
/** 학교가 아니라 교육청·전국 단위로 날짜가 정해지는 일정 */
const EXTERNAL = /듣기평가|학업성취도|진단평가|전국연합|모의고사|수능|수학능력/;

interface Board {
  terms: Terms;
  /** 날짜 → 그날 쉬는 이유 (공휴일 제외, 재량휴업 등) */
  dayOff: Map<string, string>;
  /** 날짜 → 그날 큰 일정들 */
  major: Map<string, { title: string; grades?: number[] }[]>;
}

const gradesOverlap = (a?: number[], b?: number[]) => !a || !b || a.some((g) => b.includes(g));

/** 그 기간에 둘 수 없는 이유 (없으면 null) */
function blocker(b: Board, start: string, end: string, kind: EventKind, grades: number[] | undefined, offTerm: boolean): string | null {
  for (const d of eachDay(start, end)) {
    if (isWeekend(d)) {
      // 여러 날 일정이 주말을 끼는 것은 괜찮지만, 주말에 시작하거나 끝나면 안 된다 (작년에 방학·주말에 있던 일정은 예외)
      if (!offTerm && (d === start || d === end)) return `${fmtShort(d)} 주말`;
      continue;
    }
    const h = holidayName(d);
    if (h) return `${fmtShort(d)} ${h}`;
    const off = b.dayOff.get(d);
    if (off) return `${fmtShort(d)} ${off}`;
    if (!offTerm && kind !== 'info' && !inTerms(d, b.terms)) return `${fmtShort(d)} 방학`;
    if (MAJOR.includes(kind)) {
      const clash = (b.major.get(d) ?? []).find((x) => gradesOverlap(x.grades, grades));
      if (clash) return `${fmtShort(d)} ${clash.title}`;
    }
  }
  return null;
}

function occupy(b: Board, item: PlanItem) {
  if (item.kind === 'holiday') {
    for (const d of eachDay(item.start, item.end)) b.dayOff.set(d, item.title);
    return;
  }
  if (!MAJOR.includes(item.kind)) return;
  for (const d of eachDay(item.start, item.end)) b.major.set(d, [...(b.major.get(d) ?? []), { title: item.title, grades: item.grades }]);
}

/** 겹치면 가까운 날 후보: 하루짜리는 앞뒤 날, 여러 날은 주 단위로 (요일 유지) */
function candidates(start: string, end: string): number[] {
  const len = diffDays(start, end);
  return len === 0 ? [1, -1, 2, -2, 3, -3, 7, -7, 4, -4] : [7, -7, 14, -14, 1, -1];
}

function place(b: Board, it: PlanItem, strict: boolean): PlanItem {
  const why = blocker(b, it.start, it.end, it.kind, it.grades, !!it.offTerm);
  if (!why) {
    occupy(b, it);
    return it;
  }
  const len = diffDays(it.start, it.end);
  const alts: string[] = [];
  for (const off of candidates(it.start, it.end)) {
    const s = addDays(it.start, off);
    if (!blocker(b, s, addDays(s, len), it.kind, it.grades, !!it.offTerm)) alts.push(s);
    if (alts.length >= 3) break;
  }
  if (!alts.length) {
    const r = { ...it, status: 'check' as const, reason: `겹침: ${why} · 가까이 옮길 날을 찾지 못했습니다` };
    occupy(b, r);
    return r;
  }
  const s = alts[0];
  const moved: PlanItem = {
    ...it,
    start: s,
    end: addDays(s, len),
    status: strict ? 'check' : 'moved',
    reason: `겹침: ${why} · 기준일 ${fmtShort(it.start)} → ${fmtShort(s)}`,
    alternatives: alts.slice(1),
  };
  occupy(b, moved);
  return moved;
}

/* ---------- 1차안 ---------- */

export interface PlanOptions {
  /** 작년 학년도 (예: 2026) */
  fromYear: number;
  /** 새 학기 경계. 없으면 작년에서 추정 */
  terms?: Terms;
  lastTerms?: Terms;
  rules?: RuleSet;
}

export function makePlan(lastEvents: CalEvent[], opts: PlanOptions): Plan {
  const { fromYear } = opts;
  const toYear = fromYear + 1;
  const rules = opts.rules ?? DEFAULT_RULES;
  const yearFrom = `${fromYear}-03-01`;
  const yearTo = addDays(`${fromYear + 1}-03-01`, -1);
  const events = lastEvents.filter((e) => e.source !== 'auto' && e.start <= yearTo && e.end >= yearFrom);
  const lastTerms = opts.lastTerms ?? detectTerms(events, fromYear);
  const terms = opts.terms ?? suggestTerms(lastTerms, toYear);
  const notes: string[] = [];

  const spans = toSpans(events, rules);
  const edges = Object.entries(lastTerms) as [Edge, string][];
  const lastOff = new Set(spans.filter((s) => s.kind === 'holiday').flatMap((s) => eachDay(s.start, s.end)));
  const board: Board = { terms, dayOff: new Map(), major: new Map() };
  const items: PlanItem[] = [];
  let seq = 0;
  const base = (s: Span): Omit<PlanItem, 'start' | 'end' | 'anchor' | 'status' | 'reason'> => ({
    id: `p${++seq}`,
    title: s.title,
    kind: s.kind,
    grades: s.grades,
    from: { start: s.start, end: s.end },
    offTerm: !inTerms(s.start, lastTerms) || isWeekend(s.start),
  });
  const len = (s: Span) => diffDays(s.start, s.end);

  // 1) 매주 반복 일정은 묶어서 나중에 다시 펼친다
  const byTitle = new Map<string, Span[]>();
  for (const s of spans) byTitle.set(s.title, [...(byTitle.get(s.title) ?? []), s]);
  const seriesSpans = new Set<Span>();
  const series: { title: string; list: Span[]; step: number }[] = [];
  for (const [title, list] of byTitle) {
    const step = weeklyStep(list.map((s) => s.start));
    if (step && list.every((s) => s.start === s.end)) {
      list.forEach((s) => seriesSpans.add(s));
      series.push({ title, list, step });
    }
  }
  const singles = spans.filter((s) => !seriesSpans.has(s));

  // 2) 기준 정하기
  interface Planned {
    span: Span;
    start: string;
    anchor: string;
    /** 겹치면 교사 확인이 필요한 큰 일정인가 */
    strict: boolean;
    /** 놓는 순서: 학기 경계 → 개교기념 → 시험 → 전일 행사·휴업 → 따라가는 일정 → 나머지 */
    order: number;
    /** 큰 일정 가까이 붙어 있던 일정: 그 일정이 놓인 곳에서 같은 간격 */
    follow?: { ref: Planned; offset: number };
    placed?: PlanItem;
  }
  const planned: Planned[] = [];
  const bridgesLast: Span[] = [];
  for (const s of singles) {
    const edge = edges.find(([, d]) => d === s.start);
    if (edge) {
      planned.push({ span: s, start: terms[edge[0]], anchor: `${EDGE_LABEL[edge[0]]}에 맞춤`, strict: true, order: 0 });
      continue;
    }
    if (s.kind === 'holiday') {
      if (/개교/.test(s.title)) {
        const m = monthOf(s.start);
        planned.push({ span: s, start: iso(calYear(toYear, m), m, dom(s.start)), anchor: `매년 ${m}/${dom(s.start)} (개교기념일)`, strict: true, order: 1 });
        continue;
      }
      if (s.start === s.end && isBridge(s.start, lastOff)) {
        bridgesLast.push(s);
        continue;
      }
    }
    const nth = mapNth(s.start, toYear);
    const order = s.kind === 'exam' ? 2 : s.kind === 'fullday' || s.kind === 'holiday' ? 3 : 5;
    planned.push({ span: s, start: nth.date, anchor: nth.label, strict: order <= 3, order });
  }

  // 3) 시험과 같은 주, 3일 안에 붙어 있던 일정은 시험을 따라간다 (시험 다음 날 체육대회 등)
  const weekOf = (d: string) => addDays(d, -weekdayIndex(d));
  const majors = planned.filter((p) => p.span.kind === 'exam');
  for (const p of planned) {
    if (p.order < 3 || p.span.kind === 'exam') continue;
    const ref = majors.find((q) => {
      if (weekOf(q.span.start) !== weekOf(p.span.start)) return false;
      const before = diffDays(p.span.start, q.span.start);
      const after = diffDays(q.span.end, p.span.start);
      return (before > 0 && before <= 3) || (after > 0 && after <= 3);
    });
    if (ref && !EXTERNAL.test(p.span.title)) {
      const offset = diffDays(ref.span.start, p.span.start);
      p.follow = { ref, offset };
      p.anchor = `${ref.span.title} ${offset < 0 ? `${-offset}일 전` : `시작 ${offset}일 뒤`}`;
      p.order = 4;
    }
  }

  // 4) 순서대로 놓는다
  planned.sort((a, b) => a.order - b.order || a.span.start.localeCompare(b.span.start));
  for (const p of planned) {
    const start = p.follow?.ref.placed ? addDays(p.follow.ref.placed.start, p.follow.offset) : p.start;
    const it: PlanItem = {
      ...base(p.span),
      start,
      end: addDays(start, len(p.span)),
      anchor: p.anchor,
      status: 'ok',
      reason: `작년 ${fmtShort(p.span.start)} → ${p.anchor}`,
    };
    p.placed = place(board, it, p.strict);
    if (EXTERNAL.test(p.span.title))
      Object.assign(p.placed, { status: 'check', reason: `교육청·전국 단위로 날짜가 정해지는 일정입니다. 새 학년도 공문 날짜로 확인하세요 (${p.anchor}로 임시 배치)` });
    items.push(p.placed);
  }

  // 5) 징검다리 재량휴업: 작년 날짜를 옮기지 않고 새해 후보를 다시 찾는다
  // 법정 공휴일에 붙은 징검다리를 먼저, 학교 휴업일에만 붙은 것은 뒤로
  const nextToHoliday = (d: string) => !!holidayName(addDays(d, -1)) || !!holidayName(addDays(d, 1));
  const bridgeOptions = eachDay(terms.sem1Start, terms.sem2End)
    .filter((d) => inTerms(d, terms) && !board.dayOff.has(d) && !(board.major.get(d) ?? []).length && isBridge(d, new Set(board.dayOff.keys())))
    .sort((a, b) => Number(nextToHoliday(b)) - Number(nextToHoliday(a)) || a.localeCompare(b));
  const want = bridgesLast.length;
  const chosen = bridgeOptions.slice(0, Math.max(0, want));
  for (const d of chosen) {
    const it: PlanItem = {
      id: `p${++seq}`,
      title: '재량휴업일',
      start: d,
      end: d,
      kind: 'holiday',
      anchor: '징검다리 휴일',
      status: 'suggested',
      reason: `${fmtShort(addDays(d, -1))}·${fmtShort(addDays(d, 1))} 사이에 낀 평일. 작년에도 징검다리 재량휴업 ${want}일(${bridgesLast.map((s) => fmtShort(s.start)).join(', ')})`,
      alternatives: bridgeOptions.filter((x) => !chosen.includes(x)).slice(0, 4),
    };
    occupy(board, it);
    items.push(it);
  }
  if (want && bridgeOptions.length < want) notes.push(`작년 징검다리 재량휴업은 ${want}일이었는데, 새 학년도 징검다리 평일은 ${bridgeOptions.length}일뿐입니다.`);

  // 6) 매주 반복 일정 다시 펼치기
  for (const s of series) {
    const first = mapNth(s.list[0].start, toYear).date;
    const last = mapNth(s.list[s.list.length - 1].start, toYear).date;
    const tag = `${s.step === 7 ? '매주' : '격주'} ${WD[weekdayIndex(s.list[0].start)]}요일`;
    let skipped = 0;
    for (let d = first; d <= last; d = addDays(d, s.step)) {
      if (blocker({ ...board, major: new Map() }, d, d, s.list[0].kind, undefined, false)) {
        skipped++;
        continue;
      }
      items.push({
        id: `p${++seq}`,
        title: s.title,
        start: d,
        end: d,
        kind: s.list[0].kind,
        grades: s.list[0].grades,
        anchor: tag,
        status: 'ok',
        reason: `작년 ${s.list.length}회 ${tag} 반복`,
        series: s.title,
      });
    }
    if (skipped) notes.push(`"${s.title}"(${tag}) ${skipped}회는 휴일·방학이라 뺐습니다.`);
  }

  const dropped = events.filter((e) => /선거/.test(e.title)).length;
  if (dropped) notes.push('선거일은 해마다 달라 옮기지 않았습니다. 새 학년도 선거일이 있으면 직접 넣으세요.');

  items.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { fromYear, toYear, lastTerms, terms, items, bridgeOptions, stats: planStats(items, terms), notes };
}

/* ---------- 점검 ---------- */

/** 수업일수: 학기 안 평일에서 공휴일과 휴업일을 뺀 날 */
export function planStats(items: PlanItem[], terms: Terms): PlanStats {
  const off = new Set(items.filter((i) => i.kind === 'holiday' || i.kind === 'vacation').flatMap((i) => eachDay(i.start, i.end)));
  const byWeekday = [0, 0, 0, 0, 0];
  let sem1 = 0;
  let sem2 = 0;
  for (const [a, b, add] of [
    [terms.sem1Start, terms.sem1End, () => sem1++],
    [terms.sem2Start, terms.sem2End, () => sem2++],
  ] as const) {
    if (!a || !b || a > b) continue;
    for (const d of eachDay(a, b)) {
      if (isPublicOff(d) || off.has(d)) continue;
      add();
      byWeekday[weekdayIndex(d)]++;
    }
  }
  return { total: sem1 + sem2, sem1, sem2, byWeekday, minimum: LEGAL_MIN_DAYS };
}

/** 고친 뒤 다시 점검: 일정마다 겹치는 곳 */
export function planConflicts(items: PlanItem[], terms: Terms): Map<string, string> {
  const out = new Map<string, string>();
  const board: Board = { terms, dayOff: new Map(), major: new Map() };
  const order = (i: PlanItem) => (i.kind === 'holiday' ? 0 : MAJOR.includes(i.kind) ? 1 : 2);
  for (const it of [...items].sort((a, b) => order(a) - order(b) || a.start.localeCompare(b.start))) {
    if (it.status === 'suggested' && it.kind === 'holiday') {
      occupy(board, it);
      continue;
    }
    const why = blocker(board, it.start, it.end, it.kind, it.grades, !!it.offTerm);
    if (why) out.set(it.id, why);
    occupy(board, it);
  }
  return out;
}
