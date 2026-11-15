/**
 * 第 6、8 章四页（6-arbiter、6-serial、8-intr、8-mask）共用的小件：标签页、题面的问号、文字说明块。
 * 不算任何结果。
 */
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import type { Trace } from '../../engines/trace';

export interface TabSpec {
  id: string;
  name: string;
  render: () => ComponentChildren;
}

/** 讲解、试一试、练习、弄坏它。所在标签页写进网址参数 t；每个标签页记住自己的步数。 */
export function PageTabs({ tabs, label }: { tabs: TabSpec[]; label: string }) {
  const ids = tabs.map((tab) => tab.id);
  const [tab, setTab] = useParam('t', ids[0]!, (raw) => (ids.includes(raw) ? raw : ids[0]!));
  const [step, setStep] = useIntParam('s', 0, 0, 10_000);
  const [memo] = useState(() => new Map<string, number>());
  const current = tabs.find((item) => item.id === tab) ?? tabs[0]!;
  return (
    <div class="pg">
      <div class="tabs" role="tablist" aria-label={label}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`pg-tab-${item.id}`}
            aria-selected={item.id === current.id}
            aria-controls="pg-panel"
            onClick={() => {
              if (item.id === current.id) return;
              memo.set(current.id, step);
              setTab(item.id);
              setStep(memo.get(item.id) ?? 0);
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div id="pg-panel" class="pg-panel" role="tabpanel" aria-labelledby={`pg-tab-${current.id}`}>
        {current.render()}
      </div>
    </div>
  );
}

/** 题面末尾的问号去掉：题目栏下面另有作答说明。 */
export function plainAsks<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return {
    ...trace,
    steps: trace.steps.map((step) => (step.ask ? { ...step, ask: { ...step.ask, prompt: step.ask.prompt.replace(/的屏蔽字是什么[？?]/, '的屏蔽字').replace(/[？?](\s*（[^）]*）)?\s*$/, '$1') } } : step)),
  };
}

/** 网址里的题号：1–9999 的整数。 */
export function useSeed(): [number, (next: number) => void] {
  const [text, set] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(9999, Math.trunc(Number(raw)) || 1))));
  return [Number(text), (next) => set(String(Math.max(1, Math.min(9999, next))))];
}
