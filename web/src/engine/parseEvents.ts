import type { CalEvent, EventRule, ParsedEvent } from './types';
import { WEEKDAYS } from './types';

/**
 * 캘린더 일정 제목을 시수 규칙으로 바꾼다.
 *
 * 학교 규칙:
 *   "진로교육 1-7"   → 1~7교시 진로교육 (특정 교시 대체)
 *   "함께하는 삶1"    → 1교시 특별교육
 *   "2학년 수련회"    → 2학년 전 교시 행사
 *   "목요일 시간표 운영" → 그날 목요일 시간표로 수업
 */

const HOLIDAY =
  /(공휴일|대체\s*휴일|대체\s*공휴일|재량\s*휴업|휴업일|개교\s*기념일|신정|설날|설\s*연휴|추석|삼일절|3[.·]1절|어린이날|부처님|석가탄신|현충일|광복절|개천절|한글날|성탄절|크리스마스|선거일|임시\s*공휴일)/;
const VACATION = /방학(?!\s*식)/;
const EXAM = /(지필|중간\s*고사|기말\s*고사|정기\s*고사|중간\s*평가|기말\s*평가)/;
const DAYSWAP = /([월화수목금])요일?\s*시간표/;
const FULLDAY =
  /(수련회|수련\s*활동|체육\s*대회|체육\s*한마당|현장\s*체험|체험\s*학습|현장\s*학습|수학\s*여행|소풍|축제|한마당|졸업\s*여행|야영|진로\s*체험|문화\s*체험|봉사\s*활동의?\s*날)/;
const INFO_HINT = /(방학식|개학식|종업식|졸업식|입학식|회의|협의회|연수|총회|상담|원서|접수|마감|발표|제출|공개수업|학부모)/;

/** 끝에 붙은 교시 표기: "1-7", "1~3교시", "5-6)" */
const PERIOD_RANGE = /(?:^|[^\d-])([1-9])\s*[-~]\s*([1-9])\s*(?:교시)?\s*\)?\s*$/;
/** 끝에 붙은 한 자리 교시: "함께하는 삶1", "성교육 3교시". 연도(2026) 같은 여러 자리 숫자는 제외 */
const PERIOD_SINGLE = /(?:^|[^\d])([1-9])\s*(?:교시)?\s*\)?\s*$/;
const GRADES = /((?:[1-3]\s*[,·~]\s*)*[1-3])\s*학년/;
const CLASSES = /([1-3])\s*-\s*(\d{1,2})\s*반/g;
const WHOLE = /(전\s*학년|전교|전체)/;

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
  return out;
}

function parseScope(title: string): Pick<EventRule, 'grades' | 'classes'> {
  const classes = [...title.matchAll(CLASSES)].map((m) => `${m[1]}-${Number(m[2])}`);
  if (classes.length) return { classes };
  if (WHOLE.test(title)) return {};
  const g = title.match(GRADES);
  if (!g) return {};
  const spec = g[1].replace(/\s/g, '');
  if (spec.includes('~')) {
    const [a, b] = spec.split('~').map(Number);
    return { grades: range(a, b) };
  }
  return { grades: [...new Set(spec.split(/[,·]/).map(Number))].sort() };
}

function parsePeriods(title: string): number[] | undefined {
  const r = title.match(PERIOD_RANGE);
  if (r) return range(Number(r[1]), Number(r[2]));
  const s = title.match(PERIOD_SINGLE);
  if (s) return [Number(s[1])];
  return undefined;
}

export function classifyTitle(rawTitle: string): EventRule {
  const title = rawTitle.normalize('NFC').trim();
  const scope = parseScope(title);

  const swap = title.match(DAYSWAP);
  if (swap) {
    const idx = WEEKDAYS.indexOf(swap[1] as (typeof WEEKDAYS)[number]);
    return {
      kind: 'dayswap',
      swapTo: idx,
      ...scope,
      label: `${swap[1]}요일 시간표 운영`,
      confidence: 'high',
      reason: `"${swap[0]}" 표기`,
    };
  }
  if (HOLIDAY.test(title)) {
    return { kind: 'holiday', ...scope, label: '휴업일', confidence: 'high', reason: `"${title.match(HOLIDAY)![0]}" 포함` };
  }
  if (VACATION.test(title)) {
    return { kind: 'vacation', ...scope, label: '방학', confidence: 'high', reason: '"방학" 포함' };
  }

  const periods = parsePeriods(title);

  if (EXAM.test(title)) {
    return {
      kind: 'exam',
      periods,
      ...scope,
      label: '정기고사',
      confidence: 'high',
      reason: `"${title.match(EXAM)![0]}" 포함${periods ? `, ${periods.join('·')}교시` : ', 전 교시'}`,
    };
  }
  if (periods) {
    return {
      kind: 'periods',
      periods,
      ...scope,
      label: periods.length === 1 ? `${periods[0]}교시 특별교육` : `${periods[0]}~${periods[periods.length - 1]}교시 창체`,
      confidence: 'high',
      reason: `제목 끝 교시 표기 "${periods.length === 1 ? periods[0] : `${periods[0]}-${periods[periods.length - 1]}`}"`,
    };
  }
  if (FULLDAY.test(title)) {
    return { kind: 'fullday', ...scope, label: '전일 행사', confidence: 'high', reason: `"${title.match(FULLDAY)![0]}" 포함` };
  }
  if (INFO_HINT.test(title)) {
    return { kind: 'info', ...scope, label: '참고 일정', confidence: 'mid', reason: `"${title.match(INFO_HINT)![0]}"는 보통 수업에 영향 없음` };
  }
  return { kind: 'info', ...scope, label: '참고 일정', confidence: 'low', reason: '교시 표기나 행사 키워드가 없어 시수에 반영하지 않음 — 확인 필요' };
}

export function parseEvents(events: CalEvent[], overrides: Record<string, Partial<EventRule>> = {}): ParsedEvent[] {
  return events.map((e) => {
    const rule = classifyTitle(e.title);
    const o = overrides[e.id];
    return { ...e, rule: o ? { ...rule, ...o, confidence: 'high', reason: '직접 수정함' } : rule };
  });
}

/** 일정이 특정 반에 적용되는가 */
export function appliesTo(rule: EventRule, cls: string, grade: number): boolean {
  if (rule.classes) return rule.classes.includes(cls);
  if (rule.grades) return rule.grades.includes(grade);
  return true;
}
