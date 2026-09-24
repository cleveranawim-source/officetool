import { subjectGroup } from './subjects';
import type { Timetable } from './types';

/**
 * 교사 이름을 "국어1", "수학2"처럼 바꾼다. 교사별 분석은 그대로 되고 실명은 남지 않는다.
 * 번호는 가장 많이 가르치는 교과 안에서 주당 시수가 많은 순서.
 */
export function anonymizeTeachers(tt: Timetable): Timetable {
  const count = new Map<string, Map<string, number>>();
  for (const c of tt.classes)
    for (const day of c.week)
      for (const slot of day) {
        if (!slot?.t) continue;
        const m = count.get(slot.t) ?? new Map<string, number>();
        const g = subjectGroup(slot.s);
        m.set(g, (m.get(g) ?? 0) + 1);
        count.set(slot.t, m);
      }
  const main = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1])[0][0];
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const order = [...count].sort((a, b) => main(a[1]).localeCompare(main(b[1]), 'ko') || total(b[1]) - total(a[1]) || a[0].localeCompare(b[0], 'ko'));
  const seq = new Map<string, number>();
  const alias = new Map<string, string>();
  for (const [name, m] of order) {
    const g = main(m);
    seq.set(g, (seq.get(g) ?? 0) + 1);
    alias.set(name, `${g}${seq.get(g)}`);
  }
  return {
    ...tt,
    classes: tt.classes.map((c) => ({
      ...c,
      homeroom: undefined,
      week: c.week.map((day) => day.map((slot) => ({ ...slot, t: slot.t ? alias.get(slot.t)! : '' }))),
    })),
  };
}
