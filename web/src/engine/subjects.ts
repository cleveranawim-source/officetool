/** 화면에 과목을 늘어놓는 순서. 목록에 없는 과목은 뒤에 가나다순으로 붙는다. */
const ORDER = [
  '국어', '수학', '영어', '영A', '영B', '사회', '사A', '사B', '역사', '역A', '역B', '도덕',
  '과학', '과A', '과B', '기술', '가정', '정보', '체육', '체A', '체B', '운동', '음악', '미술',
  '중국', '종교', '진로', '창체',
];

export function subjectRank(s: string): number {
  const i = ORDER.indexOf(s);
  return i === -1 ? ORDER.length : i;
}

export function sortSubjects(list: Iterable<string>): string[] {
  return [...new Set(list)].sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b, 'ko'));
}

/** 분반 과목(영A·영B 등)을 묶는 교과명 */
export function subjectGroup(s: string): string {
  const m: Record<string, string> = { 영: '영어', 사: '사회', 역: '역사', 과: '과학', 체: '체육' };
  if (/^[영사역과체][AB]$/.test(s)) return m[s[0]];
  return s;
}

/** 창체는 교과 시수 비교에서 뺀다 */
export function isAcademic(s: string): boolean {
  return s !== '창체';
}
