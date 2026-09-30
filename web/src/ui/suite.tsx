import { BrandMark, Icon } from './parts';

/** 통합 앱 이름. 바꿀 때는 여기와 index.html의 <title>만 */
export const SUITE_NAME = '교무핏';

export type AppId = 'plan' | 'sisu';

const APPS: { id: AppId; label: string; hash: string; icon: () => preact.JSX.Element }[] = [
  { id: 'plan', label: '학사일정 짜기', hash: 'plan', icon: Icon.cal },
  { id: 'sisu', label: '시수 점검', hash: 'dashboard', icon: Icon.grid },
];

export function appFromHash(hash: string): AppId {
  return hash.replace(/^#/, '').startsWith('plan') ? 'plan' : 'sisu';
}

export function SuiteBrand({ sub }: { sub: string }) {
  return (
    <div class="brand">
      <BrandMark />
      <div>
        <div class="brand-name">{SUITE_NAME}</div>
        <div class="brand-sub">{sub}</div>
      </div>
    </div>
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
        </a>
      ))}
    </nav>
  );
}
