import { useEffect, useMemo, useState } from 'preact/hooks';
import defaultTimetable from '@timetable';
import { defaultEvents } from '@events';
import { computeLedger, type Ledger } from '../engine/compute';
import { mergeHolidays } from '../engine/holidays';
import { parseEvents } from '../engine/parseEvents';
import { ledgerMetrics, suggest, type Metrics, type Suggestion } from '../engine/suggest';
import type { CalEvent, EventRule, ParsedEvent, Settings, Timetable } from '../engine/types';
import { validateTimetable, type Issue } from '../engine/validate';
import { inAppsScript, server } from './bridge';

export interface Persisted {
  settings: Settings;
  overrides: Record<string, Partial<EventRule>>;
  applied: string[];
  timetable?: Timetable;
  events?: CalEvent[];
  eventSource: 'sample' | 'ics' | 'calendar';
  calendarId?: string;
  eventsFetchedAt?: string;
}

const KEY = 'sisufit:v2';

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const DEFAULTS: Persisted = {
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

  const baseEvents = useMemo(() => parseEvents(rawEvents, p.overrides), [rawEvents, p.overrides]);
  const baseLedger = useMemo(() => computeLedger(timetable, baseEvents, s), [timetable, baseEvents, s]);
  const sugg = useMemo(() => suggest(baseLedger), [baseLedger, baseEvents]);

  const { events, ledger } = useMemo(() => {
    const on = sugg.list.filter((x) => p.applied.includes(x.id));
    if (!on.length) return { events: baseEvents, ledger: baseLedger };
    const plan = on.flatMap((x) => (x.addEvent ? [x.addEvent] : []));
    const moves = Object.fromEntries(on.flatMap((x) => (x.override ? [[x.override.eventId, x.override.rule]] : [])));
    const evs = parseEvents([...rawEvents, ...plan], p.overrides).map((e) =>
      moves[e.id] ? { ...e, rule: { ...e.rule, ...moves[e.id], reason: '보완 제안으로 교시 이동' } } : e,
    );
    return { events: evs, ledger: computeLedger(timetable, evs, s) };
  }, [sugg, p.applied, baseEvents, baseLedger, rawEvents, p.overrides, timetable, s]);

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
  };
}
