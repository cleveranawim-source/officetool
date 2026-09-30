import { useMemo, useState } from 'preact/hooks';
import { planConflicts, planStats, type PlanItem, type Terms } from '../engine/planner';
import type { CalEvent } from '../engine/types';

/** 학사일정 짜기 상태. 이 브라우저에만 저장하고, 함께 고칠 때는 구글 시트를 쓴다 */
export interface PlanState {
  /** 작년 학년도 */
  fromYear: number;
  lastEvents?: CalEvent[];
  /** 작년 일정을 어디서 읽었는지 */
  lastLabel?: string;
  lastTerms?: Terms;
  terms?: Terms;
  items?: PlanItem[];
  notes?: string[];
  bridgeOptions?: string[];
  sheetUrl?: string;
  madeAt?: string;
}

const KEY = 'gyomufit:plan:v1';

function defaultYear(): number {
  const d = new Date();
  // 3월 전이면 아직 지난 학년도
  return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
}

function load(): PlanState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PlanState;
  } catch {
    /* 저장이 막힌 브라우저 */
  }
  return { fromYear: defaultYear() };
}

export function usePlanStore() {
  const [s, setS] = useState<PlanState>(load);
  const set = (patch: Partial<PlanState>) =>
    setS((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 용량 초과 등: 이번 화면에서만 */
      }
      return next;
    });
  const reset = () => set({ lastEvents: undefined, lastLabel: undefined, lastTerms: undefined, terms: undefined, items: undefined, notes: undefined, bridgeOptions: undefined, sheetUrl: undefined, madeAt: undefined });
  const stats = useMemo(() => (s.items && s.terms ? planStats(s.items, s.terms) : null), [s.items, s.terms]);
  const conflicts = useMemo(() => (s.items && s.terms ? planConflicts(s.items, s.terms) : new Map<string, string>()), [s.items, s.terms]);
  return { s, set, reset, stats, conflicts };
}
export type PlanStore = ReturnType<typeof usePlanStore>;
