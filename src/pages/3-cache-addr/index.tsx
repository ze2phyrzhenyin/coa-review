import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { run, widths } from '../../engines/cacheaddr/model';
import type { Params, State } from '../../engines/cacheaddr/model';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Field, PageShell, Seg, useStep } from '../3-vm-replace/kit';
import { Paper } from './Paper';
import { ADDR_CONCLUSION, ADDR_NEEDS, ADDR_QUESTION, addrConvention, addrMistakes, addrStage, addrWrong, polish } from './scene';
import { DEFAULT_TRY, examples, indexName, mappingKeys, tryParams } from './setup';
import type { TryInput } from './setup';
import '../3-vm-replace/kit.css';

/** 一份参数 → Trace 和台面。参数不变时引用不变。 */
function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = polish(run(params));
    return { trace, stage: addrStage(trace, narrow), wrong: addrWrong(trace), mistakes: addrMistakes(trace), convention: addrConvention(params) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

/** 同一组容量和地址，三种映射各切成什么样。数都由引擎算。 */
function Compare({ params }: { params: Params }) {
  const rows = useMemo(() => {
    const { rowsPerSet, ...rest } = params;
    const list: { label: string; p: Params }[] = [
      { label: '直接映射', p: { ...rest, mapping: '直接' } },
      { label: `${rowsPerSet ?? 2} 路组相联`, p: { ...rest, mapping: '组相联', rowsPerSet: rowsPerSet ?? 2 } },
      { label: '全相联', p: { ...rest, mapping: '全相联' } },
    ];
    return list.flatMap(({ label, p }) => {
      try {
        return [{ label, mapping: p.mapping, result: run(p).result }];
      } catch {
        return [];
      }
    });
  }, [params]);
  return (
    <div class="t4-table-wrap">
      <table class="t4-table">
        <caption>同一组数换映射方式</caption>
        <thead>
          <tr>
            <th scope="col">映射</th>
            <th scope="col">地址格式</th>
            {params.address ? (
              <>
                <th scope="col">标记</th>
                <th scope="col">行号或组号</th>
                <th scope="col">字地址</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, mapping, result }) => (
            <tr key={label} class={mapping === params.mapping ? 'is-current' : ''}>
              <th scope="row">{label}</th>
              <td>{result['地址格式']}</td>
              {params.address ? (
                <>
                  <td>{result['标记']}</td>
                  <td>{mapping === '全相联' ? '没有这一段' : result[indexName(mapping)]}</td>
                  <td>{result['字地址']}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'direct', (raw) => (examples.some((item) => item.key === raw) ? raw : 'direct'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0]!;
  const made = useRun(example.params);
  const { trace, stage } = made;
  const [index] = useStep(trace.steps.length);
  const mappingTerm = example.key === 'direct' ? <Term k="直接映射" /> : example.key === 'set' ? <Term k="组相联映射">每组 4 行的组相联映射</Term> : <Term k="全相联映射" />;
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
        主存 256K 字，cache 2K 字，每<Term k="块" /> 8 字，按字编址，采用{mappingTerm}。写出主存地址格式，并把地址 2D6B5H 切成<Term k="标记" />
        {example.key === 'full' ? '和' : '、'}
        {example.key === 'direct' ? <Term k="行号" /> : example.key === 'set' ? <Term k="组号" /> : null}
        {example.key === 'full' ? null : '、'}
        <Term k="字地址" />。{example.key === 'direct' ? '' : '数和直接映射那一题相同，只换了映射方式。'}
      </p>
      <Player
        key={example.key}
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        askFrame={stage.askFrame}
        frame={stage.frame}
        onWrong={made.wrong}
        question={ADDR_QUESTION}
        conclusion={ADDR_CONCLUSION}
        needs={ADDR_NEEDS}
        mistakes={made.mistakes}
        convention={made.convention}
      />
      {index === trace.steps.length ? <Compare params={example.params} /> : null}
    </>
  );
}

const WAYS = ['2', '4', '8'] as const;
const WORD_BYTES = ['2', '4'] as const;

function Try() {
  const params = {
    map: useParam('map', DEFAULT_TRY.map),
    v: useParam('v', DEFAULT_TRY.v),
    unit: useParam('unit', DEFAULT_TRY.unit),
    wb: useParam('wb', DEFAULT_TRY.wb),
    k: useParam('k', DEFAULT_TRY.k),
    mem: useParam('mem', DEFAULT_TRY.mem),
    memIn: useParam('memIn', DEFAULT_TRY.memIn),
    cache: useParam('cache', DEFAULT_TRY.cache),
    cacheIn: useParam('cacheIn', DEFAULT_TRY.cacheIn),
    addr: useParam('addr', DEFAULT_TRY.addr),
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

  const [draft, setDraft] = useState({ k: input.k, mem: input.mem, cache: input.cache, addr: input.addr });
  const [problem, setProblem] = useState('');
  useEffect(() => setDraft({ k: input.k, mem: input.mem, cache: input.cache, addr: input.addr }), [input.k, input.mem, input.cache, input.addr]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = tryParams({ ...input, ...draft });
    setProblem(next.problem);
    if (next.params) set(draft);
  };

  return (
    <>
      <div class="t4-controls">
        <Field label="映射方式">
          <Seg label="映射方式" items={mappingKeys.map((item) => ({ key: item.key, label: item.label }))} value={input.map} onChoose={(key) => set({ map: key })} />
        </Field>
        {input.map === 'set' ? (
          <Field label="每组行数">
            <Seg label="每组行数" items={WAYS.map((key) => ({ key, label: key }))} value={input.v as (typeof WAYS)[number]} onChoose={(key) => set({ v: key })} />
          </Field>
        ) : null}
        <Field label="编址">
          <Seg
            label="编址"
            items={[
              { key: 'word', label: '按字' },
              { key: 'byte', label: '按字节' },
            ]}
            value={input.unit as 'word' | 'byte'}
            onChoose={(key) => set({ unit: key })}
          />
        </Field>
        {input.unit === 'byte' ? (
          <Field label="每字字节数">
            <Seg label="每字字节数" items={WORD_BYTES.map((key) => ({ key, label: key }))} value={input.wb as (typeof WORD_BYTES)[number]} onChoose={(key) => set({ wb: key })} />
          </Field>
        ) : null}
      </div>
      <form class="t4-form" onSubmit={submit}>
        <label class="field t4-num">
          <span class="field-label">每块字数</span>
          <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.k} onInput={(event) => setDraft({ ...draft, k: event.currentTarget.value })} />
        </label>
        <div class="field t4-field">
          <span class="field-label">主存</span>
          <div class="t4-form">
            <input class="input is-mono t4-size" type="text" autoComplete="off" aria-label="主存容量" value={draft.mem} onInput={(event) => setDraft({ ...draft, mem: event.currentTarget.value })} />
            <Seg
              label="主存容量的单位"
              items={[
                { key: 'unit', label: input.unit === 'byte' ? '字节' : '字' },
                { key: 'block', label: '块' },
              ]}
              value={input.memIn as 'unit' | 'block'}
              onChoose={(key) => set({ memIn: key })}
            />
          </div>
        </div>
        <div class="field t4-field">
          <span class="field-label">cache</span>
          <div class="t4-form">
            <input class="input is-mono t4-size" type="text" autoComplete="off" aria-label="cache 容量" value={draft.cache} onInput={(event) => setDraft({ ...draft, cache: event.currentTarget.value })} />
            <Seg
              label="cache 容量的单位"
              items={[
                { key: 'unit', label: input.unit === 'byte' ? '字节' : '字' },
                { key: 'row', label: '行' },
              ]}
              value={input.cacheIn as 'unit' | 'row'}
              onChoose={(key) => set({ cacheIn: key })}
            />
          </div>
        </div>
        <label class="field t4-num">
          <span class="field-label">地址（十六进制）</span>
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
        <p class="t4-note">容量写 64K、1M 或 4096。地址可以空着，只求位数。</p>
      )}
      <Player
        key={JSON.stringify(tried.params ?? fallback)}
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        askFrame={stage.askFrame}
        frame={stage.frame}
        onWrong={made.wrong}
        convention={made.convention}
      />
      <Compare params={tried.params ?? fallback} />
    </>
  );
}

/** 弄坏它：把行号的边界往左或往右挪一位，看切出来的段指到哪里。 */
function Break() {
  const params = examples[0]!.params;
  const made = useRun(params);
  const { trace, stage } = made;
  const g = widths(params);
  const [cut, setCut] = useParam('cut', 'more', (raw) => (raw === 'less' ? 'less' : 'more'));
  const [, setStep] = useParam('s', '0');
  const splitAt = trace.steps.findIndex((step) => step.changes.some((change) => change.at === 'address.tagBits'));
  const breakIt = (state: State): Breakage | null => {
    const a = state.address;
    if (!a || a.tagBits === '') return null;
    const shift = cut === 'more' ? 1 : -1;
    const tagBits = a.bits.slice(0, g.tag - shift);
    const idxBits = a.bits.slice(g.tag - shift, g.tag + g.index);
    const r = g.index + shift;
    const rows = g.m ?? 0;
    return {
      label: cut === 'more' ? '行号多切一位' : '行号少切一位',
      patch: { tag: { name: `标记 ${tagBits.length} 位`, value: tagBits }, idx: { name: `行号 ${r} 位`, value: idxBits }, tagH: { hidden: true }, idxH: { hidden: true } },
      moves: [{ value: idxBits, from: 'addr', to: 'idx', via: ['cut-idx'], ink: 'addr' }],
      message:
        cut === 'more'
          ? `行号成了 ${r} 位，能写出 2^${r} = ${2 ** r} 个行号，可 cache 只有 ${rows} 行：一半的行号指向不存在的行。标记也少了一位，存进 cache 的标记分不清两个不同的区。`
          : `行号只剩 ${r} 位，只能选中 2^${r} = ${2 ** r} 行，另外 ${rows - 2 ** r} 行永远用不上；本来落在不同行的块挤进同一行，互相顶替，缺失多出一倍。`,
    };
  };
  return (
    <>
      <div class="t4-controls">
        <Field label="直接映射的行号">
          <Seg
            label="直接映射的行号"
            items={[
              { key: 'more', label: '多切一位' },
              { key: 'less', label: '少切一位' },
            ]}
            value={cut as 'more' | 'less'}
            onChoose={(key) => setCut(key)}
          />
        </Field>
        {splitAt >= 0 ? (
          <button type="button" class="btn" onClick={() => setStep(String(Math.min(trace.steps.length, splitAt + 2)))}>
            翻到切开以后
          </button>
        ) : null}
      </div>
      <p class="t4-note">
        例题是直接映射，cache 有 {g.m} 行，行号 {g.index} 位（2<sup>{g.index}</sup> = {g.m}）。翻到地址切开、写出十六进制以后，点舞台下的按钮，看边界挪一位会怎样。
      </p>
      <Player key={`break-${cut}`} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} frame={stage.frame} breakIt={(state) => breakIt(state)} />
    </>
  );
}

export default function Page() {
  return <PageShell id="ca" panels={{ '': Learn, try: Try, quiz: Paper, break: Break }} />;
}
