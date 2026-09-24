import readXlsxFile from 'read-excel-file/browser';
import { importClassTimetable, importRows, type ImportResult } from '../engine/importTimetable';

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
          data.map((row) => row.map((c) => (c === null || c === undefined ? '' : String(c)))),
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
