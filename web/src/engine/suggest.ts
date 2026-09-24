import { appliesTo, isMovable } from './parseEvents';
import { fmtShort } from './dates';
import { classDay, deliveredBefore, type Ledger } from './compute';
import { isAcademic } from './subjects';
import type { CalEvent, EventRule, ParsedEvent } from './types';
import { WEEKDAYS } from './types';

/**
 * 보완안 탐색.
 * 점수 = 4 × Σ(편제 대비 부족 시수)² + Σ(체크포인트별 학년 내 반간 격차)²
 * 낮을수록 좋다. 이미 지난 날짜는 바꿀 수 없으므로 기준일 이후만 후보로 본다.
 */

export interface Delta {
  cls: string;
  subject: string;
  n: number;
  date: string;
}

export interface Suggestion {
  id: string;
  type: 'dayswap' | 'move';
  date: string;
  title: string;
  why: string;
  /** 적용 시 추가할 일정 (요일 교체) */
  addEvent?: CalEvent;
  /** 적용 시 기존 일정 교시를 바꾸는 수정 (교시 이동) */
  override?: { eventId: string; rule: Partial<EventRule> };
  deltas: Delta[];
  before: Metrics;
  after: Metrics;
  highlights: string[];
}

export interface Metrics {
  score: number;
  /** 편제 시수보다 부족한 (반, 과목) 칸 수 */
  deficitCells: number;
  /** 부족 시수 합 */
  deficitHours: number;
  /** 체크포인트별 최대 반간 격차 */
  maxSpread: number;
}

interface State {
  classes: { id: string; grade: number }[];
  subjects: Map<string, string[]>; // cls → academic subjects
  target: Map<string, number>; // key cls|s
  total: Map<string, number>;
  /** 체크포인트별 누적 (cls|s) */
  cp: { date: string; grades?: number[]; val: Map<string, number> }[];
}

const k = (c: string, s: string) => `${c}|${s}`;

function buildState(l: Ledger): State {
  const subjects = new Map<string, string[]>();
  const tgt = new Map<string, number>();
  const total = new Map<string, number>();
  for (const c of l.classes) {
    const list = Object.keys(l.weekly[c.id]).filter(isAcademic);
    subjects.set(c.id, list);
    for (const s of list) {
      tgt.set(k(c.id, s), l.weekly[c.id][s] * l.settings.targetWeeks);
      total.set(k(c.id, s), l.delivered[c.id][s] ?? 0);
    }
  }
  const cp = l.checkpoints
    .filter((x) => x.date !== '9999-12-31')
    .map((x) => {
      const val = new Map<string, number>();
      for (const c of l.classes) for (const s of subjects.get(c.id)!) val.set(k(c.id, s), deliveredBefore(l, c.id, s, x.date));
      return { date: x.date, grades: x.grades, val };
    });
  return { classes: l.classes.map((c) => ({ id: c.id, grade: c.grade })), subjects, target: tgt, total, cp };
}

function metrics(st: State, deltas: Delta[] = []): Metrics {
  const byKey = new Map<string, Delta[]>();
  for (const d of deltas) {
    const key = k(d.cls, d.subject);
    const list = byKey.get(key);
    if (list) list.push(d);
    else byKey.set(key, [d]);
  }
  const adj = (m: Map<string, number>, key: string, cpDate?: string) => {
    let v = m.get(key) ?? 0;
    const list = byKey.get(key);
    if (list) for (const d of list) if (!cpDate || d.date < cpDate) v += d.n;
    return v;
  };
  let deficitCells = 0;
  let deficitHours = 0;
  let score = 0;
  for (const [key, t] of st.target) {
    const v = adj(st.total, key);
    if (v < t) {
      deficitCells++;
      deficitHours += t - v;
      score += 4 * (t - v) ** 2;
    }
  }
  let maxSpread = 0;
  const grades = [...new Set(st.classes.map((c) => c.grade))];
  const pools = [
    ...st.cp.map((c) => ({ date: c.date as string | undefined, grades: c.grades, val: c.val })),
    { date: undefined as string | undefined, grades: undefined as number[] | undefined, val: st.total },
  ];
  for (const pool of pools) {
    for (const g of grades) {
      if (pool.grades && !pool.grades.includes(g)) continue;
      const cs = st.classes.filter((c) => c.grade === g);
      const subs = new Set(cs.flatMap((c) => st.subjects.get(c.id)!));
      for (const s of subs) {
        let min = Infinity;
        let max = -Infinity;
        for (const c of cs) {
          const key = k(c.id, s);
          if (!st.target.has(key)) continue;
          const v = adj(pool.val, key, pool.date);
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
        if (max >= min) {
          score += (max - min) ** 2;
          if (pool.date) maxSpread = Math.max(maxSpread, max - min);
        }
      }
    }
  }
  return { score, deficitCells, deficitHours, maxSpread };
}

function applyDeltas(st: State, deltas: Delta[]) {
  for (const d of deltas) {
    const key = k(d.cls, d.subject);
    if (!st.target.has(key)) continue;
    st.total.set(key, (st.total.get(key) ?? 0) + d.n);
    for (const cp of st.cp) if (d.date < cp.date) cp.val.set(key, (cp.val.get(key) ?? 0) + d.n);
  }
}

interface Candidate {
  type: Suggestion['type'];
  date: string;
  deltas: Delta[];
  swapTo?: number;
  event?: ParsedEvent;
  newPeriods?: number[];
}

function candidates(l: Ledger): Candidate[] {
  const out: Candidate[] = [];
  const today = l.settings.today;
  for (const day of l.days) {
    if (day.date <= today || day.off) continue;
    const active = day.events.filter((e) => e.rule.kind !== 'info');

    /** 그날 일정을 바꿨을 때 반별 과목 시수 변화 (실제 계산 규칙 그대로) */
    const diff = (next: ParsedEvent[]): Delta[] => {
      const deltas: Delta[] = [];
      for (const c of l.classes) {
        const mineNow = active.filter((e) => appliesTo(e.rule, c.id, c.grade));
        const mineNext = next.filter((e) => appliesTo(e.rule, c.id, c.grade));
        const a = classDay(c, day.weekday, mineNow, l.settings).counts;
        const b = classDay(c, day.weekday, mineNext, l.settings).counts;
        for (const s of new Set([...Object.keys(a), ...Object.keys(b)])) {
          const n = (b[s] ?? 0) - (a[s] ?? 0);
          if (n && isAcademic(s)) deltas.push({ cls: c.id, subject: s, n, date: day.date });
        }
      }
      return deltas;
    };

    // 1) 일정이 전혀 없는 날: 요일 교체
    if (active.length === 0) {
      for (let w = 0; w < 5; w++) {
        if (w === day.weekday) continue;
        const ev: ParsedEvent = {
          id: 'cand',
          title: '',
          start: day.date,
          end: day.date,
          source: 'plan',
          rule: { kind: 'dayswap', swapTo: w, label: '', confidence: 'high', reason: '' },
        };
        out.push({ type: 'dayswap', date: day.date, swapTo: w, deltas: diff([ev]) });
      }
    }

    // 2) 하루짜리 부분 교시 일정: 다른 교시로 옮기기
    for (const e of active) {
      if (e.rule.kind !== 'periods' || e.start !== e.end || !e.rule.periods || !isMovable(e.title.split(' ← ')[0])) continue;
      const len = e.rule.periods.length;
      const nPeriods = Math.max(...l.classes.map((c) => c.week[day.weekday].length));
      if (len >= nPeriods) continue;
      const first = e.rule.periods[0];
      for (let start = 1; start + len - 1 <= nPeriods; start++) {
        if (start === first) continue;
        const next = Array.from({ length: len }, (_, i) => start + i);
        // 같은 대상에게 이미 다른 교시 일정이 있는 칸으로는 옮기지 않는다
        const clash = active.some(
          (x) =>
            x !== e &&
            (x.rule.kind === 'periods' || x.rule.kind === 'exam' || x.rule.kind === 'fullday') &&
            (!x.rule.periods || x.rule.periods.some((p) => next.includes(p))) &&
            l.classes.some((c) => appliesTo(x.rule, c.id, c.grade) && appliesTo(e.rule, c.id, c.grade)),
        );
        if (clash) continue;
        const moved = active.map((x) => (x === e ? { ...x, rule: { ...x.rule, periods: next } } : x));
        const deltas = diff(moved);
        if (deltas.length) out.push({ type: 'move', date: day.date, event: e, newPeriods: next, deltas });
      }
    }
  }
  return out;
}

export function suggest(l: Ledger, limit = 4): { base: Metrics; list: Suggestion[]; final: Metrics } {
  const st = buildState(l);
  const base = metrics(st);
  const pool = candidates(l);
  const list: Suggestion[] = [];
  const usedDates = new Set<string>();
  let current = base;

  for (let round = 0; round < limit; round++) {
    let best: { c: Candidate; m: Metrics } | null = null;
    for (const c of pool) {
      if (usedDates.has(c.date)) continue;
      const m = metrics(st, c.deltas);
      if (!best || m.score < best.m.score) best = { c, m };
    }
    if (!best || best.m.score >= current.score - 1) break;
    const { c, m } = best;
    usedDates.add(c.date);
    list.push(describe(l, st, c, current, m));
    applyDeltas(st, c.deltas);
    current = m;
  }
  return { base, list, final: current };
}

function net(deltas: Delta[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of deltas) m.set(k(d.cls, d.subject), (m.get(k(d.cls, d.subject)) ?? 0) + d.n);
  return m;
}

function describe(l: Ledger, st: State, c: Candidate, before: Metrics, after: Metrics): Suggestion {
  const n = net(c.deltas);
  // 부족이 풀리는 칸을 먼저 보여준다
  const helped: { label: string; short: number }[] = [];
  for (const [key, v] of n) {
    if (v <= 0) continue;
    const t = st.target.get(key);
    const cur = st.total.get(key);
    if (t !== undefined && cur !== undefined && cur < t) {
      const [cls, s] = key.split('|');
      helped.push({ label: `${cls} ${s} +${v}`, short: t - cur });
    }
  }
  const fixed = helped.sort((a, b) => b.short - a.short).map((h) => h.label);
  const bySubject = new Map<string, number>();
  for (const d of c.deltas) bySubject.set(d.subject, (bySubject.get(d.subject) ?? 0) + d.n);
  const gainers = [...bySubject].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const losers = [...bySubject].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).map(([s]) => s);

  if (c.type === 'dayswap') {
    const wName = WEEKDAYS[c.swapTo!];
    const orig = WEEKDAYS[l.days.find((d) => d.date === c.date)!.weekday];
    return {
      id: `swap-${c.date}-${c.swapTo}`,
      type: 'dayswap',
      date: c.date,
      title: `${fmtShort(c.date)}에 ${wName}요일 시간표로 수업`,
      why: `${wName}요일 수업이 휴업·행사로 많이 빠졌습니다. ${orig}요일 과목에서 한 번씩 가져와 채웁니다.`,
      addEvent: { id: `plan-swap-${c.date}`, title: `${wName}요일 시간표 운영`, start: c.date, end: c.date, source: 'plan' },
      deltas: c.deltas,
      before,
      after,
      highlights: fixed.length ? fixed.slice(0, 8) : [`늘어나는 과목: ${gainers.slice(0, 5).join(', ')}`, `줄어드는 과목: ${losers.slice(0, 5).join(', ')}`],
    };
  }
  const e = c.event!;
  const from = e.rule.periods!;
  const to = c.newPeriods!;
  const span = (p: number[]) => (p.length === 1 ? `${p[0]}교시` : `${p[0]}~${p[p.length - 1]}교시`);
  return {
    id: `move-${e.id}-${to[0]}`,
    type: 'move',
    date: c.date,
    title: `${fmtShort(c.date)} "${e.title.split(" ← ")[0]}"을 ${span(from)} → ${span(to)}로 이동`,
    why: `지금 교시에는 부족한 과목이 걸려 있습니다. 여유 있는 과목이 있는 교시로 옮깁니다.`,
    override: { eventId: e.id, rule: { periods: to, label: `${span(to)} 특별교육` } },
    deltas: c.deltas,
    before,
    after,
    highlights: fixed.length ? fixed.slice(0, 8) : [`되살아나는 과목: ${gainers.slice(0, 5).join(', ')}`],
  };
}

/** 현재 계획(적용된 제안 포함)의 지표 */
export function ledgerMetrics(l: Ledger): Metrics {
  return metrics(buildState(l));
}

/** 남은 부족분: 보강이 필요한 칸 */
export function remainingDeficits(l: Ledger): { cls: string; subject: string; target: number; delivered: number; short: number }[] {
  const out = [];
  for (const c of l.classes)
    for (const [s, w] of Object.entries(l.weekly[c.id])) {
      if (!isAcademic(s)) continue;
      const t = w * l.settings.targetWeeks;
      const d = l.delivered[c.id][s] ?? 0;
      if (d < t) out.push({ cls: c.id, subject: s, target: t, delivered: d, short: t - d });
    }
  return out.sort((a, b) => b.short - a.short || a.cls.localeCompare(b.cls, 'ko', { numeric: true }));
}
