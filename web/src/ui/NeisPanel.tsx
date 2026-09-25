import { useState } from 'preact/hooks';
import { gradesFor, neisRows, neisScheduleToEvents, neisUrl, toSchools, type NeisSchool } from '../engine/neis';
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

type Pending = { service: 'schoolInfo' | 'SchoolSchedule'; url: string };

export function NeisPanel({
  defaultName,
  termStart,
  termEnd,
  initial,
  onEvents,
}: {
  defaultName: string;
  termStart: string;
  termEnd: string;
  initial?: NeisSchool;
  onEvents: (events: CalEvent[], school: NeisSchool, note: string) => void;
}) {
  const [key, setKey] = useState(loadKey);
  const [name, setName] = useState(initial?.name ?? defaultName);
  const [schools, setSchools] = useState<NeisSchool[] | null>(null);
  const [picked, setPicked] = useState<NeisSchool | undefined>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [pasted, setPasted] = useState('');

  const updateKey = (k: string) => {
    setKey(k);
    saveKey(k.trim());
  };

  const showSchools = (text: string) => {
    const { rows } = neisRows(text, 'schoolInfo');
    const list = toSchools(rows);
    setSchools(list);
    if (!list.length) setErr('그 이름의 학교를 찾지 못했습니다. 이름 일부만 넣어 보세요 (예: "한빛중").');
    if (list.length === 1) setPicked(list[0]);
  };

  const showSchedule = (text: string, school: NeisSchool) => {
    const { rows, total } = neisRows(text, 'SchoolSchedule');
    const all = neisScheduleToEvents(rows, gradesFor(school.kind));
    const events = all.filter((e) => e.start >= termStart && e.start <= termEnd);
    if (!rows.length) {
      setErr('NEIS에 이 기간 학사일정이 아직 없습니다. 학교가 NEIS에 학사일정을 입력했는지 확인하세요.');
      return;
    }
    const partial = total > rows.length ? ` NEIS 전체 ${total}건 중 ${rows.length}건만 받았습니다${key ? '' : ' (인증키가 없으면 5건까지만 옵니다)'}.` : '';
    onEvents(events, school, `NEIS에서 ${school.name} 일정 ${events.length}건을 받았습니다.${partial}`);
  };

  const run = async (p: Pending, then: (text: string) => void) => {
    setErr('');
    setPending(null);
    setBusy(true);
    try {
      then(await getText(p.url));
    } catch (e) {
      if (e instanceof Blocked) setPending(p);
      else setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const search = () => {
    setSchools(null);
    setPicked(undefined);
    run({ service: 'schoolInfo', url: neisUrl('schoolInfo', { SCHUL_NM: name.trim() }, key) }, showSchools);
  };
  const load = (s: NeisSchool) =>
    run(
      {
        service: 'SchoolSchedule',
        url: neisUrl('SchoolSchedule', { ATPT_OFCDC_SC_CODE: s.office, SD_SCHUL_CODE: s.code, AA_FROM_YMD: ymd(termStart), AA_TO_YMD: ymd(termEnd) }, key),
      },
      (t) => showSchedule(t, s),
    );

  const readPasted = () => {
    if (!pending) return;
    setErr('');
    try {
      if (pending.service === 'schoolInfo') showSchools(pasted);
      else if (picked) showSchedule(pasted, picked);
      setPending(null);
      setPasted('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div class="stack neis">
      <label class="field">
        NEIS 인증키
        <input class="input" id="neis-key" value={key} autoComplete="off" spellcheck={false} onInput={(e) => updateKey((e.target as HTMLInputElement).value)} placeholder="open.neis.go.kr에서 무료로 받은 키" />
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
          <input class="input" id="neis-school" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && search()} placeholder="예: 한빛중학교" />
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
              onClick={() => setPicked(s)}
            >
              <b>{s.name}</b>
              <span class="small muted">
                {s.officeName} · {s.address || s.kind}
              </span>
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div class="row">
          <span class="small">
            <b>{picked.name}</b> <span class="muted">{picked.officeName}</span>
          </span>
          <button class="btn primary" onClick={() => load(picked)} disabled={busy}>
            {busy ? '받는 중…' : '학사일정 받기'}
          </button>
        </div>
      )}

      {pending && (
        <div class="banner neis-fallback" role="status">
          <div class="stack" style={{ gap: '8px', flex: 1 }}>
            <span>
              이 브라우저에서는 NEIS에 바로 접속할 수 없습니다.{' '}
              <a href={pending.url} target="_blank" rel="noopener">
                이 주소를 새 탭에서 열고
              </a>
              , 나온 글 전체를 복사해(Ctrl+A, Ctrl+C) 아래에 붙여 넣으세요.
            </span>
            <textarea class="input" id="neis-paste" rows={3} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} placeholder={'{"' + pending.service + '":[…'} />
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
