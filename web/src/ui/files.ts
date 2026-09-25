import readXlsxFile from 'read-excel-file/browser';
import { readEventTable, type EventTableResult } from '../engine/eventTable';
import { parseICS } from '../engine/ics';
import { importClassTimetable, importRows, type ImportResult } from '../engine/importTimetable';

/** 엑셀 칸 값을 글자로 (날짜 값은 2026-10-07) */
function cellText(c: unknown): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? '' : c.toISOString().slice(0, 10);
  return String(c);
}

export type EventFileResult = { format: 'ics' | EventTableResult['format']; events: EventTableResult['events']; days?: number; sheet?: string };

/**
 * 학사일정 파일을 읽는다: .ics(구글 캘린더), .xlsx·.csv·.tsv(시트에서 받은 목록형·달력형 표).
 * 엑셀은 모든 시트를 읽어 일정이 가장 많이 나온 시트를 쓴다.
 */
export async function readEventsFile(file: File, opts: { year: number; semester: 1 | 2; termEnd: string }): Promise<EventFileResult> {
  if (/\.ics$/i.test(file.name) || file.type === 'text/calendar') {
    const events = parseICS(await file.text(), opts.termEnd);
    if (!events.length) throw new Error('이 파일에서 일정을 찾지 못했습니다. 구글 캘린더에서 받은 .ics 파일인지 확인하세요.');
    return { format: 'ics', events };
  }
  if (/\.xls$/i.test(file.name)) throw new Error('예전 엑셀(.xls) 형식은 읽지 못합니다. 엑셀에서 "다른 이름으로 저장 → .xlsx"로 바꿔 올려 주세요.');
  let best: EventFileResult | null = null;
  if (/\.xlsx$/i.test(file.name)) {
    let sheets;
    try {
      sheets = await readXlsxFile(file);
    } catch (e) {
      throw new Error(`엑셀 파일을 열지 못했습니다. 엑셀에서 한 번 열어 .xlsx로 다시 저장한 뒤 올려 주세요. (${(e as Error).message})`);
    }
    for (const { sheet, data } of sheets) {
      const r = readEventTable(data.map((row) => row.map(cellText)), opts);
      if (!best || r.events.length > best.events.length) best = { ...r, sheet };
    }
  } else {
    best = readEventTable(await file.text(), opts);
  }
  if (!best || !best.events.length)
    throw new Error('표에서 일정을 찾지 못했습니다. 목록형(날짜 | 일정)이거나, 월·화·수·목·금 머리글이 있는 달력형 표인지 확인하세요.');
  return best;
}

/**
 * 시간표 파일(.xlsx, .csv, .tsv, .txt)을 읽는다.
 * 엑셀은 시트를 차례로 시도해 시간표로 읽히는 첫 시트를 쓴다("학반"이 들어간 시트를 먼저).
 */
export async function readTimetableFile(file: File, school: string, term: string): Promise<ImportResult & { sheet?: string }> {
  if (/\.xlsx$/i.test(file.name)) {
    let sheets;
    try {
      sheets = await readXlsxFile(file);
    } catch (e) {
      throw new Error(`엑셀 파일을 열지 못했습니다. 엑셀에서 한 번 열어 .xlsx로 다시 저장한 뒤 올려 주세요. (${(e as Error).message})`);
    }
    const order = [...sheets].sort((a, b) => Number(/학반|학급/.test(b.sheet)) - Number(/학반|학급/.test(a.sheet)));
    let lastErr: unknown = null;
    for (const { sheet, data } of order) {
      try {
        const r = importRows(
          data.map((row) => row.map(cellText)),
          school,
          term,
        );
        return { ...r, sheet };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr ?? new Error('엑셀 파일에서 시간표를 찾지 못했습니다.');
  }
  if (/\.xls$/i.test(file.name)) throw new Error('예전 엑셀(.xls) 형식은 읽지 못합니다. 엑셀에서 "다른 이름으로 저장 → .xlsx"로 바꿔 올려 주세요.');
  return importClassTimetable(await file.text(), school, term);
}

/** 브라우저에서 파일 내려받기 */
export function download(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
