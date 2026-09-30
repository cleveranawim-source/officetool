import { fmtShort } from '../engine/dates';
import { Icon, Panel } from './parts';
import { usePlanStore } from './planStore';
import type { Model } from './store';
import { AppSwitch, SUITE_NAME, SuiteBrand } from './suite';

/** 교무핏 홈: 도구 모음과 우리 학교 자료가 지금 어디까지 와 있는지 */
export function HomeApp({ m }: { m: Model }) {
  const ps = usePlanStore();
  const plan = ps.s;
  const today = m.p.settings.today;
  const month = Number(today.slice(5, 7));

  const sisuReady = m.p.setupDone && !m.sampleTimetable;
  const sisuDemo = m.p.setupDone && m.sampleTimetable;
  const b = m.baseMetrics;
  const checkCount = plan.items ? new Set([...ps.conflicts.keys(), ...plan.items.filter((i) => i.status === 'check').map((i) => i.id)]).size : 0;

  const planStatus = plan.items
    ? `${plan.fromYear + 1}학년도 1차안 ${plan.items.length}건 · 확인 필요 ${checkCount}건 · 수업일수 ${ps.stats?.total ?? 0}일`
    : plan.lastEvents
      ? `작년 일정 ${plan.lastEvents.length}건을 읽었습니다. 새 학년도 기본값을 정하면 1차안이 나옵니다.`
      : null;
  const sisuStatus = sisuReady
    ? `${m.timetable.school} ${m.timetable.term} · 시험 전 최대 격차 ${b.maxSpread}시간 · 편제 부족 ${b.deficitHours}시간`
    : sisuDemo
      ? '예시 학교로 둘러보는 중입니다.'
      : null;

  // 학년도 흐름에서 지금 할 일
  const phase = month === 12 || month === 1 ? 0 : month === 2 ? 1 : month === 7 ? 3 : 2;
  const FLOW = [
    { when: '12~1월', what: '새 학년도 학사일정 짜기', how: '작년 일정으로 1차안, 교사들과 시트에서 수정', href: '#plan' },
    { when: '2월', what: '시수 균형 미리 보기', how: '1차안을 시수 점검으로 보내 반·과목 차이 확인', href: '#plan' },
    { when: '학기 중', what: '시험 전 격차 점검·보완', how: '반간 격차가 큰 과목, 요일 교체·교시 이동 제안', href: '#dashboard' },
    { when: '학기 말', what: '편제 시수 확인', how: '목표보다 부족한 반·과목, 보강 필요 목록', href: '#suggest' },
  ];

  return (
    <div class="shell">
      <aside class="side">
        <SuiteBrand sub="교무업무 도구" />
        <AppSwitch current="home" />
        <div class="side-foot">
          {(sisuReady || sisuDemo || m.p.school) && (
            <div>
              <strong>{sisuReady || sisuDemo ? m.timetable.school : m.p.school?.name}</strong>
            </div>
          )}
          <div>기준일 {fmtShort(today)}</div>
        </div>
      </aside>

      <main class="main">
        <header class="home-hero">
          <div class="eyebrow">교무업무 도구 모음 · 무료 · 오픈소스</div>
          <h1>{SUITE_NAME}</h1>
          <p>학사일정을 짜고, 그 일정 때문에 빠지는 수업을 반·과목별로 점검합니다. 학교 시간표와 학사일정을 한 번 넣으면 도구들이 함께 씁니다.</p>
        </header>

        <section class="tool-grid" aria-label="도구">
          <ToolCard
            icon={<Icon.cal />}
            name="학사일정 짜기"
            desc="작년 학사일정을 넣으면 새 학년도 공휴일에 맞춰 1차안을 짭니다. 겹치는 일정은 후보와 함께 확인 필요로 남기고, 선생님들이 구글 시트에서 함께 고칩니다."
            status={planStatus}
            alert={checkCount > 0}
            href="#plan"
            action={plan.items ? '1차안 이어서 보기' : plan.lastEvents ? '이어서 하기' : '1차안 만들기'}
          />
          <ToolCard
            icon={<Icon.grid />}
            name="시수 점검"
            desc="시간표와 학사일정으로 반·과목별 실제 수업 시수를 계산합니다. 시험 전 진도가 뒤처지는 반을 찾고, 요일 교체 같은 보완 방법을 제안합니다."
            status={sisuStatus}
            alert={sisuReady && b.maxSpread >= 4}
            href="#dashboard"
            action={sisuReady ? '결과 보기' : sisuDemo ? '예시 계속 보기' : '시작하기'}
          />
          <ToolCard icon={<Icon.swap />} name="시간표 교체" desc="출장·연가로 빠지는 수업(결보강), 수업 맞바꾸기, 행사 교시 이동을 학교 조건에 맞춰 찾고, 반간 시수 차이까지 함께 봅니다." soon />
          <ToolCard icon={<Icon.flag />} name="고교학점제 이수 점검" desc="과목마다 수업 횟수 3분의 2 이수 기준을 학사일정과 함께 미리 점검합니다." soon />
        </section>

        <div class="grid-2">
          <Panel title="한 해 흐름" hint="학년도 흐름에 맞춰 쓰면 좋습니다. 지금 할 일을 표시했습니다.">
            <ol class="flow">
              {FLOW.map((f, i) => (
                <li key={f.what} class={i === phase ? 'now' : ''}>
                  <span class="flow-when">{f.when}</span>
                  <a href={f.href}>
                    <b>{f.what}</b>
                    <span class="small muted">{f.how}</span>
                  </a>
                  {i === phase && <span class="chip good">지금</span>}
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="우리 학교 자료" hint="도구들이 함께 쓰는 자료입니다. 이 브라우저 안에만 저장됩니다.">
            <dl class="data-list">
              <div>
                <dt>학교</dt>
                <dd>{m.p.school ? `${m.p.school.name} · ${m.p.school.year}학년도 ${m.p.school.semester}학기` : sisuDemo ? '예시 학교' : <span class="muted">아직 없음</span>}</dd>
              </div>
              <div>
                <dt>시간표</dt>
                <dd>{m.p.setupDone ? `${m.timetable.classes.length}학급 · ${m.timetable.days.reduce((a, n) => a + n, 0)}교시/주${m.sampleTimetable ? ' (예시)' : ''}` : <span class="muted">아직 없음</span>}</dd>
              </div>
              <div>
                <dt>학사일정</dt>
                <dd>{m.p.setupDone ? `${fmtShort(m.p.settings.termStart)} ~ ${fmtShort(m.p.settings.termEnd)} · 일정 ${m.events.length}건` : <span class="muted">아직 없음</span>}</dd>
              </div>
              <div>
                <dt>1차안</dt>
                <dd>{plan.items ? `${plan.fromYear + 1}학년도 · ${plan.items.length}건${plan.sheetUrl ? ' · 구글 시트 있음' : ''}` : <span class="muted">아직 없음</span>}</dd>
              </div>
            </dl>
            <div class="row" style={{ marginTop: '12px' }}>
              <a class="btn" href="#data">
                {m.p.setupDone ? '자료 바꾸기' : '자료 넣기'}
              </a>
            </div>
          </Panel>
        </div>

        <p class="small muted home-foot">
          계산은 모두 이 브라우저 안에서 합니다. 학사일정 짜기의 AI 도움은 선생님이 켤 때만 일정 이름과 날짜를 보냅니다. ·{' '}
          <a href="https://github.com/cleveranawim-source/officetool" target="_blank" rel="noopener">
            소스 코드
          </a>
        </p>
      </main>
    </div>
  );
}

function ToolCard({
  icon,
  name,
  desc,
  status,
  alert,
  href,
  action,
  soon,
}: {
  icon: preact.JSX.Element;
  name: string;
  desc: string;
  status?: string | null;
  alert?: boolean;
  href?: string;
  action?: string;
  soon?: boolean;
}) {
  return (
    <article class={`tool-card ${soon ? 'soon' : ''}`}>
      <div class="tool-head">
        <span class="tool-icon">{icon}</span>
        <h2>{name}</h2>
        {soon && <span class="chip plain">준비 중</span>}
      </div>
      <p>{desc}</p>
      {status && <div class={`tool-status ${alert ? 'alert' : ''}`}>{status}</div>}
      {!soon && href && (
        <a class="btn primary" href={href}>
          {action}
        </a>
      )}
    </article>
  );
}
