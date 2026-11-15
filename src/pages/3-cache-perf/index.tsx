import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { run } from '../../engines/cacheperf/model';
import type { Params } from '../../engines/cacheperf/model';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { Field, PageShell, Seg } from '../3-vm-replace/kit';
import { Paper } from './Paper';
import { PERF_CONCLUSION, PERF_NEEDS, PERF_QUESTION, perfMistakes, perfStage, perfWrong } from './scene';
import { DEFAULT_TRY, examples, kindKeys, tryParams } from './setup';
import type { TryInput } from './setup';
import '../3-vm-replace/kit.css';

function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = run(params);
    return { trace, stage: perfStage(trace, narrow), wrong: perfWrong(trace), mistakes: perfMistakes(trace) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

/** 讲解的题面：条件照引擎的参数写，不写答案。 */
function Lead({ ex }: { ex: string }) {
  if (ex === 'back')
    return (
      <p class="t4-lead">
        <Rich text="t_c = 20 ns，t_m = 120 ns，测得" /> <Term k="平均访问时间">平均访问时间</Term> <Rich text="t_a = 23 ns，求" /> <Term k="命中率" />、r 和 <Term k="访问效率" />
        。这里的 23 ns 就是第一题求出的 <Rich text="t_a" />，看能不能倒回 h。
      </p>
    );
  if (ex === 'e')
    return (
      <p class="t4-lead">
        <Rich text="t_c = 20 ns，t_m = 120 ns，要让" /> <Term k="访问效率" />
        <Rich text=" e 达到 80%，命中率 h 至少是多少，这时 t_a 是多少。" />
      </p>
    );
  return (
    <p class="t4-lead">
      CPU 执行一段程序，<Term k="cache" /> 完成存取 3880 次，主存完成 120 次。<Rich text="t_c = 20 ns，t_m = 120 ns，求" /> <Term k="命中率" /> h、r、<Term k="访问效率" /> e 和 <Term k="平均访问时间" /> <Rich text="t_a" />。
      {ex === 'ta' ? <Rich text="和第一题同一组数，换一种次序：先用式(3.5) 求 t_a。" /> : null}
    </p>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'fwd', (raw) => (examples.some((item) => item.key === raw) ? raw : 'fwd'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0]!;
  const made = useRun(example.params);
  const { trace, stage } = made;
  return (
    <>
      <div class="t4-controls">
        <div class="seg" role="group" aria-label="例题">
          {examples.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={item.key === example.key}
              onClick={() => {
                if (item.key === example.key) return;
                setStep('0');
                setEx(item.key);
              }}
            >
              <Rich text={item.label} />
            </button>
          ))}
        </div>
      </div>
      <Lead ex={example.key} />
      <Player
        key={example.key}
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        values={stage.values}
        askFrame={stage.askFrame}
        frame={stage.frame}
        onWrong={made.wrong}
        question={PERF_QUESTION}
        conclusion={PERF_CONCLUSION}
        needs={PERF_NEEDS}
        mistakes={made.mistakes}
      />
    </>
  );
}

/** 一格数：标签在上，输入框在下。 */
function NumField({ label, value, onInput }: { label: string; value: string; onInput: (value: string) => void }) {
  return (
    <label class="field t4-num">
      <span class="field-label">
        <Rich text={label} />
      </span>
      <input class="input is-mono" type="text" inputMode="decimal" autoComplete="off" value={value} onInput={(event) => onInput(event.currentTarget.value)} />
    </label>
  );
}

function Try() {
  const params = {
    kind: useParam('kind', DEFAULT_TRY.kind),
    order: useParam('order', DEFAULT_TRY.order),
    nc: useParam('nc', DEFAULT_TRY.nc),
    nm: useParam('nm', DEFAULT_TRY.nm),
    tc: useParam('tc', DEFAULT_TRY.tc),
    tm: useParam('tm', DEFAULT_TRY.tm),
    ta: useParam('ta', DEFAULT_TRY.ta),
    e: useParam('e', DEFAULT_TRY.e),
    ghz: useParam('ghz', DEFAULT_TRY.ghz),
    cpi: useParam('cpi', DEFAULT_TRY.cpi),
    mem: useParam('mem', DEFAULT_TRY.mem),
    l1: useParam('l1', DEFAULT_TRY.l1),
    l2ns: useParam('l2ns', DEFAULT_TRY.l2ns),
    l2: useParam('l2', DEFAULT_TRY.l2),
  };
  const [, setStep] = useParam('s', '0');
  const input = Object.fromEntries(Object.entries(params).map(([key, [value]]) => [key, value])) as unknown as TryInput;
  const set = (patch: Partial<TryInput>) => {
    setStep('0');
    for (const [key, value] of Object.entries(patch)) params[key as keyof TryInput][1](value as string);
  };
  const tried = tryParams(input);
  const fallback = useMemo(() => tryParams(DEFAULT_TRY).params!, []);
  const made = useRun(tried.params ?? fallback);
  const { trace, stage } = made;

  const [draft, setDraft] = useState<TryInput>(input);
  const [problem, setProblem] = useState('');
  const inputKey = JSON.stringify(input);
  useEffect(() => setDraft(input), [inputKey]);
  const edit = (key: keyof TryInput) => (value: string) => setDraft({ ...draft, [key]: value });
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = tryParams({ ...draft, kind: input.kind, order: input.order });
    setProblem(next.problem);
    if (next.params) set(draft);
  };

  const kind = input.kind;
  return (
    <>
      <div class="t4-controls">
        <Field label="已知什么，求什么">
          <div class="seg" role="group" aria-label="题型">
            {kindKeys.map((item) => (
              <button key={item.key} type="button" aria-pressed={item.key === kind} onClick={() => item.key !== kind && set({ kind: item.key })}>
                <Rich text={item.label} />
              </button>
            ))}
          </div>
        </Field>
        {kind === 'fwd' ? (
          <Field label="次序">
            <div class="seg" role="group" aria-label="次序">
              {[
                { key: 'book', label: '例 3.4：h、r、e、t_a' },
                { key: 'ta', label: '先求 t_a' },
              ].map((item) => (
                <button key={item.key} type="button" aria-pressed={item.key === input.order} onClick={() => item.key !== input.order && set({ order: item.key })}>
                  <Rich text={item.label} />
                </button>
              ))}
            </div>
          </Field>
        ) : null}
      </div>
      <form class="t4-form" onSubmit={submit}>
        {kind === 'fwd' ? (
          <>
            <NumField label="N_c（次）" value={draft.nc} onInput={edit('nc')} />
            <NumField label="N_m（次）" value={draft.nm} onInput={edit('nm')} />
          </>
        ) : null}
        {kind === 'ta' ? <NumField label="t_a（ns）" value={draft.ta} onInput={edit('ta')} /> : null}
        {kind === 'e' ? <NumField label="e（如 0.75 或 75%）" value={draft.e} onInput={edit('e')} /> : null}
        {kind !== 'l2' ? (
          <>
            <NumField label="t_c（ns）" value={draft.tc} onInput={edit('tc')} />
            <NumField label="t_m（ns）" value={draft.tm} onInput={edit('tm')} />
          </>
        ) : (
          <>
            <NumField label="时钟频率（GHz）" value={draft.ghz} onInput={edit('ghz')} />
            <NumField label="基本 CPI" value={draft.cpi} onInput={edit('cpi')} />
            <NumField label="访问主存（ns）" value={draft.mem} onInput={edit('mem')} />
            <NumField label="一级缺失率（%）" value={draft.l1} onInput={edit('l1')} />
            <NumField label="访问二级 cache（ns）" value={draft.l2ns} onInput={edit('l2ns')} />
            <NumField label="必须访问主存（%）" value={draft.l2} onInput={edit('l2')} />
          </>
        )}
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {problem || tried.problem ? (
        <p class="field-error" role="alert">
          <Rich text={problem || tried.problem} />
        </p>
      ) : null}
      <Player
        key={JSON.stringify(tried.params ?? fallback)}
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        values={stage.values}
        askFrame={stage.askFrame}
        frame={stage.frame}
        onWrong={made.wrong}
      />
    </>
  );
}

/** 弄坏它：在「由 t_a 求 h」那道题里把 t_a 改到 t_c、t_m 之外，看 h 变成什么。 */
function Break() {
  const params = examples[2]!.params as Extract<Params, { kind: '由ta求h' }>;
  const made = useRun(params);
  const { trace, stage } = made;
  const [way, setWay] = useParam('way', 'slow', (raw) => (raw === 'fast' ? 'fast' : 'slow'));
  const ta = way === 'slow' ? params.tm + 30 : params.tc - 8;
  const h = (params.tm - ta) / (params.tm - params.tc);
  const hText = String(Number(h.toFixed(4))).replace('-', '−');
  const breakIt = (): Breakage => ({
    label: `把平均访问时间改成 ${ta} ns`,
    patch: {
      'g-tag': { value: `${ta} ns` },
      'q-h': { value: hText },
      track: { segments: [{ lane: 0, from: 0, to: params.tc, ink: 'data' }, { lane: 2, from: 0, to: params.tm, ink: 'data' }, { lane: 1, from: 0, to: ta, ink: 'accent' }], markers: [{ at: ta, lane: 1, text: `t_a = ${ta} ns` }] },
    },
    moves: [{ value: hText, from: 'calc', to: 'q-h', via: ['w-h'] }],
    message:
      way === 'slow'
        ? `t_a 比 t_m 还长，代进 h = (t_m − t_a)/(t_m − t_c) 得 ${hText}，命中率成了负数。t_a 是 h·t_c 和 (1 − h)·t_m 两段接成的，最长也就是全都缺失时的 t_m；量出比 t_m 还慢，说明数据错了，或者存储系统里还有别的等待没算进去。`
        : `t_a 比 t_c 还短，代进去得 h = ${hText}，命中率超过 1。哪怕每次都命中，平均也只能快到 t_c：cache 本身就要这么久。`,
  });
  return (
    <>
      <div class="t4-controls">
        <Field label="测出来的 t_a">
          <Seg
            label="测出来的 t_a"
            items={[
              { key: 'slow', label: '比 t_m 还长' },
              { key: 'fast', label: '比 t_c 还短' },
            ]}
            value={way as 'slow' | 'fast'}
            onChoose={(key) => setWay(key)}
          />
        </Field>
      </div>
      <p class="t4-note">
        <Rich text="题目是「由 t_a 求 h」：t_c = 20 ns，t_m = 120 ns。点舞台下的按钮，把 t_a 改到这两条之外。" />
      </p>
      <Player key={`break-${way}`} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} breakIt={() => breakIt()} />
    </>
  );
}

export default function Page() {
  return <PageShell id="cp" panels={{ '': Learn, try: Try, quiz: Paper, break: Break }} />;
}
