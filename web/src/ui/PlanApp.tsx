import { useMemo, useState } from 'preact/hooks';
import { samplePlanEvents } from '../data/samplePlanEvents';
import { addDays, diffDays, eachDay, fmtShort, weekdayIndex } from '../engine/dates';
import { describeEventTable, readEventTable } from '../engine/eventTable';
import { holidayName, HOLIDAYS_UNTIL, publicHolidays } from '../engine/holidays';
import { toICS } from '../engine/ics';
import { applyOps, CHECK_REQUEST, checkOps, planContext, type CheckedOp } from '../engine/planAI';
import { applyPlanRows, PLAN_HEADER, planToRows, STATUS_LABEL, toCSV } from '../engine/planSheet';
import { detectTerms, LEGAL_MIN_DAYS, makePlan, suggestTerms, type PlanItem, type PlanStatus, type Terms } from '../engine/planner';
import { WEEKDAYS, type CalEvent } from '../engine/types';
import { askPlanAI, loadAIKey, saveAIKey } from './aiClient';
import { inAppsScript, server } from './bridge';
import { download, readEventsFile, readRowsFile } from './files';
import { NeisPanel } from './NeisPanel';
import { Panel, Seg } from './parts';
import { usePlanStore, type PlanStore } from './planStore';
import type { Model } from './store';
import { AppSwitch, SuiteBrand } from './suite';

type View = 'import' | 'basics' | 'draft';

const STEPS: { id: View; label: string; title: string; desc: string }[] = [
  { id: 'import', label: '1. 작년 일정', title: '작년 학사일정 넣기', desc: '작년 한 해 일정을 넣으면, 일정마다 무엇에 맞춰 잡힌 날인지 읽어 새 학년도로 옮깁니다.' },
  { id: 'basics', label: '2. 새 학년도 기본', title: '새 학년도 기본값', desc: '학기 첫날과 마지막 날을 정합니다. 작년 날짜에서 추정한 값이 들어 있습니다.' },
  { id: 'draft', label: '3. 1차안 검토', title: '학사일정 1차안', desc: '확인이 필요한 일정부터 봅니다. 날짜를 바꾸면 수업일수와 겹침을 바로 다시 셉니다.' },
];

const TERM_FIELDS: { key: keyof Terms; label: string }[] = [
  { key: 'sem1Start', label: '1학기 첫날 (개학·입학)' },
  { key: 'sem1End', label: '1학기 마지막 날 (방학식)' },
  { key: 'sem2Start', label: '2학기 첫날 (개학)' },
  { key: 'sem2End', label: '2학기 마지막 날 (종업식)' },
];

export function PlanApp({ m }: { m: Model }) {
  const ps = usePlanStore();
  const { s } = ps;
  const [view, setView] = useState<View>(s.items ? 'draft' : s.lastEvents ? 'basics' : 'import');
  const step = STEPS.find((x) => x.id === view)!;
  const go = (v: View) => {
    setView(v);
    window.scrollTo(0, 0);
  };
  const enabled = (v: View) => v === 'import' || (v === 'basics' && !!s.lastEvents) || (v === 'draft' && !!s.items);

  return (
    <div class="shell">
      <aside class="side">
        <SuiteBrand sub="교무업무 도구" />
        <AppSwitch current="plan" />
        <nav class="nav" aria-label="학사일정 짜기 단계">
          {STEPS.map((x) => (
            <button key={x.id} aria-current={x.id === view ? 'page' : undefined} disabled={!enabled(x.id)} onClick={() => go(x.id)}>
              {x.label}
              {x.id === 'draft' && s.items && ps.conflicts.size + s.items.filter((i) => i.status === 'check').length > 0 && (
                <span class="count">{new Set([...ps.conflicts.keys(), ...s.items.filter((i) => i.status === 'check').map((i) => i.id)]).size}</span>
              )}
            </button>
          ))}
        </nav>
        <div class="side-foot">
          <div>
            <strong>
              {s.fromYear}학년도 → {s.fromYear + 1}학년도
            </strong>
          </div>
          {s.lastLabel && (
            <div>
              작년 일정: {s.lastLabel} · {s.lastEvents?.length ?? 0}건
            </div>
          )}
          {s.items && <div>1차안 {s.items.length}건</div>}
        </div>
      </aside>

      <main class="main">
        <header class="page-head">
          <div>
            <div class="eyebrow">학사일정 짜기 · {s.fromYear + 1}학년도</div>
            <h1>{step.title}</h1>
            <p>{step.desc}</p>
          </div>
        </header>
        {view === 'import' && <ImportStep ps={ps} onDone={() => go('basics')} />}
        {view === 'basics' && <BasicsStep ps={ps} onDone={() => go('draft')} />}
        {view === 'draft' && s.items && s.terms && <DraftStep ps={ps} m={m} onRestart={() => go('import')} />}
      </main>
    </div>
  );
}

/* ---------- 1. 작년 일정 ---------- */

function ImportStep({ ps, onDone }: { ps: PlanStore; onDone: () => void }) {
  const { s, set } = ps;
  const [src, setSrc] = useState<'file' | 'paste' | 'neis' | 'sample'>('file');
  const [paste, setPaste] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const from = `${s.fromYear}-03-01`;
  const to = addDays(`${s.fromYear + 1}-03-01`, -1);
  const inYear = (e: CalEvent) => e.end >= from && e.start <= to;

  const take = (events: CalEvent[], label: string, text?: string) => {
    const ev = events.filter(inYear);
    if (!ev.length) {
      setErr(`${s.fromYear}학년도(${fmtShort(from)} ~ ${fmtShort(to)}) 일정을 찾지 못했습니다. 위에서 학년도를 확인하세요.`);
      return;
    }
    setErr('');
    setNote(text ?? '');
    set({ lastEvents: ev, lastLabel: label, lastTerms: detectTerms(ev, s.fromYear), terms: undefined, items: undefined, sheetUrl: undefined });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await readEventsFile(f, { year: s.fromYear, semester: 1, wholeYear: true, termEnd: to });
      take(r.events, f.name, r.format === 'ics' ? undefined : describeEventTable(r.format, r.events.length, r.events.filter(inYear).length, r.days));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div class="grid-2">
      <div class="stack">
        <Panel title="작년 학사일정">
          <div class="stack">
            <label class="field" style={{ maxWidth: '240px' }}>
              작년 학년도
              <select class="input" id="plan-year" value={s.fromYear} onChange={(e) => set({ fromYear: Number((e.target as HTMLSelectElement).value), lastEvents: undefined, items: undefined })}>
                {[2025, 2026].map((y) => (
                  <option key={y} value={y}>
                    {y}학년도 → {y + 1}학년도 짜기
                  </option>
                ))}
              </select>
            </label>
            <Seg
              label="작년 일정 가져오기"
              value={src}
              onChange={(v) => {
                setSrc(v);
                setErr('');
              }}
              options={[
                { value: 'file', label: '파일' },
                { value: 'paste', label: '붙여넣기' },
                { value: 'neis', label: 'NEIS' },
                { value: 'sample', label: '예시로 해 보기' },
              ]}
            />
            {src === 'file' && (
              <label class="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), onFile(e.dataTransfer?.files[0]))}>
                <input type="file" id="plan-file" accept=".ics,text/calendar,.xlsx,.csv,.tsv,.txt" onChange={(e) => onFile((e.target as HTMLInputElement).files?.[0])} />
                <b>작년 학사일정 파일 올리기</b>
                <span>구글 캘린더 .ics, 학사일정 시트 .xlsx (목록형·달력형)</span>
              </label>
            )}
            {src === 'paste' && (
              <div class="stack">
                <textarea
                  class="input"
                  id="plan-paste"
                  rows={7}
                  value={paste}
                  onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
                  placeholder={'시트에서 복사한 학사일정 표 (목록형이나 달력형)\n2026-04-27~29\t(2,3학년) 중간고사\n2026-04-30\t체육대회'}
                />
                <button
                  class="btn"
                  style={{ alignSelf: 'flex-start' }}
                  disabled={!paste.trim()}
                  onClick={() => {
                    const r = readEventTable(paste, { year: s.fromYear, semester: 1, wholeYear: true });
                    take(r.events, '붙여넣은 표', describeEventTable(r.format, r.events.length, r.events.filter(inYear).length, r.days));
                  }}
                >
                  표 읽기
                </button>
              </div>
            )}
            {src === 'neis' && (
              <NeisPanel
                mode="schedule"
                defaultName=""
                termStart={from}
                termEnd={to}
                onEvents={(events, school, text) => take(events, `NEIS ${school.name}`, text)}
              />
            )}
            {src === 'sample' && (
              <div class="stack">
                <p class="small muted" style={{ margin: 0 }}>
                  가상 중학교의 2026학년도 학사일정(행사 {samplePlanEvents.length}건)으로 1차안이 어떻게 나오는지 봅니다. 공휴일은 실제 날짜입니다.
                </p>
                <button
                  class="btn primary"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={() => {
                    set({ fromYear: 2026, lastEvents: samplePlanEvents, lastLabel: '예시 학교', lastTerms: detectTerms(samplePlanEvents, 2026), terms: undefined, items: undefined });
                    setErr('');
                    setNote('');
                  }}
                >
                  예시 일정 불러오기
                </button>
              </div>
            )}
            {err && (
              <div class="banner" role="alert">
                <span>{err}</span>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div class="stack">
        {s.lastEvents ? (
          <Panel title="읽은 일정" hint={s.lastLabel}>
            <div class="stack">
              {note && <div class="small">{note}</div>}
              <LastSummary events={s.lastEvents} terms={s.lastTerms} />
              <button class="btn primary" style={{ alignSelf: 'flex-start' }} onClick={onDone}>
                다음: 새 학년도 기본값
              </button>
            </div>
          </Panel>
        ) : (
          <Panel title="이렇게 옮깁니다">
            <ul class="plan-how">
              <li>
                <b>학기 첫날·마지막 날</b> 일정은 새 학년도 첫날·마지막 날로
              </li>
              <li>
                <b>"4월 넷째 주 월~수 중간고사"</b>처럼 몇째 주 무슨 요일을 지켜서
              </li>
              <li>
                <b>시험 다음 날 체육대회</b>처럼 붙어 있던 일정은 시험을 따라서
              </li>
              <li>
                <b>징검다리 재량휴업일</b>은 작년 날짜 대신 새해 징검다리를 다시 찾아서
              </li>
              <li>
                <b>공휴일과 겹치면</b> 가까운 날 후보를 내고 "확인 필요"로 남깁니다. 자동으로 확정하지 않습니다
              </li>
            </ul>
            <p class="small muted">
              학교 자료는 이 브라우저 안에서만 계산합니다. AI 도움을 켤 때만 일정 이름과 날짜가 AI로 갑니다.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function LastSummary({ events, terms }: { events: CalEvent[]; terms?: Terms }) {
  const byMonth = new Map<number, number>();
  for (const e of events) {
    const mth = Number(e.start.slice(5, 7));
    byMonth.set(mth, (byMonth.get(mth) ?? 0) + 1);
  }
  const months = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2];
  const max = Math.max(1, ...byMonth.values());
  return (
    <div class="stack" style={{ gap: '10px' }}>
      <div class="month-bars" aria-label="달마다 일정 수">
        {months.map((mo) => (
          <div key={mo} class="mb">
            <span class="bar" style={{ height: `${((byMonth.get(mo) ?? 0) / max) * 48 + 2}px` }} title={`${mo}월 ${byMonth.get(mo) ?? 0}건`} />
            <span class="small muted">{mo}</span>
          </div>
        ))}
      </div>
      {terms && (
        <div class="small">
          찾은 학기: 1학기 {fmtShort(terms.sem1Start)} ~ {fmtShort(terms.sem1End)}, 2학기 {fmtShort(terms.sem2Start)} ~ {fmtShort(terms.sem2End)}
          <span class="muted"> (다음 단계에서 고칠 수 있습니다)</span>
        </div>
      )}
    </div>
  );
}

/* ---------- 2. 새 학년도 기본 ---------- */

function TermInputs({ value, onChange, prefix }: { value: Terms; onChange: (t: Terms) => void; prefix: string }) {
  return (
    <div class="grid-2" style={{ gap: '10px' }}>
      {TERM_FIELDS.map((f) => (
        <label class="field" key={f.key}>
          {f.label}
          <input class="input" type="date" id={`${prefix}-${f.key}`} value={value[f.key]} onChange={(e) => onChange({ ...value, [f.key]: (e.target as HTMLInputElement).value })} />
        </label>
      ))}
    </div>
  );
}

function BasicsStep({ ps, onDone }: { ps: PlanStore; onDone: () => void }) {
  const { s, set } = ps;
  const toYear = s.fromYear + 1;
  const last = s.lastTerms ?? detectTerms(s.lastEvents ?? [], s.fromYear);
  const [lastTerms, setLastTerms] = useState<Terms>(last);
  const [terms, setTerms] = useState<Terms>(s.terms ?? suggestTerms(last, toYear));
  const yearEnd = addDays(`${toYear + 1}-03-01`, -1);
  const holidays = publicHolidays(`${toYear}-03-01`, yearEnd).filter((h) => weekdayIndex(h.start) < 5);
  const missing = HOLIDAYS_UNTIL < yearEnd;
  const valid = terms.sem1Start < terms.sem1End && terms.sem1End < terms.sem2Start && terms.sem2Start < terms.sem2End;

  const make = () => {
    const plan = makePlan(s.lastEvents ?? [], { fromYear: s.fromYear, lastTerms, terms });
    set({ lastTerms, terms, items: plan.items, notes: plan.notes, bridgeOptions: plan.bridgeOptions, madeAt: new Date().toISOString(), sheetUrl: undefined });
    onDone();
  };

  return (
    <div class="grid-2">
      <div class="stack">
        <Panel title={`${toYear}학년도 학기`} hint="작년과 같은 요일·주차로 추정했습니다. 학교 운영계획에 맞게 고치세요.">
          <div class="stack">
            <TermInputs value={terms} onChange={setTerms} prefix="new" />
            {!valid && (
              <div class="banner" role="alert">
                <span>날짜 순서가 맞지 않습니다: 1학기 첫날 &lt; 1학기 마지막 날 &lt; 2학기 첫날 &lt; 2학기 마지막 날</span>
              </div>
            )}
            <button class="btn primary big" style={{ alignSelf: 'flex-start' }} disabled={!valid} onClick={make}>
              1차안 만들기
            </button>
          </div>
        </Panel>
        <details class="panel-details">
          <summary>작년({s.fromYear}학년도) 학기 경계 고치기</summary>
          <p class="small muted">작년 일정에서 찾은 날입니다. 이 날에 있던 일정(개학식·방학식 등)은 새 학년도의 같은 경계로 옮깁니다.</p>
          <TermInputs value={lastTerms} onChange={setLastTerms} prefix="last" />
        </details>
      </div>
      <div class="stack">
        <Panel title={`${toYear}학년도 평일 공휴일`} hint="자동으로 들어갑니다. 선거일·임시공휴일은 1차안에서 직접 더하세요.">
          {missing && (
            <div class="banner" role="note" style={{ marginBottom: '10px' }}>
              <span>공휴일 표가 {fmtShort(HOLIDAYS_UNTIL)}까지만 있습니다. 그 뒤 공휴일은 직접 넣어야 합니다.</span>
            </div>
          )}
          <div class="chips-wrap">
            {holidays.map((h) => (
              <span class="chip plain" key={h.start}>
                {fmtShort(h.start)} {h.title}
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* ---------- 3. 1차안 ---------- */

const STATUS_CHIP: Record<PlanStatus, string> = { ok: 'plain', moved: 'info', check: 'warn', suggested: 'good' };

function DraftStep({ ps, m, onRestart }: { ps: PlanStore; m: Model; onRestart: () => void }) {
  const { s, set, stats, conflicts } = ps;
  const items = s.items!;
  const terms = s.terms!;
  const [filter, setFilter] = useState<'todo' | 'changed' | 'all'>('todo');
  const [q, setQ] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const toYear = s.fromYear + 1;

  const todo = (i: PlanItem) => i.status === 'check' || conflicts.has(i.id);
  const counts = {
    todo: items.filter(todo).length,
    changed: items.filter((i) => i.status === 'moved' || i.status === 'suggested').length,
  };
  const update = (id: string, patch: Partial<PlanItem>) => set({ items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)).sort((a, b) => a.start.localeCompare(b.start)) });
  const moveTo = (it: PlanItem, start: string) => {
    if (!start) return;
    update(it.id, { start, end: addDays(start, diffDays(it.start, it.end)), status: 'ok', reason: `교사가 ${fmtShort(start)}로 정함`, anchor: '교사가 정함', alternatives: undefined });
  };
  const remove = (id: string) => set({ items: items.filter((i) => i.id !== id) });
  const removeSeries = (name: string) => set({ items: items.filter((i) => i.series !== name) });
  const addBridge = (d: string) =>
    set({
      items: [...items, { id: `b${d}`, title: '재량휴업일', start: d, end: d, kind: 'holiday' as const, anchor: '징검다리 휴일', status: 'ok' as const, reason: '징검다리 후보에서 교사가 더함' }].sort((a, b) =>
        a.start.localeCompare(b.start),
      ),
    });

  const list = useMemo(() => {
    let l = items.filter((i) => !i.series);
    if (day) l = items.filter((i) => i.start <= day && i.end >= day);
    else if (filter === 'todo') l = l.filter(todo);
    else if (filter === 'changed') l = l.filter((i) => i.status !== 'ok' || conflicts.has(i.id));
    if (q.trim()) l = l.filter((i) => i.title.includes(q.trim()));
    return l;
  }, [items, filter, q, day, conflicts]);
  const series = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const i of items) if (i.series) map.set(i.series, [...(map.get(i.series) ?? []), i]);
    return [...map.entries()];
  }, [items]);

  const title = `${toYear}학년도 학사일정 1차안`;
  const toSheet = async () => {
    try {
      setMsg('구글 시트를 만드는 중…');
      const url = await server.createPlanSheet(title, planToRows(items));
      set({ sheetUrl: url });
      setMsg('시트를 만들었습니다. 시트의 공유 버튼으로 선생님들을 초대하세요.');
    } catch (e) {
      setMsg(`시트를 만들지 못했습니다: ${(e as Error).message}`);
    }
  };
  const fromRows = (rows: string[][], where: string) => {
    try {
      const r = applyPlanRows(items, rows, toYear);
      set({ items: r.items });
      setMsg(`${where}: 바뀐 일정 ${r.changed}건, 더한 일정 ${r.added}건, 지운 일정 ${r.removed}건을 반영했습니다.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const readSheet = async () => {
    if (!s.sheetUrl) return;
    try {
      setMsg('시트를 읽는 중…');
      const sheets = await server.readEventSheets(s.sheetUrl);
      const first = sheets.find((x) => x.rows.some((r) => r.includes('번호'))) ?? sheets[0];
      fromRows(first?.rows ?? [], `"${first?.sheet}" 시트`);
    } catch (e) {
      setMsg(`시트를 읽지 못했습니다: ${(e as Error).message}`);
    }
  };
  const sendToSisu = (sem: 1 | 2) => {
    const [a, b] = sem === 1 ? [terms.sem1Start, terms.sem1End] : [terms.sem2Start, terms.sem2End];
    const events: CalEvent[] = items.map((i) => ({ id: i.id, title: i.title, start: i.start, end: i.end, source: 'plan' as const }));
    m.set({
      events,
      eventSource: 'ics',
      applied: [],
      overrides: {},
      settings: { ...m.p.settings, termStart: a, termEnd: b },
      school: m.p.school ? { ...m.p.school, year: toYear, semester: sem } : m.p.school,
    });
    location.hash = 'dashboard';
  };

  const st = stats!;
  return (
    <div class="stack">
      <div class="kpis">
        <div class={`kpi ${st.total < LEGAL_MIN_DAYS ? 'alert' : ''}`}>
          <span class="label">수업일수</span>
          <span class="value num">
            {st.total}
            <small>일 / 최소 {LEGAL_MIN_DAYS}</small>
          </span>
          <span class="sub">
            1학기 {st.sem1}일 · 2학기 {st.sem2}일
          </span>
        </div>
        <div class={`kpi ${counts.todo ? 'alert' : ''}`}>
          <span class="label">확인 필요</span>
          <span class="value num">
            {counts.todo}
            <small>건</small>
          </span>
          <span class="sub">겹쳤거나 교육청이 정하는 날짜</span>
        </div>
        <div class="kpi">
          <span class="label">옮김·새 제안</span>
          <span class="value num">
            {counts.changed}
            <small>건</small>
          </span>
          <span class="sub">가까운 날로 옮긴 작은 일정, 징검다리 휴업</span>
        </div>
        <div class="kpi">
          <span class="label">요일별 수업일수</span>
          <span class="weekday-bars">
            {st.byWeekday.map((n, i) => (
              <span key={i} title={`${WEEKDAYS[i]} ${n}일`}>
                <i style={{ height: `${(n / Math.max(...st.byWeekday)) * 26}px` }} />
                <em>
                  {WEEKDAYS[i]}
                  <b class="num">{n}</b>
                </em>
              </span>
            ))}
          </span>
        </div>
      </div>

      {s.notes && s.notes.length > 0 && (
        <div class="banner" role="note">
          <span>{s.notes.join(' ')}</span>
        </div>
      )}

      <div class="grid-main">
        <Panel
          title={day ? `${fmtShort(day)} 일정` : '일정'}
          hint={day ? '달력에서 고른 날입니다.' : '날짜를 바꾸면 "교사가 정함"이 됩니다. 매주 반복 일정은 아래에 묶었습니다.'}
        >
          <div class="stack">
            <div class="toolbar">
              {day ? (
                <button class="btn" onClick={() => setDay(null)}>
                  ← 목록으로
                </button>
              ) : (
                <Seg
                  label="보기"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'todo', label: `확인 필요 ${counts.todo}` },
                    { value: 'changed', label: '바뀐 것' },
                    { value: 'all', label: '전체' },
                  ]}
                />
              )}
              <input class="input" id="plan-search" style={{ maxWidth: '200px' }} placeholder="일정 이름 찾기" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            </div>
            {list.length === 0 ? (
              <div class="empty">{filter === 'todo' && !day ? '확인할 일정이 없습니다. "전체"에서 모든 일정을 볼 수 있습니다.' : '일정이 없습니다.'}</div>
            ) : (
              <ul class="plan-list">
                {list.map((it) => (
                  <PlanRow key={it.id} it={it} conflict={conflicts.get(it.id)} onMove={(d) => moveTo(it, d)} onRemove={() => remove(it.id)} onOk={() => update(it.id, { status: 'ok' })} />
                ))}
              </ul>
            )}
            {!day && series.length > 0 && (
              <details>
                <summary>매주 반복 일정 {series.length}묶음</summary>
                <ul class="plan-list">
                  {series.map(([name, list]) => (
                    <li key={name} class="plan-row">
                      <div class="pr-date num">{fmtShort(list[0].start)}~</div>
                      <div class="pr-body">
                        <b>{name}</b>
                        <span class="small muted">
                          {list[0].anchor} · {list.length}회 · {list[0].reason}
                        </span>
                      </div>
                      <button class="btn ghost" onClick={() => removeSeries(name)}>
                        모두 빼기
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Panel>

        <div class="stack">
          <AIPanel items={items} terms={terms} toYear={toYear} hasCheck={counts.todo > 0} onApply={(next) => set({ items: next })} />
          <Panel title="한 해 달력" hint="점을 누르면 그날 일정을 봅니다.">
            <YearCalendar items={items} terms={terms} toYear={toYear} conflicts={conflicts} selected={day} onPick={setDay} />
          </Panel>
          {s.bridgeOptions && s.bridgeOptions.filter((d) => !items.some((i) => i.start === d && i.kind === 'holiday')).length > 0 && (
            <Panel title="징검다리 휴업 후보" hint="공휴일과 주말 사이에 낀 평일입니다. 눌러서 재량휴업일로 더합니다.">
              <div class="chips-wrap">
                {s.bridgeOptions
                  .filter((d) => !items.some((i) => i.start === d && i.kind === 'holiday'))
                  .map((d) => (
                    <button class="chip plain" key={d} style={{ border: 0, cursor: 'pointer' }} onClick={() => addBridge(d)}>
                      + {fmtShort(d)}
                    </button>
                  ))}
              </div>
            </Panel>
          )}
          <Panel title="함께 고치기·내보내기">
            <div class="stack">
              {inAppsScript() ? (
                <div class="row">
                  <button class="btn primary" onClick={toSheet}>
                    {s.sheetUrl ? '시트 새로 만들기' : '구글 시트로 만들기'}
                  </button>
                  {s.sheetUrl && (
                    <>
                      <a class="btn" href={s.sheetUrl} target="_blank" rel="noopener">
                        시트 열기
                      </a>
                      <button class="btn" onClick={readSheet}>
                        시트에서 다시 읽기
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <p class="small muted" style={{ margin: 0 }}>
                  시트용 파일을 구글 드라이브에 올려 구글 시트로 열면 선생님들이 함께 고칠 수 있습니다. 고친 시트는 .xlsx로 받아 다시 올리세요. ("번호" 칸은 지우지 마세요)
                </p>
              )}
              <div class="row">
                <button class="btn" onClick={() => download(`${title}.csv`, toCSV(planToRows(items)), 'text/csv')}>
                  시트용 파일(.csv)
                </button>
                <label class="btn">
                  고친 시트 올리기
                  <input
                    type="file"
                    hidden
                    id="plan-sheet-file"
                    accept=".xlsx,.csv,.tsv"
                    onChange={async (e) => {
                      const f = (e.target as HTMLInputElement).files?.[0];
                      if (!f) return;
                      try {
                        fromRows(await readRowsFile(f, (rows) => rows.some((r) => r.includes(PLAN_HEADER[6]))), f.name);
                      } catch (err) {
                        setMsg((err as Error).message);
                      }
                    }}
                  />
                </label>
                <button class="btn" onClick={() => download(`${title}.ics`, toICS(items, title), 'text/calendar')}>
                  캘린더 파일(.ics)
                </button>
              </div>
              {msg && <div class="small" style={{ color: 'var(--ink-2)' }}>{msg}</div>}
            </div>
          </Panel>
          <Panel title="시수 점검으로 보내기" hint="이 1차안으로 반·과목 시수와 시험 전 격차를 봅니다 (지금 시간표 기준).">
            <div class="row">
              <button class="btn" onClick={() => sendToSisu(1)}>
                1학기 점검
              </button>
              <button class="btn" onClick={() => sendToSisu(2)}>
                2학기 점검
              </button>
              <button class="btn ghost" onClick={() => (confirm('1차안을 지우고 처음부터 할까요?') ? (ps.reset(), onRestart()) : undefined)}>
                처음부터
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** AI에게 부탁하기: 제안을 받아 검사하고, 교사가 고른 것만 적용 */
function AIPanel({ items, terms, toYear, hasCheck, onApply }: { items: PlanItem[]; terms: Terms; toYear: number; hasCheck: boolean; onApply: (items: PlanItem[]) => void }) {
  const [key, setKey] = useState(loadAIKey);
  const [req, setReq] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ summary: string; ops: CheckedOp[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const ask = async (text: string) => {
    setErr('');
    setResult(null);
    setBusy(true);
    try {
      const r = await askPlanAI(key, planContext(items, terms, toYear), text);
      const ops = checkOps(r.operations, items, terms, toYear);
      setResult({ summary: r.summary, ops });
      setPicked(new Set(ops.map((o, i) => (o.problem ? -1 : i)).filter((i) => i >= 0)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!result) return;
    onApply(applyOps(items, result.ops.filter((_, i) => picked.has(i))));
    setResult(null);
    setReq('');
  };
  const label = (o: CheckedOp) => {
    const when = o.end !== o.start ? `${fmtShort(o.start)}~${fmtShort(o.end)}` : fmtShort(o.start);
    if (o.op === 'remove') return `빼기: ${o.before?.title ?? o.title}`;
    if (o.op === 'add') return `더하기: ${when} ${o.title}`;
    return `옮기기: ${o.before?.title ?? o.title} ${o.before ? fmtShort(o.before.start) : ''} → ${when}`;
  };

  return (
    <Panel title="AI에게 부탁하기" hint="바꿀 점을 말로 적으면 AI가 제안합니다. 검사를 통과한 제안 중 고른 것만 적용됩니다.">
      <div class="stack">
        {!key.trim() && (
          <label class="field">
            Anthropic API 키
            <input
              class="input"
              id="ai-key"
              type="password"
              autoComplete="off"
              value={key}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setKey(v);
                saveAIKey(v.trim());
              }}
              placeholder="sk-ant-…"
            />
            <span class="small muted">
              console.anthropic.com에서 받은 키. 이 브라우저에만 저장됩니다. AI에는 일정 이름과 날짜만 보내고, 교사 이름·시간표는 보내지 않습니다.
            </span>
          </label>
        )}
        <textarea
          class="input"
          id="ai-request"
          rows={3}
          value={req}
          onInput={(e) => setReq((e.target as HTMLTextAreaElement).value)}
          placeholder={'예: 2학년 수련회는 5월 둘째 주로 옮기고, 체육대회는 중간고사 끝난 다음 날로 해 주세요.'}
        />
        <div class="row">
          <button class="btn primary" disabled={!key.trim() || !req.trim() || busy} onClick={() => ask(req)}>
            {busy ? 'AI가 보는 중…' : '부탁하기'}
          </button>
          {hasCheck && (
            <button class="btn" disabled={!key.trim() || busy} onClick={() => ask(CHECK_REQUEST)}>
              확인 필요 일정 검토 맡기기
            </button>
          )}
          {key.trim() && (
            <button
              class="btn ghost"
              onClick={() => {
                setKey('');
                saveAIKey('');
              }}
            >
              키 지우기
            </button>
          )}
        </div>
        {err && (
          <div class="banner" role="alert">
            <span>{err}</span>
          </div>
        )}
        {result && (
          <div class="result">
            <b>AI 제안</b>
            <div class="small">{result.summary}</div>
            {result.ops.length === 0 ? (
              <div class="small muted">바꿀 제안이 없습니다.</div>
            ) : (
              <ul class="ai-ops">
                {result.ops.map((o, i) => (
                  <li key={i} class={o.problem ? 'bad' : ''}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!!o.problem}
                        checked={picked.has(i)}
                        onChange={() => {
                          const next = new Set(picked);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          setPicked(next);
                        }}
                      />
                      <span>
                        <b>{label(o)}</b>
                        <span class="small muted">{o.problem ? `적용 불가: ${o.problem} · ` : ''}{o.reason}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div class="row">
              <button class="btn primary" disabled={picked.size === 0} onClick={apply}>
                고른 제안 {picked.size}개 적용
              </button>
              <button class="btn ghost" onClick={() => setResult(null)}>
                닫기
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function PlanRow({ it, conflict, onMove, onRemove, onOk }: { it: PlanItem; conflict?: string; onMove: (d: string) => void; onRemove: () => void; onOk: () => void }) {
  const multi = it.end !== it.start;
  return (
    <li class={`plan-row ${it.status} ${conflict ? 'conflict' : ''}`}>
      <div class="pr-date">
        <input class="input num" type="date" aria-label={`${it.title} 날짜`} value={it.start} onChange={(e) => onMove((e.target as HTMLInputElement).value)} />
        {multi && <span class="small muted">~ {fmtShort(it.end)}</span>}
      </div>
      <div class="pr-body">
        <div class="row" style={{ gap: '6px' }}>
          <b>{it.title}</b>
          <span class={`chip ${STATUS_CHIP[it.status]}`}>{STATUS_LABEL[it.status]}</span>
          {it.from && (
            <span class="small muted">
              작년 {fmtShort(it.from.start)}
              {it.from.end !== it.from.start ? `~${fmtShort(it.from.end)}` : ''}
            </span>
          )}
        </div>
        <span class="small">{it.status === 'ok' ? it.anchor : it.reason}</span>
        {conflict && <span class="small" style={{ color: 'var(--deficit)' }}>지금 날짜가 겹칩니다: {conflict}</span>}
        {it.alternatives && it.alternatives.length > 0 && (
          <div class="row" style={{ gap: '6px' }}>
            <span class="small muted">다른 후보</span>
            {it.alternatives.map((d) => (
              <button key={d} class="chip plain" style={{ border: 0, cursor: 'pointer' }} onClick={() => onMove(d)}>
                {fmtShort(d)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div class="pr-act">
        {it.status === 'check' && !conflict && (
          <button class="btn" onClick={onOk}>
            이대로
          </button>
        )}
        <button class="btn ghost" aria-label={`${it.title} 빼기`} onClick={onRemove}>
          빼기
        </button>
      </div>
    </li>
  );
}

/** 3월~다음 해 2월 작은 달력 12개 */
function YearCalendar({
  items,
  terms,
  toYear,
  conflicts,
  selected,
  onPick,
}: {
  items: PlanItem[];
  terms: Terms;
  toYear: number;
  conflicts: Map<string, string>;
  selected: string | null;
  onPick: (d: string) => void;
}) {
  const byDay = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    for (const i of items) if (!i.series) for (const d of eachDay(i.start, i.end)) map.set(d, [...(map.get(d) ?? []), i]);
    return map;
  }, [items]);
  const inTerm = (d: string) => (d >= terms.sem1Start && d <= terms.sem1End) || (d >= terms.sem2Start && d <= terms.sem2End);
  const months = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2].map((mo) => ({ y: mo <= 2 ? toYear + 1 : toYear, mo }));
  return (
    <div class="ycal">
      {months.map(({ y, mo }) => {
        const first = `${y}-${String(mo).padStart(2, '0')}-01`;
        const last = addDays(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01`, -1);
        const days = eachDay(first, last);
        const lead = weekdayIndex(first);
        return (
          <div class="ym" key={first}>
            <div class="ym-title">{mo}월</div>
            <div class="ym-grid">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`l${i}`} />
              ))}
              {days.map((d) => {
                const its = byDay.get(d) ?? [];
                const wd = weekdayIndex(d);
                const hol = holidayName(d) || its.some((i) => i.kind === 'holiday');
                const status = its.some((i) => conflicts.has(i.id) || i.status === 'check')
                  ? 'check'
                  : its.some((i) => i.status === 'suggested')
                    ? 'suggested'
                    : its.some((i) => i.status === 'moved')
                      ? 'moved'
                      : its.length
                        ? 'ok'
                        : '';
                const cls = [wd > 4 ? 'we' : '', hol ? 'hol' : '', !inTerm(d) && wd < 5 ? 'vac' : '', status ? `s-${status}` : '', selected === d ? 'sel' : ''].join(' ');
                const label = `${fmtShort(d)}${holidayName(d) ? ` ${holidayName(d)}` : ''}${its.length ? ` · ${its.map((i) => i.title).join(', ')}` : ''}`;
                return its.length ? (
                  <button key={d} class={`yd ${cls}`} title={label} aria-label={label} onClick={() => onPick(d)}>
                    {Number(d.slice(8))}
                  </button>
                ) : (
                  <span key={d} class={`yd ${cls}`} title={label}>
                    {Number(d.slice(8))}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <div class="ycal-legend small muted">
        <span>
          <i class="s-check" /> 확인 필요
        </span>
        <span>
          <i class="s-moved" /> 옮김
        </span>
        <span>
          <i class="s-suggested" /> 새 제안
        </span>
        <span>
          <i class="s-ok" /> 일정
        </span>
        <span>
          <i class="vac" /> 방학
        </span>
      </div>
    </div>
  );
}
