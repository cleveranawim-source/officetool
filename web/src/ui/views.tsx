import { useMemo, useState } from 'preact/hooks';
import { cpApplies, gradeSpreads, target, type Ledger } from '../engine/compute';
import { diffDays, fmtShort, weekdayIndex } from '../engine/dates';
import { isAcademic } from '../engine/subjects';
import type { Checkpoint } from '../engine/types';
import { WEEKDAYS } from '../engine/types';
import type { Model } from './store';
import { divergingColor, inkOn, lagColor, Panel, Seg, signed, useTip } from './parts';

export type Pick = { cls: string; subject: string } | null;
export type Go = (view: string) => void;

export function nextCheckpoint(l: Ledger, grade?: number): Checkpoint {
  const cps = grade === undefined ? l.checkpoints : checkpointsFor(l, grade);
  return cps.find((c) => c.date > l.settings.today) ?? cps[cps.length - 1];
}

export function checkpointsFor(l: Ledger, grade: number): Checkpoint[] {
  return l.checkpoints.filter((c) => cpApplies(c, grade));
}

function grades(l: Ledger): number[] {
  return [...new Set(l.classes.map((c) => c.grade))].sort();
}

/* ======================= 히트맵 ======================= */

type Mode = 'lag' | 'target';

export function Heatmap({
  l,
  grade,
  mode,
  cp,
  pick,
  onPick,
}: {
  l: Ledger;
  grade: number;
  mode: Mode;
  cp: Checkpoint;
  pick: Pick;
  onPick: (p: Pick) => void;
}) {
  const tip = useTip();
  const classes = l.classes.filter((c) => c.grade === grade);
  const subjects = l.subjectsByGrade[grade].filter(isAcademic);
  const spreads = useMemo(() => {
    const m = new Map<string, { values: Map<string, number>; max: number }>();
    for (const s of gradeSpreads(l, cp).filter((x) => x.grade === grade))
      m.set(s.subject, { values: new Map(s.values.map((v) => [v.cls, v.value])), max: s.max });
    return m;
  }, [l, cp, grade]);

  return (
    <div class="table-wrap">
      <table class="heat">
        <thead>
          <tr>
            <th />
            {subjects.map((s) => (
              <th key={s} scope="col">
                {s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.id}>
              <th scope="row">{c.id}</th>
              {subjects.map((s) => {
                if (!l.weekly[c.id][s])
                  return (
                    <td key={s}>
                      <div class="na" />
                    </td>
                  );
                const got = l.delivered[c.id][s] ?? 0;
                const tgt = target(l, c.id, s);
                const sp = spreads.get(s);
                const at = sp?.values.get(c.id) ?? 0;
                const lag = (sp?.max ?? 0) - at;
                const v = mode === 'lag' ? lag : got - tgt;
                const bg = mode === 'lag' ? lagColor(lag) : divergingColor(v, 2);
                const text = mode === 'lag' ? (lag ? `−${lag}` : '·') : v === 0 ? '0' : signed(v);
                const selected = pick?.cls === c.id && pick.subject === s;
                return (
                  <td key={s}>
                    <button
                      style={{ background: bg, color: mode === 'lag' ? inkOn(lag, 3) : inkOn(v, 5) }}
                      aria-pressed={selected}
                      aria-label={`${c.id} ${s} ${text}`}
                      onClick={() => onPick({ cls: c.id, subject: s })}
                      {...tip(() => (
                        <>
                          <b>
                            {c.id} {s}
                          </b>
                          <br />
                          {cp.date < '9999' ? `${cp.label} 전까지 ${at}시간 (학년 최다 ${sp?.max})` : `학기 ${got}시간 (학년 최다 ${sp?.max})`}
                          <br />
                          편제 {tgt} · 학기 계획 {got} ({signed(got - tgt)})
                        </>
                      ))}
                    >
                      {text}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatLegend({ mode }: { mode: Mode }) {
  if (mode === 'lag')
    return (
      <div class="legend">
        <span>학년에서 가장 많이 한 반보다</span>
        <span class="ramp">
          <span style={{ background: 'var(--mid)' }} />
          <span style={{ background: 'var(--neg-1)' }} />
          <span style={{ background: 'var(--neg-2)' }} />
          <span style={{ background: 'var(--neg-3)' }} />
          <span style={{ background: 'var(--neg-4)' }} />
        </span>
        <span>0 → 4시간 이상 적음</span>
      </div>
    );
  return (
    <div class="legend">
      <span>편제 대비 부족</span>
      <span class="ramp">
        {[4, 3, 2, 1].map((i) => (
          <span key={i} style={{ background: `var(--neg-${i})` }} />
        ))}
        <span style={{ background: 'var(--mid)' }} />
        {[1, 2, 3, 4].map((i) => (
          <span key={i} style={{ background: `var(--pos-${i})` }} />
        ))}
      </span>
      <span>초과 (칸 하나 = 2시간)</span>
    </div>
  );
}

export function MatrixPanel({ l, pick, onPick, initialMode = 'lag' }: { l: Ledger; pick: Pick; onPick: (p: Pick) => void; initialMode?: Mode }) {
  const [grade, setGrade] = useState(grades(l)[0]);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [cpId, setCpId] = useState<string | null>(null);
  const cps = checkpointsFor(l, grade);
  const cp = cps.find((c) => c.id === cpId) ?? nextCheckpoint(l, grade);
  return (
    <Panel
      title="반 × 과목 시수"
      hint={
        mode === 'lag'
          ? `${cp.date < '9999' ? `${cp.label}(${fmtShort(cp.date)}) 전날까지` : '학기 전체'} 누적 시수가 같은 학년 최다 반보다 몇 시간 적은지`
          : `학기 계획 시수 − 편제 목표(주당 × ${l.settings.targetWeeks}주)`
      }
      right={
        <div class="toolbar">
          <Seg label="학년" value={grade} onChange={setGrade} options={grades(l).map((g) => ({ value: g, label: `${g}학년` }))} />
          <Seg
            label="보기"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'lag', label: '반간 격차' },
              { value: 'target', label: '편제 대비' },
            ]}
          />
          {mode === 'lag' && (
            <select class="input" value={cp.id} onChange={(e) => setCpId((e.target as HTMLSelectElement).value)} aria-label="기준 시점">
              {cps.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.date < '9999' ? `${c.label} 전까지` : '학기 전체'}
                </option>
              ))}
            </select>
          )}
        </div>
      }
    >
      <div class="stack">
        <Heatmap l={l} grade={grade} mode={mode} cp={cp} pick={pick} onPick={onPick} />
        <HeatLegend mode={mode} />
      </div>
    </Panel>
  );
}

/* ======================= 대시보드 ======================= */

export function Dashboard({ m, onPick, pick, go }: { m: Model; onPick: (p: Pick) => void; pick: Pick; go: Go }) {
  const l = m.ledger;
  const cp = nextCheckpoint(l);
  // 학년마다 다음 시험이 다를 수 있으므로 학년별 다음 시험 기준 격차를 모은다
  const spreads = useMemo(
    () =>
      grades(l)
        .flatMap((g) => {
          const c = nextCheckpoint(l, g);
          return gradeSpreads(l, c)
            .filter((x) => x.grade === g)
            .map((x) => ({ ...x, cp: c }));
        })
        .sort((a, b) => b.spread - a.spread),
    [l],
  );
  const worst = spreads[0];
  const dday = cp.date < '9999' ? diffDays(l.settings.today, cp.date) : null;
  const baseDays = l.settings.targetWeeks * 5;
  const lowConf = m.events.filter((e) => e.rule.confidence === 'low').length;
  const errors = m.issues.filter((i) => i.level === 'error').length;

  const lossByWd = [0, 0, 0, 0, 0];
  for (const x of l.losses) lossByWd[weekdayIndex(x.date)]++;
  const perClass = lossByWd.map((n) => Math.round((n / l.classes.length) * 10) / 10);
  const maxWd = Math.max(...perClass);

  const alerts: { sev: 'crit' | 'warn' | 'info'; what: string; why: string; act?: { label: string; run: () => void } }[] = [];
  for (const s of spreads.slice(0, 4)) {
    if (s.spread < 2) break;
    const low = s.values.filter((v) => v.value === s.min).map((v) => v.cls);
    alerts.push({
      sev: s.spread >= 4 ? 'crit' : 'warn',
      what: `${s.grade}학년 ${s.subject} 반간 격차 ${s.spread}시간`,
      why: `${s.cp.date < '9999' ? `${s.cp.label} 전까지` : '학기 전체'} ${low.join(', ')}반 ${s.min}시간, 최다 반 ${s.max}시간`,
      act: { label: '근거 보기', run: () => onPick({ cls: low[0], subject: s.subject }) },
    });
  }
  if (m.suggestions.length)
    alerts.push({
      sev: 'info',
      what: `보완안 ${m.suggestions.length}개를 찾았습니다`,
      why: (() => {
        const a = m.suggestions[m.suggestions.length - 1].after;
        const b = m.baseMetrics;
        const lastOf = (x: number[]) => x[x.length - 1];
        const parts = [`부족 시수 ${b.deficitHours} → ${a.deficitHours}`];
        if (a.maxSpread < b.maxSpread) parts.push(`시험 전 최대 격차 ${b.maxSpread} → ${a.maxSpread}`);
        if (lastOf(a.spreadByCheckpoint) < lastOf(b.spreadByCheckpoint)) parts.push(`학기 전체 최대 격차 ${lastOf(b.spreadByCheckpoint)} → ${lastOf(a.spreadByCheckpoint)}`);
        return `모두 적용하면 ${parts.join(', ')}. 어떤 제안도 격차를 늘리지 않습니다.`;
      })(),
      act: { label: '제안 보기', run: () => go('suggest') },
    });
  if (lowConf)
    alerts.push({ sev: 'warn', what: `분류가 불확실한 일정 ${lowConf}건`, why: '시수 반영 여부를 확인해 주세요.', act: { label: '확인하기', run: () => go('calendar') } });
  if (errors)
    alerts.push({ sev: 'crit', what: `시간표 오류 ${errors}건`, why: m.issues.find((i) => i.level === 'error')!.detail, act: { label: '점검 보기', run: () => go('data') } });

  return (
    <>
      <div class="kpis">
        <div class="kpi">
          <span class="label">수업일수 (교과 수업이 있는 날)</span>
          <span class="value num">
            {l.schoolDays}
            <small>일 / 기준 {baseDays}일</small>
          </span>
          <span class="sub">{l.schoolDays < baseDays ? `${baseDays - l.schoolDays}일 부족` : `${l.schoolDays - baseDays}일 여유`}</span>
        </div>
        <div class="kpi">
          <span class="label">다음 시험</span>
          <span class="value num">
            {dday !== null ? `D-${dday}` : '—'}
            <small>{dday !== null ? cp.label : '예정된 시험 없음'}</small>
          </span>
          <span class="sub">{dday !== null ? `${fmtShort(cp.date)} 시작` : '학기 전체 기준으로 봅니다'}</span>
        </div>
        <div class={`kpi ${worst && worst.spread >= 4 ? 'alert' : ''}`}>
          <span class="label">시험 전 최대 반간 격차</span>
          <span class="value num">
            {worst?.spread ?? 0}
            <small>시간</small>
          </span>
          <span class="sub">{worst ? `${worst.grade}학년 ${worst.subject}` : '—'}</span>
        </div>
        <div class="kpi">
          <span class="label">편제보다 부족한 칸 (학기 전체)</span>
          <span class="value num">
            {m.appliedMetrics.deficitCells}
            <small>칸 · {m.appliedMetrics.deficitHours}시간</small>
          </span>
          <span class="sub">반 × 과목 기준, 주당 × {l.settings.targetWeeks}주</span>
        </div>
      </div>

      <div class="grid-main">
          <Panel title="먼저 볼 것">
            <div class="alerts">
              {alerts.length === 0 && <div class="muted">눈에 띄는 불균형이 없습니다.</div>}
              {alerts.map((a, i) => (
                <div class="alert-row" key={i}>
                  <span class={`chip ${a.sev}`}>{a.sev === 'crit' ? '위험' : a.sev === 'warn' ? '주의' : '제안'}</span>
                  <div>
                    <div class="what">{a.what}</div>
                    <div class="why">{a.why}</div>
                  </div>
                  {a.act && (
                    <button class="btn" onClick={a.act.run}>
                      {a.act.label}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="요일별로 빠진 교시" hint="반 하나당 평균. 휴업·행사·시험 모두 포함">
            <WeekdayBars values={perClass} max={maxWd} />
          </Panel>
      </div>
      <MatrixPanel l={l} pick={pick} onPick={onPick} />
    </>
  );
}

function WeekdayBars({ values, max }: { values: number[]; max: number }) {
  const tip = useTip();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: '10px', alignItems: 'end', height: '150px' }}>
      {values.map((v, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
          <span class="num small" style={{ fontWeight: 600 }}>
            {v}
          </span>
          <div
            tabIndex={0}
            {...tip(() => (
              <>
                <b>{WEEKDAYS[i]}요일</b> 반마다 평균 {v}교시가 빠짐
              </>
            ))}
            style={{
              width: '100%',
              maxWidth: '44px',
              height: `${max ? Math.max(3, (v / max) * 100) : 3}px`,
              background: v === max && v > 0 ? 'var(--deficit)' : 'var(--accent)',
              opacity: v === max ? 1 : 0.75,
              borderRadius: '4px 4px 0 0',
            }}
          />
          <span class="small" style={{ color: 'var(--ink-2)', fontWeight: 600 }}>
            {WEEKDAYS[i]}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ======================= 시험 대비 ======================= */

export function Exams({ l, onPick }: { l: Ledger; onPick: (p: Pick) => void }) {
  const tip = useTip();
  const [cpId, setCpId] = useState<string | null>(null);
  const [grade, setGrade] = useState(grades(l)[0]);
  const cps = checkpointsFor(l, grade);
  const cp = cps.find((c) => c.id === cpId) ?? nextCheckpoint(l, grade);
  const rows = useMemo(
    () =>
      gradeSpreads(l, cp)
        .filter((s) => s.grade === grade)
        .sort((a, b) => b.spread - a.spread || a.subject.localeCompare(b.subject, 'ko')),
    [l, cp, grade],
  );
  // 과목마다 시수 규모가 달라 줄마다 자기 범위로 그린다. 격차 비교는 오른쪽 숫자로 한다.

  return (
    <Panel
      title="시험 범위 진도 격차"
      hint="점 하나가 한 반입니다. 빨간 점은 가장 적게 한 반, 파란 점은 가장 많이 한 반입니다."
      right={
        <div class="toolbar">
          <Seg label="학년" value={grade} onChange={setGrade} options={grades(l).map((g) => ({ value: g, label: `${g}학년` }))} />
          <Seg
            label="시험"
            value={cp.id}
            onChange={setCpId}
            options={cps.map((c) => ({ value: c.id, label: c.date < '9999' ? `${c.label} 전` : '학기 전체' }))}
          />
        </div>
      }
    >
      <div class="strip-row small muted" style={{ borderBottom: '1px solid var(--line)' }}>
        <span>과목</span>
        <span>반별 누적 시수</span>
        <span style={{ textAlign: 'right' }}>격차</span>
      </div>
      {rows.map((r) => {
        const pad = 1;
        const a = r.min - pad;
        const b = r.max + pad;
        const pos = (v: number) => `${((v - a) / (b - a)) * 100}%`;
        const lowCls = r.values.filter((v) => v.value === r.min).map((v) => v.cls);
        return (
          <div class="strip-row" key={r.subject}>
            <span class="name">{r.subject}</span>
            <div class="strip">
              <div class="track" />
              {r.spread > 0 && <div class="range" style={{ left: pos(r.min), width: `calc(${pos(r.max)} - ${pos(r.min)})` }} />}
              {r.values.map((v) => (
                <button
                  key={v.cls}
                  class={`pt ${r.spread > 0 && v.value === r.min ? 'low' : r.spread > 0 && v.value === r.max ? 'high' : ''}`}
                  style={{ left: pos(v.value) }}
                  aria-label={`${v.cls} ${r.subject} ${v.value}시간`}
                  onClick={() => onPick({ cls: v.cls, subject: r.subject })}
                  {...tip(() => (
                    <>
                      <b>
                        {v.cls} {r.subject}
                      </b>{' '}
                      {v.value}시간
                      {v.value < r.max ? ` (최다보다 ${r.max - v.value} 적음)` : ''}
                    </>
                  ))}
                />
              ))}
              {r.spread > 0 && (
                <span class="tag" style={{ left: pos(r.min) }}>
                  {lowCls.length > 2 ? `${lowCls[0]} 외 ${lowCls.length - 1}` : lowCls.join(',')} · {r.min}
                </span>
              )}
              {r.spread > 0 && (
                <span class="tag" style={{ left: pos(r.max) }}>
                  {r.max}
                </span>
              )}
            </div>
            <span class="gap num" style={{ color: r.spread >= 4 ? 'var(--deficit)' : r.spread >= 2 ? 'var(--warn)' : 'var(--muted)' }}>
              {r.spread ? `${r.spread}시간` : '없음'}
            </span>
          </div>
        );
      })}
    </Panel>
  );
}

/* ======================= 교사 시수 ======================= */

export function Teachers({ l }: { l: Ledger }) {
  const tip = useTip();
  const [sort, setSort] = useState<'weekly' | 'lost' | 'skew'>('weekly');
  const skew = (t: Ledger['teachers'][number]) => Math.max(...t.byWeekday) / Math.max(1, t.weekly);
  const list = [...l.teachers].sort((a, b) =>
    sort === 'weekly' ? b.weekly - a.weekly : sort === 'lost' ? b.lost / b.weekly - a.lost / a.weekly : skew(b) - skew(a),
  );
  const avg = Math.round((l.teachers.reduce((s, t) => s + t.weekly, 0) / Math.max(1, l.teachers.length)) * 10) / 10;
  const heavy = l.teachers.filter((t) => skew(t) >= 0.4 && t.weekly >= 6);
  const full = l.teachers.filter((t) => t.weekly >= 20).length;

  return (
    <>
      <div class="kpis">
        <div class="kpi">
          <span class="label">수업하는 교사</span>
          <span class="value num">
            {l.teachers.length}
            <small>명</small>
          </span>
          <span class="sub">시간표에 이름이 있는 교사 기준</span>
        </div>
        <div class="kpi">
          <span class="label">평균 주당 시수</span>
          <span class="value num">
            {avg}
            <small>시간</small>
          </span>
          <span class="sub">창체 제외</span>
        </div>
        <div class="kpi">
          <span class="label">주 20시간 이상</span>
          <span class="value num">
            {full}
            <small>명</small>
          </span>
          <span class="sub">최대 {l.teachers[0]?.weekly ?? 0}시간</span>
        </div>
        <div class="kpi">
          <span class="label">한 요일에 40% 이상 몰린 교사</span>
          <span class="value num">
            {heavy.length}
            <small>명</small>
          </span>
          <span class="sub">그 요일 행사 하나에 시수가 크게 빠집니다</span>
        </div>
      </div>
      <Panel
        title="교사별 수업 시수"
        hint={`주당 시수는 시간표 기준, 학기 계획은 학사일정을 반영한 실제 수업 수 (기준 ${l.settings.targetWeeks}주)`}
        right={
          <Seg
            label="정렬"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'weekly', label: '주당 시수' },
              { value: 'lost', label: '빠진 비율' },
              { value: 'skew', label: '요일 편중' },
            ]}
          />
        }
      >
        <div class="table-wrap">
          <table class="t">
            <thead>
              <tr>
                <th>교사</th>
                <th>담당</th>
                <th class="r">주당</th>
                <th>요일 분포</th>
                <th class="r">학기 계획</th>
                <th class="r">빠진 교시</th>
                <th>기준 대비</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => {
                const maxBar = Math.max(...t.byWeekday, 1);
                const ratio = t.delivered / Math.max(1, t.target);
                return (
                  <tr key={t.name}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.name}</td>
                    <td class="small" style={{ color: 'var(--ink-2)' }}>
                      {t.subjects.join('·')} <span class="muted">· {t.classes.length}개 반</span>
                    </td>
                    <td class="r num" style={{ fontWeight: 600 }}>
                      {t.weekly}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }} {...tip(() => <>{t.byWeekday.map((n, i) => `${WEEKDAYS[i]} ${n}`).join(' · ')}</>)} tabIndex={0}>
                        <span class="wk">
                          {t.byWeekday.map((n, i) => (
                            <span key={i} class={n / t.weekly >= 0.4 ? 'heavy' : ''} style={{ height: `${Math.max(2, (n / maxBar) * 26)}px` }} />
                          ))}
                        </span>
                        <span class="wk-lbl">
                          {WEEKDAYS.map((d) => (
                            <span key={d}>{d}</span>
                          ))}
                        </span>
                      </div>
                    </td>
                    <td class="r num">{t.delivered}</td>
                    <td class="r num">
                      {t.lost} <span class="muted small">({Math.round((t.lost / Math.max(1, t.delivered + t.lost)) * 100)}%)</span>
                    </td>
                    <td style={{ minWidth: '120px' }}>
                      <div class="row" style={{ gap: '8px', flexWrap: 'nowrap' }}>
                        <div class="meter" style={{ flex: 1 }}>
                          <i style={{ width: `${Math.min(100, ratio * 90)}%`, background: ratio < 1 ? 'var(--deficit)' : 'var(--accent)' }} />
                          <b style={{ left: '90%' }} />
                        </div>
                        <span class="num small" style={{ color: ratio < 1 ? 'var(--deficit)' : 'var(--ink-2)', width: '34px', textAlign: 'right' }}>
                          {signed(t.delivered - t.target)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
