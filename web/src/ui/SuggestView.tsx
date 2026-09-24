import { useState } from 'preact/hooks';
import { fmtShort } from '../engine/dates';
import { remainingDeficits } from '../engine/suggest';
import { inAppsScript, server } from './bridge';
import type { Model } from './store';
import { Panel } from './parts';
import type { Pick } from './views';

export function SuggestView({ m, onPick }: { m: Model; onPick: (p: Pick) => void }) {
  const { suggestions, baseMetrics: b, appliedMetrics: a } = m;
  const applied = new Set(m.p.applied);
  const toggle = (id: string) => m.set({ applied: applied.has(id) ? m.p.applied.filter((x) => x !== id) : [...m.p.applied, id] });
  const deficits = remainingDeficits(m.ledger);
  const [msg, setMsg] = useState('');
  const on = suggestions.filter((s) => applied.has(s.id));
  const planText = on
    .map((s) => (s.addEvent ? `${s.addEvent.start}\t${s.addEvent.title}` : `${s.date}\t${s.title}`))
    .join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planText);
      setMsg('복사했습니다. 학사일정 캘린더에 붙여 넣으세요.');
    } catch {
      setMsg('복사가 막혀 있습니다. 아래 글을 직접 선택해 복사하세요.');
    }
  };
  const push = async () => {
    if (!m.p.calendarId) return setMsg('먼저 데이터 화면에서 캘린더를 연결하세요.');
    try {
      const n = await server.addPlanEvents(m.p.calendarId, on.flatMap((s) => (s.addEvent ? [s.addEvent] : [])));
      setMsg(`캘린더에 ${n}건을 등록했습니다.`);
    } catch (e) {
      setMsg(`등록하지 못했습니다: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div class="kpis">
        <div class="kpi">
          <span class="label">편제보다 부족한 시수 합</span>
          <span class="value num">
            {a.deficitHours}
            <small>시간</small>
          </span>
          <span class="sub">{a.deficitHours !== b.deficitHours ? `적용 전 ${b.deficitHours}시간` : '제안을 켜면 바로 다시 계산합니다'}</span>
        </div>
        <div class={`kpi ${a.maxSpread >= 4 ? 'alert' : ''}`}>
          <span class="label">시험 전 최대 반간 격차</span>
          <span class="value num">
            {a.maxSpread}
            <small>시간</small>
          </span>
          <span class="sub">{a.maxSpread !== b.maxSpread ? `적용 전 ${b.maxSpread}시간` : '중간·기말 전날까지 누적 기준'}</span>
        </div>
        <div class="kpi">
          <span class="label">적용한 제안</span>
          <span class="value num">
            {on.length}
            <small>/ {suggestions.length}개</small>
          </span>
          <span class="sub">원본 캘린더는 바뀌지 않습니다</span>
        </div>
        <div class="kpi">
          <span class="label">남은 보강 필요 칸</span>
          <span class="value num">
            {deficits.length}
            <small>칸</small>
          </span>
          <span class="sub">요일 교체로도 못 채운 부족분</span>
        </div>
      </div>

      <div class="grid-main">
        <Panel
          title="보완 제안"
          hint={`${fmtShort(m.ledger.settings.today)} 이후 일정이 없는 날과 한 교시짜리 행사만 바꿉니다. 전교가 같은 요일 시간표를 쓰므로 교사 겹침이 생기지 않습니다.`}
        >
          {suggestions.length === 0 ? (
            <div class="empty">지금 일정으로는 더 나아지는 교체안이 없습니다.</div>
          ) : (
            <div class="sugg">
              {suggestions.map((s, i) => (
                <article class={`sugg-card ${applied.has(s.id) ? 'on' : ''}`} key={s.id}>
                  <div>
                    <div class="eyebrow">
                      제안 {i + 1} · {s.type === 'dayswap' ? '요일 교체' : '교시 이동'}
                    </div>
                    <h3>{s.title}</h3>
                  </div>
                  <label class="switch act">
                    <input type="checkbox" id={`apply-${s.id}`} checked={applied.has(s.id)} onChange={() => toggle(s.id)} />
                    <span class="track" />
                    {applied.has(s.id) ? '적용함' : '미리 적용'}
                  </label>
                  <p class="why" style={{ margin: 0 }}>
                    {s.why}
                  </p>
                  <div class="delta">
                    <span>
                      부족 시수 <b>{s.before.deficitHours}</b> → <b>{s.after.deficitHours}</b>
                    </span>
                    <span>
                      최대 격차 <b>{s.before.maxSpread}</b> → <b>{s.after.maxSpread}</b>
                    </span>
                  </div>
                  <div class="effects">
                    {s.highlights.map((h) => {
                      const mt = h.match(/^(\d-\d+) (\S+) \+/);
                      return mt ? (
                        <button key={h} class="chip good" style={{ border: 0, cursor: 'pointer' }} onClick={() => onPick({ cls: mt[1], subject: mt[2] })}>
                          {h}
                        </button>
                      ) : (
                        <span key={h} class="chip plain">
                          {h}
                        </span>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <div class="stack">
          <Panel title="캘린더에 옮기기" hint="적용한 제안을 학사일정에 등록하면 다음 계산부터 반영됩니다.">
            {on.length === 0 ? (
              <div class="muted small">켠 제안이 없습니다.</div>
            ) : (
              <div class="stack">
                <textarea class="input" id="plan-text" rows={Math.min(6, on.length + 1)} readOnly value={planText} />
                <div class="row">
                  <button class="btn" onClick={copy}>
                    복사
                  </button>
                  {inAppsScript() && (
                    <button class="btn primary" onClick={push}>
                      캘린더에 등록
                    </button>
                  )}
                </div>
                {msg && <div class="small" style={{ color: 'var(--ink-2)' }}>{msg}</div>}
              </div>
            )}
          </Panel>
          <Panel title="보강이 필요한 칸" hint="부족 시수가 큰 순서. 누르면 근거를 봅니다.">
            <div class="table-wrap" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              <table class="t">
                <thead>
                  <tr>
                    <th>반</th>
                    <th>과목</th>
                    <th class="r">계획/목표</th>
                    <th class="r">부족</th>
                  </tr>
                </thead>
                <tbody>
                  {deficits.slice(0, 60).map((d) => (
                    <tr key={`${d.cls}${d.subject}`} style={{ cursor: 'pointer' }} onClick={() => onPick({ cls: d.cls, subject: d.subject })}>
                      <td class="num">{d.cls}</td>
                      <td>{d.subject}</td>
                      <td class="r num">
                        {d.delivered}/{d.target}
                      </td>
                      <td class="r num" style={{ color: 'var(--deficit)', fontWeight: 600 }}>
                        −{d.short}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
