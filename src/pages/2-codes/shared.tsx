/**
 * 第 2 章码制、浮点三页（2-codes、2-ieee、2-fpadd）共用的页面外壳：标签页、例题选择、「需要先会」。
 * 标签页和例题都写进网址（useParam）。样式只用 components.css 的 .tabs、.seg、.btn。
 */
import type { ComponentChildren } from 'preact';
import { useParam } from '../../app/url-state';

export const TABS = [
  { id: 'learn', name: '讲解' },
  { id: 'try', name: '试一试' },
  { id: 'practice', name: '练习' },
  { id: 'break', name: '弄坏它' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export function usePageTab(): [TabId, (id: TabId) => void] {
  const [tab, setTab] = useParam('tab', 'learn', (raw) => (TABS.some((item) => item.id === raw) ? raw : 'learn'));
  const [, setStep] = useParam('s', '0');
  const current = (TABS.find((item) => item.id === tab)?.id ?? 'learn') as TabId;
  const choose = (id: TabId) => {
    if (id === current) return;
    setStep('0');
    setTab(id);
  };
  return [current, choose];
}

export function PageTabs({ prefix, current, choose, children }: { prefix: string; current: TabId; choose: (id: TabId) => void; children: ComponentChildren }) {
  return (
    <>
      <div class="tabs" role="tablist" aria-label="本页">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${prefix}-tab-${item.id}`}
            aria-selected={item.id === current}
            aria-controls={`${prefix}-panel`}
            onClick={() => choose(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div id={`${prefix}-panel`} role="tabpanel" aria-labelledby={`${prefix}-tab-${current}`}>
        {children}
      </div>
    </>
  );
}

/** 选第几道例题（网址参数 ex，从 1 起）。 */
export function useExample(count: number): [number, (i: number) => void] {
  const [ex, setEx] = useParam('ex', '1', (raw) => String(Math.max(1, Math.min(count, Math.trunc(Number(raw)) || 1))));
  const [, setStep] = useParam('s', '0');
  const index = Math.max(0, Math.min(count - 1, Number(ex) - 1 || 0));
  return [
    index,
    (i: number) => {
      if (i === index) return;
      setStep('0');
      setEx(String(i + 1));
    },
  ];
}

export function Choice<T extends string>({ label, options, value, onPick, mono, names }: { label: string; options: readonly T[]; value: T; onPick: (next: T) => void; mono?: boolean; names?: (item: T) => string }) {
  return (
    <div class={`seg${mono ? ' is-mono' : ''}`} role="group" aria-label={label}>
      {options.map((item) => (
        <button key={item} type="button" aria-pressed={item === value} onClick={() => item !== value && onPick(item)}>
          {names ? names(item) : item}
        </button>
      ))}
    </div>
  );
}

/** 没有前置页面时的「需要先会」：样式同播放器的那一行。 */
export function NeedsText({ children }: { children: ComponentChildren }) {
  return <p class="pl-needs">需要先会：{children}</p>;
}

/** 练习的种子（网址参数 seed）。 */
export function useSeed(): [number, () => void] {
  const [seedText, setSeed] = useParam('seed', '1', (raw) => String(Math.max(1, Math.min(99999, Math.trunc(Number(raw)) || 1))));
  const [, setStep] = useParam('s', '0');
  const seed = Math.max(1, Math.min(99999, Math.trunc(Number(seedText)) || 1));
  return [
    seed,
    () => {
      setStep('0');
      setSeed(String(seed + 1));
    },
  ];
}
