import { parseDateCell } from './eventList';
import { classifyTitle } from './parseEvents';
import type { PlanItem, PlanStatus } from './planner';

/**
 * 1차안 ↔ 구글 시트. 교사들이 시트에서 날짜·이름을 고치면 다시 읽어 점검한다.
 * "번호" 칸으로 원래 일정과 맞추고, 번호가 없는 줄은 새 일정으로 본다.
 */
export const PLAN_HEADER = ['날짜', '끝 날짜', '일정', '상태', '근거', '작년 날짜', '번호'] as const;

export const STATUS_LABEL: Record<PlanStatus, string> = {
  ok: '기준대로',
  moved: '옮김',
  check: '확인 필요',
  suggested: '새 제안',
};

export function planToRows(items: PlanItem[]): string[][] {
  return [
    [...PLAN_HEADER],
    ...items.map((i) => [
      i.start,
      i.end !== i.start ? i.end : '',
      i.title,
      STATUS_LABEL[i.status],
      i.status === 'ok' ? i.anchor : i.reason,
      i.from ? (i.from.end !== i.from.start ? `${i.from.start}~${i.from.end}` : i.from.start) : '',
      i.id,
    ]),
  ];
}

/** CSV (구글 시트 "파일 → 가져오기"나 엑셀에서 바로 열림) */
export function toCSV(rows: string[][]): string {
  const cell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  // 엑셀이 한글을 깨뜨리지 않게 BOM
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/**
 * 시트에서 고친 표를 읽어 1차안에 반영한다.
 * - 번호가 맞는 줄: 날짜·이름을 바꾸고 상태를 "기준대로"로 (교사가 정한 것)
 * - 번호가 없는 줄: 새 일정
 * - 시트에서 지운 번호: 목록에서 뺀다
 */
export function applyPlanRows(items: PlanItem[], rows: string[][], year: number): { items: PlanItem[]; changed: number; added: number; removed: number } {
  const head = rows.findIndex((r) => r.some((c) => c.trim() === '일정') && r.some((c) => c.trim() === '날짜'));
  if (head < 0) throw new Error('"날짜"와 "일정" 머리글이 있는 표가 아닙니다. 내려받은 1차안 시트를 고쳐서 올려 주세요.');
  const col = (name: string) => rows[head].findIndex((c) => c.trim() === name);
  const [cDate, cEnd, cTitle, cId] = [col('날짜'), col('끝 날짜'), col('일정'), col('번호')];
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: PlanItem[] = [];
  let changed = 0;
  let added = 0;
  let n = 0;
  for (const r of rows.slice(head + 1)) {
    const title = (r[cTitle] ?? '').trim();
    const dateCell = (r[cDate] ?? '').trim();
    if (!title || !dateCell) continue;
    const endCell = cEnd >= 0 ? (r[cEnd] ?? '').trim() : '';
    const ev = parseDateCell(endCell ? `${dateCell}~${endCell}` : dateCell, year);
    if (!ev) continue;
    const id = cId >= 0 ? (r[cId] ?? '').trim() : '';
    const old = id ? byId.get(id) : undefined;
    if (old) {
      seen.add(id);
      if (old.start !== ev.start || old.end !== ev.end || old.title !== title) {
        changed++;
        const rule = classifyTitle(title);
        out.push({ ...old, title, start: ev.start, end: ev.end, kind: rule.kind, grades: rule.grades, status: 'ok', reason: '시트에서 고침', anchor: '교사가 정함', alternatives: undefined });
      } else out.push(old);
    } else {
      added++;
      const rule = classifyTitle(title);
      out.push({ id: `s${++n}-${ev.start}`, title, start: ev.start, end: ev.end, kind: rule.kind, grades: rule.grades, anchor: '교사가 더함', status: 'ok', reason: '시트에서 더함' });
    }
  }
  // 번호 칸이 없으면 표 전체를 새 1차안으로 본다
  const removed = items.filter((i) => !seen.has(i.id)).length;
  return { items: out.sort((a, b) => a.start.localeCompare(b.start)), changed, added, removed };
}
