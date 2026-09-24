import { useEffect } from 'preact/hooks';
import { cumulative, deliveredBefore, lossesFor, target, type Ledger } from '../engine/compute';
import { fmtShort } from '../engine/dates';
import { Icon, KindTag, signed } from './parts';

/** 한 반·한 과목의 시수 근거: 어떤 날 어떤 일정 때문에 빠졌는지 */
export function CellDrawer({ l, cls, subject, onClose }: { l: Ledger; cls: string; subject: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const c = l.classes.find((x) => x.id === cls)!;
  const weekly = l.weekly[cls][subject] ?? 0;
  const tgt = target(l, cls, subject);
  const got = l.delivered[cls][subject] ?? 0;
  const losses = lossesFor(l, cls, subject);
  const swaps = l.swaps.filter((s) => s.cls === cls && (s.added.includes(subject) || s.removed.includes(subject)));
  const peers = l.classes.filter((x) => x.grade === c.grade && l.weekly[x.id][subject]);
  const cps = l.checkpoints.filter((x) => x.date !== '9999-12-31');
  const slots = c.week.flatMap((day, wd) => day.map((s, i) => ({ s, wd, p: i + 1 }))).filter((x) => x.s.s === subject);
  const WD = ['월', '화', '수', '목', '금'];

  return (
    <>
      <div class="drawer-back" onClick={onClose} />
      <aside class="drawer" role="dialog" aria-modal="true" aria-label={`${cls} ${subject} 상세`}>
        <div class="drawer-head">
          <div>
            <div class="eyebrow">{c.homeroom ? `${cls} · 담임 ${c.homeroom}` : cls}</div>
            <h2>{subject}</h2>
            <div class="small muted">
              주 {weekly}시간 · {slots.map((x) => `${WD[x.wd]}${x.p}`).join(' ')}
              {slots[0]?.s.t ? ` · ${[...new Set(slots.map((x) => x.s.t))].join(', ')}` : ''}
            </div>
          </div>
          <button class="btn ghost" onClick={onClose} aria-label="닫기">
            <Icon.close />
          </button>
        </div>
        <div class="drawer-body">
          <div class="stats">
            <div>
              <span>편제 목표</span>
              <b>{tgt}</b>
            </div>
            <div>
              <span>학기 계획</span>
              <b>{got}</b>
            </div>
            <div>
              <span>차이</span>
              <b style={{ color: got < tgt ? 'var(--deficit)' : got > tgt ? 'var(--surplus)' : undefined }}>{signed(got - tgt)}</b>
            </div>
            <div>
              <span>빠진 교시</span>
              <b>{losses.length}</b>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: '14px', marginBottom: '6px' }}>누적 시수</h3>
            <CumChart l={l} cls={cls} subject={subject} peers={peers.map((x) => x.id)} />
            <div class="legend" style={{ marginTop: '4px' }}>
              <span>
                <i class="dot" style={{ background: 'var(--accent)' }} />
                {cls}
              </span>
              <span>
                <i class="dot" style={{ background: 'var(--line-strong)' }} />
                같은 학년 다른 반
              </span>
              {cps.length > 0 && <span>세로선: 시험 시작일</span>}
            </div>
          </div>

          {cps.length > 0 && (
            <div>
              <h3 style={{ fontSize: '14px', marginBottom: '6px' }}>시험 전까지 반별 비교</h3>
              <table class="t">
                <thead>
                  <tr>
                    <th>시험</th>
                    <th class="r">이 반</th>
                    <th class="r">학년 최다</th>
                    <th class="r">격차</th>
                  </tr>
                </thead>
                <tbody>
                  {cps.map((cp) => {
                    const mine = deliveredBefore(l, cls, subject, cp.date);
                    const max = Math.max(...peers.map((x) => deliveredBefore(l, x.id, subject, cp.date)));
                    return (
                      <tr key={cp.id}>
                        <td>
                          {cp.label} <span class="muted small">{fmtShort(cp.date)}</span>
                        </td>
                        <td class="r num">{mine}</td>
                        <td class="r num">{max}</td>
                        <td class="r num" style={{ color: mine < max ? 'var(--deficit)' : undefined }}>
                          {mine - max === 0 ? '—' : mine - max}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 style={{ fontSize: '14px', marginBottom: '6px' }}>빠진 교시 근거</h3>
            {losses.length === 0 && swaps.length === 0 ? (
              <div class="muted small">빠진 교시가 없습니다.</div>
            ) : (
              <table class="t">
                <tbody>
                  {losses.map((x, i) => (
                    <tr key={i}>
                      <td class="num small" style={{ whiteSpace: 'nowrap' }}>
                        {fmtShort(x.date)} {x.period}교시
                      </td>
                      <td>{x.eventTitle}</td>
                      <td class="r">
                        <KindTag kind={x.kind} />
                      </td>
                    </tr>
                  ))}
                  {swaps.map((x, i) => {
                    const n = x.added.filter((s) => s === subject).length - x.removed.filter((s) => s === subject).length;
                    if (!n) return null;
                    return (
                      <tr key={`s${i}`}>
                        <td class="num small">{fmtShort(x.date)}</td>
                        <td>{x.eventTitle}</td>
                        <td class="r num" style={{ color: n > 0 ? 'var(--good)' : 'var(--deficit)' }}>
                          {signed(n)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function CumChart({ l, cls, subject, peers }: { l: Ledger; cls: string; subject: string; peers: string[] }) {
  const W = 420;
  const H = 170;
  const pad = { l: 30, r: 10, t: 8, b: 22 };
  const series = peers.map((id) => ({ id, v: cumulative(l, id, subject) }));
  const n = l.days.length;
  const max = Math.max(1, ...series.flatMap((s) => s.v), target(l, cls, subject));
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const path = (v: number[]) => v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join('');
  const ticks = [0, Math.round(max / 2), max];
  const months = l.days.map((d, i) => ({ i, d: d.date })).filter((d, i, a) => i === 0 || d.d.slice(5, 7) !== a[i - 1].d.slice(5, 7));
  const tgt = target(l, cls, subject);
  const cps = l.checkpoints.filter((c) => c.date !== '9999-12-31');
  const mine = series.find((s) => s.id === cls)!;
  const todayIdx = l.days.findIndex((d) => d.date > l.settings.today);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${cls} ${subject} 누적 시수 그래프`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" stroke-width="1" />
          <text x={pad.l - 6} y={y(t) + 4} text-anchor="end" font-size="10">
            {t}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(tgt)} y2={y(tgt)} stroke="var(--ink-2)" stroke-dasharray="3 3" stroke-width="1" />
      <text x={W - pad.r} y={y(tgt) - 4} text-anchor="end" font-size="10">
        목표 {tgt}
      </text>
      {cps.map((c) => {
        const i = l.days.findIndex((d) => d.date >= c.date);
        return i < 0 ? null : <line key={c.id} x1={x(i)} x2={x(i)} y1={pad.t} y2={H - pad.b} stroke="var(--k-exam)" stroke-width="1" opacity="0.6" />;
      })}
      {todayIdx > 0 && <rect x={x(todayIdx)} y={pad.t} width={W - pad.r - x(todayIdx)} height={H - pad.t - pad.b} fill="var(--surface-2)" opacity="0.6" />}
      {series
        .filter((s) => s.id !== cls)
        .map((s) => (
          <path key={s.id} d={path(s.v)} fill="none" stroke="var(--line-strong)" stroke-width="1.5" />
        ))}
      <path d={path(mine.v)} fill="none" stroke="var(--accent)" stroke-width="2.2" />
      <circle cx={x(n - 1)} cy={y(mine.v[n - 1] ?? 0)} r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" />
      {months.map((m) => (
        <text key={m.i} x={x(m.i)} y={H - 6} font-size="10">
          {Number(m.d.slice(5, 7))}월
        </text>
      ))}
    </svg>
  );
}
