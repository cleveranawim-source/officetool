import { BrandMark, Icon } from './parts';

/** 통합 앱 이름. 바꿀 때는 여기와 index.html의 <title>만 */
export const SUITE_NAME = '교무핏';

export type AppId = 'home' | 'plan' | 'sisu' | 'swap';

const APPS: { id: AppId; label: string; hash: string; icon: () => preact.JSX.Element; beta?: boolean }[] = [
  { id: 'home', label: '홈', hash: 'home', icon: Icon.house },
  { id: 'plan', label: '학사일정 짜기', hash: 'plan', icon: Icon.cal },
  { id: 'sisu', label: '시수 점검', hash: 'dashboard', icon: Icon.grid },
  { id: 'swap', label: '시간표 교체', hash: 'swap', icon: Icon.swap, beta: true },
];

/** 주소 뒤 #으로 도구를 고른다: 없거나 #home이면 홈, #plan은 학사일정 짜기, #swap은 시간표 교체, 나머지(#dashboard 등)는 시수 점검 */
export function appFromHash(hash: string): AppId {
  const h = hash.replace(/^#/, '');
  if (!h || h === 'home') return 'home';
  if (h.startsWith('plan')) return 'plan';
  if (h.startsWith('swap')) return 'swap';
  return 'sisu';
}

export function SuiteBrand({ sub }: { sub: string }) {
  return (
    <a class="brand brand-link" href="#home" aria-label={`${SUITE_NAME} 홈`}>
      <BrandMark />
      <div>
        <div class="brand-name">{SUITE_NAME}</div>
        <div class="brand-sub">{sub}</div>
      </div>
    </a>
  );
}

/** 사이드바 맨 위의 도구 바꾸기 */
export function AppSwitch({ current }: { current: AppId }) {
  return (
    <nav class="apps" aria-label="도구">
      {APPS.map((a) => (
        <a key={a.id} href={`#${a.hash}`} aria-current={a.id === current ? 'page' : undefined}>
          <a.icon />
          {a.label}
          {a.beta && <span class="beta">베타</span>}
        </a>
      ))}
    </nav>
  );
}
