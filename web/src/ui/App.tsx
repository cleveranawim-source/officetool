import { useEffect, useState } from 'preact/hooks';
import { defaultEventsLabel, eventsAreSample } from '@events';
import { fmtShort } from '../engine/dates';
import { CalendarView } from './CalendarView';
import { CellDrawer } from './CellDrawer';
import { DataView } from './DataView';
import { BrandMark, Icon, TipProvider } from './parts';
import { useModel } from './store';
import { Setup } from './Setup';
import { SuggestView } from './SuggestView';
import { Dashboard, Exams, MatrixPanel, Teachers, type Pick } from './views';

const VIEWS = [
  { id: 'dashboard', label: '한눈에 보기', icon: Icon.home, title: '시수 현황', desc: '학사일정을 반영한 반·과목별 수업 시수입니다. 칸을 누르면 어떤 날 무엇 때문에 빠졌는지 보입니다.' },
  { id: 'calendar', label: '학사일정', icon: Icon.cal, title: '학사일정', desc: '캘린더 일정을 시수 규칙으로 읽은 결과입니다. 분류가 틀리면 여기서 고칩니다.' },
  { id: 'matrix', label: '반·과목', icon: Icon.grid, title: '반·과목 시수표', desc: '학년별로 모든 반과 과목을 한 번에 비교합니다.' },
  { id: 'exams', label: '시험 대비', icon: Icon.flag, title: '시험 전 진도 격차', desc: '시험 범위는 학년 공통입니다. 시험 전날까지 반마다 몇 시간 수업했는지 비교합니다.' },
  { id: 'teachers', label: '교사 시수', icon: Icon.user, title: '교사 시수', desc: '시간표에서 읽은 교사별 주당 시수와, 학사일정 때문에 실제로 빠지는 수업입니다.' },
  { id: 'suggest', label: '보완 제안', icon: Icon.swap, title: '보완 제안', desc: '요일 교체와 행사 교시 이동으로 부족분과 반간 격차를 줄이는 방법입니다. 켜 보면 모든 화면이 다시 계산됩니다.' },
  { id: 'data', label: '데이터·설정', icon: Icon.data, title: '데이터와 설정', desc: '시간표와 학사일정을 가져오고, 계산 기준을 정합니다.' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

function readHash(): ViewId {
  const h = typeof location !== 'undefined' ? location.hash.slice(1) : '';
  return (VIEWS.find((v) => v.id === h)?.id ?? 'dashboard') as ViewId;
}

export function App() {
  const m = useModel();
  const [view, setView] = useState<ViewId>(readHash);
  const [pick, setPick] = useState<Pick>(null);

  useEffect(() => {
    const on = () => setView(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (id: string) => {
    setView(id as ViewId);
    try {
      history.replaceState(null, '', `#${id}`);
    } catch {
      /* 무시 */
    }
    window.scrollTo(0, 0);
  };

  if (!m.p.setupDone) return <Setup m={m} />;

  const v = VIEWS.find((x) => x.id === view)!;
  const l = m.ledger;
  const lowConf = m.events.filter((e) => e.rule.confidence === 'low').length;
  const errors = m.issues.filter((i) => i.level === 'error').length;
  const sampleEv = m.p.eventSource === 'sample' && eventsAreSample;
  const srcLabel = m.p.eventSource === 'sample' ? defaultEventsLabel : m.p.eventSource === 'ics' ? '학사일정 파일' : '구글 캘린더';

  return (
    <TipProvider>
      <div class="shell">
        <aside class="side">
          <div class="brand">
            <BrandMark />
            <div>
              <div class="brand-name">시수핏</div>
              <div class="brand-sub">학사일정 시수 균형 점검</div>
            </div>
          </div>
          <nav class="nav" aria-label="화면">
            {VIEWS.map((x) => (
              <button key={x.id} aria-current={x.id === view ? 'page' : undefined} onClick={() => go(x.id)}>
                <x.icon />
                {x.label}
                {x.id === 'calendar' && lowConf > 0 && <span class="count">{lowConf}</span>}
                {x.id === 'data' && errors > 0 && <span class="count">{errors}</span>}
                {x.id === 'suggest' && m.suggestions.length > 0 && (
                  <span class="count" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {m.suggestions.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div class="side-foot">
            <div>
              <strong>{m.timetable.school}</strong>
              <br />
              {m.timetable.term} · {m.timetable.classes.length}학급
            </div>
            <div>
              <i class="dot" style={{ background: sampleEv ? 'var(--warn)' : 'var(--good)' }} />
              {srcLabel} · {m.events.length}건
            </div>
            <div>
              {fmtShort(l.settings.termStart)} ~ {fmtShort(l.settings.termEnd)}
            </div>
          </div>
        </aside>

        <main class="main">
          <header class="page-head">
            <div>
              <div class="eyebrow">
                {m.timetable.school} · 기준일 {fmtShort(l.settings.today)}
              </div>
              <h1>{v.title}</h1>
              <p>{v.desc}</p>
            </div>
          </header>

          {(sampleEv || m.sampleTimetable) && (
            <div class="banner" role="note" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>
                <b>예시 학교입니다.</b> 시간표는 실제 중학교 시간표를 익명화한 것이고, 학사일정은 공휴일만 실제입니다.
              </span>
              <button class="btn primary" onClick={m.restartSetup}>
                우리 학교로 시작하기
              </button>
            </div>
          )}

          {view === 'dashboard' && <Dashboard m={m} pick={pick} onPick={setPick} go={go} />}
          {view === 'calendar' && <CalendarView m={m} />}
          {view === 'matrix' && (
            <div class="stack">
              <MatrixPanel l={l} pick={pick} onPick={setPick} />
              <MatrixPanel l={l} pick={pick} onPick={setPick} initialMode="target" />
            </div>
          )}
          {view === 'exams' && <Exams l={l} onPick={setPick} />}
          {view === 'teachers' && <Teachers l={l} />}
          {view === 'suggest' && <SuggestView m={m} onPick={setPick} />}
          {view === 'data' && <DataView m={m} />}
        </main>
      </div>
      {pick && <CellDrawer l={l} cls={pick.cls} subject={pick.subject} onClose={() => setPick(null)} />}
    </TipProvider>
  );
}
