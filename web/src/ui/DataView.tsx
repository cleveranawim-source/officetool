import { useEffect, useState } from 'preact/hooks';
import { calendarIdFrom, parseICS } from '../engine/ics';
import { importClassTimetable } from '../engine/importTimetable';
import { WEEKDAYS } from '../engine/types';
import { inAppsScript, server } from './bridge';
import type { Model } from './store';
import { Panel, Seg } from './parts';

export function DataView({ m }: { m: Model }) {
  const tt = m.timetable;
  const s = m.p.settings;
  const [paste, setPaste] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [calInput, setCalInput] = useState(m.p.calendarId ?? '');
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

  const onIcs = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const events = parseICS(await f.text(), s.termEnd).filter((e) => e.end >= s.termStart && e.start <= s.termEnd);
    m.set({ events, eventSource: 'ics', applied: [], overrides: {} });
    setMsg(`${f.name}에서 일정 ${events.length}건을 읽었습니다.`);
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
                { value: 'sample', label: '예시 일정' },
                { value: 'ics', label: '.ics 파일' },
                { value: 'calendar', label: '구글 캘린더' },
              ]}
            />
            {m.p.eventSource === 'sample' && (
              <p class="small muted" style={{ margin: 0 }}>
                화면을 채우기 위한 예시입니다. 공휴일은 실제 날짜이고 나머지 행사는 가상입니다.
              </p>
            )}
            {m.p.eventSource === 'ics' && (
              <label class="field">
                구글 캘린더 → 설정 → 가져오기/내보내기에서 받은 .ics 파일
                <input class="input" type="file" id="ics-file" accept=".ics,text/calendar" onChange={onIcs} />
              </label>
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

        <Panel title="이 화면의 규칙" hint="캘린더 일정 제목을 이렇게 읽습니다.">
          <table class="t">
            <tbody>
              <tr>
                <td>
                  <code class="inline">진로교육 1-7</code>
                </td>
                <td>1~7교시를 진로교육으로 대체</td>
              </tr>
              <tr>
                <td>
                  <code class="inline">함께하는 삶1</code>
                </td>
                <td>1교시 특별교육</td>
              </tr>
              <tr>
                <td>
                  <code class="inline">2학년 수련회</code>
                </td>
                <td>2학년 전 교시 행사</td>
              </tr>
              <tr>
                <td>
                  <code class="inline">목요일 시간표 운영</code>
                </td>
                <td>그날 목요일 시간표로 수업</td>
              </tr>
              <tr>
                <td>
                  <code class="inline">재량휴업일</code>, 공휴일
                </td>
                <td>수업 없음 (공휴일은 자동으로 더함)</td>
              </tr>
              <tr>
                <td>
                  <code class="inline">2학기 중간고사</code>
                </td>
                <td>시험 기간 · 체크포인트</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
