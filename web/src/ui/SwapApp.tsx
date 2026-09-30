import { useMemo, useState } from 'preact/hooks';
import { addDays, fmtShort, weekdayIndex } from '../engine/dates';
import { holidayName } from '../engine/holidays';
import {
  describePick,
  findOptions,
  indexTeachers,
  needsFor,
  teachingPeriods,
  type Absence,
  type Need,
  type Option,
  type SwapContext,
  type SwapRules,
} from '../engine/swap';
import { Panel } from './parts';
import type { Model } from './store';
import { AppSwitch, SuiteBrand } from './suite';
import { useSwapStore, type SwapStore } from './swapStore';

const REASONS = ['출장', '연가', '연수', '병가', '기타'];
const OFF_KINDS = ['holiday', 'vacation', 'exam', 'fullday'];

/** 오늘이 주말이면 다음 월요일 */
function nextSchoolDay(d: string): string {
  let x = d;
  while (weekdayIndex(x) > 4 || holidayName(x)) x = addDays(x, 1);
  return x;
}

/** 시간표 교체 (베타): 지금은 결보강 찾기 */
export function SwapApp({ m }: { m: Model }) {
  const st = useSwapStore();
  const { s, set } = st;
  const tt = m.timetable;
  const idx = useMemo(() => indexTeachers(tt), [tt]);
  const noTeachers = idx.teachers.length === 0;

  // 그 반 학년이 그날 평소 수업을 하는가: 공휴일, 학사일정의 휴업·방학·시험·전일 행사가 아니면
  const dayOpen = (date: string, grade: number) =>
    weekdayIndex(date) < 5 &&
    !holidayName(date) &&
    !m.events.some((e) => e.start <= date && e.end >= date && OFF_KINDS.includes(e.rule.kind) && (!e.rule.grades || e.rule.grades.includes(grade)));

  const coverCount = useMemo(() => new Map(Object.entries(s.coverCount)), [s.coverCount]);
  const ctxFor = (exceptKey?: string): SwapContext => ({
    tt,
    idx,
    rules: s.rules,
    absences: s.absences,
    picks: s.picks.filter((p) => p.need.key !== exceptKey),
    dayOpen,
    coverCount,
  });

  return (
    <div class="shell">
      <aside class="side">
        <SuiteBrand sub="교무업무 도구" />
        <AppSwitch current="swap" />
        <div class="side-foot">
          <div>
            <strong>{tt.school}</strong>
            <br />
            선생님 {idx.teachers.length}명 · {tt.classes.length}학급
          </div>
          <div>베타: 요일별 기본 시간표 기준</div>
        </div>
      </aside>

      <main class="main">
        <header class="page-head">
          <div>
            <div class="eyebrow">시간표 교체 · 베타</div>
            <h1>결보강 찾기</h1>
            <p>빠지는 선생님과 날짜를 넣으면, 수업마다 교체(맞바꾸기) 후보를 먼저, 안 되면 보강할 선생님 후보를 찾습니다.</p>
          </div>
        </header>

        <div class="banner" role="note">
          <span>
            <b>베타입니다.</b> 요일별 기본 시간표로 찾고, 그날의 요일 교체·교시 옮김은 아직 반영하지 않습니다. 학교 규칙과 다른 점이 있으면{' '}
            <a href="https://github.com/cleveranawim-source/officetool/issues" target="_blank" rel="noopener">
              알려 주세요
            </a>
            .{m.sampleTimetable && ' 지금은 예시 학교 시간표(교사 이름은 "국어1" 같은 코드)로 보고 있습니다.'}
          </span>
        </div>

        {noTeachers ? (
          <Panel title="교사가 들어 있는 시간표가 필요합니다">
            <p class="small muted" style={{ margin: 0 }}>
              결보강은 선생님별 시간표로 찾습니다. 시간표 프로그램의 엑셀 파일(교사 이름이 있는 것)을 시수 점검에서 넣어 주세요. NEIS 시간표에는 교사 정보가 없습니다.
            </p>
            <div class="row" style={{ marginTop: '12px' }}>
              <a class="btn primary" href="#data">
                시간표 넣기
              </a>
            </div>
          </Panel>
        ) : (
          <div class="grid-main">
            <div class="stack">
              <AddAbsence st={st} teachers={idx.teachers} periodsOf={(t, d) => teachingPeriods(idx, t, weekdayIndex(d))} today={m.p.settings.today} />
              {s.absences.length === 0 ? (
                <Panel title="빠지는 수업">
                  <div class="empty">위에서 빠지는 선생님과 날짜를 넣으세요.</div>
                </Panel>
              ) : (
                s.absences.map((a) => <AbsenceCard key={a.id} a={a} st={st} needs={needsFor(tt, idx, a)} ctxFor={ctxFor} dayOpen={dayOpen} />)
              )}
            </div>
            <div class="stack">
              <NoticePanel st={st} needsOf={(a) => needsFor(tt, idx, a)} />
              <RulesPanel rules={s.rules} onChange={(rules) => set({ rules })} />
              {Object.keys(s.coverCount).length > 0 && (
                <Panel title="보강 누적" hint="기록한 보강 횟수. 몰림 방지에 씁니다.">
                  <div class="chips-wrap">
                    {Object.entries(s.coverCount)
                      .sort((a, b) => b[1] - a[1])
                      .map(([t, n]) => (
                        <span class="chip plain" key={t}>
                          {t} {n}
                        </span>
                      ))}
                  </div>
                  <button class="btn ghost" style={{ marginTop: '10px' }} onClick={() => confirm('보강 누적과 기록을 지울까요?') && set({ coverCount: {}, history: [] })}>
                    누적 지우기
                  </button>
                </Panel>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function AddAbsence({ st, teachers, periodsOf, today }: { st: SwapStore; teachers: string[]; periodsOf: (t: string, d: string) => number[]; today: string }) {
  const [teacher, setTeacher] = useState('');
  const [date, setDate] = useState(nextSchoolDay(today));
  const [reason, setReason] = useState(REASONS[0]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const periods = teacher && date ? periodsOf(teacher, date) : [];
  const weekend = !!date && weekdayIndex(date) > 4;
  const hol = date ? holidayName(date) : undefined;

  const add = () => {
    const chosen = periods.filter((p) => !off.has(p));
    const a: Absence = { id: `a${Date.now().toString(36)}`, teacher, date, periods: chosen.length === periods.length ? [] : chosen, reason };
    st.set({ absences: [...st.s.absences, a] });
    setOff(new Set());
  };

  return (
    <Panel title="빠지는 선생님">
      <div class="stack">
        <div class="swap-form">
          <label class="field">
            선생님
            <select class="input" id="swap-teacher" value={teacher} onChange={(e) => (setTeacher((e.target as HTMLSelectElement).value), setOff(new Set()))}>
              <option value="">고르기</option>
              {teachers.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            날짜
            <input class="input" type="date" id="swap-date" value={date} onChange={(e) => (setDate((e.target as HTMLInputElement).value), setOff(new Set()))} />
          </label>
          <label class="field">
            사유
            <select class="input" id="swap-reason" value={reason} onChange={(e) => setReason((e.target as HTMLSelectElement).value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
        {teacher && date && (weekend || hol) && <div class="small" style={{ color: 'var(--deficit)' }}>{hol ?? '주말'}이라 수업이 없는 날입니다.</div>}
        {teacher && date && !weekend && !hol && (
          <fieldset class="swap-periods">
            <legend class="small muted">
              {fmtShort(date)} {teacher} 선생님 수업 {periods.length}시간 · 빠지는 교시
            </legend>
            {periods.length === 0 && <span class="small muted">이날 수업이 없습니다.</span>}
            {periods.map((p) => (
              <label key={p} class="switch-chip">
                <input
                  type="checkbox"
                  checked={!off.has(p)}
                  onChange={() => {
                    const n = new Set(off);
                    if (n.has(p)) n.delete(p);
                    else n.add(p);
                    setOff(n);
                  }}
                />
                {p}교시
              </label>
            ))}
          </fieldset>
        )}
        <button class="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!teacher || !date || weekend || !!hol || periods.length === off.size} onClick={add}>
          결보강 찾기
        </button>
      </div>
    </Panel>
  );
}

function AbsenceCard({
  a,
  st,
  needs,
  ctxFor,
  dayOpen,
}: {
  a: Absence;
  st: SwapStore;
  needs: Need[];
  ctxFor: (exceptKey?: string) => SwapContext;
  dayOpen: (date: string, grade: number) => boolean;
}) {
  const { s, set } = st;
  const pickOf = (key: string) => s.picks.find((p) => p.need.key === key);
  const choose = (need: Need, option: Option) => set({ picks: [...s.picks.filter((p) => p.need.key !== need.key), { need, option }] });
  const unpick = (key: string) => set({ picks: s.picks.filter((p) => p.need.key !== key) });
  const remove = () => set({ absences: s.absences.filter((x) => x.id !== a.id), picks: s.picks.filter((p) => p.need.absenceId !== a.id) });
  const done = needs.filter((n) => pickOf(n.key)).length;

  return (
    <Panel title={`${a.teacher} 선생님 · ${fmtShort(a.date)} · ${a.reason}`} hint={`수업 ${needs.length}시간 중 ${done}시간 정함`}>
      <div class="stack">
        {needs.length > 0 && !needs.some((n) => dayOpen(n.date, n.grade)) && <div class="small muted">학사일정상 이날은 평소 수업이 없는 날입니다 (시험·행사 등).</div>}
        <ul class="swap-list">
          {needs.map((n) => {
            const pk = pickOf(n.key);
            const opts = pk ? null : findOptions(n, ctxFor(n.key));
            return (
              <li key={n.key} class={pk ? 'done' : ''}>
                <div class="sw-slot">
                  <b class="num">{n.period}교시</b>
                  <span>
                    {n.cls} {n.subject}
                  </span>
                </div>
                {pk ? (
                  <div class="sw-picked">
                    <span class={`chip ${pk.option.kind === 'swap' ? 'good' : 'info'}`}>{pk.option.kind === 'swap' ? '교체' : '보강'}</span>
                    <span class="small">{describePick(pk).split('→ ')[1].replace(/^(교체|보강): /, '')}</span>
                    {pk.recorded ? (
                      <span class="chip plain">기록됨</span>
                    ) : (
                      <button class="btn ghost" onClick={() => unpick(n.key)}>
                        바꾸기
                      </button>
                    )}
                  </div>
                ) : (
                  <div class="sw-opts">
                    {opts!.swaps.length === 0 && opts!.covers.length > 0 && (
                      <div class="sw-row">
                        <span class="small muted">교체</span>
                        <span class="small muted">{s.rules.window === 'week' ? '같은 주엔 맞바꿀 수업이 없습니다. 조건에서 범위를 "다음 주까지"로 넓혀 보세요.' : '맞바꿀 수업이 없습니다.'}</span>
                      </div>
                    )}
                    {opts!.swaps.length > 0 && (
                      <div class="sw-row">
                        <span class="small muted">교체</span>
                        {opts!.swaps.map((o) => (
                          <button key={`${o.date}${o.period}`} class="opt swap" title={o.notes.join(' · ')} onClick={() => choose(n, o)}>
                            {fmtShort(o.date)} {o.period}교시 {o.subject}
                            <em>{o.teacher}</em>
                          </button>
                        ))}
                      </div>
                    )}
                    {opts!.covers.length > 0 && (
                      <div class="sw-row">
                        <span class="small muted">보강</span>
                        {opts!.covers.map((o) => (
                          <button key={o.teacher} class="opt cover" title={o.notes.join(' · ')} onClick={() => choose(n, o)}>
                            {o.teacher}
                            <em>{o.notes.filter((x) => !x.startsWith('그날')).join('·') || o.notes[o.notes.length - 1]}</em>
                          </button>
                        ))}
                      </div>
                    )}
                    {opts!.swaps.length === 0 && opts!.covers.length === 0 && <span class="small" style={{ color: 'var(--deficit)' }}>후보가 없습니다. 오른쪽 조건을 풀어 보세요.</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button class="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={remove}>
          이 결보강 지우기
        </button>
      </div>
    </Panel>
  );
}

function NoticePanel({ st, needsOf }: { st: SwapStore; needsOf: (a: Absence) => Need[] }) {
  const { s, set } = st;
  const [msg, setMsg] = useState('');
  const fresh = s.picks.filter((p) => !p.recorded);
  const lines = [...fresh].sort((a, b) => a.need.date.localeCompare(b.need.date) || a.need.period - b.need.period).map(describePick);
  const text = lines.join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg('복사했습니다. 메신저나 알림장에 붙여 넣으세요.');
    } catch {
      setMsg('복사가 막혀 있습니다. 글을 직접 선택해 복사하세요.');
    }
  };
  // 새로 고른 것만 기록하고, 수업을 모두 정한 결보강은 목록에서 뺀다 (덜 정한 것은 남겨 이어서 정함)
  const record = () => {
    const count = { ...s.coverCount };
    for (const p of fresh) if (p.option.kind === 'cover') count[p.option.teacher] = (count[p.option.teacher] ?? 0) + 1;
    const picked = new Set(s.picks.map((p) => p.need.key));
    const complete = new Set(s.absences.filter((a) => needsOf(a).every((n) => picked.has(n.key))).map((a) => a.id));
    set({
      coverCount: count,
      history: [{ at: new Date().toISOString().slice(0, 10), lines }, ...s.history].slice(0, 50),
      picks: s.picks.filter((p) => !complete.has(p.need.absenceId)).map((p) => ({ ...p, recorded: true })),
      absences: s.absences.filter((a) => !complete.has(a.id)),
    });
    const left = s.absences.length - complete.size;
    setMsg(`${lines.length}건을 기록했습니다.${left ? ` 아직 다 정하지 않은 결보강 ${left}건은 남겨 두었습니다.` : ''}`);
  };
  return (
    <Panel title="결보강 안내문" hint="고른 교체·보강을 한 줄씩 적었습니다.">
      <div class="stack">
        {lines.length === 0 ? (
          <div class="small muted">{s.picks.length ? '새로 고른 것이 없습니다.' : '아직 고른 것이 없습니다. 수업마다 교체나 보강 후보를 누르세요.'}</div>
        ) : (
          <>
            <textarea class="input" id="swap-notice" rows={Math.min(8, lines.length + 1)} readOnly value={text} />
            <div class="row">
              <button class="btn primary" onClick={copy}>
                복사
              </button>
              <button class="btn" onClick={record}>
                확정하고 기록
              </button>
            </div>
          </>
        )}
        {msg && <div class="small" style={{ color: 'var(--ink-2)' }}>{msg}</div>}
        {s.history.length > 0 && (
          <details>
            <summary class="small">지난 기록 {s.history.length}건</summary>
            <ul class="small" style={{ paddingLeft: '18px' }}>
              {s.history.flatMap((h) => h.lines.map((l, i) => <li key={`${h.at}${i}${l}`}>{l}</li>))}
            </ul>
          </details>
        )}
      </div>
    </Panel>
  );
}

function RulesPanel({ rules, onChange }: { rules: SwapRules; onChange: (r: SwapRules) => void }) {
  const toggle = (k: 'sameSubject' | 'sameGrade' | 'homeroom' | 'balance', label: string) => (
    <label class="switch">
      <input type="checkbox" id={`rule-${k}`} checked={rules[k]} onChange={() => onChange({ ...rules, [k]: !rules[k] })} />
      <span class="track" />
      {label}
    </label>
  );
  return (
    <Panel title="조건" hint="학교 규칙에 맞게 바꾸세요. 바로 다시 찾습니다.">
      <div class="stack">
        <label class="field">
          교체를 찾을 범위
          <select class="input" id="rule-window" value={rules.window} onChange={(e) => onChange({ ...rules, window: (e.target as HTMLSelectElement).value as SwapRules['window'] })}>
            <option value="week">같은 주 안</option>
            <option value="twoWeeks">다음 주까지</option>
          </select>
        </label>
        <div class="row">
          <label class="field">
            하루 최대 수업
            <input class="input" type="number" id="rule-daily" min={3} max={8} style={{ width: '90px' }} value={rules.maxDaily} onChange={(e) => onChange({ ...rules, maxDaily: Number((e.target as HTMLInputElement).value) || 6 })} />
          </label>
          <label class="field">
            최대 연강
            <input class="input" type="number" id="rule-run" min={1} max={8} style={{ width: '90px' }} value={rules.maxRun} onChange={(e) => onChange({ ...rules, maxRun: Number((e.target as HTMLInputElement).value) || 3 })} />
          </label>
        </div>
        <div class="stack" style={{ gap: '8px' }}>
          <span class="small muted">보강 순서</span>
          {toggle('sameSubject', '같은 과목 선생님 먼저')}
          {toggle('homeroom', '그 반 담임 먼저')}
          {toggle('sameGrade', '같은 학년 수업하는 선생님 먼저')}
          {toggle('balance', '보강이 몰리지 않게')}
        </div>
      </div>
    </Panel>
  );
}
