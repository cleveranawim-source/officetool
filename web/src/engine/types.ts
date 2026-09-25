/** 요일 인덱스: 0=월 … 4=금 */
export const WEEKDAYS = ['월', '화', '수', '목', '금'] as const;

export interface Slot {
  /** 과목명 (시간표에 적힌 그대로: 국어, 영A, 체B, 창체 …) */
  s: string;
  /** 교사 (창체 등 담당 교사가 없는 칸은 빈 문자열) */
  t: string;
}

export interface ClassTimetable {
  /** "2-7" 형식 */
  id: string;
  grade: number;
  homeroom?: string;
  /** week[요일][교시-1] */
  week: Slot[][];
}

export interface Timetable {
  school: string;
  term: string;
  /** 요일별 교시 수 (월~금) */
  days: number[];
  classes: ClassTimetable[];
}

/** 캘린더 원본 일정 (end는 포함 날짜) */
export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  /** auto: 공휴일 자동 추가, sample: 예시 일정, calendar: 구글 캘린더, manual: 직접 입력, plan: 보완 제안 적용 */
  source: 'auto' | 'sample' | 'calendar' | 'manual' | 'plan' | 'neis';
}

export type EventKind =
  | 'holiday' // 휴업·공휴일: 수업 없음
  | 'vacation' // 방학: 수업 없음
  | 'exam' // 정기고사: 교과 시수 대체
  | 'fullday' // 전일 행사: 전 교시 창체/행사
  | 'periods' // 특정 교시 창체/특별교육
  | 'dayswap' // 요일 교체 운영
  | 'periodswap' // 그날 두 교시 맞바꿈 ("6(1)")
  | 'info'; // 시수에 영향 없음

export interface EventRule {
  kind: EventKind;
  /** periods/exam 일 때 대상 교시 (1부터). 없으면 전 교시 */
  periods?: number[];
  /** 대상 학년. 없으면 전교 */
  grades?: number[];
  /** 대상 반 ("2-3"). 있으면 grades보다 우선 */
  classes?: string[];
  /** dayswap: 운영할 요일 인덱스 */
  swapTo?: number;
  /** periodswap: 맞바꿀 두 교시 */
  swap?: [number, number];
  /** 사람이 읽는 분류명 */
  label: string;
  confidence: 'high' | 'mid' | 'low';
  /** 왜 이렇게 분류했는지 */
  reason: string;
}

export interface ParsedEvent extends CalEvent {
  rule: EventRule;
}

export interface Settings {
  termStart: string;
  termEnd: string;
  /** 편제 기준 주수 (학기당 17주) */
  targetWeeks: number;
  /** 시험 교시를 교과 시수로 인정할지 */
  examCountsAsClass: boolean;
  /** 현재 기준일 (실적/계획 구분) */
  today: string;
}

/** 한 교시가 빠진 기록 */
export interface Loss {
  date: string;
  cls: string;
  period: number;
  subject: string;
  teacher: string;
  eventId: string;
  eventTitle: string;
  kind: EventKind;
}

export interface Checkpoint {
  id: string;
  label: string;
  /** 이 날짜 전날까지의 누적 시수를 본다 */
  date: string;
  /** 이 시험을 보는 학년. 없으면 전 학년 */
  grades?: number[];
}
