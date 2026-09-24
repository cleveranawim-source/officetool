import { useMemo, useState } from 'preact/hooks';
import { addDays, fmtRange, fmtShort, weekdayIndex } from '../engine/dates';
import type { EventKind, ParsedEvent } from '../engine/types';
import { WEEKDAYS } from '../engine/types';
import type { Model } from './store';
import { KIND_LABEL, KindTag, Panel, useTip } from './parts';

const KINDS: EventKind[] = ['holiday', 'vacation', 'exam', 'fullday', 'periods', 'dayswap', 'periodswap', 'info'];

export function CalendarView({ m }: { m: Model }) {
  const l = m.ledger;
  const tip = useTip();
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'check'>('all');

  const byDate = useMemo(() => new Map(l.days.map((d) => [d.date, d])), [l]);
  const months = useMemo(() => {
    const out: { key: string; label: string; cells: (string | null)[] }[] = [];
    let cur = l.settings.termStart.slice(0, 7);
    const last = l.settings.termEnd.slice(0, 7);
    while (cur <= last) {
      const first = `${cur}-01`;
      const cells: (string | null)[] = [];
      const lead = weekdayIndex(first);
      if (lead < 5) for (let i = 0; i < lead; i++) cells.push(null);
      for (let d = first; d.slice(0, 7) === cur; d = addDays(d, 1)) if (weekdayIndex(d) < 5) cells.push(d);
      out.push({ key: cur, label: `${Number(cur.slice(5))}월`, cells });
      const [y, mo] = cur.split('-').map(Number);
      cur = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
    return out;
  }, [l.settings.termStart, l.settings.termEnd]);

  const events = [...m.events]
    .filter((e) => e.end >= l.settings.termStart && e.start <= l.settings.termEnd)
    .filter((e) => filter === 'all' || e.rule.confidence === 'low')
    .sort((a, b) => a.start.localeCompare(b.start));

  const setKind = (e: ParsedEvent, kind: EventKind) => {
    const overrides = { ...m.p.overrides };
    if (kind === e.rule.kind && !overrides[e.id]) return;
    overrides[e.id] = { kind, label: KIND_LABEL[kind] };
    m.set({ overrides });
  };
  const resetKind = (id: string) => {
    const overrides = { ...m.p.overrides };
    delete overrides[id];
    m.set({ overrides });
  };

  const day = sel ? byDate.get(sel) : null;
  const dayLoss = useMemo(() => {
    if (!sel) return [];
    const g = new Map<string, { n: number; subjects: Map<string, number> }>();
    for (const x of l.losses) {
      if (x.date !== sel) continue;
      const k = x.eventTitle;
      const cur = g.get(k) ?? { n: 0, subjects: new Map() };
      cur.n++;
      cur.subjects.set(x.subject, (cur.subjects.get(x.subject) ?? 0) + 1);
      g.set(k, cur);
    }
    return [...g];
  }, [l, sel]);

  return (
    <div class="grid-main">
      <Panel
        title="학사일정 달력"
        hint="칸 아래 막대는 그날 걸린 일정 종류, 빗금은 전교 휴업일입니다. 날짜를 누르면 빠지는 수업을 봅니다."
      >
        <div class="stack">
          <div class="legend">
            {KINDS.filter((k) => k !== 'info').map((k) => (
              <KindTag key={k} kind={k} />
            ))}
          </div>
          <div class="months">
            {months.map((mo) => (
              <div class="month" key={mo.key}>
                <h3>{mo.label}</h3>
                <div class="cal">
                  {WEEKDAYS.map((w) => (
                    <div class="wd" key={w}>
                      {w}
                    </div>
                  ))}
                  {mo.cells.map((d, i) => {
                    if (!d) return <div class="day out" key={`o${i}`} />;
                    const info = byDate.get(d);
                    const inTerm = !!info;
                    const evs = info?.events ?? [];
                    const kinds = [...new Set(evs.map((e) => e.rule.kind))];
                    return (
                      <button
                        key={d}
                        class={`day ${info?.off ? 'off' : ''} ${d === l.settings.today ? 'today' : ''}`}
                        style={inTerm ? undefined : { opacity: 0.35 }}
                        aria-pressed={sel === d}
                        onClick={() => setSel(d)}
                        {...tip(() => (
                          <>
                            <b>{fmtShort(d)}</b>
                            {evs.length ? evs.map((e) => <div key={e.id}>{e.title}</div>) : <div>일정 없음</div>}
                            {info && info.lostPeriods > 0 && <div>빠지는 교시 {info.lostPeriods}개 (전 학급 합)</div>}
                          </>
                        ))}
                      >
                        <span class="d">{Number(d.slice(8))}</span>
                        {evs[0] && <span class="lbl">{evs[0].title}</span>}
                        {kinds.length > 0 && (
                          <span class="bar">
                            {kinds.map((k) => (
                              <i key={k} style={{ background: `var(--k-${k})` }} />
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div class="stack">
        {day && (
          <Panel title={`${fmtShort(day.date)} 수업 변화`} right={<button class="btn ghost" onClick={() => setSel(null)}>닫기</button>}>
            {dayLoss.length === 0 ? (
              <div class="muted">빠지는 수업이 없습니다.</div>
            ) : (
              <div class="stack">
                {dayLoss.map(([title, g]) => (
                  <div key={title}>
                    <div class="row" style={{ justifyContent: 'space-between' }}>
                      <strong>{title}</strong>
                      <span class="num small muted">{g.n}교시</span>
                    </div>
                    <div class="small" style={{ color: 'var(--ink-2)' }}>
                      {[...g.subjects]
                        .sort((a, b) => b[1] - a[1])
                        .map(([s, n]) => `${s} ${n}`)
                        .join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
        <Panel
          title="일정 분류 확인"
          hint="제목을 읽어 자동으로 나눴습니다. 틀린 것은 오른쪽에서 바로 고치세요."
          right={
            <select class="input" value={filter} onChange={(e) => setFilter((e.target as HTMLSelectElement).value as 'all' | 'check')} aria-label="보기">
              <option value="all">전체 {m.events.length}건</option>
              <option value="check">확인 필요만</option>
            </select>
          }
        >
          <div class="ev-list">
            {events.length === 0 && <div class="muted">확인할 일정이 없습니다.</div>}
            {events.map((e) => (
              <div class="ev" key={e.id}>
                <span class="date">{fmtRange(e.start, e.end)}</span>
                <div>
                  <div class="title">
                    {e.title} {e.source === 'auto' && <span class="chip plain">공휴일 자동</span>}
                    {e.source === 'plan' && <span class="chip good">제안 적용</span>}
                    {e.rule.confidence === 'low' && <span class="chip warn">확인 필요</span>}
                  </div>
                  <div class="reason">
                    {describeRule(e)} · {e.rule.reason}
                  </div>
                </div>
                <div class="row" style={{ gap: '4px' }}>
                  <select class="input" value={e.rule.kind} onChange={(ev) => setKind(e, (ev.target as HTMLSelectElement).value as EventKind)} aria-label={`${e.title} 분류`}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  {m.p.overrides[e.id] && (
                    <button class="btn ghost small" onClick={() => resetKind(e.id)} title="자동 분류로 되돌리기">
                      되돌리기
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function describeRule(e: ParsedEvent): string {
  const r = e.rule;
  const who = r.classes ? r.classes.join(', ') : r.grades ? `${r.grades.join('·')}학년` : '전교';
  const when = r.periods ? (r.periods.length === 1 ? `${r.periods[0]}교시` : `${r.periods[0]}~${r.periods[r.periods.length - 1]}교시`) : '';
  if (r.kind === 'dayswap') return `${who} ${WEEKDAYS[r.swapTo ?? 0]}요일 시간표`;
  if (r.kind === 'periodswap') return `${who} ${r.swap?.[0]}교시↔${r.swap?.[1]}교시`;
  if (r.kind === 'info') return '시수에 반영 안 함';
  return [who, when, KIND_LABEL[r.kind]].filter(Boolean).join(' ');
}
