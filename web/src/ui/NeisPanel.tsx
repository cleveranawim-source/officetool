import { useState } from 'preact/hooks';
import { addDays, fmtShort } from '../engine/dates';
import {
  gradesFor,
  neisRows,
  neisScheduleToEvents,
  neisTimetable,
  neisUrl,
  timetableRange,
  timetableService,
  toSchools,
  type NeisRow,
  type NeisSchool,
  type NeisService,
  type NeisTimetableResult,
} from '../engine/neis';
import type { CalEvent } from '../engine/types';
import { inAppsScript, server } from './bridge';

const KEY_STORE = 'sisufit:neis-key';

/** 인증키는 이 브라우저에만 둔다 (설정 파일·공용 저장에 넣지 않음) */
function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}
function saveKey(k: string) {
  try {
    if (k) localStorage.setItem(KEY_STORE, k);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* 저장이 막힌 브라우저: 이번 화면에서만 쓴다 */
  }
}

/** 브라우저가 NEIS를 직접 못 부를 때 */
class Blocked extends Error {
  constructor(public url: string) {
    super('blocked');
  }
}

async function getText(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`NEIS 응답 ${res.status}`);
    return await res.text();
  } catch (e) {
    if (inAppsScript()) return server.fetchNeis(url);
    // CORS·네트워크 막힘은 TypeError로 온다
    if (e instanceof TypeError) throw new Blocked(url);
    throw e;
  }
}

const ymd = (iso: string) => iso.replace(/-/g, '');

/** 여러 쪽(한 쪽 1000건)에 걸친 요청 하나 */
interface Job {
  service: NeisService;
  params: Record<string, string | number>;
  rows: NeisRow[];
  page: number;
  pages?: number;
  done: (rows: NeisRow[], total: number) => void;
}

export function NeisPanel({
  mode,
  defaultName,
  termStart,
  termEnd,
  today,
  year,
  semester,
  term,
  initial,
  onPick,
  onEvents,
  onTimetable,
}: {
  mode: 'schedule' | 'timetable';
  defaultName: string;
  termStart: string;
  termEnd: string;
  today?: string;
  year?: number;
  semester?: 1 | 2;
  term?: string;
  initial?: NeisSchool;
  onPick?: (s: NeisSchool) => void;
  onEvents?: (events: CalEvent[], school: NeisSchool, note: string) => void;
  onTimetable?: (r: NeisTimetableResult, school: NeisSchool, note: string) => void;
}) {
  const [key, setKey] = useState(loadKey);
  const [name, setName] = useState(initial?.name ?? defaultName);
  const [schools, setSchools] = useState<NeisSchool[] | null>(null);
  const [picked, setPicked] = useState<NeisSchool | undefined>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<Job | null>(null);
  const [pasted, setPasted] = useState('');
  const range0 = timetableRange(termStart, termEnd, today ?? termStart);
  const [ttFrom, setTtFrom] = useState(range0.from);
  const ttTo = addDays(ttFrom, 18);

  const updateKey = (k: string) => {
    setKey(k);
    saveKey(k.trim());
  };
  const pick = (s: NeisSchool) => {
    setPicked(s);
    onPick?.(s);
  };

  /** 한 쪽을 더하고, 남은 쪽이 있으면 다음 쪽 번호를 돌려준다 */
  const addPage = (job: Job, text: string): boolean => {
    const { rows, total } = neisRows(text, job.service);
    job.rows.push(...rows);
    job.pages = key ? Math.max(1, Math.ceil(total / 1000)) : 1;
    if (job.page < job.pages && rows.length > 0) {
      job.page++;
      return true;
    }
    job.done(job.rows, total);
    return false;
  };

  const run = async (job: Job) => {
    setErr('');
    setPending(null);
    setBusy(true);
    try {
      for (;;) {
        const text = await getText(neisUrl(job.service, { ...job.params, pIndex: job.page }, key));
        if (!addPage(job, text)) break;
      }
    } catch (e) {
      if (e instanceof Blocked) setPending({ ...job });
      else setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const readPasted = () => {
    if (!pending) return;
    setErr('');
    try {
      const job = pending;
      const more = addPage(job, pasted);
      setPasted('');
      setPending(more ? { ...job } : null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const search = () => {
    setSchools(null);
    setPicked(undefined);
    run({
      service: 'schoolInfo',
      params: { SCHUL_NM: name.trim() },
      rows: [],
      page: 1,
      done: (rows) => {
        const list = toSchools(rows);
        setSchools(list);
        if (!list.length) setErr('그 이름의 학교를 찾지 못했습니다. 이름 일부만 넣어 보세요 (예: "한빛중").');
        if (list.length === 1) pick(list[0]);
      },
    });
  };

  const loadSchedule = (school: NeisSchool) =>
    run({
      service: 'SchoolSchedule',
      params: { ATPT_OFCDC_SC_CODE: school.office, SD_SCHUL_CODE: school.code, AA_FROM_YMD: ymd(termStart), AA_TO_YMD: ymd(termEnd) },
      rows: [],
      page: 1,
      done: (rows, total) => {
        if (!rows.length) return setErr('NEIS에 이 기간 학사일정이 아직 없습니다. 학교가 NEIS에 학사일정을 입력했는지 확인하세요.');
        const events = neisScheduleToEvents(rows, gradesFor(school.kind)).filter((e) => e.start >= termStart && e.start <= termEnd);
        const partial = total > rows.length ? ` NEIS 전체 ${total}건 중 ${rows.length}건만 받았습니다${key ? '' : ' (인증키가 없으면 5건까지만 옵니다)'}.` : '';
        onEvents?.(events, school, `NEIS에서 ${school.name} 일정 ${events.length}건을 받았습니다.${partial}`);
      },
    });

  const loadTimetable = (school: NeisSchool) => {
    if (!key.trim()) return setErr('시간표는 한 학교에 수백 건이라 인증키가 있어야 받을 수 있습니다.');
    run({
      service: timetableService(school.kind),
      params: {
        ATPT_OFCDC_SC_CODE: school.office,
        SD_SCHUL_CODE: school.code,
        ...(year ? { AY: year } : {}),
        ...(semester ? { SEM: semester } : {}),
        TI_FROM_YMD: ymd(ttFrom),
        TI_TO_YMD: ymd(ttTo),
      },
      rows: [],
      page: 1,
      done: (rows) => {
        try {
          const r = neisTimetable(rows, school.name, term ?? '');
          const note =
            `NEIS에서 ${school.name} ${fmtShort(ttFrom)}~${fmtShort(ttTo)} 시간표(${r.dates}일)를 받아 요일별 평소 시간표로 정리했습니다.` +
            (r.varied ? ` 주마다 과목이 달랐던 ${r.varied}칸은 가장 많이 나온 과목으로 정했습니다.` : '');
          onTimetable?.(r, school, note);
        } catch (e) {
          setErr((e as Error).message);
        }
      },
    });
  };

  const pageNote = pending?.pages && pending.pages > 1 ? ` (${pending.page}/${pending.pages}쪽)` : '';

  return (
    <div class="stack neis">
      <label class="field">
        NEIS 인증키
        <input class="input" id={`neis-key-${mode}`} value={key} autoComplete="off" spellcheck={false} onInput={(e) => updateKey((e.target as HTMLInputElement).value)} placeholder="open.neis.go.kr에서 무료로 받은 키" />
        <span class="small muted">
          <a href="https://open.neis.go.kr/" target="_blank" rel="noopener">
            open.neis.go.kr
          </a>
          에서 회원가입 뒤 인증키를 신청하면 바로 나옵니다. 키는 이 브라우저에만 저장되고 설정 파일에는 들어가지 않습니다.
        </span>
      </label>
      <div class="row" style={{ alignItems: 'flex-end' }}>
        <label class="field" style={{ flex: 1 }}>
          학교 이름
          <input
            class="input"
            id={`neis-school-${mode}`}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && search()}
            placeholder="예: 한빛중학교"
          />
        </label>
        <button class="btn" onClick={search} disabled={!name.trim() || busy}>
          학교 찾기
        </button>
      </div>

      {schools && schools.length > 0 && (
        <div class="neis-list" role="listbox" aria-label="찾은 학교">
          {schools.slice(0, 30).map((s) => (
            <button
              key={`${s.office}${s.code}`}
              role="option"
              aria-selected={picked?.code === s.code}
              class={`neis-item ${picked?.code === s.code ? 'on' : ''}`}
              onClick={() => pick(s)}
            >
              <b>{s.name}</b>
              <span class="small muted">
                {s.officeName} · {s.address || s.kind}
              </span>
            </button>
          ))}
        </div>
      )}

      {picked && mode === 'schedule' && (
        <div class="row">
          <span class="small">
            <b>{picked.name}</b> <span class="muted">{picked.officeName}</span>
          </span>
          <button class="btn primary" onClick={() => loadSchedule(picked)} disabled={busy}>
            {busy ? '받는 중…' : '학사일정 받기'}
          </button>
        </div>
      )}
      {picked && mode === 'timetable' && (
        <div class="row" style={{ alignItems: 'flex-end' }}>
          <label class="field">
            받을 기간 (3주, 시작 날짜)
            <input class="input" type="date" id="neis-tt-from" value={ttFrom} onChange={(e) => setTtFrom((e.target as HTMLInputElement).value || range0.from)} />
          </label>
          <span class="small muted" style={{ paddingBottom: '9px' }}>
            ~ {fmtShort(ttTo)}. 행사가 적은 평소 주간일수록 정확합니다
          </span>
          <button class="btn primary" onClick={() => loadTimetable(picked)} disabled={busy}>
            {busy ? '받는 중…' : `${picked.name} 시간표 받기`}
          </button>
        </div>
      )}

      {pending && (
        <div class="banner neis-fallback" role="status">
          <div class="stack" style={{ gap: '8px', flex: 1 }}>
            <span>
              이 브라우저에서는 NEIS에 바로 접속할 수 없습니다.{' '}
              <a href={neisUrl(pending.service, { ...pending.params, pIndex: pending.page }, key)} target="_blank" rel="noopener">
                이 주소를 새 탭에서 열고{pageNote}
              </a>
              , 나온 글 전체를 복사해(Ctrl+A, Ctrl+C) 아래에 붙여 넣으세요.
            </span>
            <textarea class="input" id={`neis-paste-${mode}`} rows={3} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} placeholder={'{"' + pending.service + '":[…'} />
            <button class="btn" style={{ alignSelf: 'flex-start' }} onClick={readPasted} disabled={!pasted.trim()}>
              붙여 넣은 내용 읽기
            </button>
          </div>
        </div>
      )}
      {err && (
        <div class="banner" role="alert">
          <span>{err}</span>
        </div>
      )}
    </div>
  );
}
