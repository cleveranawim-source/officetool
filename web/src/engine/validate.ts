import { weeklyCounts } from './compute';
import type { Timetable } from './types';
import { WEEKDAYS } from './types';

export interface Issue {
  level: 'error' | 'warn';
  title: string;
  detail: string;
}

/** 시간표 자체의 모순을 찾는다. 계산 전에 먼저 보여줄 것. */
export function validateTimetable(tt: Timetable): Issue[] {
  const issues: Issue[] = [];

  // 1) 같은 교사가 같은 시간에 두 반 (분반 수업 A/B는 다른 교사라 여기 걸리지 않는다)
  const at = new Map<string, string[]>();
  for (const c of tt.classes)
    c.week.forEach((day, wd) =>
      day.forEach((slot, i) => {
        if (!slot?.t) return;
        const key = `${slot.t}|${wd}|${i}`;
        at.set(key, [...(at.get(key) ?? []), `${c.id} ${slot.s}`]);
      }),
    );
  for (const [key, list] of at) {
    if (list.length < 2) continue;
    const [t, wd, i] = key.split('|');
    issues.push({
      level: 'error',
      title: `${t} 교사 중복 배정`,
      detail: `${WEEKDAYS[+wd]}요일 ${+i + 1}교시에 ${list.join(', ')} 두 곳에 배정되어 있습니다. 시간표 원본의 교사 칸을 확인하세요.`,
    });
  }

  // 2) 같은 학년인데 반마다 주당 시수가 다른 과목
  const grades = [...new Set(tt.classes.map((c) => c.grade))];
  for (const g of grades) {
    const cs = tt.classes.filter((c) => c.grade === g);
    const counts = cs.map((c) => ({ id: c.id, w: weeklyCounts(c) }));
    const subjects = new Set(counts.flatMap((c) => Object.keys(c.w)));
    for (const s of subjects) {
      const vals = counts.map((c) => c.w[s] ?? 0);
      if (new Set(vals).size > 1) {
        const detail = counts.map((c) => `${c.id}:${c.w[s] ?? 0}`).join(' ');
        issues.push({ level: 'warn', title: `${g}학년 ${s} 주당 시수가 반마다 다름`, detail });
      }
    }
  }

  // 3) 교사 칸이 빈 교과 수업
  for (const c of tt.classes)
    c.week.forEach((day, wd) =>
      day.forEach((slot, i) => {
        if (slot && !slot.t && slot.s !== '창체')
          issues.push({ level: 'warn', title: `${c.id} 담당 교사 없음`, detail: `${WEEKDAYS[wd]} ${i + 1}교시 ${slot.s}` });
      }),
    );

  return issues;
}
