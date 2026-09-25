import type { CalEvent, EventRule, ParsedEvent } from './types';
import { WEEKDAYS } from './types';

/**
 * 캘린더 일정 제목을 시수 규칙으로 바꾼다.
 *
 * 학교마다 표기가 달라서 키워드는 RuleSet으로 바꿀 수 있게 둔다.
 * 기본값은 실제 중학교 학사일정 캘린더에서 쓰는 표기를 기준으로 했다.
 *
 *   진로교육 1-7 / 1-7 백마페스티벌   → 1~7교시 대체 (교시가 앞이든 뒤든)
 *   함께하는 삶1 / 3감염병예방교육     → 한 교시 대체
 *   6(1)                              → 그날 6교시와 1교시를 맞바꿈 (시수 변화 없음)
 *   (1,2학년) 중간고사 / 2학년 수련회  → 학년 한정
 *   부장회의1, 교직원 연수             → 교직원 일정: 수업과 무관
 *   목요일 시간표 운영                 → 요일 교체
 */

export interface RuleSet {
  /** 교직원·학부모 등 학생 수업과 무관한 일정 */
  staff: string[];
  holiday: string[];
  exam: string[];
  fullday: string[];
  /** 교시 표기가 없으면 수업에 영향이 없는 일정 */
  info: string[];
  /** 날짜·교시를 학교가 옮길 수 없는 일정 (보완 제안에서 제외) */
  fixed: string[];
}

export const DEFAULT_RULES: RuleSet = {
  staff: [
    '교직원', '부장', '연수', '평정', '감독', '학부모', '보호자', '정담회', '방과후', '기도회', '생기부', '생활기록부',
    '예비소집', '수학능력', '수능', '교장', '교감', '임원', '캠페인', '상담주간', '제출', '마감', '원서', '접수', '회의', '협의회',
  ],
  holiday: [
    '공휴일', '대체휴일', '대체 공휴일', '재량휴업', '휴업일', '개교기념일', '신정', '설날', '설 연휴', '추석', '삼일절', '3.1절',
    '어린이날', '부처님', '석가탄신', '현충일', '광복절', '개천절', '한글날', '성탄절', '선거일', '임시공휴일',
  ],
  exam: ['지필', '중간고사', '기말고사', '정기고사', '중간평가', '기말평가'],
  fullday: [
    '수련회', '수련활동', '체육대회', '체육한마당', '현장체험', '체험학습', '현장학습', '수학여행', '소풍', '축제', '한마당',
    '졸업여행', '야영', '진로체험', '문화체험', '탐방', '관람',
  ],
  info: ['방학식', '개학식', '종업식', '졸업식', '입학식', '총회', '상담', '발표', '공개수업', '예배', '전시', '학급자치'],
  fixed: ['듣기평가', '학업성취도', '진단평가', '종업식', '졸업식', '개학식', '입학식', '방학식', '선거', '페스티벌', '축제', '방송제'],
};

/** 보완 제안에서 옮겨도 되는 일정인가 */
export function isMovable(title: string, rules: RuleSet = DEFAULT_RULES): boolean {
  return !findWord(title, rules.fixed);
}

const DAYSWAP = /([월화수목금])요일\s*(?:시간표|수업)|([월화수목금])\s*시간표/;
const VACATION = /방학(?!\s*식)/;
/** "6(1)" 교시 교환 */
const SWAP = /(?:^|[^\d])([1-9])\s*\(\s*([1-9])\s*\)/;

/** 뒤에 붙은 교시: "진로교육 1-7", "성교육 5~6교시", "함께하는 삶1". 연도처럼 여러 자리 숫자는 제외 */
const SUFFIX_RANGE = /(?:^|[^\d-])([1-9])\s*[-~]\s*([1-9])\s*(?:교시)?\s*$/;
const SUFFIX_ONE = /(?:^|[^\d])([1-9])\s*(?:교시)?\s*$/;
/** 앞에 붙은 교시: "1-7 백마페스티벌", "3감염병예방교육". 1학년·2학기 같은 표현은 제외 */
const PREFIX = /^([1-9])(?:\s*[-~]\s*([1-9]))?\s*(?:교시)?(?!\s*(?:학년|학기|년|반|차|회|월|일|시|명|번|기|개월))(?![\d,.·])\s*(?=[가-힣A-Za-z]|[1-3]\s*학년)/;

const GRADES = /(?<!\d)((?:[1-3]\s*[,·~]\s*)*[1-3])\s*학?년(?!도)/;
const CLASSES = /([1-3])\s*-\s*(\d{1,2})\s*반/g;
const WHOLE = /(전\s*학년|전교|전체)/;
const TIME = /(?:오전|오후)\s*\d{1,2}\s*(?::\s*\d{2}|시(?:\s*\d{1,2}\s*분)?)?|\b\d{1,2}:\d{2}\b/g;

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
  return out;
}

const compact = (s: string) => s.replace(/\s+/g, '');
function findWord(title: string, words: string[]): string | undefined {
  const t = compact(title);
  return words.find((w) => t.includes(compact(w)));
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

/** 괄호를 정리한다. 학년 표기 괄호는 남기고, 시각·날짜·기타 메모 괄호는 뗀다 */
function cleanParens(title: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const text = title.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    if (/(?<!\d)[1-3]\s*학?년(?!도)/.test(inner)) return ` ${inner} `;
    // "아동학대예방교육(6)", "정서행동특성검사(4교시)": 괄호 속 교시
    if (/^\s*[1-9](?:\s*[-~]\s*[1-9])?\s*(?:교시)?\s*$/.test(inner)) return ` ${inner.trim()}`;
    removed.push(inner.trim());
    return ' ';
  });
  return { text: text.replace(/\s+/g, ' ').trim(), removed };
}

function parsePeriods(title: string): number[] | undefined {
  const p = title.match(PREFIX);
  if (p) return p[2] ? range(+p[1], +p[2]) : [+p[1]];
  const r = title.match(SUFFIX_RANGE);
  if (r) return range(+r[1], +r[2]);
  const s = title.match(SUFFIX_ONE);
  if (s) return [+s[1]];
  return undefined;
}

const span = (p: number[]) => (p.length === 1 ? `${p[0]}교시` : `${p[0]}~${p[p.length - 1]}교시`);

/**
 * 한 일정 제목 안에 여러 뜻이 들어 있는 경우를 나눈다.
 * "사랑하는 삶1/6(1)" → ["사랑하는 삶1", "6(1)"], "독서감상문쓰기대회6(5)" → ["독서감상문쓰기대회", "6(5)"]
 */
export function splitTitle(title: string): string[] {
  const t = title.normalize('NFC').trim();
  const m = t.match(SWAP);
  if (!m) return [t];
  const token = `${m[1]}(${m[2]})`;
  let rest = t.replace(m[0].slice(m[0].indexOf(m[1])), ' ').replace(/[/,]\s*$|^\s*[/,]/g, '').replace(/\s*\/\s*/g, ' ').trim();
  // "독서감상문쓰기대회6(5)": 이름만 있는 행사는 비게 되는 교시(5교시)에 들어간다
  if (rest && !parsePeriods(cleanParens(rest).text)) rest = `${rest} ${m[2]}`;
  return rest ? [rest, token] : [token];
}

export function classifyTitle(rawTitle: string, rules: RuleSet = DEFAULT_RULES): EventRule {
  // 이모지·기호 머리 떼기
  const base = rawTitle.normalize('NFC').replace(/^[^\p{L}\p{N}(]+/u, '').trim();

  const sw = base.match(/^([1-9])\s*\(\s*([1-9])\s*\)$/);
  if (sw) {
    const a = +sw[1];
    const b = +sw[2];
    return {
      kind: 'periodswap',
      swap: [a, b],
      label: `${a}교시에 ${b}교시 수업`,
      confidence: 'high',
      reason: `"${base}": ${b}교시 수업을 ${a}교시로 옮기고, ${b}교시는 그날 행사에 씀`,
    };
  }

  const { text: noParen, removed } = cleanParens(base);
  const title = noParen.replace(TIME, ' ').replace(/\s+/g, ' ').trim();
  const scope = parseScope(title);
  const note = removed.length ? ` (괄호 "${removed.join('", "')}"는 뺌)` : '';

  const staff = findWord(title, rules.staff);
  if (staff) return { kind: 'info', ...scope, label: '교직원·기타 일정', confidence: 'high', reason: `"${staff}" 포함 — 학생 수업과 무관${note}` };

  const swap = title.match(DAYSWAP);
  if (swap) {
    const ch = swap[1] ?? swap[2];
    const idx = WEEKDAYS.indexOf(ch as (typeof WEEKDAYS)[number]);
    return { kind: 'dayswap', swapTo: idx, ...scope, label: `${ch}요일 시간표 운영`, confidence: 'high', reason: `"${swap[0]}" 표기` };
  }

  const hol = findWord(title, rules.holiday);
  if (hol) return { kind: 'holiday', ...scope, label: '휴업일', confidence: 'high', reason: `"${hol}" 포함` };
  if (VACATION.test(title)) return { kind: 'vacation', ...scope, label: '방학', confidence: 'high', reason: '"방학" 포함' };

  const periods = parsePeriods(title);
  const exam = findWord(title, rules.exam);
  const conf = removed.some((r) => /[가-힣]/.test(r)) ? 'mid' : 'high';

  if (exam) {
    return {
      kind: 'exam',
      periods,
      ...scope,
      label: '정기고사',
      confidence: 'high',
      reason: `"${exam}" 포함${periods ? `, ${span(periods)}` : ', 전 교시'}${note}`,
    };
  }
  if (periods) {
    return {
      kind: 'periods',
      periods,
      ...scope,
      label: `${span(periods)} ${periods.length === 1 ? '특별교육' : '창체·행사'}`,
      confidence: conf,
      reason: `교시 표기 "${periods.length === 1 ? periods[0] : `${periods[0]}-${periods[periods.length - 1]}`}"${note}`,
    };
  }
  const full = findWord(title, rules.fullday);
  if (full) return { kind: 'fullday', ...scope, label: '전일 행사', confidence: 'high', reason: `"${full}" 포함${note}` };

  const info = findWord(title, rules.info);
  if (info) return { kind: 'info', ...scope, label: '참고 일정', confidence: 'mid', reason: `"${info}"는 교시 표기가 없으면 수업에 영향 없음으로 봄${note}` };
  return { kind: 'info', ...scope, label: '참고 일정', confidence: 'low', reason: `교시 표기나 행사 키워드가 없어 시수에 반영하지 않음 — 확인 필요${note}` };
}

export function parseEvents(
  events: CalEvent[],
  overrides: Record<string, Partial<EventRule>> = {},
  rules: RuleSet = DEFAULT_RULES,
): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const e of events) {
    const parts = splitTitle(e.title);
    parts.forEach((part, i) => {
      const id = parts.length > 1 ? `${e.id}#${i}` : e.id;
      const title = parts.length > 1 ? `${part} ← ${e.title}` : e.title;
      const rule = classifyTitle(part, rules);
      const o = overrides[id];
      if (o) {
        out.push({ ...e, id, title, rule: { ...rule, ...o, confidence: 'high', reason: '직접 수정함' } });
        return;
      }
      // "영어듣기평가1-3(학년별)": 1학년 1교시, 2학년 2교시, 3학년 3교시
      if (/학년\s*별/.test(part) && rule.periods && rule.periods.length > 1 && !rule.grades && !rule.classes) {
        rule.periods.forEach((p, k) => {
          out.push({
            ...e,
            id: `${id}@${k + 1}`,
            title,
            rule: { ...rule, periods: [p], grades: [k + 1], label: `${k + 1}학년 ${p}교시`, confidence: 'high', reason: `학년별로 한 교시씩: ${k + 1}학년은 ${p}교시` },
          });
        });
        return;
      }
      out.push({ ...e, id, title, rule });
    });
  }
  return out;
}

/** 일정이 특정 반에 적용되는가 */
export function appliesTo(rule: EventRule, cls: string, grade: number): boolean {
  if (rule.classes) return rule.classes.includes(cls);
  if (rule.grades) return rule.grades.includes(grade);
  return true;
}
