import { describe, expect, it } from 'vitest';
import { classifyTitle, parseEvents } from './parseEvents';
import { computeLedger, deliveredBefore, gradeSpreads } from './compute';
import { importClassTimetable } from './importTimetable';
import { parseICS } from './ics';
import { validateTimetable } from './validate';
import { suggest } from './suggest';
import { mergeHolidays } from './holidays';
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

  it('요일 교체', () => {
    const r = classifyTitle('월요일 시간표 운영');
    expect(r.kind).toBe('dayswap');
    expect(r.swapTo).toBe(0);
  });

  it('모르는 제목은 확인 필요로 표시', () => {
    const r = classifyTitle('교직원 워크숍');
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
  it('월요일 손실을 요일 교체로 메운다', () => {
    const events: CalEvent[] = [{ id: 'h', title: '재량휴업일', start: '2026-09-07', end: '2026-09-07', source: 'manual' }];
    const l = ledger(events);
    const r = suggest(l);
    expect(r.list.length).toBeGreaterThan(0);
    expect(r.list[0].type).toBe('dayswap');
    expect(r.final.deficitHours).toBeLessThan(r.base.deficitHours);
    // 제안을 실제 일정으로 넣으면 같은 결과
    const applied = ledger([...events, r.list[0].addEvent!]);
    expect(r.list[0].after.deficitHours).toBe(
      Object.entries(applied.weekly)
        .flatMap(([c, w]) => Object.entries(w).filter(([s]) => s !== '창체').map(([s, n]) => Math.max(0, n * 2 - applied.delivered[c][s])))
        .reduce((a, b) => a + b, 0),
    );
  });
});

describe('가져오기', () => {
  const csv = [
    '전체 학반 시간표,,,,,,,,,,,',
    '학반,월,,화,,수,,목,,금,,학반,담임',
    ',1,2,1,2,1,2,1,2,1,2,,',
    '1-1,국어,미술,─▷,수학,영A,창체,국어,수학,영B,국어,1-1,홍길',
    ',가가,나나,,다다,라라,,가가,다다,마마,가가,,',
    '1-2,수학,국어,영A,영B,국어,창체,미술,─▷,수학,국어,1-2,김철',
    ',다다,가가,라라,마마,가가,,나나,,다다,가가,,',
  ].join('\n');

  it('학반별 시간표 붙여넣기', () => {
    const { timetable } = importClassTimetable(csv);
    expect(timetable.days).toEqual([2, 2, 2, 2, 2]);
    expect(timetable.classes).toHaveLength(2);
    expect(timetable.classes[0].homeroom).toBe('홍길');
    // 화1 "─▷"는 앞 칸(월2 미술)을 이어받는다
    expect(timetable.classes[0].week[1][0]).toEqual({ s: '미술', t: '나나' });
    expect(timetable.classes[1].week[3][1]).toEqual({ s: '미술', t: '나나' });
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
    expect(ev[0]).toMatchObject({ title: '2학년 수련회', start: '2026-11-11', end: '2026-11-13' });
    expect(ev[1]).toMatchObject({ title: '진로교육 1-7', start: '2026-11-05' });
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

  it('계산과 제안이 빠르게 끝난다', () => {
    const t0 = performance.now();
    const l = computeLedger(tt, events, s);
    const r = suggest(l);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r.final.score).toBeLessThanOrEqual(r.base.score);
  });
});
