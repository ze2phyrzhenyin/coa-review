import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { pageList, run } from '../../engines/vmreplace/model';
import type { Params, State } from '../../engines/vmreplace/model';
import type { Trace } from '../../engines/trace';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Field, PageShell, Seg } from './kit';
import { Paper } from './Paper';
import {
  REPLACE_CONCLUSION,
  REPLACE_NEEDS,
  REPLACE_QUESTION,
  filledColumns,

  polish,
  replaceConvention,
  replaceMistakes,
  replaceStage,
  replaceWrong,
  slot,
} from './scene';
import { EXAMPLE_PAGES, examples, policyKeys, policyOf, tryParams } from './setup';

/** 一份参数 → 引擎 Trace（加上命中率一步）和台面。参数不变时引用不变。 */
function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const raw = run(params);
    const trace = polish(raw);
    return { raw, trace, stage: replaceStage(trace, narrow, raw.table), wrong: replaceWrong(trace), mistakes: replaceMistakes(trace), convention: replaceConvention(params) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

/** 考试版式的表：一列一次访问，填到当前步为止。点列头跳到那一次访问。 */
function ExamTable({ raw, trace }: { raw: Trace<Params, State>; trace: Trace<Params, State> }) {
  const [index, setIndex] = useIntParam('s', 0, 0, trace.steps.length);
  const filled = filledColumns(trace, index);
  const access = index > 0 ? (trace.steps[index - 1]?.state.current.n ?? 0) : 0;
  const done = filled === pageList(raw.params).length && index > raw.steps.length - 1;
  const columns = raw.table.columns;
  const body = raw.table.rows;
  return (
    <div class="t4-table-wrap">
      <table class="t4-table">
        <caption>解题表（例 3.11 的版式）</caption>
        <thead>
          <tr>
            <th scope="col">{columns[0]}</th>
            {columns.slice(1, -1).map((title, k) => {
              const plain = String(pageList(raw.params)[k] ?? '');
              return (
                <th key={k} scope="col" class={k === access - 1 ? 'is-current' : ''}>
                  <button type="button" class="t4-col" aria-label={`跳到第 ${k + 1} 次访问`} onClick={() => setIndex(k * 2 + 1)}>
                    {k < filled ? title : plain}
                  </button>
                </th>
              );
            })}
            <th scope="col">{columns[columns.length - 1]}</th>
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              <th scope="row">{row.cells[0]}</th>
              {row.cells.slice(1, -1).map((cell, k) => (
                <td key={k} class={`${k >= filled ? 'is-later' : ''}${k === access - 1 ? ' is-current' : ''}${k === filled - 1 && trace.steps[index - 1]?.level === 'access' ? ' is-new' : ''}`}>
                  {k < filled ? cell : ''}
                </td>
              ))}
              <td>{done ? row.cells[row.cells.length - 1] : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'fifo', (raw) => (examples.some((item) => item.key === raw) ? raw : 'fifo'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0];
  const made = useRun(example.params);
  const { stage } = made;
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
        主存有 3 个<Term k="页面" />，开始时是空的。依次访问页 {EXAMPLE_PAGES.join(' ')}，按{' '}
        {example.key === 'fifo' ? <Term k="FIFO" /> : <Term k="FIFO+LRU" />} 填表，求<Term k="命中率" />和依次淘汰的页。
        {example.key === 'lru' ? '序列和上一题相同，只换了算法。' : ''}
      </p>
      <Player
        key={example.key}
        trace={made.trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        values={stage.values}
        askFrame={stage.askFrame}
        frame={stage.frame}
        onWrong={made.wrong}
        question={REPLACE_QUESTION}
        conclusion={REPLACE_CONCLUSION}
        needs={REPLACE_NEEDS}
        mistakes={made.mistakes}
        convention={made.convention}
      />
      <ExamTable raw={made.raw} trace={made.trace} />
    </>
  );
}

const FRAME_CHOICES = ['2', '3', '4', '5'] as const;
const DEFAULT_SEQ = '7,2,7,5,1,2,7,3,5,1';

function Try() {
  const [p, setP] = useParam('p', 'fifo', (raw) => (policyKeys.some((item) => item.key === raw) ? raw : 'fifo'));
  const [nText, setN] = useParam('n', '3', (raw) => (FRAME_CHOICES.includes(raw as never) ? raw : '3'));
  const [kind, setKind] = useParam('k', 'page', (raw) => (raw === 'addr' ? 'addr' : 'page'));
  const [seq, setSeq] = useParam('seq', DEFAULT_SEQ);
  const [size, setSize] = useParam('size', '100');
  const [init, setInit] = useParam('init', '');
  const [, setStep] = useParam('s', '0');
  const input = { policy: policyOf(p), frames: Number(nText), kind: kind as 'page' | 'addr', seq: seq.replace(/,/g, ' '), size, init: init.replace(/,/g, ' ') };
  const tried = tryParams(input);
  const fallback = useMemo<Params>(() => ({ frames: 3, policy: 'FIFO', pages: DEFAULT_SEQ.split(',').map(Number) }), []);
  const params = tried.params ?? fallback;
  const made = useRun(params);
  const { stage } = made;

  const [draft, setDraft] = useState({ seq: input.seq, size, init: input.init });
  const [problem, setProblem] = useState('');
  useEffect(() => setDraft({ seq: seq.replace(/,/g, ' '), size, init: init.replace(/,/g, ' ') }), [seq, size, init]);

  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = tryParams({ ...input, seq: draft.seq, size: draft.size, init: draft.init });
    setProblem(next.problem);
    if (!next.params) return;
    setStep('0');
    setSeq(draft.seq.trim().split(/[\s,，、;；]+/).join(','));
    setSize(draft.size.trim());
    setInit(draft.init.trim().split(/[\s,，、;；]+/).filter(Boolean).join(','));
  };

  const variants = useMemo(() => policyKeys.map((item) => ({ item, result: run({ ...params, policy: item.policy }).result })), [params]);

  return (
    <>
      <div class="t4-controls">
        <Field label="替换算法">
          <Seg label="替换算法" items={policyKeys.map((item) => ({ key: item.key, label: item.label }))} value={p} onChoose={(key) => (setStep('0'), setP(key))} />
        </Field>
        <Field label="主存页面数">
          <Seg label="主存页面数" items={FRAME_CHOICES.map((key) => ({ key, label: key }))} value={nText as (typeof FRAME_CHOICES)[number]} onChoose={(key) => (setStep('0'), setN(key))} />
        </Field>
        <Field label="序列写的是">
          <Seg
            label="序列写的是"
            items={[
              { key: 'page', label: '页号' },
              { key: 'addr', label: '字地址' },
            ]}
            value={kind as 'page' | 'addr'}
            onChoose={(key) => {
              setStep('0');
              setKind(key);
              if (key === 'addr' && seq === DEFAULT_SEQ) setSeq('130,425,108,267,391,82,450,236');
              if (key === 'page' && seq === '130,425,108,267,391,82,450,236') setSeq(DEFAULT_SEQ);
            }}
          />
        </Field>
      </div>
      <form class="t4-form" onSubmit={submit}>
        <label class="field t4-grow">
          <span class="field-label">{kind === 'addr' ? '字地址序列' : '页号序列'}</span>
          <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} value={draft.seq} onInput={(event) => setDraft({ ...draft, seq: event.currentTarget.value })} />
        </label>
        {kind === 'addr' ? (
          <label class="field t4-num">
            <span class="field-label">页大小（字）</span>
            <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.size} onInput={(event) => setDraft({ ...draft, size: event.currentTarget.value })} />
          </label>
        ) : null}
        <label class="field t4-num">
          <span class="field-label">开始时已在主存</span>
          <input class="input is-mono" type="text" autoComplete="off" placeholder="空" value={draft.init} onInput={(event) => setDraft({ ...draft, init: event.currentTarget.value })} />
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
        <p class="t4-note">空格隔开，最多 16 次访问。开始时已在主存的页从 a 往下排，不算缺页。</p>
      )}
      <Player
        key={JSON.stringify(params)}
        trace={made.trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        values={stage.values}
        askFrame={stage.askFrame}
        frame={stage.frame}
        onWrong={made.wrong}
        convention={made.convention}
      />
      <ExamTable raw={made.raw} trace={made.trace} />
      <div class="t4-table-wrap">
        <table class="t4-table">
          <caption>同一串访问，换算法</caption>
          <thead>
            <tr>
              <th scope="col">算法</th>
              <th scope="col">命中</th>
              <th scope="col">缺页</th>
              <th scope="col">命中率</th>
              <th scope="col">依次淘汰</th>
            </tr>
          </thead>
          <tbody>
            {variants.map(({ item, result }) => (
              <tr key={item.key} class={item.policy === params.policy ? 'is-current' : ''}>
                <th scope="row">
                  <button type="button" class="t4-col" aria-current={item.policy === params.policy ? 'true' : undefined} onClick={() => (setStep('0'), setP(item.key))}>
                    {item.label}
                  </button>
                </th>
                <td>{result['命中次数']}</td>
                <td>{result['缺页次数']}</td>
                <td>{result['命中率']}</td>
                <td>{result['淘汰页号']}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 弄坏它：主存满了还缺页时，换出的不是最下一格，而是学生挑的那一格。 */
function Break() {
  const params = examples[0].params;
  const made = useRun(params);
  const { trace, stage } = made;
  const n = params.frames;
  const [victimText, setVictim] = useParam('v', '0', (raw) => (/^\d$/.test(raw) && Number(raw) < n - 1 ? raw : '0'));
  const victim = Number(victimText);
  const [, setStep] = useParam('s', '0');
  // 主存满了以后第一次缺页的比较步。
  const firstFull = trace.steps.findIndex((step, i) => step.level === 'explain' && step.state.current.hit === false && (i > 0 ? trace.steps[i - 1]!.state.frames.every((q) => q !== null) : false));
  const breakIt = (state: State): Breakage | null => {
    const cur = state.current;
    if (cur.hit !== false || cur.page === null || state.frames.some((q) => q === null)) return null;
    // 只在比较步上给：这时还没填这一列。
    if (state.frames.includes(cur.page)) return null;
    const gone = state.frames[victim];
    const right = state.frames[n - 1];
    const rest = state.frames.filter((_, i) => i !== victim);
    return {
      label: `把 ${slot(victim)} 格的页 ${gone} 换出去`,
      patch: { conv: { items: [String(cur.page), ...rest.map((q) => (q === null ? '' : String(q)))] }, out: { value: String(gone) } },
      moves: [{ value: `页 ${cur.page}`, from: 'cur', to: 'conv', via: ['cur-conv'] }],
      message: `页 ${gone} 在 ${slot(victim)} 格，是${victim === 0 ? '刚调进来' : '较晚调进来'}的页，最该留下的反而被换出；最早进来的页 ${right} 还占着 ${slot(n - 1)} 格。程序往往接着用刚调进来的页，真实系统里这样换会马上又缺页，页面在主存和辅存之间来回搬。按 a 进 c 出，该换出的是 ${slot(n - 1)} 格。`,
    };
  };
  return (
    <>
      <div class="t4-controls">
        <Field label="缺页时硬换出">
          <Seg
            label="缺页时硬换出"
            items={Array.from({ length: n - 1 }, (_, i) => ({ key: String(i), label: `${slot(i)} 格` }))}
            value={victimText}
            onChoose={(key) => setVictim(key)}
          />
        </Field>
        {firstFull >= 0 ? (
          <button type="button" class="btn" onClick={() => setStep(String(firstFull + 1))}>
            翻到主存满后第一次缺页
          </button>
        ) : null}
      </div>
      <p class="t4-note">翻到某次缺页的比较步（主存已满），点舞台下的按钮，看换错一格会怎样。</p>
      <Player
        key="break"
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        frame={stage.frame}
        names={stage.names}
        values={stage.values}
        breakIt={(state) => breakIt(state)}
      />
    </>
  );
}

export default function Page() {
  return <PageShell id="vr" panels={{ '': Learn, try: Try, quiz: Paper, break: Break }} />;
}

