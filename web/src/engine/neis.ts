import { weekdayIndex } from './dates';
import type { CalEvent } from './types';

/**
 * NEIS 교육정보 개방 포털(open.neis.go.kr) 학교 검색·학사일정.
 * 인증키는 학교마다 포털에서 무료로 받는다. 키가 없으면 NEIS가 5건까지만 준다.
 */
export const NEIS_BASE = 'https://open.neis.go.kr/hub/';

export interface NeisSchool {
  /** 시도교육청 코드 (예: B10 서울) */
  office: string;
  officeName: string;
  /** 표준 학교 코드 */
  code: string;
  name: string;
  /** 초등학교·중학교·고등학교 … */
  kind: string;
  address: string;
}

export type NeisRow = Record<string, string | null | undefined>;

export function neisUrl(service: 'schoolInfo' | 'SchoolSchedule', params: Record<string, string | number>, key?: string): string {
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: key ? '1000' : '5' });
  if (key) q.set('KEY', key.trim());
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return `${NEIS_BASE}${service}?${q.toString()}`;
}

const NEIS_ERRORS: Record<string, string> = {
  'ERROR-290': '인증키가 올바르지 않습니다. NEIS 포털에서 받은 키를 다시 확인하세요.',
  'ERROR-300': '필수 값이 빠졌습니다.',
  'ERROR-310': '해당하는 서비스를 찾을 수 없습니다.',
  'ERROR-333': '요청 위치 값이 잘못되었습니다.',
  'ERROR-336': '한 번에 1000건까지만 받을 수 있습니다.',
  'ERROR-337': '오늘 쓸 수 있는 요청 수를 넘었습니다. 내일 다시 하거나 인증키를 확인하세요.',
  'ERROR-500': 'NEIS 서버 오류입니다. 잠시 뒤 다시 하세요.',
  'ERROR-600': 'NEIS 데이터베이스 연결 오류입니다. 잠시 뒤 다시 하세요.',
  'INFO-300': '관리자에 의해 인증키 사용이 제한되었습니다.',
};

/**
 * NEIS 응답(JSON 글 또는 객체)에서 행과 전체 건수를 꺼낸다.
 * 자료가 없으면(INFO-200) 빈 목록, 오류 코드는 한국어 설명으로 던진다.
 */
export function neisRows(input: string | unknown, service: string): { rows: NeisRow[]; total: number } {
  let data: unknown = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new Error('NEIS 응답을 읽지 못했습니다. 주소의 Type=json 부분을 확인하세요.');
    }
  }
  const obj = data as Record<string, unknown>;
  const body = obj[service] as { head?: unknown[]; row?: NeisRow[] }[] | undefined;
  if (!body) {
    const r = (obj.RESULT ?? {}) as { CODE?: string; MESSAGE?: string };
    if (r.CODE === 'INFO-200') return { rows: [], total: 0 };
    if (r.CODE) throw new Error(NEIS_ERRORS[r.CODE] ?? `NEIS: ${r.MESSAGE ?? r.CODE}`);
    throw new Error('NEIS 응답 모양이 예상과 다릅니다.');
  }
  const head = (body[0]?.head ?? []) as Record<string, unknown>[];
  const total = Number(head.find((h) => 'list_total_count' in h)?.list_total_count ?? 0);
  const rows = body.flatMap((b) => b.row ?? []);
  return { rows, total };
}

export function toSchools(rows: NeisRow[]): NeisSchool[] {
  return rows.map((r) => ({
    office: r.ATPT_OFCDC_SC_CODE ?? '',
    officeName: r.ATPT_OFCDC_SC_NM ?? '',
    code: r.SD_SCHUL_CODE ?? '',
    name: r.SCHUL_NM ?? '',
    kind: r.SCHUL_KND_SC_NM ?? '',
    address: (r.ORG_RDNMA ?? '').trim(),
  }));
}

const GRADE_FLAGS = ['ONE_GRADE_EVENT_YN', 'TW_GRADE_EVENT_YN', 'THREE_GRADE_EVENT_YN', 'FR_GRADE_EVENT_YN', 'FIV_GRADE_EVENT_YN', 'SIX_GRADE_EVENT_YN'];

/**
 * NEIS 학사일정 행 → 일정.
 * - 토·일, "토요휴업일"은 뺀다
 * - 수업공제일이 "휴업일"·"공휴일"인데 이름에 그 말이 없으면 붙여서 휴업으로 읽히게 한다
 * - 일부 학년만 표시된 일정은 "(1,2학년) " 머리를 붙인다
 */
export function neisScheduleToEvents(rows: NeisRow[], grades = 3): CalEvent[] {
  const out: CalEvent[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const ymd = r.AA_YMD ?? '';
    const m = ymd.match(/^(\d{4})(\d{2})(\d{2})$/);
    let title = (r.EVENT_NM ?? '').replace(/\s+/g, ' ').trim();
    if (!m || !title || /토요\s*휴업/.test(title)) continue;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    if (weekdayIndex(date) > 4) continue;
    const off = (r.SBTR_DD_SC_NM ?? '').trim();
    if ((off === '휴업일' || off === '공휴일') && !/휴업|휴일|방학/.test(title)) title = `${title} ${off}`;
    const gs = GRADE_FLAGS.slice(0, grades)
      .map((k, i) => ((r[k] ?? '').trim().toUpperCase() === 'Y' ? i + 1 : 0))
      .filter((g) => g > 0);
    if (gs.length > 0 && gs.length < grades && !/\d\s*학년/.test(title)) title = `(${gs.join(',')}학년) ${title}`;
    const key = `${date}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const desc = (r.EVENT_CNTNT ?? '').trim();
    out.push({ id: `neis-${date}-${out.length}`, title, start: date, end: date, source: 'neis', ...(desc ? { description: desc } : {}) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** 학교급에 맞는 학년 수 */
export function gradesFor(kind: string): number {
  return /초등/.test(kind) ? 6 : 3;
}
