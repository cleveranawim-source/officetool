import { appliesTo } from './parseEvents';
import { eachDay, weekdayIndex } from './dates';
import { isAcademic, sortSubjects } from './subjects';
import type { Checkpoint, ClassTimetable, EventKind, Loss, ParsedEvent, Settings, Timetable } from './types';

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
      const counts: Record<string, number> = {};
      dailyDelivered[c.id].push(counts);
      const mine = todays.filter((e) => appliesTo(e.rule, c.id, c.grade));
      const base = c.week[wd] ?? [];

      const off = mine.find((e) => OFF_KINDS.includes(e.rule.kind));
      if (off) {
        base.forEach((slot, i) => {
          if (!slot) return;
          losses.push(loss(date, c.id, i + 1, slot.s, slot.t, off));
          info.lostPeriods++;
          if (slot.t) teacher(slot.t).lost++;
        });
        continue;
      }
      info.off = false;

      const swap = mine.find((e) => e.rule.kind === 'dayswap');
      const tplIdx = swap?.rule.swapTo ?? wd;
      const tpl = c.week[tplIdx] ?? [];
      if (swap && tplIdx !== wd) {
        swaps.push({
          date,
          cls: c.id,
          removed: base.map((s) => s.s),
          added: tpl.map((s) => s.s),
          eventTitle: swap.title,
        });
      }

      const full = mine.find((e) => e.rule.kind === 'fullday');
      tpl.forEach((slot, i) => {
        if (!slot) return;
        const p = i + 1;
        const ev =
          full ??
          mine.find(
            (e) => e.rule.kind === 'exam' && !settings.examCountsAsClass && (!e.rule.periods || e.rule.periods.includes(p)),
          ) ??
          mine.find((e) => e.rule.kind === 'periods' && e.rule.periods!.includes(p));
        if (ev) {
          losses.push(loss(date, c.id, p, slot.s, slot.t, ev));
          const label = ev.rule.kind === 'exam' ? '시험' : '행사·창체';
          replaced[c.id][label] = (replaced[c.id][label] ?? 0) + 1;
          info.lostPeriods++;
          if (slot.t) teacher(slot.t).lost++;
          return;
        }
        counts[slot.s] = (counts[slot.s] ?? 0) + 1;
        delivered[c.id][slot.s] = (delivered[c.id][slot.s] ?? 0) + 1;
        if (slot.t) teacher(slot.t).delivered++;
        if (isAcademic(slot.s)) anyClass = true;
      });
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

function loss(date: string, cls: string, period: number, subject: string, teacherName: string, e: ParsedEvent): Loss {
  return { date, cls, period, subject, teacher: teacherName, eventId: e.id, eventTitle: e.title, kind: e.rule.kind };
}

/** 정기고사 첫날마다 체크포인트를 만들고, 학기말을 마지막에 둔다. */
export function findCheckpoints(events: ParsedEvent[], settings: Settings): Checkpoint[] {
  const exams = events
    .filter((e) => e.rule.kind === 'exam' && e.start > settings.termStart && e.start <= settings.termEnd)
    .sort((a, b) => a.start.localeCompare(b.start));
  const seen = new Set<string>();
  const cps: Checkpoint[] = [];
  for (const e of exams) {
    if (seen.has(e.title)) continue;
    seen.add(e.title);
    cps.push({ id: e.id, label: e.title.replace(/\s*[1-9]\s*[-~]\s*[1-9]\s*$/, ''), date: e.start });
  }
  cps.push({ id: 'term-end', label: '학기 전체', date: '9999-12-31' });
  return cps;
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
