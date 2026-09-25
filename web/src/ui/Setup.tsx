import { useMemo, useState } from 'preact/hooks';
import { computeLedger, weeklyCounts } from '../engine/compute';
import { fmtShort } from '../engine/dates';
import { describeEventTable, readEventTable } from '../engine/eventTable';
import { mergeHolidays } from '../engine/holidays';
import { importClassTimetable, type ImportResult } from '../engine/importTimetable';
import { parseEvents } from '../engine/parseEvents';
import { anonymizeTeachers } from '../engine/privacy';
import { isAcademic, sortSubjects } from '../engine/subjects';
import type { CalEvent, EventKind, EventRule, Settings } from '../engine/types';
import { WEEKDAYS } from '../engine/types';
import { validateTimetable } from '../engine/validate';
import { readEventsFile, readTimetableFile } from './files';
import { BrandMark, KIND_LABEL, KindTag, Seg } from './parts';
import type { Model, SchoolInfo } from './store';

const STEPS = ['학교', '시간표', '학사일정', '확인'] as const;

function termDates(year: number, semester: 1 | 2): { termStart: string; termEnd: string } {
  return semester === 1 ? { termStart: `${year}-03-02`, termEnd: `${year}-07-20` } : { termStart: `${year}-08-18`, termEnd: `${year}-12-31` };
}

export function Setup({ m }: { m: Model }) {
  const [step, setStep] = useState(-1);
  const now = new Date();
  const [school, setSchool] = useState<SchoolInfo>(
    m.p.school ?? { name: '', level: 'middle', year: now.getFullYear(), semester: now.getMonth() >= 7 ? 2 : 1 },
  );
  const [settings, setSettings] = useState<Settings>(() => ({
    ...m.p.settings,
    ...(m.p.school ? {} : termDates(school.year, school.semester)),
  }));
  const [tt, setTt] = useState<(ImportResult & { sheet?: string }) | null>(null);
  const [hideNames, setHideNames] = useState(false);
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [evSource, setEvSource] = useState<'ics' | 'sheet' | 'skip'>('ics');
  const [overrides, setOverrides] = useState<Record<string, Partial<EventRule>>>({});

  const term = `${school.year}학년도 ${school.semester}학기`;

  if (step === -1) return <Welcome onStart={() => setStep(0)} onDemo={m.startDemo} hasPrevious={!!m.p.school} onBack={() => m.set({ setupDone: true })} />;

  const canNext = step === 0 ? school.name.trim().length > 0 && settings.termStart < settings.termEnd : step === 1 ? !!tt : true;

  const finish = () => {
    const timetable = { ...tt!.timetable, school: school.name.trim(), term };
    m.set({
      setupDone: true,
      school: { ...school, name: school.name.trim() },
      settings,
      timetable: hideNames ? anonymizeTeachers(timetable) : timetable,
      events: events ?? [],
      eventSource: 'ics',
      overrides,
      applied: [],
    });
  };

  return (
    <div class="setup">
      <header class="setup-head">
        <div class="brand">
          <BrandMark />
          <div class="brand-name">시수핏</div>
        </div>
        <ol class="steps" aria-label="설정 단계">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined} class={i < step ? 'done' : ''}>
              <span class="n">{i < step ? '✓' : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </header>

      <main class="setup-card">
        {step === 0 && <StepSchool school={school} setSchool={setSchool} settings={settings} setSettings={setSettings} />}
        {step === 1 && <StepTimetable tt={tt} setTt={setTt} hideNames={hideNames} setHideNames={setHideNames} school={school.name} term={term} />}
        {step === 2 && <StepEvents settings={settings} year={school.year} semester={school.semester} source={evSource} setSource={setEvSource} events={events} setEvents={setEvents} />}
        {step === 3 && tt && (
          <StepReview tt={tt} events={events ?? []} settings={settings} overrides={overrides} setOverrides={setOverrides} />
        )}
      </main>

      <footer class="setup-foot">
        <button class="btn ghost" onClick={() => setStep(step - 1)}>
          {step === 0 ? '처음으로' : '이전'}
        </button>
        {step < 3 ? (
          <button class="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            {step === 2 && !events?.length ? '공휴일만으로 계속' : '다음'}
          </button>
        ) : (
          <button class="btn primary" onClick={finish}>
            결과 보기
          </button>
        )}
      </footer>
    </div>
  );
}

/* ---------- 시작 화면 ---------- */

function Welcome({ onStart, onDemo, hasPrevious, onBack }: { onStart: () => void; onDemo: () => void; hasPrevious: boolean; onBack: () => void }) {
  return (
    <div class="welcome">
      <div class="welcome-inner">
        <div class="brand">
          <BrandMark />
          <div class="brand-name">시수핏</div>
        </div>
        <h1>
          학사일정 때문에 빠지는 수업,
          <br />
          반마다 얼마나 차이 날까요?
        </h1>
        <p class="lead">
          시간표와 학사일정만 넣으면 반·과목별로 실제 수업 시수를 계산합니다. 시험 전에 진도가 뒤처지는 반을 먼저 찾고, 요일 교체 같은
          보완 방법까지 제안합니다.
        </p>
        <WeekGrid />
        <ul class="features">
          <li>
            <b>반간 격차</b>
            <span>공휴일·행사가 요일마다 다르게 걸려 생기는 반별 진도 차이</span>
          </li>
          <li>
            <b>시험 대비</b>
            <span>시험 전날까지 과목별로 어느 반이 몇 시간 적은지</span>
          </li>
          <li>
            <b>보완 제안</b>
            <span>어느 날을 어느 요일 시간표로 운영하면 되는지</span>
          </li>
        </ul>
        <div class="privacy">
          <b>학교 자료는 밖으로 나가지 않습니다.</b> 모든 계산은 이 브라우저 안에서만 하고, 서버에 아무것도 보내지 않습니다.
        </div>
        <div class="row">
          <button class="btn primary big" onClick={onStart}>
            우리 학교로 시작하기
          </button>
          <button class="btn big" onClick={onDemo}>
            예시 학교로 둘러보기
          </button>
          {hasPrevious && (
            <button class="btn ghost" onClick={onBack}>
              이전 결과로 돌아가기
            </button>
          )}
        </div>
        <p class="small muted">지금은 중학교를 지원합니다. 고등학교·초등학교는 준비 중입니다.</p>
      </div>
    </div>
  );
}

/** 일주일 시간표 격자: 공휴일 하루가 통째로 빠지고, 행사 교시가 흩어져 빠지는 모습 */
function WeekGrid() {
  const holiday = 4;
  const events = new Set(['2-0', '2-4', '0-5', '3-5', '1-1']);
  return (
    <div class="weekgrid" aria-hidden="true">
      {WEEKDAYS.map((d, di) => (
        <div class="wg-col" key={d}>
          <span class="wg-day">{d}</span>
          {Array.from({ length: di === 1 || di === 3 ? 7 : 6 }, (_, p) => (
            <i key={p} class={di === holiday ? 'off' : events.has(`${di}-${p}`) ? 'ev' : ''} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- 1. 학교 ---------- */

function StepSchool({
  school,
  setSchool,
  settings,
  setSettings,
}: {
  school: SchoolInfo;
  setSchool: (s: SchoolInfo) => void;
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  const setTerm = (year: number, semester: 1 | 2) => {
    setSchool({ ...school, year, semester });
    setSettings({ ...settings, ...termDates(year, semester) });
  };
  return (
    <div class="stack" style={{ gap: '20px' }}>
      <div>
        <h2>학교 정보</h2>
        <p class="muted">학기 기간은 개학일과 방학식(종업식) 날짜로 맞춰 주세요.</p>
      </div>
      <label class="field">
        학교 이름
        <input class="input" id="school-name" value={school.name} placeholder="예: 한빛중학교" onInput={(e) => setSchool({ ...school, name: (e.target as HTMLInputElement).value })} />
      </label>
      <div class="field">
        학교급
        <div class="level-cards" role="radiogroup" aria-label="학교급">
          {(
            [
              ['middle', '중학교', '45분 · 학기당 17주'],
              ['high', '고등학교', '준비 중'],
              ['elementary', '초등학교', '준비 중'],
            ] as const
          ).map(([v, name, sub]) => (
            <button
              key={v}
              role="radio"
              aria-checked={school.level === v}
              disabled={v !== 'middle'}
              class="level"
              onClick={() => setSchool({ ...school, level: v })}
            >
              <b>{name}</b>
              <span>{sub}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="row" style={{ alignItems: 'flex-end', gap: '16px' }}>
        <label class="field">
          학년도
          <input class="input" type="number" id="school-year" style={{ width: '100px' }} value={school.year} onChange={(e) => setTerm(Number((e.target as HTMLInputElement).value), school.semester)} />
        </label>
        <div class="field">
          학기
          <Seg
            label="학기"
            value={school.semester}
            onChange={(v) => setTerm(school.year, v)}
            options={[
              { value: 1, label: '1학기' },
              { value: 2, label: '2학기' },
            ]}
          />
        </div>
        <label class="field">
          개학일
          <input class="input" type="date" id="setup-start" value={settings.termStart} onChange={(e) => setSettings({ ...settings, termStart: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          학기 마지막 날
          <input class="input" type="date" id="setup-end" value={settings.termEnd} onChange={(e) => setSettings({ ...settings, termEnd: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <div class="row" style={{ alignItems: 'flex-end', gap: '16px' }}>
        <label class="field">
          편제 기준 주수
          <input class="input" type="number" id="setup-weeks" min={1} max={40} style={{ width: '100px' }} value={settings.targetWeeks} onChange={(e) => setSettings({ ...settings, targetWeeks: Number((e.target as HTMLInputElement).value) || 17 })} />
        </label>
        <label class="switch" style={{ fontWeight: 500, paddingBottom: '6px' }}>
          <input type="checkbox" id="setup-exam" checked={settings.examCountsAsClass} onChange={() => setSettings({ ...settings, examCountsAsClass: !settings.examCountsAsClass })} />
          <span class="track" />
          시험 보는 교시도 교과 시수로 셉니다
        </label>
      </div>
    </div>
  );
}

/* ---------- 2. 시간표 ---------- */

function StepTimetable({
  tt,
  setTt,
  hideNames,
  setHideNames,
  school,
  term,
}: {
  tt: (ImportResult & { sheet?: string }) | null;
  setTt: (r: (ImportResult & { sheet?: string }) | null) => void;
  hideNames: boolean;
  setHideNames: (v: boolean) => void;
  school: string;
  term: string;
}) {
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState('');
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState('');

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setFileName(f.name);
    try {
      setTt(await readTimetableFile(f, school, term));
    } catch (e) {
      setTt(null);
      setErr((e as Error).message);
    }
  };
  const onPaste = () => {
    setErr('');
    try {
      setTt(importClassTimetable(paste, school, term));
      setFileName('붙여넣은 표');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const issues = tt ? validateTimetable(tt.timetable) : [];
  const grades = tt ? [...new Set(tt.timetable.classes.map((c) => c.grade))].sort() : [];

  return (
    <div class="stack" style={{ gap: '18px' }}>
      <div>
        <h2>시간표</h2>
        <p class="muted">시간표 프로그램에서 내려받은 엑셀 파일을 그대로 올리세요. 반마다 한 줄인 표와 반마다 한 칸짜리 표 모두 읽습니다.</p>
      </div>
      <label
        class={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFile(e.dataTransfer?.files[0]);
        }}
      >
        <input type="file" id="tt-file" accept=".xlsx,.csv,.tsv,.txt" onChange={(e) => onFile((e.target as HTMLInputElement).files?.[0])} />
        <b>{fileName ? fileName : '시간표 엑셀 파일을 끌어다 놓거나 눌러서 고르기'}</b>
        <span>.xlsx · .csv 파일. "전체 학반 시간표" 또는 "학반별 시간표"</span>
      </label>
      <details>
        <summary>또는 시트에서 복사해 붙여넣기</summary>
        <div class="stack" style={{ marginTop: '10px' }}>
          <textarea class="input" id="tt-paste-setup" rows={5} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} placeholder="요일 머리글(월·화·수·목·금) 줄부터 마지막 반까지 복사해 붙여 넣으세요." />
          <button class="btn" style={{ alignSelf: 'flex-start' }} onClick={onPaste} disabled={!paste.trim()}>
            붙여넣은 표 읽기
          </button>
        </div>
      </details>

      {err && (
        <div class="banner" role="alert">
          <span>{err}</span>
        </div>
      )}

      {tt && (
        <div class="result">
          <div class="row" style={{ justifyContent: 'space-between' }}>
            <b>
              {tt.timetable.classes.length}개 반을 읽었습니다{tt.sheet ? ` (시트 "${tt.sheet}")` : ''}
            </b>
            <span class="small muted">
              {tt.timetable.days.map((n, i) => `${WEEKDAYS[i]}${n}`).join(' ')}교시 · {tt.layout === 'wide' ? '반마다 한 줄' : '반마다 한 칸'} 형식
            </span>
          </div>
          <div class="table-wrap">
            <table class="t">
              <thead>
                <tr>
                  <th>학년</th>
                  <th class="r">반</th>
                  <th>과목별 주당 시수 (첫 반 기준)</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => {
                  const cs = tt.timetable.classes.filter((c) => c.grade === g);
                  const w = weeklyCounts(cs[0]);
                  return (
                    <tr key={g}>
                      <td>{g}학년</td>
                      <td class="r num">{cs.length}</td>
                      <td class="small">
                        {sortSubjects(Object.keys(w))
                          .filter(isAcademic)
                          .map((s) => `${s} ${w[s]}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {issues.length > 0 && (
            <details>
              <summary>
                <span class={`chip ${issues.some((i) => i.level === 'error') ? 'crit' : 'warn'}`}>확인 {issues.length}건</span> 시간표 원본에서 이상한 점
              </summary>
              <ul class="small">
                {issues.slice(0, 20).map((i, k) => (
                  <li key={k}>
                    <b>{i.title}</b> — {i.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {tt.warnings.length > 0 && (
            <details>
              <summary class="small muted">읽으면서 채우거나 비운 칸 {tt.warnings.length}곳</summary>
              <ul class="small">
                {tt.warnings.slice(0, 30).map((w, k) => (
                  <li key={k}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <label class="switch" style={{ fontWeight: 500 }}>
            <input type="checkbox" id="hide-names" checked={hideNames} onChange={() => setHideNames(!hideNames)} />
            <span class="track" />
            교사 이름 대신 "국어1"처럼 바꿔 저장하기
          </label>
        </div>
      )}
    </div>
  );
}

/* ---------- 3. 학사일정 ---------- */

function StepEvents({
  settings,
  year,
  semester,
  source,
  setSource,
  events,
  setEvents,
}: {
  settings: Settings;
  year: number;
  semester: 1 | 2;
  source: 'ics' | 'sheet' | 'skip';
  setSource: (s: 'ics' | 'sheet' | 'skip') => void;
  events: CalEvent[] | null;
  setEvents: (e: CalEvent[] | null) => void;
}) {
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [paste, setPaste] = useState('');
  const inTerm = (e: CalEvent) => e.end >= settings.termStart && e.start <= settings.termEnd;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    setNote('');
    try {
      const r = await readEventsFile(f, { year, semester, termEnd: settings.termEnd });
      const ev = r.events.filter(inTerm);
      if (r.format !== 'ics') setNote(`${r.sheet ? `"${r.sheet}" 시트, ` : ''}${describeEventTable(r.format, r.events.length, ev.length, r.days)}`);
      setEvents(ev);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const onPaste = () => {
    setErr('');
    const r = readEventTable(paste, { year, semester });
    const ev = r.events.filter(inTerm);
    if (!r.events.length) {
      setNote('');
      setErr('날짜를 찾지 못했습니다. 목록형은 한 줄에 날짜와 일정 이름이, 달력형은 월·화·수·목·금 머리글과 날짜 줄이 있어야 합니다.');
      return;
    }
    setNote(describeEventTable(r.format, r.events.length, ev.length, r.days));
    setEvents(ev);
  };

  return (
    <div class="stack" style={{ gap: '18px' }}>
      <div>
        <h2>학사일정</h2>
        <p class="muted">공휴일은 자동으로 들어갑니다. 행사·특별교육·시험 일정을 넣어 주세요.</p>
      </div>
      <Seg
        label="학사일정 가져오기"
        value={source}
        onChange={(v) => {
          setSource(v);
          setNote('');
          setEvents(v === 'skip' ? [] : null);
        }}
        options={[
          { value: 'ics', label: '구글 캘린더' },
          { value: 'sheet', label: '구글 시트·엑셀' },
          { value: 'skip', label: '나중에 넣기' },
        ]}
      />
      {source === 'ics' && (
        <div class="grid-2">
          <ol class="howto">
            <li>구글 캘린더에서 학사일정 캘린더 이름 옆 <b>⋮ → 설정 및 공유</b></li>
            <li>
              <b>캘린더 통합</b>의 <b>iCal 형식의 공개 주소</b>(비공개 캘린더면 비공개 주소)를 복사
            </li>
            <li>새 탭 주소창에 붙여 넣으면 <code class="inline">.ics</code> 파일이 내려받아집니다</li>
            <li>그 파일을 오른쪽에 올리기</li>
          </ol>
          <label class="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), onFile(e.dataTransfer?.files[0]))}>
            <input type="file" id="setup-ics" accept=".ics,text/calendar" onChange={(e) => onFile((e.target as HTMLInputElement).files?.[0])} />
            <b>.ics 파일 올리기</b>
            <span>끌어다 놓거나 눌러서 고르기</span>
          </label>
        </div>
      )}
      {source === 'sheet' && (
        <div class="stack">
          <div class="grid-2">
            <ol class="howto">
              <li>
                목록형(<b>날짜 | 일정</b>)도, 달력형(<b>월·화·수·목·금</b> 칸에 날짜와 일정)도 됩니다. 어느 모양인지는 알아서 판단합니다
              </li>
              <li>
                구글 시트에서 <b>파일 → 다운로드 → Microsoft Excel(.xlsx)</b>로 받아 오른쪽에 올리거나
              </li>
              <li>
                표 전체를 선택(<b>Ctrl+A</b>)해 복사한 뒤 아래 칸에 붙여 넣기
              </li>
            </ol>
            <label class="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), onFile(e.dataTransfer?.files[0]))}>
              <input type="file" id="setup-sheet" accept=".xlsx,.csv,.tsv,.txt" onChange={(e) => onFile((e.target as HTMLInputElement).files?.[0])} />
              <b>.xlsx 파일 올리기</b>
              <span>끌어다 놓거나 눌러서 고르기</span>
            </label>
          </div>
          <textarea
            class="input"
            id="setup-list"
            rows={6}
            value={paste}
            onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
            placeholder={'시트에서 복사한 표를 그대로 붙여 넣으세요.\n목록형:  2026-10-07\t(1,2학년) 중간고사\n달력형:  월\t주\t월\t화\t수\t목\t금 …'}
          />
          <button class="btn" style={{ alignSelf: 'flex-start' }} onClick={onPaste} disabled={!paste.trim()}>
            표 읽기
          </button>
        </div>
      )}
      {err && (
        <div class="banner" role="alert">
          <span>{err}</span>
        </div>
      )}
      {events && events.length > 0 && (
        <div class="result">
          <b>
            학기 안 일정 {events.length}건을 읽었습니다 ({fmtShort(settings.termStart)} ~ {fmtShort(settings.termEnd)})
          </b>
          {note && <div class="small">{note}</div>}
          <div class="small muted">
            {events
              .slice(0, 8)
              .map((e) => `${fmtShort(e.start)} ${e.title}`)
              .join(' · ')}
            {events.length > 8 ? ' …' : ''}
          </div>
        </div>
      )}
      {source === 'skip' && <p class="small muted">공휴일만 반영해서 계산합니다. 학사일정은 나중에 "데이터·설정"에서 넣을 수 있습니다.</p>}
    </div>
  );
}

/* ---------- 4. 확인 ---------- */

const KINDS: EventKind[] = ['holiday', 'vacation', 'exam', 'fullday', 'periods', 'dayswap', 'periodswap', 'info'];

function StepReview({
  tt,
  events,
  settings,
  overrides,
  setOverrides,
}: {
  tt: ImportResult;
  events: CalEvent[];
  settings: Settings;
  overrides: Record<string, Partial<EventRule>>;
  setOverrides: (o: Record<string, Partial<EventRule>>) => void;
}) {
  const parsed = useMemo(() => parseEvents(mergeHolidays(events, settings.termStart, settings.termEnd), overrides), [events, settings, overrides]);
  const l = useMemo(() => computeLedger(tt.timetable, parsed, settings), [tt, parsed, settings]);
  const counts = new Map<EventKind, number>();
  for (const e of parsed) counts.set(e.rule.kind, (counts.get(e.rule.kind) ?? 0) + 1);
  const check = parsed.filter((e) => e.rule.confidence === 'low' || overrides[e.id]);
  const rest = parsed.filter((e) => !check.includes(e) && e.source !== 'auto');
  const exams = l.checkpoints.filter((c) => c.date < '9999');

  return (
    <div class="stack" style={{ gap: '18px' }}>
      <div>
        <h2>일정을 이렇게 읽었습니다</h2>
        <p class="muted">일정 이름으로 자동 분류했습니다. 애매한 것만 확인해 주세요. 나중에 "학사일정" 화면에서도 고칠 수 있습니다.</p>
      </div>
      <div class="kpis">
        <div class="kpi">
          <span class="label">수업일수</span>
          <span class="value num">
            {l.schoolDays}
            <small>일</small>
          </span>
          <span class="sub">기준 {settings.targetWeeks * 5}일</span>
        </div>
        <div class="kpi">
          <span class="label">반마다 빠지는 교시</span>
          <span class="value num">
            {Math.round(l.losses.length / Math.max(1, l.classes.length))}
            <small>교시</small>
          </span>
          <span class="sub">휴업·행사·시험 합</span>
        </div>
        <div class="kpi">
          <span class="label">시험 기준점</span>
          <span class="value num">
            {exams.length}
            <small>개</small>
          </span>
          <span class="sub">{exams.map((c) => c.label).join(', ') || '시험 일정 없음'}</span>
        </div>
        <div class={`kpi ${check.length ? 'alert' : ''}`}>
          <span class="label">확인이 필요한 일정</span>
          <span class="value num">
            {check.length}
            <small>건</small>
          </span>
          <span class="sub">아래 목록</span>
        </div>
      </div>
      <div class="legend">
        {KINDS.filter((k) => counts.get(k)).map((k) => (
          <KindTag key={k} kind={k} text={`${KIND_LABEL[k]} ${counts.get(k)}`} />
        ))}
      </div>
      {check.length > 0 && <ReviewList list={check} overrides={overrides} setOverrides={setOverrides} />}
      {rest.length > 0 && (
        <details>
          <summary>자동으로 읽은 나머지 일정 {rest.length}건 보기</summary>
          <ReviewList list={rest} overrides={overrides} setOverrides={setOverrides} />
        </details>
      )}
    </div>
  );
}

function ReviewList({
  list,
  overrides,
  setOverrides,
}: {
  list: ReturnType<typeof parseEvents>;
  overrides: Record<string, Partial<EventRule>>;
  setOverrides: (o: Record<string, Partial<EventRule>>) => void;
}) {
  return (
        <div class="ev-list">
          {list.map((e) => (
            <div class="ev" key={e.id}>
              <span class="date">{fmtShort(e.start)}</span>
              <div>
                <div class="title">{e.title}</div>
                <div class="reason">{e.rule.reason}</div>
              </div>
              <select
                class="input"
                value={e.rule.kind}
                aria-label={`${e.title} 분류`}
                onChange={(ev) => {
                  const kind = (ev.target as HTMLSelectElement).value as EventKind;
                  setOverrides({ ...overrides, [e.id]: { kind, label: KIND_LABEL[kind] } });
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
  );
}
