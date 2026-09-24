import type { CalEvent, Timetable } from '../engine/types';

/**
 * 구글 Apps Script(HtmlService) 안에서 실행될 때 서버 함수를 부른다.
 * 브라우저 단독 실행(미리보기)에서는 inAppsScript()가 false라서 쓰지 않는다.
 */
interface GoogleRun {
  withSuccessHandler(fn: (v: unknown) => void): GoogleRun;
  withFailureHandler(fn: (e: Error) => void): GoogleRun;
  [fn: string]: unknown;
}
declare global {
  interface Window {
    google?: { script?: { run?: GoogleRun } };
  }
}

export function inAppsScript(): boolean {
  return typeof window !== 'undefined' && !!window.google?.script?.run;
}

function call<T>(fn: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = window.google!.script!.run!.withSuccessHandler((v) => resolve(v as T)).withFailureHandler(reject);
    (run[fn] as (...a: unknown[]) => void)(...args);
  });
}

export const server = {
  listCalendars: () => call<{ id: string; name: string }[]>('listCalendars'),
  getEvents: (calendarId: string, start: string, end: string) => call<CalEvent[]>('getEvents', calendarId, start, end),
  addPlanEvents: (calendarId: string, events: CalEvent[]) => call<number>('addPlanEvents', calendarId, events),
  loadState: () => call<string | null>('loadState'),
  saveState: (json: string) => call<void>('saveState', json),
  fetchPublicIcs: (calendarId: string) => call<string>('fetchPublicIcs', calendarId),
  readTimetableSheet: (url: string) => call<string>('readTimetableSheet', url),
};

export type { Timetable };
