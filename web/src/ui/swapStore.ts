import { useState } from 'preact/hooks';
import { DEFAULT_SWAP_RULES, type Absence, type Pick, type SwapRules } from '../engine/swap';

/** 시간표 교체(베타) 상태. 이 브라우저에만 저장 */
export interface SwapState {
  rules: SwapRules;
  absences: Absence[];
  /** 고른 결보강. recorded: 이미 기록해 누적에 더한 것 */
  picks: (Pick & { recorded?: boolean })[];
  /** 선생님별 보강 누적 (기록하기로 쌓임) */
  coverCount: Record<string, number>;
  /** 기록한 결보강 안내 줄 */
  history: { at: string; lines: string[] }[];
}

const KEY = 'gyomufit:swap:v1';
const EMPTY: SwapState = { rules: DEFAULT_SWAP_RULES, absences: [], picks: [], coverCount: {}, history: [] };

function load(): SwapState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as SwapState;
      return { ...EMPTY, ...p, rules: { ...DEFAULT_SWAP_RULES, ...p.rules } };
    }
  } catch {
    /* 저장이 막힌 브라우저 */
  }
  return EMPTY;
}

export function useSwapStore() {
  const [s, setS] = useState<SwapState>(load);
  const set = (patch: Partial<SwapState>) =>
    setS((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 이번 화면에서만 */
      }
      return next;
    });
  return { s, set };
}
export type SwapStore = ReturnType<typeof useSwapStore>;
