import { addDays, diffDays, fmtShort, weekdayIndex } from './dates';
import type { Timetable } from './types';

/**
 * 시간표 교체 (베타): 선생님이 빠지는 수업을 교체(맞바꾸기)나 보강으로 채울 후보를 찾는다.
 *
 * - 교체: 빠지는 수업(A 선생님, C반, d일 p교시)을 같은 반의 다른 수업(B 선생님, d2일 p2교시)과 맞바꾼다.
 *   B는 d일 p교시에, A는 d2일 p2교시에 비어 있어야 한다. 반의 과목 시수가 그대로라 먼저 찾는다.
 * - 보강: d일 p교시에 비어 있는 다른 선생님이 들어간다. 원래 과목 수업은 한 시간 빠진다.
 *
 * 베타 한계: 요일별 기본 시간표로 본다(그날의 요일 교체·교시 옮김은 아직 반영하지 않음).
 */

export interface SwapRules {
  /** 교체를 찾을 범위: 같은 주 / 다음 주까지 */
  window: 'week' | 'twoWeeks';
  /** 선생님 하루 최대 수업 */
  maxDaily: number;
  /** 연달아 할 수 있는 최대 수업 */
  maxRun: number;
  sameSubject: boolean;
  sameGrade: boolean;
  homeroom: boolean;
  /** 보강이 한 선생님께 몰리지 않게 */
  balance: boolean;
}

export const DEFAULT_SWAP_RULES: SwapRules = { window: 'week', maxDaily: 6, maxRun: 3, sameSubject: true, sameGrade: true, homeroom: true, balance: true };

export interface Absence {
  id: string;
  teacher: string;
  date: string;
  /** 빠지는 교시. 비어 있으면 그날 전부 */
  periods: number[];
  reason: string;
}

/** 채워야 할 수업 한 칸 */
export interface Need {
  key: string;
  absenceId: string;
  date: string;
  period: number;
  cls: string;
  grade: number;
  subject: string;
  teacher: string;
}

export interface SwapOption {
  kind: 'swap';
  teacher: string;
  subject: string;
  date: string;
  period: number;
  notes: string[];
}
export interface CoverOption {
  kind: 'cover';
  teacher: string;
  notes: string[];
}
export type Option = SwapOption | CoverOption;

/** 지금까지 고른 결보강: 그 선생님이 그날 추가로 들어가거나 빠지는 교시 */
export interface Pick {
  need: Need;
  option: Option;
}

export interface TeacherIndex {
  teachers: string[];
  /** 선생님 → 요일 → 교시 → 반 */
  busy: Map<string, (string | null)[][]>;
  subjects: Map<string, Set<string>>;
  grades: Map<string, Set<number>>;
  homeroomOf: Map<string, string>;
}

export function indexTeachers(tt: Timetable): TeacherIndex {
  const busy = new Map<string, (string | null)[][]>();
  const subjects = new Map<string, Set<string>>();
  const grades = new Map<string, Set<number>>();
  const homeroomOf = new Map<string, string>();
  for (const c of tt.classes) {
    if (c.homeroom) homeroomOf.set(c.homeroom, c.id);
    c.week.forEach((day, wd) =>
      day.forEach((slot, i) => {
        if (!slot?.t) return;
        if (!busy.has(slot.t)) busy.set(slot.t, [0, 1, 2, 3, 4].map(() => []));
        busy.get(slot.t)![wd][i + 1] = c.id;
        if (!subjects.has(slot.t)) subjects.set(slot.t, new Set());
        subjects.get(slot.t)!.add(slot.s);
        if (!grades.has(slot.t)) grades.set(slot.t, new Set());
        grades.get(slot.t)!.add(c.grade);
      }),
    );
  }
  const teachers = [...busy.keys()].sort((a, b) => a.localeCompare(b, 'ko'));
  return { teachers, busy, subjects, grades, homeroomOf };
}

/** 그 선생님이 그 요일에 가르치는 교시 */
export function teachingPeriods(idx: TeacherIndex, teacher: string, wd: number): number[] {
  const day = idx.busy.get(teacher)?.[wd] ?? [];
  return day.map((c, p) => (c ? p : 0)).filter((p) => p > 0);
}

export function needsFor(tt: Timetable, idx: TeacherIndex, a: Absence): Need[] {
  const wd = weekdayIndex(a.date);
  if (wd > 4) return [];
  const periods = a.periods.length ? a.periods : teachingPeriods(idx, a.teacher, wd);
  const out: Need[] = [];
  for (const p of periods) {
    const cls = idx.busy.get(a.teacher)?.[wd]?.[p];
    if (!cls) continue;
    const c = tt.classes.find((x) => x.id === cls)!;
    out.push({ key: `${a.id}|${p}`, absenceId: a.id, date: a.date, period: p, cls, grade: c.grade, subject: c.week[wd][p - 1].s, teacher: a.teacher });
  }
  return out;
}

export interface SwapContext {
  tt: Timetable;
  idx: TeacherIndex;
  rules: SwapRules;
  absences: Absence[];
  picks: Pick[];
  /** 그 반 학년이 그날 평소 수업을 하는가 (휴업·방학·시험·전일 행사 제외) */
  dayOpen: (date: string, grade: number) => boolean;
  /** 선생님별 지금까지 보강 횟수 */
  coverCount: Map<string, number>;
}

/** 고른 결보강을 반영한 그날 그 선생님의 교시별 상태 */
function dayState(ctx: SwapContext, teacher: string, date: string): boolean[] {
  const wd = weekdayIndex(date);
  const on: boolean[] = [];
  const day = ctx.idx.busy.get(teacher)?.[wd] ?? [];
  for (let p = 1; p <= 8; p++) on[p] = !!day[p];
  for (const { need, option } of ctx.picks) {
    // 빠지는 선생님의 원래 수업은 비고, 교체 상대 수업은 옮겨 간다
    if (need.teacher === teacher && need.date === date) on[need.period] = false;
    if (option.kind === 'cover' && option.teacher === teacher && need.date === date) on[need.period] = true;
    if (option.kind === 'swap') {
      if (option.teacher === teacher && option.date === date) on[option.period] = false;
      if (option.teacher === teacher && need.date === date) on[need.period] = true;
      if (need.teacher === teacher && option.date === date) on[option.period] = true;
    }
  }
  return on;
}

function absentAt(ctx: SwapContext, teacher: string, date: string, period: number): boolean {
  return ctx.absences.some((a) => a.teacher === teacher && a.date === date && (a.periods.length === 0 || a.periods.includes(period)));
}

/** 그 교시에 넣어도 되는가: 비어 있고, 하루 최대·연강 제한 안 */
function canAdd(ctx: SwapContext, teacher: string, date: string, period: number): string | null {
  if (absentAt(ctx, teacher, date, period)) return '그날 빠짐';
  const on = dayState(ctx, teacher, date);
  if (on[period]) return '수업 있음';
  const load = on.filter(Boolean).length;
  if (load + 1 > ctx.rules.maxDaily) return `하루 ${ctx.rules.maxDaily}시간 넘음`;
  on[period] = true;
  let run = 0;
  for (let p = 1; p <= 8; p++) {
    run = on[p] ? run + 1 : 0;
    if (run > ctx.rules.maxRun) return `${ctx.rules.maxRun}시간 넘게 연속`;
  }
  return null;
}

function loadOn(ctx: SwapContext, teacher: string, date: string): number {
  return dayState(ctx, teacher, date).filter(Boolean).length;
}

/** 교체를 찾을 날들 (그 주 월~금, 또는 다음 주까지) */
function windowDays(date: string, w: SwapRules['window']): string[] {
  const mon = addDays(date, -weekdayIndex(date));
  const n = w === 'week' ? 5 : 12;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(mon, i);
    if (weekdayIndex(d) < 5) out.push(d);
  }
  return out;
}

export function findOptions(need: Need, ctx: SwapContext): { swaps: SwapOption[]; covers: CoverOption[] } {
  const cls = ctx.tt.classes.find((x) => x.id === need.cls)!;

  // 교체: 같은 반 다른 수업과 맞바꾸기
  const swaps: (SwapOption & { dist: number })[] = [];
  for (const d2 of windowDays(need.date, ctx.rules.window)) {
    if (!ctx.dayOpen(d2, need.grade)) continue;
    const wd2 = weekdayIndex(d2);
    cls.week[wd2].forEach((slot, i) => {
      const p2 = i + 1;
      if (!slot?.t || slot.t === need.teacher) return;
      if (d2 === need.date && p2 === need.period) return;
      // 이미 다른 결보강으로 바뀐 수업은 건드리지 않음
      if (ctx.picks.some((pk) => pk.option.kind === 'swap' && pk.option.date === d2 && pk.option.period === p2 && pk.need.cls === need.cls)) return;
      const b = slot.t;
      if (canAdd(ctx, b, need.date, need.period) || canAdd(ctx, need.teacher, d2, p2)) return;
      const dist = Math.abs(diffDays(need.date, d2));
      const notes = [d2 === need.date ? '같은 날' : `${fmtShort(d2)} ${p2}교시와 맞바꿈`, '두 과목 시수 그대로'];
      swaps.push({ kind: 'swap', teacher: b, subject: slot.s, date: d2, period: p2, notes, dist });
    });
  }
  swaps.sort((a, b) => a.dist - b.dist || a.period - b.period);

  // 보강: 그 시간 비어 있는 선생님
  const covers: (CoverOption & { score: number })[] = [];
  for (const t of ctx.idx.teachers) {
    if (t === need.teacher) continue;
    if (canAdd(ctx, t, need.date, need.period)) continue;
    const notes: string[] = [];
    let score = 0;
    if (ctx.rules.sameSubject && ctx.idx.subjects.get(t)?.has(need.subject)) {
      score += 4;
      notes.push('같은 과목');
    }
    if (ctx.rules.homeroom && ctx.idx.homeroomOf.get(t) === need.cls) {
      score += 3;
      notes.push('담임');
    }
    if (ctx.rules.sameGrade && ctx.idx.grades.get(t)?.has(need.grade)) {
      score += 2;
      notes.push(`${need.grade}학년 수업`);
    }
    const count = ctx.coverCount.get(t) ?? 0;
    if (ctx.rules.balance) {
      score -= count * 1.5;
      if (count) notes.push(`보강 ${count}번 함`);
    }
    const load = loadOn(ctx, t, need.date);
    score -= load * 0.3;
    notes.push(`그날 ${load}시간`);
    covers.push({ kind: 'cover', teacher: t, notes, score });
  }
  covers.sort((a, b) => b.score - a.score || a.teacher.localeCompare(b.teacher, 'ko'));

  return {
    swaps: swaps.slice(0, 3).map(({ dist: _d, ...s }) => s),
    covers: covers.slice(0, 5).map(({ score: _s, ...c }) => c),
  };
}

/** 안내문 한 줄 */
export function describePick(p: Pick): string {
  const n = p.need;
  const head = `${fmtShort(n.date)} ${n.period}교시 ${n.cls} ${n.subject}(${n.teacher})`;
  if (p.option.kind === 'cover') return `${head} → 보강: ${p.option.teacher}`;
  return `${head} → 교체: ${fmtShort(p.option.date)} ${p.option.period}교시 ${p.option.subject}(${p.option.teacher})와 맞바꿈`;
}
