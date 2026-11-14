import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { run, validateParams } from '../../engines/cache/model';
import type { Params } from '../../engines/cache/model';
import { Player } from '../../player/Player';
import { useNarrow } from '../../app/media';
import { BreakIt } from './BreakIt';
import { Paper } from './Paper';
import { cacheStage, cacheWrong, polish, withRowAsks } from './scene';
import {
  encodeSequence,
  exampleParams,
  setExampleParams,
  trySequence,
  makeParams,
  mappingKey,
  mappingKeys,
  mappingOf,
  parseSequence,
  policyKey,
  policyKeys,
  policyOf,
  showSequence,
} from './setup';
import './cache.css';

const tabs = [
  { key: '', label: '讲解' },
  { key: 'try', label: '试一试' },
  { key: 'quiz', label: '练习' },
  { key: 'break', label: '弄坏它' },
] as const;

/** 一份参数 → 引擎 Trace（加上点选行的题）和台面。参数不变时引用不变。 */
function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = polish(withRowAsks(run(params)));
    return { trace, stage: cacheStage(params, narrow), wrong: cacheWrong(params) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

const examples = [
  { key: 'direct', label: '直接映射', params: exampleParams },
  { key: 'set', label: '2 路组相联 LRU', params: setExampleParams },
] as const;

/** 讲解：两道例题，直接映射和 2 路组相联（LRU）。所选例题在网址参数 ex。 */
function Walkthrough() {
  const [ex, setEx] = useParam('ex', 'direct', (raw) => (examples.some((item) => item.key === raw) ? raw : 'direct'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0];
  const { trace, stage, wrong } = useRun(example.params);
  return (
    <>
      <div class="cr-controls">
      <div class="cr-choice" role="group" aria-label="例题">
        {examples.map((item) => (
          <button
            key={item.key}
            type="button"
            class={`pl-btn${item.key === example.key ? ' is-on' : ''}`}
            aria-pressed={item.key === example.key}
            onClick={() => {
              if (item.key === example.key) return;
              setStep('0');
              setEx(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      </div>
      <Player key={example.key} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} onWrong={wrong} />
    </>
  );
}

const defaultSeq = encodeSequence(trySequence);

function Try() {
  const [mapKey, setMapKey] = useParam('map', 'direct', (raw) => (mappingKeys.some((item) => item.key === raw) ? raw : 'direct'));
  const [repKey, setRepKey] = useParam('rep', 'lru', (raw) => (policyKeys.some((item) => item.key === raw) ? raw : 'lru'));
  const [seq, setSeq] = useParam('seq', defaultSeq);
  const [, setStep] = useParam('s', '0');
  const parsed = useMemo(() => parseSequence(seq.replace(/,/g, ' ')), [seq]);
  const accesses = parsed.problems.length === 0 ? parsed.accesses : trySequence;
  const [draft, setDraft] = useState(() => showSequence(accesses));
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => setDraft(showSequence(accesses)), [seq]);

  const mapping = mappingOf(mapKey);
  const policy = policyOf(repKey);
  const params = useMemo(() => makeParams(mapping, policy, accesses), [mapping, policy, accesses]);
  const { trace, stage, wrong } = useRun(params);

  const variants = useMemo(
    () =>
      [
        makeParams('直接', 'LRU', accesses),
        makeParams('组相联', 'LRU', accesses),
        makeParams('组相联', 'LFU', accesses),
        makeParams('全相联', 'LRU', accesses),
        makeParams('全相联', 'LFU', accesses),
      ].map((p) => ({ params: p, result: run(p).result })),
    [accesses],
  );

  const choose = (p: Params) => {
    setStep('0');
    setMapKey(mappingKey(p.mapping));
    if (p.replacement) setRepKey(policyKey(p.replacement));
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = parseSequence(draft);
    const trial = makeParams(mapping, policy, next.accesses);
    const issues = next.problems.length > 0 ? next.problems : validateParams(trial);
    setProblems(issues);
    if (issues.length > 0) return;
    setStep('0');
    setSeq(encodeSequence(next.accesses));
  };

  return (
    <>
      <div class="cr-controls">
        <div class="cr-choice" role="group" aria-label="映射方式">
          {mappingKeys.map((item) => (
            <button
              key={item.key}
              type="button"
              class={`pl-btn${item.mapping === mapping ? ' is-on' : ''}`}
              aria-pressed={item.mapping === mapping}
              onClick={() => {
                setStep('0');
                setMapKey(item.key);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div class="cr-choice" role="group" aria-label="替换算法">
          {policyKeys.map((item) => (
            <button
              key={item.key}
              type="button"
              class={`pl-btn${mapping !== '直接' && item.policy === policy ? ' is-on' : ''}`}
              aria-pressed={mapping !== '直接' && item.policy === policy}
              disabled={mapping === '直接'}
              onClick={() => {
                setStep('0');
                setRepKey(item.key);
              }}
            >
              {item.label}
            </button>
          ))}
          {mapping === '直接' && <span class="cr-note">直接映射每块只有一行可放，不用替换算法</span>}
        </div>
        <form class="cr-seq" onSubmit={submit}>
          <label for="cr-seq">访问序列</label>
          <input
            id="cr-seq"
            class="pl-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellcheck={false}
            value={draft}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <button type="submit" class="pl-btn">
            换上
          </button>
          <p class="cr-note">地址 0–31，空格隔开，写操作前加「写」，例如 写10</p>
          {problems.length > 0 && (
            <p class="cr-problem" role="alert">
              {problems[0]}
            </p>
          )}
        </form>
      </div>

      <Player key={JSON.stringify(params)} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} onWrong={wrong} />
      <div class="cr-compare-wrap">
        <table class="cr-compare">
          <caption>同一串地址，换映射和替换算法</caption>
          <thead>
            <tr>
              <th scope="col">映射</th>
              <th scope="col">替换</th>
              <th scope="col">命中</th>
              <th scope="col">h</th>
            </tr>
          </thead>
          <tbody>
            {variants.map(({ params: p, result }) => {
              const current = p.mapping === mapping && (p.mapping === '直接' || p.replacement === policy);
              return (
                <tr key={`${p.mapping}${p.replacement ?? ''}`} class={current ? 'is-current' : ''}>
                  <td>
                    <button type="button" class="cr-pick" aria-current={current ? 'true' : undefined} onClick={() => choose(p)}>
                      {mappingKeys.find((item) => item.mapping === p.mapping)?.label}
                    </button>
                  </td>
                  <td>{p.mapping === '直接' ? '不用' : p.replacement}</td>
                  <td>{result['命中次数']}</td>
                  <td>{result['h']}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </>
  );
}

export default function Page() {
  const [tab, setTab] = useParam('t', '', (raw) => (tabs.some((item) => item.key === raw) ? raw : ''));
  const [step, setStep] = useParam('s', '0');
  // 每个标签页记住自己的步数：试一试 → 练习 → 试一试，回到原来那一步。
  const [memo] = useState(() => new Map<string, string>());
  const current = tab;
  return (
    <div class="cr">
      <div class="cr-tabs" role="tablist" aria-label="这一页的部分">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`cr-tab-${item.key || 'learn'}`}
            aria-selected={item.key === current}
            aria-controls="cr-panel"
            class="cr-tab"
            onClick={() => {
              if (item.key === current) return;
              memo.set(current, step);
              setTab(item.key);
              setStep(memo.get(item.key) ?? '0');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id="cr-panel" role="tabpanel" aria-labelledby={`cr-tab-${current || 'learn'}`}>
        {current === '' && <Walkthrough />}
        {current === 'try' && <Try />}
        {current === 'quiz' && <Paper />}
        {current === 'break' && <BreakIt />}
      </div>
    </div>
  );
}
