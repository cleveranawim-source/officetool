import { addDays } from './dates';
import type { CalEvent } from './types';

/**
 * 구글 캘린더 내보내기(.ics)를 읽는다.
 * 종일 일정의 DTEND는 다음 날(배타적)이므로 하루 빼서 포함 날짜로 바꾼다.
 */
export function parseICS(text: string): CalEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: CalEvent[] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (cur?.DTSTART && cur.SUMMARY) {
        const allDay = cur.DTSTART.params.includes('VALUE=DATE') || /^\d{8}$/.test(cur.DTSTART.value);
        const start = isoDate(cur.DTSTART.value);
        let end = cur.DTEND ? isoDate(cur.DTEND.value) : start;
        if (allDay && cur.DTEND) end = addDays(end, -1);
        if (end < start) end = start;
        out.push({
          id: cur.UID?.value ?? `ics-${out.length}`,
          title: unescape(cur.SUMMARY.value),
          start,
          end,
          description: cur.DESCRIPTION ? unescape(cur.DESCRIPTION.value) : undefined,
          source: 'calendar',
        });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      cur[name] = { value: line.slice(i + 1), params: params.join(';') };
    }
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
