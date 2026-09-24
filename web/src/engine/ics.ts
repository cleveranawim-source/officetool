import { addDays, weekdayIndex } from './dates';
import type { CalEvent } from './types';

/**
 * 구글 캘린더 내보내기(.ics)를 읽는다.
 * - 종일 일정의 DTEND는 다음 날(배타적)이므로 하루 빼서 포함 날짜로 바꾼다.
 * - 반복 일정(RRULE)은 DAILY/WEEKLY를 펼친다 (INTERVAL, COUNT, UNTIL, BYDAY, EXDATE).
 */

type Prop = { value: string; params: string };

export function parseICS(text: string, rangeEnd = '2099-12-31'): CalEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: CalEvent[] = [];
  let cur: Record<string, Prop> | null = null;
  let exdates: string[] = [];
  let recurrenceId: string | null = null;
  /** 반복 일정 중 한 회차만 따로 바뀐 경우: uid|원래 날짜 */
  const moved = new Set<string>();
  const expanded: { uid: string; ev: CalEvent }[] = [];
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      exdates = [];
      recurrenceId = null;
    } else if (line === 'END:VEVENT') {
      if (cur?.DTSTART && cur.SUMMARY && cur.STATUS?.value !== 'CANCELLED') {
        const allDay = cur.DTSTART.params.includes('VALUE=DATE') || /^\d{8}$/.test(cur.DTSTART.value);
        const start = isoDate(cur.DTSTART.value);
        let end = cur.DTEND ? isoDate(cur.DTEND.value) : start;
        if (allDay && cur.DTEND) end = addDays(end, -1);
        if (end < start) end = start;
        const base = {
          id: cur.UID?.value ?? `ics-${out.length}`,
          title: unescape(cur.SUMMARY.value),
          description: cur.DESCRIPTION ? unescape(cur.DESCRIPTION.value) : undefined,
          source: 'calendar' as const,
        };
        const span = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
        if (recurrenceId) {
          moved.add(`${base.id}|${recurrenceId}`);
          out.push({ ...base, id: `${base.id}_${start}`, start, end });
        } else if (cur.RRULE) {
          for (const s of expand(start, cur.RRULE.value, rangeEnd).filter((d) => !exdates.includes(d)))
            expanded.push({ uid: base.id, ev: { ...base, id: `${base.id}_${s}`, start: s, end: addDays(s, span) } });
        } else out.push({ ...base, start, end });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const value = line.slice(i + 1);
      if (name === 'EXDATE') exdates.push(...value.split(',').map(isoDate));
      else if (name === 'RECURRENCE-ID') recurrenceId = isoDate(value);
      else cur[name] = { value, params: params.join(';') };
    }
  }
  // 따로 바뀐 회차는 원래 반복 전개에서 뺀다
  for (const x of expanded) if (!moved.has(`${x.uid}|${x.ev.start}`)) out.push(x.ev);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

const BYDAY: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 };

function expand(start: string, rrule: string, rangeEnd: string): string[] {
  const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=') as [string, string]));
  const freq = r.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return [start];
  const interval = Number(r.INTERVAL ?? 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const until = r.UNTIL ? isoDate(r.UNTIL) : rangeEnd;
  const last = until < rangeEnd ? until : rangeEnd;
  const days = r.BYDAY ? r.BYDAY.split(',').map((d: string) => BYDAY[d.slice(-2)]) : [weekdayIndex(start)];
  const out: string[] = [];
  if (freq === 'DAILY') {
    for (let d = start; d <= last && out.length < count; d = addDays(d, interval)) out.push(d);
    return out;
  }
  // WEEKLY: 시작일이 든 주의 월요일부터 interval 주씩
  let week = addDays(start, -weekdayIndex(start));
  while (week <= last && out.length < count) {
    for (const wd of [...days].sort()) {
      const d = addDays(week, wd);
      if (d < start || d > last || out.length >= count) continue;
      out.push(d);
    }
    week = addDays(week, 7 * interval);
  }
  return out;
}

function isoDate(v: string): string {
  if (/T\d{6}Z$/.test(v)) {
    // UTC 시각은 한국 시간(+9)으로 날짜를 정한다
    const t = Date.UTC(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8), +v.slice(9, 11) + 9, +v.slice(11, 13));
    return new Date(t).toISOString().slice(0, 10);
  }
  const d = v.slice(0, 8);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** 캘린더 ID 또는 공유/임베드 주소에서 캘린더 ID만 꺼낸다 */
export function calendarIdFrom(input: string): string {
  const s = input.trim();
  const m = s.match(/[?&](?:src|cid)=([^&]+)/);
  if (m) {
    const v = decodeURIComponent(m[1]);
    return v.includes('@') ? v : safeAtob(v) ?? v;
  }
  const ical = s.match(/calendar\/ical\/([^/]+)\//);
  if (ical) return decodeURIComponent(ical[1]);
  return decodeURIComponent(s);
}

function safeAtob(v: string): string | null {
  try {
    const d = atob(v.replace(/-/g, '+').replace(/_/g, '/'));
    return d.includes('@') ? d : null;
  } catch {
    return null;
  }
}
