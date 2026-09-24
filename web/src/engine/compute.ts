import { appliesTo } from './parseEvents';
import { eachDay, weekdayIndex } from './dates';
import { isAcademic, sortSubjects } from './subjects';
import type { Checkpoint, ClassTimetable, EventKind, Loss, ParsedEvent, Settings, Slot, Timetable } from './types';

export interface SwapRecord {
  date: string;
  cls: string;
  /** 원래 요일에서 빠진 과목 */
  removed: string[];
  /** 교체 요일에서 들어온 과목 */
  added: string[];
  eventTitle: string;
}

export interface DayInfo {
  date: string;
  weekday: number;
  /** 모든 반이 수업 없음 */
  off: boolean;
  /** 이 날 빠진 교시 수 (전 학급 합) */
  lostPeriods: number;
  events: ParsedEvent[];
}

export interface TeacherStat {
  name: string;
  weekly: number;
  byWeekday: number[];
  subjects: string[];
  classes: string[];
  target: number;
  delivered: number;
  lost: number;
}

export interface Ledger {
  settings: Settings;
  timetable: Timetable;
  classes: ClassTimetable[];
  /** 학기 중 평일 */
  days: DayInfo[];
  /** 한 반이라도 교과 수업이 있는 날 수 */
  schoolDays: number;
  weekly: Record<string, Record<string, number>>;
  delivered: Record<string, Record<string, number>>;
  /** 행사·시험 등으로 대체된 교시 수: cls → 분류명 → 교시 */
  replaced: Record<string, Record<string, number>>;
  /** dailyDelivered[cls][dayIndex][subject] */
  dailyDelivered: Record<string, Record<string, number>[]>;
  losses: Loss[];
  swaps: SwapRecord[];
  teachers: TeacherStat[];
  checkpoints: Checkpoint[];
  subjectsByGrade: Record<number, string[]>;
}

const OFF_KINDS: EventKind[] = ['holiday', 'vacation'];

export function weeklyCounts(c: ClassTimetable): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of c.week) for (const slot of day) if (slot) out[slot.s] = (out[slot.s] ?? 0) + 1;
  return out;
}

export function computeLedger(tt: Timetable, events: ParsedEvent[], settings: Settings): Ledger {
  const classes = tt.classes;
  const weekly: Ledger['weekly'] = {};
  const delivered: Ledger['delivered'] = {};
  const replaced: Ledger['replaced'] = {};
  const dailyDelivered: Ledger['dailyDelivered'] = {};
  const losses: Loss[] = [];
  const swaps: SwapRecord[] = [];
  const subjectsByGrade: Record<number, Set<string>> = {};

  const teacherMap = new Map<string, TeacherStat>();
  const teacher = (name: string) => {
    let t = teacherMap.get(name);
    if (!t) {
      t = { name, weekly: 0, byWeekday: [0, 0, 0, 0, 0], subjects: [], classes: [], target: 0, delivered: 0, lost: 0 };
      teacherMap.set(name, t);
    }
    return t;
  };

  for (const c of classes) {
    weekly[c.id] = weeklyCounts(c);
    delivered[c.id] = Object.fromEntries(Object.keys(weekly[c.id]).map((s) => [s, 0]));
    replaced[c.id] = {};
    dailyDelivered[c.id] = [];
    const gradeSet = (subjectsByGrade[c.grade] ??= new Set());
    for (const s of Object.keys(weekly[c.id])) gradeSet.add(s);
    c.week.forEach((day, wd) =>
      day.forEach((slot) => {
        if (!slot?.t) return;
        const t = teacher(slot.t);
        t.weekly++;
        t.byWeekday[wd]++;
        if (!t.subjects.includes(slot.s)) t.subjects.push(slot.s);
        if (!t.classes.includes(c.id)) t.classes.push(c.id);
      }),
    );
  }

  const active = events.filter((e) => e.rule.kind !== 'info');
  const days: DayInfo[] = [];
  let schoolDays = 0;

  for (const date of eachDay(settings.termStart, settings.termEnd)) {
    const wd = weekdayIndex(date);
    if (wd > 4) continue;
    const todays = active.filter((e) => e.start <= date && date <= e.end);
    const info: DayInfo = {
      date,
      weekday: wd,
      off: true,
      lostPeriods: 0,
      events: events.filter((e) => e.start <= date && date <= e.end),
    };
    let anyClass = false;

    for (const c of classes) {
      const mine = todays.filter((e) => appliesTo(e.rule, c.id, c.grade));
      const r = classDay(c, wd, mine, settings);
      dailyDelivered[c.id].push(r.counts);
      for (const x of r.lost) {
        losses.push(loss(date, c.id, x.period, x.slot.s, x.slot.t, x.event));
        info.lostPeriods++;
        if (x.slot.t) teacher(x.slot.t).lost++;
        if (!r.off) {
          const label = x.event.rule.kind === 'exam' ? '시험' : '행사·창체';
          replaced[c.id][label] = (replaced[c.id][label] ?? 0) + 1;
        }
      }
      if (r.off) continue;
      info.off = false;
      if (r.swap) swaps.push({ date, cls: c.id, ...r.swap });
      for (const x of r.taught) {
        delivered[c.id][x.s] = (delivered[c.id][x.s] ?? 0) + 1;
        if (x.t) teacher(x.t).delivered++;
        if (isAcademic(x.s)) anyClass = true;
      }
    }
    if (anyClass) schoolDays++;
    days.push(info);
  }

  for (const t of teacherMap.values()) t.target = t.weekly * settings.targetWeeks;

  return {
    settings,
    timetable: tt,
    classes,
    days,
    schoolDays,
    weekly,
    delivered,
    replaced,
    dailyDelivered,
    losses,
    swaps,
    teachers: [...teacherMap.values()].sort((a, b) => b.weekly - a.weekly || a.name.localeCompare(b.name, 'ko')),
    checkpoints: findCheckpoints(events, settings),
    subjectsByGrade: Object.fromEntries(
      Object.entries(subjectsByGrade).map(([g, s]) => [g, sortSubjects(s)]),
    ),
  };
}

export interface ClassDayResult {
  /** 휴업·방학으로 수업이 없는 날 */
  off: boolean;
  counts: Record<string, number>;
  taught: Slot[];
  lost: { period: number; slot: Slot; event: ParsedEvent }[];
  swap?: { removed: string[]; added: string[]; eventTitle: string };
}

/**
 * 한 반의 하루 수업을 계산한다. 계산 엔진과 보완 제안이 같은 규칙을 쓰도록 여기 한 곳에만 둔다.
 * 순서: 휴업·방학 → 요일 교체 → 교시 교환 → 전일 행사 > 시험 > 교시 일정
 */
export function classDay(c: ClassTimetable, wd: number, mine: ParsedEvent[], settings: Settings): ClassDayResult {
  const base = c.week[wd] ?? [];
  const off = mine.find((e) => OFF_KINDS.includes(e.rule.kind));
  if (off) {
    return {
      off: true,
      counts: {},
      taught: [],
      lost: base.flatMap((slot, i) => (slot ? [{ period: i + 1, slot, event: off }] : [])),
    };
  }

  const dswap = mine.find((e) => e.rule.kind === 'dayswap');
  const tplIdx = dswap?.rule.swapTo ?? wd;
  const tpl = c.week[tplIdx] ?? [];
  const swap =
    dswap && tplIdx !== wd ? { removed: base.map((s) => s.s), added: tpl.map((s) => s.s), eventTitle: dswap.title } : undefined;

  // "6(1)": 그날 두 교시를 맞바꾼 뒤 교시 일정을 적용한다
  const row = [...tpl];
  for (const e of mine) {
    if (e.rule.kind !== 'periodswap' || !e.rule.swap) continue;
    const [a, b] = e.rule.swap;
    if (row[a - 1] && row[b - 1]) [row[a - 1], row[b - 1]] = [row[b - 1], row[a - 1]];
  }

  const counts: Record<string, number> = {};
  const taught: Slot[] = [];
  const lost: ClassDayResult['lost'] = [];
  const full = mine.find((e) => e.rule.kind === 'fullday');
  row.forEach((slot, i) => {
    if (!slot) return;
    const p = i + 1;
    const ev =
      full ??
      mine.find((e) => e.rule.kind === 'exam' && !settings.examCountsAsClass && (!e.rule.periods || e.rule.periods.includes(p))) ??
      mine.find((e) => e.rule.kind === 'periods' && (e.rule.periods ?? []).includes(p));
    if (ev) {
      lost.push({ period: p, slot, event: ev });
      return;
    }
    counts[slot.s] = (counts[slot.s] ?? 0) + 1;
    taught.push(slot);
  });
  return { off: false, counts, taught, lost, swap };
}

function loss(date: string, cls: string, period: number, subject: string, teacherName: string, e: ParsedEvent): Loss {
  return { date, cls, period, subject, teacher: teacherName, eventId: e.id, eventTitle: e.title, kind: e.rule.kind };
}

/**
 * 정기고사마다 체크포인트를 만든다. 학년마다 시험 날짜가 다를 수 있어
 * 같은 제목이라도 학년 범위별로 첫날을 잡는다. 학기말은 마지막에 둔다.
 */
export function findCheckpoints(events: ParsedEvent[], settings: Settings): Checkpoint[] {
  const exams = events
    .filter((e) => e.rule.kind === 'exam' && e.start > settings.termStart && e.start <= settings.termEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const seen = new Map<string, Checkpoint>();
  for (const e of exams) {
    const g = e.rule.classes ? [...new Set(e.rule.classes.map((c) => Number(c.split('-')[0])))] : e.rule.grades;
    const key = `${e.title}|${g?.join(',') ?? '*'}`;
    if (seen.has(key)) continue;
    const label = e.title.replace(/\s*[1-9]\s*[-~]\s*[1-9]\s*$/, '').trim();
    seen.set(key, { id: e.id, label, date: e.start, grades: g });
  }
  return [...seen.values(), { id: 'term-end', label: '학기 전체', date: '9999-12-31' }];
}

/** 이 체크포인트가 이 학년에 해당하는가 */
export function cpApplies(cp: Checkpoint, grade: number): boolean {
  return !cp.grades || cp.grades.includes(grade);
}

/* ---------- 조회 도구 ---------- */

export function target(l: Ledger, cls: string, subject: string): number {
  return (l.weekly[cls]?.[subject] ?? 0) * l.settings.targetWeeks;
}

/** 체크포인트 날짜 전날까지 누적 시수 */
export function deliveredBefore(l: Ledger, cls: string, subject: string, date: string): number {
  if (date >= '9999') return l.delivered[cls]?.[subject] ?? 0;
  let n = 0;
  const daily = l.dailyDelivered[cls];
  for (let i = 0; i < l.days.length && l.days[i].date < date; i++) n += daily[i][subject] ?? 0;
  return n;
}

/** 날짜별 누적 시수 (그래프용) */
export function cumulative(l: Ledger, cls: string, subject: string): number[] {
  const out: number[] = [];
  let n = 0;
  for (const d of l.dailyDelivered[cls]) {
    n += d[subject] ?? 0;
    out.push(n);
  }
  return out;
}

export interface GradeSpread {
  grade: number;
  subject: string;
  values: { cls: string; value: number }[];
  min: number;
  max: number;
  spread: number;
}

/** 체크포인트에서 학년 안 반별 누적 시수와 격차 */
export function gradeSpreads(l: Ledger, cp: Checkpoint): GradeSpread[] {
  const out: GradeSpread[] = [];
  const grades = [...new Set(l.classes.map((c) => c.grade))].sort();
  for (const g of grades) {
    if (!cpApplies(cp, g)) continue;
    const cs = l.classes.filter((c) => c.grade === g);
    for (const s of l.subjectsByGrade[g]) {
      if (!isAcademic(s)) continue;
      const values = cs
        .filter((c) => l.weekly[c.id][s])
        .map((c) => ({ cls: c.id, value: deliveredBefore(l, c.id, s, cp.date) }));
      if (!values.length) continue;
      const nums = values.map((v) => v.value);
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      out.push({ grade: g, subject: s, values, min, max, spread: max - min });
    }
  }
  return out;
}

/** 요일별로 통째로 빠진 날 수 (전교 휴업 기준) */
export function offDaysByWeekday(l: Ledger): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const d of l.days) if (d.off) out[d.weekday]++;
  return out;
}

export function lossesFor(l: Ledger, cls: string, subject: string): Loss[] {
  return l.losses.filter((x) => x.cls === cls && x.subject === subject);
}
