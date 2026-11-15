import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { run } from '../../engines/vm/model';
import type { Params, State } from '../../engines/vm/model';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Field, PageShell, Seg } from '../3-vm-replace/kit';
import { Paper } from './Paper';
import { VM_CONCLUSION, VM_NEEDS, VM_QUESTION, group4, polish, vmMistakes, vmStage, vmWrong } from './scene';
import { DEFAULT_TRY, examples, log2, tryParams } from './setup';
import type { TryInput } from './setup';
import '../3-vm-replace/kit.css';

function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = polish(run(params));
    return { trace, stage: vmStage(trace, narrow), wrong: vmWrong(trace), mistakes: vmMistakes(trace) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'pt', (raw) => (examples.some((item) => item.key === raw) ? raw : 'pt'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0]!;
  const made = useRun(example.params);
  const { trace, stage } = made;
  return (
    <>
      <div class="t4-controls">
        <Seg
          label="例题"
          items={examples.map((item) => ({ key: item.key, label: item.label }))}
          value={example.key}
          onChoose={(key) => {
            setStep('0');
            setEx(key);
          }}
        />
      </div>
      <p class="t4-lead">
        页长 1K，<Term k="虚地址" />空间 32 页，主存 16 页。<Term k="页表" />里第 0、2、3 页在主存第 9、4、5 页，第 1、4 页的<Term k="有效位" />为 0。把虚地址 0DB4H、12A7H、0A1CH 变成<Term k="物理地址" />。
        {example.key === 'tlb' ? (
          <>
            这一题多了一张<Term k="快表" />，存着第 3 页和第 0 页，其余条件不变。
          </>
        ) : null}
      </p>
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
        question={VM_QUESTION}
        conclusion={VM_CONCLUSION}
        needs={VM_NEEDS}
        mistakes={made.mistakes}
      />
    </>
  );
}

const SIZES = ['512', '1024', '2048', '4096'] as const;
const sizeLabel = (n: string) => (Number(n) >= 1024 ? `${Number(n) / 1024}K` : n);

function Try() {
  const params = {
    size: useParam('size', DEFAULT_TRY.size),
    pages: useParam('pages', DEFAULT_TRY.pages),
    frames: useParam('frames', DEFAULT_TRY.frames),
    table: useParam('table', DEFAULT_TRY.table),
    tlb: useParam('tlb', DEFAULT_TRY.tlb),
    addr: useParam('addr', DEFAULT_TRY.addr),
    radix: useParam('radix', DEFAULT_TRY.radix),
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

  const [draft, setDraft] = useState({ pages: input.pages, frames: input.frames, table: input.table, tlb: input.tlb, addr: input.addr });
  const [problem, setProblem] = useState('');
  useEffect(() => setDraft({ pages: input.pages, frames: input.frames, table: input.table, tlb: input.tlb, addr: input.addr }), [input.pages, input.frames, input.table, input.tlb, input.addr]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = tryParams({ ...input, ...draft });
    setProblem(next.problem);
    if (next.params) set(draft);
  };

  return (
    <>
      <div class="t4-controls">
        <Field label="页长">
          <Seg label="页长" items={SIZES.map((key) => ({ key, label: sizeLabel(key) }))} value={input.size as (typeof SIZES)[number]} onChoose={(key) => set({ size: key })} />
        </Field>
        <Field label="地址写法">
          <Seg
            label="地址写法"
            items={[
              { key: 'hex', label: '十六进制' },
              { key: 'dec', label: '十进制' },
            ]}
            value={input.radix as 'hex' | 'dec'}
            onChoose={(key) => set({ radix: key, addr: key === 'dec' ? '6703 3077 11120' : DEFAULT_TRY.addr })}
          />
        </Field>
      </div>
      <form class="t4-form" onSubmit={submit}>
        <label class="field t4-num">
          <span class="field-label">虚存页数</span>
          <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.pages} onInput={(event) => setDraft({ ...draft, pages: event.currentTarget.value })} />
        </label>
        <label class="field t4-num">
          <span class="field-label">主存页数</span>
          <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.frames} onInput={(event) => setDraft({ ...draft, frames: event.currentTarget.value })} />
        </label>
        <label class="field t4-grow">
          <span class="field-label">页表</span>
          <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} value={draft.table} onInput={(event) => setDraft({ ...draft, table: event.currentTarget.value })} />
        </label>
        <label class="field t4-grow">
          <span class="field-label">快表（可空）</span>
          <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} value={draft.tlb} onInput={(event) => setDraft({ ...draft, tlb: event.currentTarget.value })} />
        </label>
        <label class="field t4-grow">
          <span class="field-label">虚地址</span>
          <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} value={draft.addr} onInput={(event) => setDraft({ ...draft, addr: event.currentTarget.value })} />
        </label>
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {problem || tried.problem ? (
        <p class="field-error" role="alert">
          {problem || tried.problem}
        </p>
      ) : (
        <p class="t4-note">页表每项写「页号:物理页号」，不在主存写「页号:-」，没写的页有效位按 0。快表照同样写法，只放在主存的页。最多 8 个虚地址。</p>
      )}
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

/** 弄坏它：页内地址少切或多切一位，看页号和页内地址各指到哪。 */
function Break() {
  const params = examples[0]!.params;
  const made = useRun(params);
  const { stage } = made;
  // 弄坏它不出预测题：有待答的题时播放器不给「弄坏」按钮。
  const trace = useMemo(() => ({ ...made.trace, steps: made.trace.steps.map(({ ask: _ask, ...rest }) => rest) }), [made.trace]);
  const offW = log2(params.pageSize);
  const [cut, setCut] = useParam('cut', 'less', (raw) => (raw === 'more' ? 'more' : 'less'));
  const [, setStep] = useParam('s', '0');
  const breakIt = (state: State): Breakage | null => {
    const s = state.current;
    if (s.page === null || s.valid !== null || s.tlb !== null) return null;
    const w = cut === 'less' ? offW - 1 : offW + 1;
    const bits = s.bits;
    const pageBits = bits.slice(0, bits.length - w);
    const offBits = bits.slice(bits.length - w);
    const page = parseInt(pageBits || '0', 2);
    return {
      label: cut === 'less' ? '页内地址少切一位' : '页内地址多切一位',
      patch: { page: { value: `${pageBits}（${page}）` }, off: { value: group4(offBits) } },
      moves: [{ value: pageBits, from: 'va', to: 'page', via: ['va-page'], ink: 'addr' }],
      message:
        cut === 'less'
          ? `页内地址只剩 ${w} 位，只能指到一页的前 ${2 ** w} 个单元，页长 ${params.pageSize} 的后一半没有地址；逻辑页号多出一位成了 ${page}，去查的是页表里另一项，物理地址整个错位。`
          : `页内地址成了 ${w} 位，可一页只有 ${params.pageSize} 个单元：多出的那一位本该属于页号。逻辑页号少一位成了 ${page}，相邻两页被当成同一页，查到的物理页号对一半的地址是错的。`,
    };
  };
  return (
    <>
      <div class="t4-controls">
        <Field label={`页长 ${params.pageSize}，页内地址 ${offW} 位`}>
          <Seg
            label="页内地址怎么切错"
            items={[
              { key: 'less', label: '少切一位' },
              { key: 'more', label: '多切一位' },
            ]}
            value={cut as 'less' | 'more'}
            onChoose={(key) => setCut(key)}
          />
        </Field>
        <button type="button" class="btn" onClick={() => setStep('1')}>
          翻到切开那一步
        </button>
      </div>
      <p class="t4-note">翻到某个虚地址刚切开的那一步，点舞台下的按钮，看边界挪一位会怎样。</p>
      <Player key={`break-${cut}`} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} breakIt={(state) => breakIt(state)} />
    </>
  );
}

export default function Page() {
  return <PageShell id="va" panels={{ '': Learn, try: Try, quiz: Paper, break: Break }} />;
}
