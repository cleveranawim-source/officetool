import { describe, expect, it } from 'vitest';
import { classifyTitle, parseEvents } from './parseEvents';
import { computeLedger, deliveredBefore, gradeSpreads } from './compute';
import { importClassTimetable } from './importTimetable';
import { calendarIdFrom, parseICS } from './ics';
import { validateTimetable } from './validate';
import { suggest } from './suggest';
import { mergeHolidays } from './holidays';
import { anonymizeTeachers } from './privacy';
import { parseEventList } from './eventList';
import { looksLikeCalendarGrid, parseCalendarGrid } from './calendarGrid';
import { readEventTable, termOf } from './eventTable';
import { neisRows, neisScheduleToEvents, neisUrl, toSchools } from './neis';
import type { CalEvent, Settings, Timetable } from './types';
import sample from '../data/sample-timetable.json';
import { sampleEvents } from '../data/sampleEvents';

describe('일정 제목 분류', () => {
  it.each([
    ['진로교육 1-7', 'periods', [1, 2, 3, 4, 5, 6, 7], undefined],
    ['함께하는 삶1', 'periods', [1], undefined],
    ['1학년 진로교육 1-7', 'periods', [1, 2, 3, 4, 5, 6, 7], [1]],
    ['성교육 5~6교시', 'periods', [5, 6], undefined],
    ['안전교육 7교시', 'periods', [7], undefined],
    ['2학년 수련회', 'fullday', undefined, [2]],
    ['1,2학년 체육대회', 'fullday', undefined, [1, 2]],
    ['2학기 중간고사', 'exam', undefined, undefined],
    ['3학년 기말고사 1-3', 'exam', [1, 2, 3], [3]],
    ['재량휴업일', 'holiday', undefined, undefined],
    ['추석', 'holiday', undefined, undefined],
    ['여름방학', 'vacation', undefined, undefined],
    ['방학식', 'info', undefined, undefined],
    ['2026 체육대회', 'fullday', undefined, undefined],
  ] as const)('%s', (title, kind, periods, grades) => {
    const r = classifyTitle(title);
    expect(r.kind).toBe(kind);
    expect(r.periods).toEqual(periods);
    expect(r.grades).toEqual(grades);
  });

  it.each([
    // 실제 학교 캘린더에서 쓰이는 표기
    ['3감염병예방교육', 'periods', [3], undefined],
    ['1-7 백마페스티벌', 'periods', [1, 2, 3, 4, 5, 6, 7], undefined],
    ['5-6 동아리 활동', 'periods', [5, 6], undefined],
    ['1-4 1학년 봄날 관람', 'periods', [1, 2, 3, 4], [1]],
    ['2 학교폭력예방교육, 안전교육', 'periods', [2], undefined],
    ['1개학식', 'periods', [1], undefined],
    ['크리스마스 페스티벌2-4', 'periods', [2, 3, 4], undefined],
    ['(3학년)졸업식1-4', 'periods', [1, 2, 3, 4], [3]],
    ['학급자치6(담)', 'periods', [6], undefined],
    ['(1,2학년) 중간고사', 'exam', undefined, [1, 2]],
    ['(2학년) 역사탐방', 'fullday', undefined, [2]],
    ['부장회의1', 'info', undefined, undefined],
    ['1부장회의', 'info', undefined, undefined],
    ['✝️교직원예배', 'info', undefined, undefined],
    ['2학기 임원수련회', 'info', undefined, undefined],
    ['학급자치(08:30~09:10)', 'info', undefined, undefined],
    ['오전 10:30 새학기 준비기도회', 'info', undefined, undefined],
    ['보호자 상담주간(24-28)', 'info', undefined, undefined],
    ['3학년 학급문집 제출마감일', 'info', undefined, [3]],
    ['1,2학년 학급 문집 제출 마감일', 'info', undefined, [1, 2]],
    ['6(1)', 'periodswap', undefined, undefined],
  ] as const)('실제 표기 %s', (title, kind, periods, grades) => {
    const r = classifyTitle(title);
    expect(r.kind).toBe(kind);
    expect(r.periods).toEqual(periods);
    expect(r.grades).toEqual(grades);
  });

  it('한 제목에 교시 교환이 함께 있으면 나눈다', () => {
    const ev = parseEvents([
      { id: 'a', title: '사랑하는 삶1/6(1)', start: '2026-12-23', end: '2026-12-23', source: 'calendar' },
      { id: 'b', title: '독서감상문쓰기대회6(5)', start: '2026-12-16', end: '2026-12-16', source: 'calendar' },
    ]);
    expect(ev.map((e) => e.rule.kind)).toEqual(['periods', 'periodswap', 'periods', 'periodswap']);
    expect(ev[1].rule.swap).toEqual([6, 1]);
    // 이름만 있는 행사는 비게 되는 교시(5교시)에 들어간다
    expect(ev[2].rule.periods).toEqual([5]);
  });

  it('학년별로 한 교시씩', () => {
    const ev = parseEvents([{ id: 'l', title: '영어듣기평가1-3(학년별)', start: '2026-10-14', end: '2026-10-14', source: 'calendar' }]);
    expect(ev.map((e) => [e.rule.grades, e.rule.periods])).toEqual([
      [[1], [1]],
      [[2], [2]],
      [[3], [3]],
    ]);
  });

  it('요일 교체', () => {
    const r = classifyTitle('월요일 시간표 운영');
    expect(r.kind).toBe('dayswap');
    expect(r.swapTo).toBe(0);
  });

  it('모르는 제목은 확인 필요로 표시', () => {
    const r = classifyTitle('북적북적나들이');
    expect(r.kind).toBe('info');
    expect(r.confidence).toBe('low');
  });

  it('반 단위 일정', () => {
    const r = classifyTitle('2-3반 현장체험학습');
    expect(r.kind).toBe('fullday');
    expect(r.classes).toEqual(['2-3']);
  });
});

/** 월~금 하루 2교시, 한 학년 두 반짜리 작은 시간표 */
const tiny: Timetable = {
  school: 't',
  term: 't',
  days: [2, 2, 2, 2, 2],
  classes: [
    {
      id: '1-1',
      grade: 1,
      week: [
        [{ s: '국어', t: 'A' }, { s: '수학', t: 'B' }],
        [{ s: '영어', t: 'C' }, { s: '국어', t: 'A' }],
        [{ s: '수학', t: 'B' }, { s: '창체', t: '' }],
        [{ s: '국어', t: 'A' }, { s: '영어', t: 'C' }],
        [{ s: '수학', t: 'B' }, { s: '영어', t: 'C' }],
      ],
    },
    {
      id: '1-2',
      grade: 1,
      week: [
        [{ s: '수학', t: 'B' }, { s: '국어', t: 'A' }],
        [{ s: '국어', t: 'A' }, { s: '영어', t: 'C' }],
        [{ s: '영어', t: 'C' }, { s: '창체', t: '' }],
        [{ s: '수학', t: 'B' }, { s: '국어', t: 'A' }],
        [{ s: '영어', t: 'C' }, { s: '수학', t: 'B' }],
      ],
    },
  ],
};

const settings: Settings = {
  termStart: '2026-09-07', // 월
  termEnd: '2026-09-18', // 2주
  targetWeeks: 2,
  examCountsAsClass: false,
  today: '2026-09-01',
};

function ledger(events: CalEvent[]) {
  return computeLedger(tiny, parseEvents(events), settings);
}

describe('시수 계산', () => {
  it('일정이 없으면 주당 × 주수', () => {
    const l = ledger([]);
    expect(l.delivered['1-1']).toEqual({ 국어: 6, 수학: 6, 영어: 6, 창체: 2 });
    expect(l.schoolDays).toBe(10);
  });

  it('휴업일은 그 요일 과목만 뺀다', () => {
    const l = ledger([{ id: 'h', title: '재량휴업일', start: '2026-09-07', end: '2026-09-07', source: 'manual' }]);
    expect(l.delivered['1-1'].국어).toBe(5);
    expect(l.delivered['1-1'].수학).toBe(5);
    expect(l.delivered['1-1'].영어).toBe(6);
    expect(l.losses.filter((x) => x.cls === '1-1')).toHaveLength(2);
  });

  it('교시 일정은 해당 교시만 창체로 바꾼다', () => {
    const l = ledger([{ id: 'p', title: '함께하는 삶1', start: '2026-09-08', end: '2026-09-08', source: 'manual' }]);
    expect(l.delivered['1-1'].영어).toBe(5); // 1-1 화1 영어
    expect(l.delivered['1-2'].국어).toBe(5); // 1-2 화1 국어
    expect(l.replaced['1-1']['행사·창체']).toBe(1);
  });

  it('학년 일정은 다른 학년에 영향 없음', () => {
    const l = ledger([{ id: 'f', title: '2학년 수련회', start: '2026-09-07', end: '2026-09-11', source: 'manual' }]);
    expect(l.delivered['1-1'].국어).toBe(6);
  });

  it('요일 교체는 교체 요일 시간표로 센다', () => {
    const l = ledger([{ id: 's', title: '월요일 시간표 운영', start: '2026-09-11', end: '2026-09-11', source: 'manual' }]);
    // 금(수학,영어) 대신 월(국어,수학)
    expect(l.delivered['1-1']).toMatchObject({ 국어: 7, 수학: 6, 영어: 5 });
    expect(l.swaps).toHaveLength(2);
  });

  it('교시 교환 뒤 교시 일정: 1교시 행사가 6교시 과목을 잡아먹는다', () => {
    // 1-1 수(9/9): 1교시 수학, 2교시 창체. "2(1)" + "행사1" → 1교시 자리에 창체가 오고 행사가 창체를 대체
    const l = ledger([
      { id: 'x', title: '감사하는 삶1', start: '2026-09-09', end: '2026-09-09', source: 'manual' },
      { id: 'y', title: '2(1)', start: '2026-09-09', end: '2026-09-09', source: 'manual' },
    ]);
    expect(l.delivered['1-1'].수학).toBe(6);
    expect(l.delivered['1-1'].창체).toBe(1);
  });

  it('학년마다 다른 시험 날짜는 따로 체크포인트', () => {
    const l = ledger([
      { id: 'e1', title: '(1학년) 중간고사', start: '2026-09-16', end: '2026-09-16', source: 'manual' },
      { id: 'e2', title: '(2학년) 중간고사', start: '2026-09-17', end: '2026-09-17', source: 'manual' },
    ]);
    expect(l.checkpoints.map((c) => [c.date, c.grades])).toEqual([
      ['2026-09-16', [1]],
      ['2026-09-17', [2]],
      ['9999-12-31', undefined],
    ]);
    expect(gradeSpreads(l, l.checkpoints[1])).toHaveLength(0); // 1학년만 있는 시간표
  });

  it('시험 인정 설정', () => {
    const ev: CalEvent[] = [{ id: 'e', title: '중간고사', start: '2026-09-07', end: '2026-09-07', source: 'manual' }];
    expect(computeLedger(tiny, parseEvents(ev), settings).delivered['1-1'].국어).toBe(5);
    expect(computeLedger(tiny, parseEvents(ev), { ...settings, examCountsAsClass: true }).delivered['1-1'].국어).toBe(6);
  });

  it('체크포인트 전날까지 누적과 반간 격차', () => {
    const l = ledger([
      { id: 'h', title: '재량휴업일', start: '2026-09-07', end: '2026-09-07', source: 'manual' },
      { id: 'e', title: '중간고사', start: '2026-09-17', end: '2026-09-18', source: 'manual' },
    ]);
    const cp = l.checkpoints[0];
    expect(cp.date).toBe('2026-09-17');
    expect(deliveredBefore(l, '1-1', '국어', cp.date)).toBe(4);
    const s = gradeSpreads(l, cp).find((x) => x.subject === '국어')!;
    expect(s.values.map((v) => v.value)).toEqual([4, 4]);
  });
});

describe('보완 제안', () => {
  it('목요일 휴업으로 벌어진 격차를 같은 모양의 요일 교체로 메운다', () => {
    const events: CalEvent[] = [{ id: 'h', title: '재량휴업일', start: '2026-09-10', end: '2026-09-10', source: 'manual' }];
    const l = ledger(events);
    const r = suggest(l);
    expect(r.list[0].type).toBe('dayswap');
    expect(r.list[0].title).toContain('목요일 시간표');
    const last = (a: number[]) => a[a.length - 1];
    expect(last(r.final.spreadByCheckpoint)).toBeLessThan(last(r.base.spreadByCheckpoint));
    expect(r.final.deficitHours).toBeLessThanOrEqual(r.base.deficitHours);
    // 제안을 실제 일정으로 넣으면 같은 결과
    const applied = ledger([...events, r.list[0].addEvent!]);
    expect(r.list[0].after.deficitHours).toBe(
      Object.entries(applied.weekly)
        .flatMap(([c, w]) => Object.entries(w).filter(([s]) => s !== '창체').map(([s, n]) => Math.max(0, n * 2 - applied.delivered[c][s])))
        .reduce((a, b) => a + b, 0),
    );
  });

  it('창체가 있는 요일이나 교시 수가 다른 요일과는 바꾸지 않는다', () => {
    const r = suggest(ledger([{ id: 'h', title: '재량휴업일', start: '2026-09-07', end: '2026-09-07', source: 'manual' }]), 10);
    // 수요일(창체 있음)을 끌어들이는 요일 교체는 없어야 한다
    expect(r.list.filter((x) => x.type === 'dayswap').every((x) => !x.title.includes('수요일') && !x.title.includes('(수)'))).toBe(true);
  });
});

describe('교시 이동 제안의 제약', () => {
  const events: CalEvent[] = [
    { id: 'h', title: '재량휴업일', start: '2026-09-07', end: '2026-09-07', source: 'manual' },
    { id: 'a', title: '성교육1', start: '2026-09-15', end: '2026-09-15', source: 'manual' },
    { id: 'b', title: '안전교육2', start: '2026-09-15', end: '2026-09-15', source: 'manual' },
    { id: 'c', title: '영어듣기평가1', start: '2026-09-16', end: '2026-09-16', source: 'manual' },
  ];
  const l = ledger(events);
  const moves = suggest(l, 10).list.filter((x) => x.type === 'move');
  it('다른 일정과 겹치는 교시로는 옮기지 않는다', () => {
    expect(moves.every((m) => !(m.override?.eventId === 'a' && m.override.rule.periods?.includes(2)))).toBe(true);
  });
  it('듣기평가처럼 정해진 일정은 옮기지 않는다', () => {
    expect(moves.some((m) => m.override?.eventId === 'c')).toBe(false);
  });
});

describe('가져오기', () => {
  const csv = [
    '전체 학반 시간표,,,,,,,,,,,',
    '학반,월,,화,,수,,목,,금,,학반,담임',
    ',1,2,1,2,1,2,1,2,1,2,,',
    '1-1,미술,─▷,국어,수학,영A,창체,국어,수학,영B,국어,1-1,홍길',
    ',나나,,가가,다다,라라,,가가,다다,마마,가가,,',
    '1-2,수학,국어,영A,영B,국어,창체,미술,─▷,수학,국어,1-2,김철',
    ',다다,가가,라라,마마,가가,,나나,,다다,가가,,',
  ].join('\n');

  it('학반별 시간표 붙여넣기', () => {
    const { timetable } = importClassTimetable(csv);
    expect(timetable.days).toEqual([2, 2, 2, 2, 2]);
    expect(timetable.classes).toHaveLength(2);
    expect(timetable.classes[0].homeroom).toBe('홍길');
    // 월2 "─▷"는 같은 날 앞 교시(월1 미술)를 이어받는다
    expect(timetable.classes[0].week[0][1]).toEqual({ s: '미술', t: '나나' });
    expect(timetable.classes[1].week[3][1]).toEqual({ s: '미술', t: '나나' });
  });

  it('학반별 블록형 시간표 (세로 블록 표시 │ ▽)', () => {
    const text = [
      '학반 시간표,,,,,',
      '2026 학년도,,,1-2 홍길동,,',
      ',월,화,수,목,금',
      '1,국어,미술,수학,영어,과학',
      ',가가,나나,다다,라라,마마',
      '2,수학,│,창체,국어,수학',
      ',다다,▽,,가가,다다',
      '3,,영어,,수학,',
      ',,라라,,다다,',
      ',,,,,',
      '학반 시간표,,,,,',
      '2026 학년도,,,1-1 김철수,,',
      ',월,화,수,목,금',
      '1,과학,국어,국어,수학,영어',
      ',마마,가가,가가,다다,라라',
      '2,영어,수학,창체,과학,국어',
      ',라라,다다,,마마,가가',
    ].join('\n');
    const r = importClassTimetable(text);
    expect(r.layout).toBe('blocks');
    expect(r.timetable.classes.map((c) => c.id)).toEqual(['1-1', '1-2']);
    const c12 = r.timetable.classes[1];
    expect(c12.homeroom).toBe('홍길동');
    expect(c12.week[1]).toEqual([{ s: '미술', t: '나나' }, { s: '미술', t: '나나' }, { s: '영어', t: '라라' }]);
    expect(c12.week[0]).toHaveLength(2); // 월 3교시 빈칸은 잘라냄
    expect(r.timetable.days).toEqual([2, 3, 2, 3, 2]);
  });

  it('한 칸에 과목과 교사가 같이 있는 시간표', () => {
    const text = ['학반,월,,화,,수,,목,,금,', ',1,2,1,2,1,2,1,2,1,2', '1-1,"국어\n김가",수학(이나),영어,,창체,,,,,'].join('\n');
    const c = importClassTimetable(text).timetable.classes[0];
    expect(c.week[0]).toEqual([{ s: '국어', t: '김가' }, { s: '수학', t: '이나' }]);
  });

  it('구글 캘린더 ics', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261111',
      'DTEND;VALUE=DATE:20261114',
      'SUMMARY:2학년 수련회',
      'UID:abc',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261104T230000Z',
      'DTEND:20261105T010000Z',
      'SUMMARY:진로교육 1-7',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const ev = parseICS(ics);
    expect(ev.find((e) => e.title === '2학년 수련회')).toMatchObject({ start: '2026-11-11', end: '2026-11-13' });
    expect(ev.find((e) => e.title === '진로교육 1-7')).toMatchObject({ start: '2026-11-05' });
  });
});

describe('반복 일정과 캘린더 주소', () => {
  it('매주 수요일 반복, 제외 날짜, 한 회차 이동', () => {
    const ics = [
      'BEGIN:VEVENT',
      'UID:r1',
      'DTSTART;VALUE=DATE:20260902',
      'DTEND;VALUE=DATE:20260903',
      'RRULE:FREQ=WEEKLY;UNTIL=20260930;BYDAY=WE',
      'EXDATE;VALUE=DATE:20260916',
      'SUMMARY:함께하는 삶1',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:r1',
      'RECURRENCE-ID;VALUE=DATE:20260923',
      'DTSTART;VALUE=DATE:20260924',
      'DTEND;VALUE=DATE:20260925',
      'SUMMARY:함께하는 삶1',
      'END:VEVENT',
    ].join('\n');
    expect(parseICS(ics).map((e) => e.start)).toEqual(['2026-09-02', '2026-09-09', '2026-09-24', '2026-09-30']);
  });

  it('임베드 주소에서 캘린더 ID', () => {
    const id = 'c_abc123@group.calendar.google.com';
    expect(calendarIdFrom(`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(id)}&ctz=Asia%2FSeoul`)).toBe(id);
    expect(calendarIdFrom(id)).toBe(id);
    expect(calendarIdFrom(`https://calendar.google.com/calendar/ical/${encodeURIComponent(id)}/public/basic.ics`)).toBe(id);
  });
});

describe('개인정보와 목록형 일정', () => {
  it('교사 이름을 교과 번호로 바꾼다', () => {
    const a = anonymizeTeachers(tiny);
    const names = new Set(a.classes.flatMap((c) => c.week.flat().map((s) => s.t)).filter(Boolean));
    expect([...names].sort()).toEqual(['국어1', '수학1', '영어1']);
    expect(computeLedger(a, [], settings).teachers).toHaveLength(3);
  });

  it('날짜와 일정 이름 목록', () => {
    const text = ['날짜\t요일\t행사', '2026-10-07\t수\t(1,2학년) 중간고사', '10/13~15\t\t2학년 수련회', '2026. 11. 5.\t목\t진로교육 1-7', '11월 20일 재량휴업일'].join('\n');
    const ev = parseEventList(text, 2026);
    expect(ev.map((e) => [e.start, e.end, e.title])).toEqual([
      ['2026-10-07', '2026-10-07', '(1,2학년) 중간고사'],
      ['2026-10-13', '2026-10-15', '2학년 수련회'],
      ['2026-11-05', '2026-11-05', '진로교육 1-7'],
      ['2026-11-20', '2026-11-20', '재량휴업일'],
    ]);
  });
});

describe('달력형 학사일정', () => {
  // 실제 학교 학사일정표 모양: 월 | 주 | 월~금(교시 수) | 토, 날짜 줄 아래 일정 줄
  const T = (...cells: string[]) => cells.join('\t');
  const sheet = [
    T('2024학년도 1학기 학사일정'),
    T('월', '주', '월(6교시)', '화(7교시)', '수(6교시)', '목(7교시)', '금(6교시)', '토'),
    T('3', '', '4', '5♥1', '6', '7♠1', '8♣1', '9 (1년)입학식1-4'),
    T('', '1', '(2,3년)개학식1', '(1학년)자유학기제OT', '6(1)', '', '', ''),
    T('', '', '교직원예배', '', '', '', '', ''),
    T('', '4', '25', '26♥3', '27', '28', '29♣4', '30'),
    T('', '', '', '6(5)', '"진로탐색1-7\n부장회의"', '', '', ''),
    T('4', '5', '1', '2♥4', '3', '4♠4', '5♣5', '6'),
    T('', '', '교직원예배', '', '', '', '학부모공개수업2-3', ''),
    T('수업일', '', '19', '21', '18', '19', '19', ''),
    T('2024학년도 2학기 학사일정'),
    T('월', '주', '월', '화', '수', '목', '금', '토'),
    T('12', '20', '23', '24', '25', '26', '27', '28'),
    T('', '', '학급자치회의', '크리스마스 페스티벌2-4', '성탄절', '', '', ''),
    T('', '21', '30', '31', '1', '2', '3', '4'),
    T('', '', '교직원예배', '', '신정', '아동학대예방교육(6)', '수요일 수업', ''),
  ].join('\n');

  it('달력형인지 알아본다', () => {
    expect(looksLikeCalendarGrid(sheet.split('\n').map((l) => l.split('\t')))).toBe(true);
    expect(looksLikeCalendarGrid([['2026-10-07', '중간고사']])).toBe(false);
  });

  it('날짜와 일정을 읽는다 (달 바뀜·해 바뀜·표시 기호)', () => {
    const r = parseCalendarGrid(sheet, { year: 2024, semester: 1 });
    const got = r.events.map((e) => `${e.start} ${e.title}`);
    expect(got).toEqual([
      '2024-03-04 (2,3년)개학식1',
      '2024-03-04 교직원예배',
      '2024-03-05 (1학년)자유학기제OT',
      '2024-03-06 6(1)',
      '2024-03-26 6(5)',
      '2024-03-27 진로탐색1-7',
      '2024-03-27 부장회의',
      '2024-04-01 교직원예배',
      '2024-04-05 학부모공개수업2-3',
      '2024-12-23 학급자치회의',
      '2024-12-24 크리스마스 페스티벌2-4',
      '2024-12-25 성탄절',
      '2024-12-30 교직원예배',
      '2025-01-01 신정',
      '2025-01-02 아동학대예방교육(6)',
      '2025-01-03 수요일 수업',
    ]);
  });

  it('달력형에서 온 표기도 규칙으로 읽는다', () => {
    expect(classifyTitle('(2,3년)개학식1')).toMatchObject({ kind: 'periods', periods: [1], grades: [2, 3] });
    expect(classifyTitle('(1년)보건1-3')).toMatchObject({ kind: 'periods', periods: [1, 2, 3], grades: [1] });
    expect(classifyTitle('아동학대예방교육(6)')).toMatchObject({ kind: 'periods', periods: [6] });
    expect(classifyTitle('정서행동특성검사(4교시)')).toMatchObject({ kind: 'periods', periods: [4] });
    expect(classifyTitle('수요일 수업')).toMatchObject({ kind: 'dayswap', swapTo: 2 });
    expect(classifyTitle('2024학년도 학사일정').grades).toBeUndefined();
  });

  it('엑셀 날짜 값으로 된 칸도 읽는다', () => {
    const rows = [
      ['월', '주', '월', '화', '수', '목', '금'],
      ['9', '', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'],
      ['', '', '', '진로교육1-7', '', '', '(1학년)수련회'],
      ['', '5', '5', '6', '7', '8', '9'],
      ['', '', '', '', '', '', '개교기념일'],
    ];
    const r = parseCalendarGrid(rows, { year: 2026, semester: 2 });
    expect(r.events.map((e) => `${e.start} ${e.title}`)).toEqual(['2026-09-29 진로교육1-7', '2026-10-02 (1학년)수련회', '2026-10-09 개교기념일']);
  });

  it('붙여넣은 표가 목록형인지 달력형인지 알아서 고른다', () => {
    const grid = readEventTable(sheet, { year: 2024, semester: 1 });
    expect(grid.format).toBe('grid');
    expect(grid.events.length).toBe(16);
    const list = readEventTable('1/5\t겨울방학\n12/24\t종업식', { year: 2026, semester: 2 });
    expect(list.format).toBe('list');
    expect(list.events.map((e) => e.start)).toEqual(['2027-01-05', '2026-12-24']);
    expect(termOf('2026-08-18')).toEqual({ year: 2026, semester: 2 });
  });
});

describe('NEIS 학사일정', () => {
  const row = (ymd: string, name: string, extra: Record<string, string> = {}) => ({
    AA_YMD: ymd,
    EVENT_NM: name,
    SBTR_DD_SC_NM: '해당없음',
    ONE_GRADE_EVENT_YN: 'Y',
    TW_GRADE_EVENT_YN: 'Y',
    THREE_GRADE_EVENT_YN: 'Y',
    ...extra,
  });
  const res = (rows: object[]) =>
    JSON.stringify({ SchoolSchedule: [{ head: [{ list_total_count: rows.length }, { RESULT: { CODE: 'INFO-000' } }] }, { row: rows }] });

  it('응답에서 행과 건수를 꺼내고, 오류는 한국어로 알린다', () => {
    expect(neisRows(res([row('20261007', '중간고사')]), 'SchoolSchedule')).toMatchObject({ total: 1, rows: [{ EVENT_NM: '중간고사' }] });
    expect(neisRows({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } }, 'SchoolSchedule').rows).toEqual([]);
    expect(() => neisRows({ RESULT: { CODE: 'ERROR-290' } }, 'SchoolSchedule')).toThrow('인증키');
  });

  it('주소에 키·학교·기간을 넣는다 (키가 없으면 5건)', () => {
    const u = new URL(neisUrl('SchoolSchedule', { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: '7130000' }, ' abc '));
    expect(u.searchParams.get('KEY')).toBe('abc');
    expect(u.searchParams.get('pSize')).toBe('1000');
    expect(new URL(neisUrl('schoolInfo', { SCHUL_NM: '한빛중' })).searchParams.get('pSize')).toBe('5');
  });

  it('학교 검색 결과를 정리한다', () => {
    const r = toSchools([{ ATPT_OFCDC_SC_CODE: 'B10', ATPT_OFCDC_SC_NM: '서울특별시교육청', SD_SCHUL_CODE: '7130000', SCHUL_NM: '한빛중학교', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: ' 서울 어딘가 ' }]);
    expect(r[0]).toEqual({ office: 'B10', officeName: '서울특별시교육청', code: '7130000', name: '한빛중학교', kind: '중학교', address: '서울 어딘가' });
  });

  it('주말·토요휴업일은 빼고, 휴업일·학년 표시를 제목에 담는다', () => {
    const ev = neisScheduleToEvents([
      row('20261010', '토요휴업일'),
      row('20261011', '학급 행사'),
      row('20261009', '한글날', { SBTR_DD_SC_NM: '공휴일' }),
      row('20261016', '개교기념일', { SBTR_DD_SC_NM: '휴업일' }),
      row('20261102', '학교장재량', { SBTR_DD_SC_NM: '휴업일' }),
      row('20261007', '중간고사', { THREE_GRADE_EVENT_YN: 'N' }),
      row('20261015', '2학년 수련회', { ONE_GRADE_EVENT_YN: 'N', THREE_GRADE_EVENT_YN: 'N' }),
      row('20261007', '중간고사', { THREE_GRADE_EVENT_YN: 'N' }),
    ]);
    expect(ev.map((e) => `${e.start} ${e.title}`)).toEqual([
      '2026-10-07 (1,2학년) 중간고사',
      '2026-10-09 한글날 공휴일',
      '2026-10-15 2학년 수련회',
      '2026-10-16 개교기념일 휴업일',
      '2026-11-02 학교장재량 휴업일',
    ]);
    expect(classifyTitle(ev[0].title)).toMatchObject({ kind: 'exam', grades: [1, 2] });
    expect(classifyTitle(ev[4].title).kind).toBe('holiday');
  });
});

describe('예시 데이터 전체', () => {
  const tt = sample as Timetable;
  const s: Settings = { termStart: '2026-08-17', termEnd: '2026-12-31', targetWeeks: 17, examCountsAsClass: false, today: '2026-09-24' };
  const events = parseEvents(mergeHolidays(sampleEvents, s.termStart, s.termEnd));

  it('30학급, 학년 안 주당 시수 동일', () => {
    expect(tt.classes).toHaveLength(30);
    expect(validateTimetable(tt).filter((i) => i.title.includes('주당 시수'))).toHaveLength(0);
  });

  it('원본의 교사 중복 배정을 찾아낸다', () => {
    const dup = validateTimetable(tt).filter((i) => i.level === 'error');
    expect(dup.length).toBeGreaterThan(0);
  });

  it('어떤 제안도 격차나 부족 시수를 늘리지 않는다', () => {
    const l = computeLedger(tt, events, s);
    const r = suggest(l, 6);
    expect(r.list.length).toBeGreaterThan(0);
    for (const x of r.list) {
      expect(x.after.deficitHours).toBeLessThanOrEqual(x.before.deficitHours);
      expect(x.after.maxSpread).toBeLessThanOrEqual(x.before.maxSpread);
      x.after.spreadByCheckpoint.forEach((v, i) => expect(v).toBeLessThanOrEqual(x.before.spreadByCheckpoint[i]));
    }
  });

  it('계산과 제안이 빠르게 끝난다', () => {
    const t0 = performance.now();
    const l = computeLedger(tt, events, s);
    const r = suggest(l);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.final.score).toBeLessThanOrEqual(r.base.score);
  });
});
