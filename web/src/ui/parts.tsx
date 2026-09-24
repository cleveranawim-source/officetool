import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { EventKind } from '../engine/types';

/* ---------- 아이콘 (선 굵기 1.6, currentColor) ---------- */
const P = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
export const Icon = {
  home: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  cal: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  grid: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  ),
  flag: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  ),
  user: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  ),
  swap: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </svg>
  ),
  data: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  ),
  close: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" {...P}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
};

/** 로고: 주간 시간표 격자에서 한 칸이 채워진 모양 */
export function BrandMark() {
  const cells = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      const on = r === 1 && c === 2;
      const gone = r === 2 && c === 0;
      cells.push(
        <rect
          key={`${r}${c}`}
          x={2 + c * 7}
          y={4 + r * 7}
          width="5.5"
          height="5.5"
          rx="1.4"
          fill={on ? 'var(--accent)' : gone ? 'none' : 'var(--line-strong)'}
          stroke={gone ? 'var(--deficit)' : 'none'}
          stroke-width="1.2"
          stroke-dasharray={gone ? '2 1.5' : undefined}
        />,
      );
    }
  return (
    <svg class="brand-mark" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      {cells}
    </svg>
  );
}

/* ---------- 일정 종류 ---------- */
export const KIND_LABEL: Record<EventKind, string> = {
  holiday: '휴업일',
  vacation: '방학',
  exam: '정기고사',
  fullday: '전일 행사',
  periods: '교시 대체',
  dayswap: '요일 교체',
  periodswap: '교시 교환',
  info: '참고(영향 없음)',
};
export function KindTag({ kind, text }: { kind: EventKind; text?: string }) {
  return (
    <span class="kind">
      <i style={{ background: `var(--k-${kind})` }} />
      {text ?? KIND_LABEL[kind]}
    </span>
  );
}

/* ---------- 색 척도 ---------- */
/** 발산형: 음수(부족) 빨강, 양수(초과) 파랑 */
export function divergingColor(v: number, step = 2): string {
  if (v === 0) return 'var(--mid)';
  const lvl = Math.min(4, Math.ceil(Math.abs(v) / step));
  return v < 0 ? `var(--neg-${lvl})` : `var(--pos-${lvl})`;
}
/** 순차형(뒤처짐): 0이면 중립, 클수록 진한 빨강 */
export function lagColor(v: number): string {
  if (v <= 0) return 'var(--mid)';
  return `var(--neg-${Math.min(4, v)})`;
}
/** 진한 칸 위 글자색 */
export function inkOn(v: number, strongAt: number): string {
  return Math.abs(v) >= strongAt ? '#fff' : 'var(--ink)';
}

/* ---------- 툴팁 ---------- */
type TipState = { x: number; y: number; body: ComponentChildren } | null;
const TipCtx = createContext<(t: TipState) => void>(() => {});
export function TipProvider({ children }: { children: ComponentChildren }) {
  const [tip, setTip] = useState<TipState>(null);
  useEffect(() => {
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, []);
  let style = {};
  if (tip) {
    const left = Math.min(tip.x + 14, window.innerWidth - 270);
    const top = tip.y + 16 + 90 > window.innerHeight ? tip.y - 90 : tip.y + 16;
    style = { left: `${Math.max(8, left)}px`, top: `${top}px` };
  }
  return (
    <TipCtx.Provider value={setTip}>
      {children}
      {tip && (
        <div class="tip" role="tooltip" style={style}>
          {tip.body}
        </div>
      )}
    </TipCtx.Provider>
  );
}
/** onMouseMove/onFocus에 붙일 핸들러 묶음 */
export function useTip() {
  const set = useContext(TipCtx);
  return (body: () => ComponentChildren) => ({
    onMouseMove: (e: MouseEvent) => set({ x: e.clientX, y: e.clientY, body: body() }),
    onMouseLeave: () => set(null),
    onFocus: (e: FocusEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      set({ x: r.left + r.width / 2, y: r.bottom, body: body() });
    },
    onBlur: () => set(null),
  });
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} key={String(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ title, hint, right, children }: { title: string; hint?: ComponentChildren; right?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>{title}</h2>
          {hint && <div class="hint">{hint}</div>}
        </div>
        {right}
      </div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}
