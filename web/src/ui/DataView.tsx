import { useEffect, useState } from 'preact/hooks';
import { defaultEventsLabel, eventsAreSample } from '@events';
import { calendarIdFrom, parseICS } from '../engine/ics';
import { describeEventTable, readEventTable, termOf } from '../engine/eventTable';
import { DEFAULT_RULES, type RuleSet } from '../engine/parseEvents';
import { download, readEventsFile, readTimetableFile } from './files';
import { importClassTimetable } from '../engine/importTimetable';
import { WEEKDAYS, type CalEvent } from '../engine/types';
import { inAppsScript, server } from './bridge';
import type { Model } from './store';
import { Panel, Seg } from './parts';
import { NeisPanel } from './NeisPanel';

export function DataView({ m }: { m: Model }) {
  const tt = m.timetable;
  const s = m.p.settings;
  const [paste, setPaste] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [calInput, setCalInput] = useState(m.p.calendarId ?? '');
  const [listText, setListText] = useState('');
  const [evSheetUrl, setEvSheetUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [cals, setCals] = useState<{ id: string; name: string }[]>([]);
  const gas = inAppsScript();

  useEffect(() => {
    if (gas) server.listCalendars().then(setCals).catch(() => setCals([]));
  }, [gas]);

  const readSheet = async () => {
    try {
      setMsg('시트를 읽는 중…');
      setPaste(await server.readTimetableSheet(sheetUrl));
      setMsg('시트를 읽었습니다. 내용을 확인하고 "시간표 바꾸기"를 누르세요.');
    } catch (e) {
      setMsg(`시트를 읽지 못했습니다: ${(e as Error).message}`);
    }
  };

  const importPaste = () => {
    try {
      const r = importClassTimetable(paste, tt.school, tt.term);
      m.set({ timetable: r.timetable, applied: [] });
      setMsg(`${r.timetable.classes.length}개 반 시간표를 읽었습니다.${r.warnings.length ? ` 빈 칸 ${r.warnings.length}곳이 있습니다.` : ''}`);
      setPaste('');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const inTerm = (e: { start: string; end: string }) => e.end >= s.termStart && e.start <= s.termEnd;
  const applyEvents = (events: CalEvent[], text: string) => {
    m.set({ events, eventSource: 'ics', applied: [], overrides: {} });
    setMsg(text);
  };

  const onEventFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const r = await readEventsFile(f, { ...termOf(s.termStart), termEnd: s.termEnd });
      const events = r.events.filter(inTerm);
      applyEvents(
        events,
        r.format === 'ics'
          ? `${f.name}에서 일정 ${events.length}건을 읽었습니다.`
          : `${f.name}${r.sheet ? ` "${r.sheet}" 시트` : ''}: ${describeEventTable(r.format, r.events.length, events.length, r.days)}`,
      );
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const readEventPaste = () => {
    const r = readEventTable(listText, termOf(s.termStart));
    if (!r.events.length) return setMsg('표에서 날짜를 찾지 못했습니다. 목록형(날짜 | 일정)이나 월~금 머리글이 있는 달력형 표를 붙여 넣으세요.');
    const events = r.events.filter(inTerm);
    applyEvents(events, describeEventTable(r.format, r.events.length, events.length, r.days));
  };

  const readEventSheet = async () => {
    try {
      setMsg('시트를 읽는 중…');
      const sheets = await server.readEventSheets(evSheetUrl);
      const best = sheets
        .map((sh) => ({ sheet: sh.sheet, r: readEventTable(sh.rows, termOf(s.termStart)) }))
        .sort((a, b) => b.r.events.length - a.r.events.length)[0];
      if (!best || !best.r.events.length) return setMsg('시트에서 일정을 찾지 못했습니다.');
      const events = best.r.events.filter(inTerm);
      applyEvents(events, `"${best.sheet}" 시트: ${describeEventTable(best.r.format, best.r.events.length, events.length, best.r.days)}`);
    } catch (err) {
      setMsg(`시트를 읽지 못했습니다: ${(err as Error).message}`);
    }
  };

  const fetchCalendar = async (raw: string) => {
    const id = calendarIdFrom(raw);
    if (!id) return;
    setMsg('캘린더를 읽는 중…');
    let events;
    try {
      events = await server.getEvents(id, s.termStart, s.termEnd);
    } catch (err) {
      // 내 캘린더 목록으로 열 수 없는 공개 캘린더는 iCal 주소로 받는다
      try {
        events = parseICS(await server.fetchPublicIcs(id), s.termEnd).filter((e) => e.end >= s.termStart && e.start <= s.termEnd);
      } catch {
        setMsg(`불러오지 못했습니다: ${(err as Error).message}`);
        return;
      }
    }
    m.set({ events, eventSource: 'calendar', calendarId: id, eventsFetchedAt: new Date().toISOString(), applied: [] });
    setCalInput(id);
    setMsg(`일정 ${events.length}건을 불러왔습니다.`);
  };

  const setSetting = (patch: Partial<typeof s>) => m.set({ settings: { ...s, ...patch }, applied: [] });

  return (
    <div class="grid-2">
      <div class="stack">
        <Panel title="학사일정 가져오기">
          <div class="stack">
            <Seg
              label="일정 출처"
              value={m.p.eventSource}
              onChange={(v) => m.set({ eventSource: v, applied: [] })}
              options={[
                { value: 'sample', label: defaultEventsLabel },
                { value: 'ics', label: '파일·시트' },
                { value: 'calendar', label: '구글 캘린더' },
                { value: 'neis', label: 'NEIS' },
              ]}
            />
            {m.p.eventSource === 'sample' && eventsAreSample && (
              <p class="small muted" style={{ margin: 0 }}>
                화면을 채우기 위한 예시입니다. 공휴일은 실제 날짜이고 나머지 행사는 가상입니다.
              </p>
            )}
            {m.p.eventSource === 'ics' && (
              <label class="field">
                구글 캘린더의 .ics 파일, 또는 학사일정 시트를 .xlsx로 받은 파일 (목록형·달력형 모두)
                <input class="input" type="file" id="ics-file" accept=".ics,text/calendar,.xlsx,.csv,.tsv,.txt" onChange={onEventFile} />
              </label>
            )}
            {m.p.eventSource === 'ics' && (
              <details>
                <summary>또는 시트의 학사일정 표 붙여넣기 (목록형·달력형)</summary>
                <div class="stack" style={{ marginTop: '8px' }}>
                  <textarea
                    class="input"
                    id="list-paste"
                    rows={4}
                    value={listText}
                    onInput={(e) => setListText((e.target as HTMLTextAreaElement).value)}
                    placeholder={'목록형:  2026-10-07\t(1,2학년) 중간고사\n달력형:  월\t주\t월\t화\t수\t목\t금 … (표 전체 복사)'}
                  />
                  <button class="btn" style={{ alignSelf: 'flex-start' }} disabled={!listText.trim()} onClick={readEventPaste}>
                    표 읽기
                  </button>
                </div>
              </details>
            )}
            {m.p.eventSource === 'ics' && gas && (
              <div class="row" style={{ alignItems: 'flex-end' }}>
                <label class="field" style={{ flex: 1 }}>
                  학사일정 구글 시트 주소
                  <input class="input" id="event-sheet-url" value={evSheetUrl} onInput={(e) => setEvSheetUrl((e.target as HTMLInputElement).value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                </label>
                <button class="btn" onClick={readEventSheet} disabled={!evSheetUrl.trim()}>
                  시트 읽기
                </button>
              </div>
            )}
            {m.p.eventSource === 'neis' && (
              <NeisPanel
                mode="schedule"
                defaultName={m.p.school?.name ?? ''}
                termStart={s.termStart}
                termEnd={s.termEnd}
                initial={m.p.neis}
                onEvents={(events, school, text) => {
                  m.set({ events, eventSource: 'neis', neis: school, eventsFetchedAt: new Date().toISOString(), applied: [], overrides: {} });
                  setMsg(text);
                }}
              />
            )}
            {m.p.eventSource === 'calendar' &&
              (gas ? (
                <div class="stack">
                  <div class="row" style={{ alignItems: 'flex-end' }}>
                    <label class="field" style={{ flex: 1 }}>
                      캘린더 ID 또는 공유 주소
                      <input class="input" id="cal-id" value={calInput} onInput={(e) => setCalInput((e.target as HTMLInputElement).value)} placeholder="c_…@group.calendar.google.com 또는 https://calendar.google.com/…" />
                    </label>
                    <button class="btn primary" onClick={() => fetchCalendar(calInput)} disabled={!calInput.trim()}>
                      불러오기
                    </button>
                  </div>
                  {cals.length > 0 && (
                    <label class="field">
                      또는 내 캘린더에서 고르기
                      <select class="input" id="cal-select" value="" onChange={(e) => fetchCalendar((e.target as HTMLSelectElement).value)}>
                        <option value="" disabled>
                          캘린더 선택
                        </option>
                        {cals.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {m.p.eventsFetchedAt && (
                    <span class="small muted">마지막으로 불러온 때: {new Date(m.p.eventsFetchedAt).toLocaleString('ko-KR')}</span>
                  )}
                </div>
              ) : (
                <p class="small" style={{ margin: 0, color: 'var(--ink-2)' }}>
                  구글 캘린더 직접 연결은 학교 계정의 Apps Script 웹앱으로 열었을 때 켜집니다. 지금은 .ics 파일을 쓰세요.
                </p>
              ))}
            {msg && <div class="banner">{msg}</div>}
          </div>
        </Panel>

        <Panel title="시간표" hint={`${tt.school} · ${tt.term} · ${tt.classes.length}개 반 · ${tt.days.map((n, i) => `${WEEKDAYS[i]}${n}`).join(' ')}교시`}>
          <div class="stack">
            <label class="field">
              시간표 엑셀 파일 올리기 (.xlsx, .csv)
              <input
                class="input"
                type="file"
                id="tt-file-data"
                accept=".xlsx,.csv,.tsv,.txt"
                onChange={async (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (!f) return;
                  try {
                    const r = await readTimetableFile(f, tt.school, tt.term);
                    m.set({ timetable: r.timetable, applied: [] });
                    setMsg(`${r.timetable.classes.length}개 반 시간표를 읽었습니다.`);
                  } catch (err) {
                    setMsg((err as Error).message);
                  }
                }}
              />
            </label>
            <details>
              <summary>NEIS에서 시간표 받기 (교사 이름 없이 과목만)</summary>
              <div style={{ marginTop: '10px' }}>
                <NeisPanel
                  mode="timetable"
                  defaultName={m.p.school?.name ?? tt.school}
                  termStart={s.termStart}
                  termEnd={s.termEnd}
                  today={s.today}
                  year={m.p.school?.year ?? termOf(s.termStart).year}
                  semester={m.p.school?.semester ?? termOf(s.termStart).semester}
                  term={tt.term}
                  initial={m.p.neis}
                  onTimetable={(r, school, text) => {
                    m.set({ timetable: r.timetable, neis: school, applied: [] });
                    setMsg(`${r.timetable.classes.length}개 반. ${text}`);
                  }}
                />
              </div>
            </details>
            {gas && (
              <div class="row" style={{ alignItems: 'flex-end' }}>
                <label class="field" style={{ flex: 1 }}>
                  시간표 시트 주소 (전체 학반 시간표)
                  <input class="input" id="sheet-url" value={sheetUrl} onInput={(e) => setSheetUrl((e.target as HTMLInputElement).value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                </label>
                <button class="btn" onClick={readSheet} disabled={!sheetUrl.trim()}>
                  시트 읽기
                </button>
              </div>
            )}
            <label class="field" for="tt-paste">
              "전체 학반 시간표" 시트에서 머리글(월·화… 줄)부터 마지막 반까지 복사해 붙여 넣으세요.
            </label>
            <textarea class="input" id="tt-paste" rows={5} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} placeholder={'학반\t월\t\t…\n\t1\t2\t3 …\n1-1\t수학\t과학 …\n\t김미\t박정 …'} />
            <div class="row">
              <button class="btn primary" onClick={importPaste} disabled={!paste.trim()}>
                시간표 바꾸기
              </button>
              {m.p.timetable && (
                <button class="btn ghost" onClick={() => m.set({ timetable: undefined, applied: [] })}>
                  기본 시간표로
                </button>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <div class="stack">
        <Panel title="학교 설정 파일" hint="시간표·학사일정·분류 수정·규칙을 파일 하나로 저장합니다. 같은 학교 선생님께 파일을 주면 같은 화면을 봅니다.">
          <div class="row">
            <button
              class="btn primary"
              onClick={() => {
                const st: Partial<typeof s> = { ...m.p.settings };
                delete st.today;
                const name = (m.p.school?.name || tt.school || '학교').replace(/\s+/g, '');
                download(`시수핏-${name}-${tt.term.replace(/\s+/g, '')}.json`, JSON.stringify({ app: 'sisufit', version: 1, ...m.p, settings: st }, null, 1));
              }}
            >
              설정 파일 저장
            </button>
            <label class="btn">
              설정 파일 불러오기
              <input
                type="file"
                id="state-file"
                accept=".json,application/json"
                hidden
                onChange={async (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0];
                  if (!f) return;
                  try {
                    const data = JSON.parse(await f.text());
                    if (data.app !== 'sisufit') throw new Error('시수핏 설정 파일이 아닙니다.');
                    delete data.app;
                    delete data.version;
                    const rest = data;
                    m.set({ ...rest, settings: { ...s, ...rest.settings, today: s.today }, setupDone: true });
                    setMsg(`${f.name}을 불러왔습니다.`);
                  } catch (err) {
                    setMsg(`불러오지 못했습니다: ${(err as Error).message}`);
                  }
                }}
              />
            </label>
            <button class="btn ghost" onClick={m.restartSetup}>
              처음부터 다시 설정
            </button>
          </div>
        </Panel>

        <Panel title="계산 기준">
          <div class="stack">
            <div class="row" style={{ alignItems: 'flex-end' }}>
              <label class="field">
                학기 시작
                <input class="input" type="date" id="term-start" value={s.termStart} onChange={(e) => setSetting({ termStart: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="field">
                학기 끝
                <input class="input" type="date" id="term-end" value={s.termEnd} onChange={(e) => setSetting({ termEnd: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="field">
                편제 기준 주수
                <input class="input" type="number" id="target-weeks" min={1} max={40} style={{ width: '90px' }} value={s.targetWeeks} onChange={(e) => setSetting({ targetWeeks: Number((e.target as HTMLInputElement).value) || 17 })} />
              </label>
            </div>
            <label class="switch" style={{ fontWeight: 500 }}>
              <input type="checkbox" id="exam-counts" checked={s.examCountsAsClass} onChange={() => setSetting({ examCountsAsClass: !s.examCountsAsClass })} />
              <span class="track" />
              시험 교시도 교과 시수로 셉니다
            </label>
            <p class="small muted" style={{ margin: 0 }}>
              기준일(오늘): {s.today}. 이 날짜 이후만 보완 제안 대상입니다.
            </p>
          </div>
        </Panel>

        <Panel title="시간표 점검" hint="계산 전에 원본 자체의 모순을 찾습니다.">
          {m.issues.length === 0 ? (
            <div class="chip good">문제 없음</div>
          ) : (
            <div>
              {m.issues.map((i, k) => (
                <div class="issue" key={k}>
                  <span class={`chip ${i.level === 'error' ? 'crit' : 'warn'}`}>{i.level === 'error' ? '오류' : '확인'}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{i.title}</div>
                    <div class="small" style={{ color: 'var(--ink-2)' }}>
                      {i.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <RulesEditor rules={m.rules} custom={!!m.p.rules} onSave={(r) => m.set({ rules: r, applied: [] })} onReset={() => m.set({ rules: undefined, applied: [] })} />
      </div>
    </div>
  );
}

const RULE_FIELDS: { key: keyof RuleSet; label: string; hint: string }[] = [
  { key: 'staff', label: '학생 수업과 무관한 일정', hint: '교직원 회의·연수, 학부모 행사 등. 교시 표기가 있어도 무시' },
  { key: 'holiday', label: '휴업일', hint: '그날 수업이 없음' },
  { key: 'exam', label: '정기고사', hint: '시험 전 진도 비교의 기준점' },
  { key: 'fullday', label: '전일 행사', hint: '교시 표기가 없으면 하루 전체 대체' },
  { key: 'info', label: '참고 일정', hint: '교시 표기가 없으면 수업에 영향 없음' },
  { key: 'fixed', label: '옮길 수 없는 일정', hint: '보완 제안에서 교시를 옮기지 않음' },
];

function RulesEditor({ rules, custom, onSave, onReset }: { rules: RuleSet; custom: boolean; onSave: (r: RuleSet) => void; onReset: () => void }) {
  const toText = (r: RuleSet) => Object.fromEntries(RULE_FIELDS.map((f) => [f.key, r[f.key].join(', ')])) as Record<keyof RuleSet, string>;
  const [draft, setDraft] = useState(toText(rules));
  const dirty = RULE_FIELDS.some((f) => draft[f.key] !== toText(rules)[f.key]);
  const save = () =>
    onSave(
      Object.fromEntries(
        RULE_FIELDS.map((f) => [
          f.key,
          draft[f.key]
            .split(/[,\n]/)
            .map((w) => w.trim())
            .filter(Boolean),
        ]),
      ) as unknown as RuleSet,
    );
  return (
    <Panel
      title="일정 읽는 규칙"
      hint="일정 이름에 이 낱말이 들어 있으면 그렇게 분류합니다. 교시는 이름 앞이나 뒤의 숫자로 읽습니다 (진로교육 1-7, 3감염병예방교육). 6(1)은 6교시에 1교시 수업을 하고 1교시는 행사에 씀."
      right={custom ? <span class="chip info">학교 규칙 사용 중</span> : <span class="chip plain">기본 규칙</span>}
    >
      <div class="stack">
        <div class="rules-grid">
          {RULE_FIELDS.map((f) => (
            <label class="field" key={f.key}>
              {f.label}
              <textarea class="input" id={`rule-${f.key}`} rows={3} value={draft[f.key]} onInput={(e) => setDraft({ ...draft, [f.key]: (e.target as HTMLTextAreaElement).value })} />
              <span class="small muted" style={{ fontWeight: 400 }}>
                {f.hint}
              </span>
            </label>
          ))}
        </div>
        <div class="row">
          <button class="btn primary" disabled={!dirty} onClick={save}>
            규칙 저장
          </button>
          {custom && (
            <button
              class="btn ghost"
              onClick={() => {
                setDraft(toText(DEFAULT_RULES));
                onReset();
              }}
            >
              기본 규칙으로
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
