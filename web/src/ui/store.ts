import type { NeisSchool } from '../engine/neis';
import { useEffect, useMemo, useState } from 'preact/hooks';
import defaultTimetable from '@timetable';
import { defaultEvents, eventsAreSample } from '@events';
import { computeLedger, type Ledger } from '../engine/compute';
import { mergeHolidays } from '../engine/holidays';
import { DEFAULT_RULES, parseEvents, type RuleSet } from '../engine/parseEvents';
import { ledgerMetrics, suggest, type Metrics, type Suggestion } from '../engine/suggest';
import type { CalEvent, EventRule, ParsedEvent, Settings, Timetable } from '../engine/types';
import { validateTimetable, type Issue } from '../engine/validate';
import { inAppsScript, server } from './bridge';

export interface SchoolInfo {
  name: string;
  level: 'middle' | 'high' | 'elementary';
  year: number;
  semester: 1 | 2;
}

export interface Persisted {
  /** 처음 설정을 마쳤는지. false면 시작 화면을 보여준다 */
  setupDone: boolean;
  school?: SchoolInfo;
  /** 학교별 일정 읽기 규칙. 없으면 기본 규칙 */
  rules?: RuleSet;
  settings: Settings;
  overrides: Record<string, Partial<EventRule>>;
  applied: string[];
  timetable?: Timetable;
  events?: CalEvent[];
  eventSource: 'sample' | 'ics' | 'calendar' | 'neis';
  /** NEIS에서 고른 학교 (학사일정 다시 받기용) */
  neis?: NeisSchool;
  calendarId?: string;
  eventsFetchedAt?: string;
}

const KEY = 'sisufit:v2';

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const DEFAULTS: Persisted = {
  // 실제 학교 데이터가 미리 들어 있는 빌드라면 바로 결과 화면
  setupDone: !eventsAreSample,
  settings: {
    termStart: '2026-08-18',
    termEnd: '2026-12-31',
    targetWeeks: 17,
    examCountsAsClass: false,
    today: todayISO(),
  },
  overrides: {},
  applied: [],
  eventSource: 'sample',
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Persisted;
    return { ...DEFAULTS, ...p, settings: { ...DEFAULTS.settings, ...p.settings, today: todayISO() } };
  } catch {
    return DEFAULTS;
  }
}

export interface Model {
  p: Persisted;
  set: (patch: Partial<Persisted>) => void;
  timetable: Timetable;
  events: ParsedEvent[];
  ledger: Ledger;
  baseLedger: Ledger;
  suggestions: Suggestion[];
  baseMetrics: Metrics;
  appliedMetrics: Metrics;
  issues: Issue[];
  sampleTimetable: boolean;
  rules: RuleSet;
  /** 예시 학교로 둘러보기 */
  startDemo: () => void;
  /** 처음 설정 화면으로 */
  restartSetup: () => void;
}

export function useModel(): Model {
  const [p, setP] = useState<Persisted>(load);

  // Apps Script 안이면 학교 공용 설정을 서버에서 불러온다
  useEffect(() => {
    if (!inAppsScript()) return;
    server
      .loadState()
      .then((json) => json && setP((cur) => ({ ...cur, ...JSON.parse(json), settings: { ...cur.settings, ...JSON.parse(json).settings, today: todayISO() } })))
      .catch(() => {});
  }, []);

  const set = (patch: Partial<Persisted>) =>
    setP((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 저장 불가 환경 */
      }
      if (inAppsScript()) server.saveState(JSON.stringify(next)).catch(() => {});
      return next;
    });

  const timetable = p.timetable ?? (defaultTimetable as Timetable);
  const s = p.settings;

  const rawEvents = useMemo(() => {
    const src = p.eventSource === 'sample' ? defaultEvents : p.events ?? [];
    return mergeHolidays(src, s.termStart, s.termEnd);
  }, [p.eventSource, p.events, s.termStart, s.termEnd]);

  const rules = p.rules ?? DEFAULT_RULES;
  const baseEvents = useMemo(() => parseEvents(rawEvents, p.overrides, rules), [rawEvents, p.overrides, rules]);
  const baseLedger = useMemo(() => computeLedger(timetable, baseEvents, s), [timetable, baseEvents, s]);
  const sugg = useMemo(() => suggest(baseLedger, 4, rules), [baseLedger, rules]);

  const { events, ledger } = useMemo(() => {
    const on = sugg.list.filter((x) => p.applied.includes(x.id));
    if (!on.length) return { events: baseEvents, ledger: baseLedger };
    const plan = on.flatMap((x) => (x.addEvent ? [x.addEvent] : []));
    const moves = Object.fromEntries(on.flatMap((x) => (x.override ? [[x.override.eventId, x.override.rule]] : [])));
    const evs = parseEvents([...rawEvents, ...plan], p.overrides, rules).map((e) =>
      moves[e.id] ? { ...e, rule: { ...e.rule, ...moves[e.id], reason: '보완 제안으로 교시 이동' } } : e,
    );
    return { events: evs, ledger: computeLedger(timetable, evs, s) };
  }, [sugg, p.applied, baseEvents, baseLedger, rawEvents, p.overrides, timetable, s, rules]);

  const appliedMetrics = useMemo(() => (ledger === baseLedger ? sugg.base : ledgerMetrics(ledger)), [ledger, baseLedger, sugg]);

  const issues = useMemo(() => validateTimetable(timetable), [timetable]);

  return {
    p,
    set,
    timetable,
    events,
    ledger,
    baseLedger,
    suggestions: sugg.list,
    baseMetrics: sugg.base,
    appliedMetrics,
    issues,
    sampleTimetable: timetable.school.startsWith('예시'),
    rules,
    startDemo: () =>
      set({ setupDone: true, eventSource: 'sample', timetable: undefined, events: undefined, overrides: {}, applied: [], school: undefined, rules: undefined, settings: { ...DEFAULTS.settings } }),
    restartSetup: () => set({ setupDone: false }),
  };
}
