import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { plan, run, sizeText } from '../../engines/expand/model';
import type { Params } from '../../engines/expand/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { breakTrace, breakage } from './break';
import type { BreakKind } from './break';
import { exerciseRows, exerciseTask, makeExercise } from './exercise';
import { Paper } from './Paper';
import { expandMistakes, expandStage, polish, sub } from './scene';
import { BIT_CHOICES, EXAMPLES, TRY_DEFAULT, tryParams } from './setup';
import './expand.css';

const TABS = [
  { key: '', label: '讲解' },
  { key: 'try', label: '试一试' },
  { key: 'quiz', label: '练习' },
  { key: 'break', label: '弄坏它' },
] as const;

/** 一份参数 → 加工过的 Trace 和台面。参数不变时引用不变。 */
function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = polish(run(params));
    const stage = expandStage(params, narrow);
    return { trace, stage, mistakes: expandMistakes(trace, stage) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

/** 公式：芯片数和片选位数。数都取自引擎的 plan()。 */
function Formulas({ params }: { params: Params }) {
  const p = plan(params);
  const w = (x: number | string) => (typeof x === 'number' ? sizeText(x) : x);
  const h = p.n - p.k;
  return (
    <div class="xp-formulas" aria-label="算式">
      <p class="mono">
        d = ({w(params.target.words)}×{params.target.bits}) / ({w(params.chip.words)}×{params.chip.bits}) = {p.d}
      </p>
      <p class="mono">
        每组片数 = {params.target.bits} ÷ {params.chip.bits} = {p.perGroup}，组数 = {sizeText(p.targetWords)} ÷ {sizeText(p.chipWords)} = {p.groups}
      </p>
      <p class="mono">
        <Rich text={h > 0 ? `片选位数 h = log_2 ${p.groups} = ${h}（${sub(p.decoderLines)} 进 ${p.decoder}）` : '只有 1 组，不用片选译码'} />
      </p>
    </div>
  );
}

function Lead() {
  return (
    <p class="xp-lead">
      一片芯片的字数或位数不够，就用几片拼。位数不够做<Term k="位扩展" />，字数不够做<Term k="字扩展" />，两样都不够做<Term k="字位扩展" />：先位扩展再字扩展。低位地址作<Term k="片内地址" />接每一片，高位地址进<Term k="译码器" />，输出接各组的<Term k="片选" />。存储器<Term k="按字编址" />，容量写成「字数×位数」。
    </p>
  );
}

function Needs() {
  return <p class="pl-needs xp-needs">需要先会：二进制和十六进制互换；<Rich text="2^10 = 1K，2^20 = 1M" />。</p>;
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'a', (raw) => (EXAMPLES.some((item) => item.key === raw) ? raw : 'a'));
  const [, setStep] = useParam('s', '0');
  const example = EXAMPLES.find((item) => item.key === ex) ?? EXAMPLES[0]!;
  const { trace, stage, mistakes } = useRun(example.params);
  return (
    <>
      <Needs />
      <Lead />
      <div class="seg is-mono xp-examples" role="group" aria-label="例题">
        {EXAMPLES.map((item) => (
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
            {item.label}
          </button>
        ))}
      </div>
      <Player
        key={example.key}
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        values={stage.values}
        frame={stage.frame}
        askFrame={stage.askFrame}
        onWrong={stage.wrong}
        question={stage.question}
        conclusion={stage.conclusion}
        mistakes={mistakes}
        wide
      />
    </>
  );
}

const WORDS_RE = /^\s*\d+\s*[KkMm]?\s*$/;

function Try() {
  const [tw, setTw] = useParam('tw', TRY_DEFAULT.tw);
  const [tb, setTb] = useParam('tb', String(TRY_DEFAULT.tb));
  const [cw, setCw] = useParam('cw', TRY_DEFAULT.cw);
  const [cb, setCb] = useParam('cb', String(TRY_DEFAULT.cb));
  const [probe, setProbe] = useParam('a', TRY_DEFAULT.probe);
  const [, setStep] = useParam('s', '0');
  const [draft, setDraft] = useState<{ tw: string; cw: string; a: string } | null>(null);
  const shownDraft = draft ?? { tw, cw, a: probe };
  const result = useMemo(() => tryParams({ tw, tb: Number(tb), cw, cb: Number(cb), probe }), [tw, tb, cw, cb, probe]);
  const [problem, setProblem] = useState('');

  const commit = (event?: TargetedEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!draft) return;
    if (!WORDS_RE.test(draft.tw) || !WORDS_RE.test(draft.cw)) {
      setProblem('字数写成 64K、1M 或一个整数');
      return;
    }
    const next = tryParams({ tw: draft.tw.trim().toUpperCase(), tb: Number(tb), cw: draft.cw.trim().toUpperCase(), cb: Number(cb), probe: draft.a });
    if (next.problems.length > 0) {
      setProblem(next.problems[0]!);
      return;
    }
    setProblem('');
    setStep('0');
    setTw(draft.tw.trim().toUpperCase());
    setCw(draft.cw.trim().toUpperCase());
    setProbe(draft.a.trim().toUpperCase().replace(/H$/, ''));
    setDraft(null);
  };
  const pickBits = (which: 'tb' | 'cb', value: string) => {
    const next = tryParams({ tw, tb: Number(which === 'tb' ? value : tb), cw, cb: Number(which === 'cb' ? value : cb), probe });
    setProblem(next.problems[0] ?? '');
    setStep('0');
    (which === 'tb' ? setTb : setCb)(value);
  };
  const edit = (key: 'tw' | 'cw' | 'a', value: string) => setDraft({ ...shownDraft, [key]: value });

  return (
    <>
      <form class="xp-form" onSubmit={commit}>
        <div class="field">
          <label class="field-label" for="xp-tw">
            目标容量
          </label>
          <div class="xp-pair">
            <input id="xp-tw" class="input is-mono" value={shownDraft.tw} autoComplete="off" spellcheck={false} onInput={(e) => edit('tw', e.currentTarget.value)} onChange={() => commit()} aria-label="目标字数" />
            <span>×</span>
            <select class="select" value={tb} aria-label="目标位数" onChange={(e) => pickBits('tb', e.currentTarget.value)}>
              {[...BIT_CHOICES, 32, 64].map((b) => (
                <option key={b} value={String(b)}>
                  {b} 位
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="xp-cw">
            芯片规格
          </label>
          <div class="xp-pair">
            <input id="xp-cw" class="input is-mono" value={shownDraft.cw} autoComplete="off" spellcheck={false} onInput={(e) => edit('cw', e.currentTarget.value)} onChange={() => commit()} aria-label="芯片字数" />
            <span>×</span>
            <select class="select" value={cb} aria-label="芯片位数" onChange={(e) => pickBits('cb', e.currentTarget.value)}>
              {BIT_CHOICES.map((b) => (
                <option key={b} value={String(b)}>
                  {b} 位
                </option>
              ))}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="xp-a">
            要查的地址
          </label>
          <input id="xp-a" class="input is-mono xp-addr" value={shownDraft.a} autoComplete="off" spellcheck={false} placeholder="9A3C" onInput={(e) => edit('a', e.currentTarget.value)} onChange={() => commit()} />
          <span class="field-help">十六进制，不写 H</span>
        </div>
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {problem ? (
        <p class="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {result.params ? <TryRun params={result.params} /> : <p class="field-error">{result.problems[0]}</p>}
    </>
  );
}

function TryRun({ params }: { params: Params }) {
  const { trace, stage } = useRun(params);
  return (
    <>
      <Formulas params={params} />
      <Player key={JSON.stringify(params)} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} askFrame={stage.askFrame} onWrong={stage.wrong} wide />
    </>
  );
}

function Practice() {
  const [seedText, setSeed] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(99999, Math.trunc(Number(raw)) || 1))));
  const seed = Number(seedText);
  const [, setTab] = useParam('t', '');
  const [, setTw] = useParam('tw', TRY_DEFAULT.tw);
  const [, setTb] = useParam('tb', String(TRY_DEFAULT.tb));
  const [, setCw] = useParam('cw', TRY_DEFAULT.cw);
  const [, setCb] = useParam('cb', String(TRY_DEFAULT.cb));
  const [, setProbe] = useParam('a', TRY_DEFAULT.probe);
  const [, setStep] = useParam('s', '0');
  const params = useMemo(() => makeExercise(seed), [seed]);
  const rows = useMemo(
    () =>
      exerciseRows(params).map((row) => ({
        ...row,
        demo: () => {
          const w = (x: number | string) => (typeof x === 'number' ? sizeText(x) : x);
          setTw(w(params.target.words));
          setTb(String(params.target.bits));
          setCw(w(params.chip.words));
          setCb(String(params.chip.bits));
          setProbe(params.probe === undefined ? '' : params.probe.toString(16).toUpperCase());
          setStep(String(Math.max(0, row.step - 1)));
          setTab('try');
        },
      })),
    // set* 来自 useParam，引用稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );
  const trace = useMemo(() => run(params), [params]);
  return (
    <Paper
      key={seed}
      storeKey={`coa:3-expand:quiz:${seed}`}
      seed={seed}
      task={exerciseTask(params)}
      conditions={trace.conditions.map((c) => ({ label: c.label, value: sub(c.value) }))}
      rows={rows}
      onNext={() => setSeed(String(seed + 1))}
    />
  );
}

function Break() {
  const [kind, setKind] = useParam('bk', 'fight', (raw) => (raw === 'cut' ? 'cut' : 'fight'));
  const [, setStep] = useParam('s', '0');
  const params = EXAMPLES[0]!.params;
  const { trace, stage } = useRun(params);
  const short = useMemo(() => breakTrace(trace), [trace]);
  const breakIt = useMemo(
    () => (state: Parameters<typeof breakage>[1], part: string | null) => {
      if (part === null) return breakage(kind as BreakKind, state, stage);
      if (part === 'addr' || part === 'DEC') return breakage('cut', state, stage);
      const chip = /^U(\d+)$/.exec(part);
      if (chip) return breakage('fight', state, stage, Math.floor(Number(chip[1]) / stage.plan.perGroup));
      return null;
    },
    [kind, stage],
  );
  return (
    <>
      <p class="xp-lead">先走两步，把讲解例题的地址送出去、选中一组；再故意弄坏一处，看会怎样。也可以直接点台面上别的组的芯片，或点译码器。</p>
      <div class="seg xp-examples" role="group" aria-label="弄坏哪里">
        {(
          [
            ['fight', '两组同时选中'],
            ['cut', '断一根地址线'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={kind === key}
            onClick={() => {
              setKind(key);
              setStep('2');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Player key="break" trace={short} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} breakIt={breakIt} wide />
    </>
  );
}

export default function Page() {
  const [tab, setTab] = useParam('t', '', (raw) => (TABS.some((item) => item.key === raw) ? raw : ''));
  const [step, setStep] = useParam('s', '0');
  const [memo] = useState(() => new Map<string, string>());
  return (
    <div class="xp">
      <div class="tabs" role="tablist" aria-label="这一页的部分">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`xp-tab-${item.key || 'learn'}`}
            aria-selected={item.key === tab}
            aria-controls="xp-panel"
            onClick={() => {
              if (item.key === tab) return;
              memo.set(tab, step);
              setTab(item.key);
              setStep(memo.get(item.key) ?? '0');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id="xp-panel" class="xp-panel" role="tabpanel" aria-labelledby={`xp-tab-${tab || 'learn'}`}>
        {tab === '' && <Learn />}
        {tab === 'try' && <Try />}
        {tab === 'quiz' && <Practice />}
        {tab === 'break' && <Break />}
      </div>
    </div>
  );
}
