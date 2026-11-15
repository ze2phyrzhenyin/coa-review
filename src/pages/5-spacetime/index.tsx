import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { checkSpacetime, runSpacetime, stageNamesOf, MAX_STAGES, MAX_TASKS } from '../../engines/pipeline/spacetime';
import type { SpacetimeParams, SpacetimeState } from '../../engines/pipeline/spacetime';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { Field, Formula, PageShell, Seg } from './kit';
import { polishTrace } from './polish';
import { SPACE_CONCLUSION, SPACE_NEEDS, SPACE_QUESTION, lineItems, spaceConvention, spaceMistakes, spaceStage, spaceWrong } from './scene';
import { SpaceQuiz } from './quiz';

/** 一份参数 → 引擎 Trace（记号排好）和台面。参数不变时引用不变。 */
function useRun(params: SpacetimeParams) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    // 时空图就画在台面上（考试的版式），播放器下面不再重复一张解题表。
    const trace = { ...polishTrace(runSpacetime(params)), table: { columns: [], rows: [] } };
    return { trace, stage: spaceStage(trace, narrow), wrong: spaceWrong(trace), mistakes: spaceMistakes(trace), convention: spaceConvention(params) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

const examples: { key: string; label: string; params: SpacetimeParams; lead: string }[] = [
  { key: 'eq', label: '四段，等长', params: { k: 4, n: 6, dt: 50 }, lead: '四段流水线（IF、ID、EX、WB），各段都是一个时钟周期 Δt = 50 ns，连续送进 6 条指令。' },
  { key: 'five', label: '五段', params: { k: 5, n: 6, dt: 50 }, lead: '只改一个条件：段数从 4 变成 5（多一个 MEM 段），指令还是 6 条，Δt 还是 50 ns。' },
  {
    key: 'neq',
    label: '各段不等长',
    params: { k: 4, n: 6, stageTimes: [40, 60, 50, 30], latch: 5 },
    lead: '还是四段、6 条，可各段用时不同：IF 40 ns，ID 60 ns，EX 50 ns，WB 30 ns，段间缓冲寄存器延时 τₗ = 5 ns。时钟周期要先定下来。',
  },
];

function Lead() {
  return (
    <>
      <p class="pp-lead">
        <Term k="流水线">流水线</Term>像一条装配线：指令是盒子，每个时钟周期往前挪一个工位。把每个周期各段里是哪条指令记下来，就是<Term k="时空图">时空图</Term>。
        时空图画完，下面三个数就能直接读出来。
      </p>
      <Formula text="T_k = k + (n − 1)　　C_k = n·k / T_k　　T_p = n / (T_k·τ)" />
    </>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'eq', (raw) => (examples.some((item) => item.key === raw) ? raw : 'eq'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0]!;
  const made = useRun(example.params);
  const { stage } = made;
  return (
    <>
      <div class="pp-controls">
        <Field label="例题">
          <Seg
            label="例题"
            items={examples.map((item) => ({ key: item.key, label: item.label }))}
            value={example.key}
            onChoose={(key) => {
              setStep('0');
              setEx(key);
            }}
          />
        </Field>
      </div>
      <Lead />
      <p class="pp-lead">
        <Rich text={example.lead} />
      </p>
      <Player
        levelNames={{ beat: '一个时钟周期' }}
        key={example.key}
        trace={made.trace}
        scene={stage.scene}
        bind={stage.bind}
        frame={stage.frame}
        askFrame={stage.askFrame}
        names={stage.names}
        values={stage.values}
        onWrong={made.wrong}
        question={SPACE_QUESTION}
        conclusion={SPACE_CONCLUSION}
        needs={SPACE_NEEDS}
        mistakes={made.mistakes}
        convention={made.convention}
      />
    </>
  );
}

const STAGE_CHOICES = Array.from({ length: MAX_STAGES - 1 }, (_, i) => String(i + 2));
const parseList = (text: string): number[] =>
  text
    .split(/[\s,，、;；/]+/)
    .filter(Boolean)
    .map(Number);

/** 试一试：段数、条数、时钟（等长 Δt 或各段时间加 τₗ）、画法都在网址里。 */
function Try() {
  const [kText, setK] = useParam('k', '4', (raw) => (STAGE_CHOICES.includes(raw) ? raw : '4'));
  const [nText, setN] = useParam('n', '6');
  const [tm, setTm] = useParam('tm', 'eq', (raw) => (raw === 'neq' ? 'neq' : 'eq'));
  const [dtText, setDt] = useParam('dt', '50');
  const [stText, setSt] = useParam('st', '');
  const [tlText, setTl] = useParam('tl', '5');
  const [lay, setLay] = useParam('lay', 'stage', (raw) => (raw === 'ins' ? 'ins' : 'stage'));
  const [, setStep] = useParam('s', '0');
  const k = Number(kText);
  const defaultTimes = (count: number) => Array.from({ length: count }, (_, i) => [40, 60, 50, 30, 70, 45, 55, 35][i] ?? 50).join(' ');
  const times = stText ? stText.replace(/,/g, ' ') : defaultTimes(k);

  const built = useMemo(() => {
    const base: SpacetimeParams = { k, n: Number(nText), layout: lay === 'ins' ? '指令为行' : '段为行' };
    const params: SpacetimeParams = tm === 'eq' ? { ...base, dt: Number(dtText) } : { ...base, stageTimes: parseList(times), latch: Number(tlText) };
    const problems = checkSpacetime(params);
    return { params, problem: problems.join('；') };
  }, [k, nText, tm, dtText, times, tlText, lay]);
  const fallback = useMemo<SpacetimeParams>(() => ({ k: 4, n: 6, dt: 50 }), []);
  const params = built.problem ? fallback : built.params;
  const made = useRun(params);
  const { stage } = made;

  const [draft, setDraft] = useState({ n: nText, dt: dtText, st: times, tl: tlText });
  useEffect(() => setDraft({ n: nText, dt: dtText, st: times, tl: tlText }), [nText, dtText, times, tlText]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStep('0');
    setN(draft.n.trim());
    setDt(draft.dt.trim());
    setSt(parseList(draft.st).join(','));
    setTl(draft.tl.trim());
  };
  const names = stageNamesOf({ k });

  return (
    <>
      <div class="pp-controls">
        <Field label="段数 k">
          <Seg
            label="段数 k"
            items={STAGE_CHOICES.map((key) => ({ key, label: key }))}
            value={kText}
            onChoose={(key) => {
              setStep('0');
              setK(key);
              setSt('');
            }}
          />
        </Field>
        <Field label="各段用时">
          <Seg
            label="各段用时"
            items={[
              { key: 'eq', label: '一样长' },
              { key: 'neq', label: '不一样长' },
            ]}
            value={tm as 'eq' | 'neq'}
            onChoose={(key) => (setStep('0'), setTm(key))}
          />
        </Field>
        <Field label="时空图的画法">
          <Seg
            label="时空图的画法"
            items={[
              { key: 'stage', label: '段为行' },
              { key: 'ins', label: '指令为行' },
            ]}
            value={lay as 'stage' | 'ins'}
            onChoose={(key) => (setStep('0'), setLay(key))}
          />
        </Field>
      </div>
      <form class="pp-form" onSubmit={submit}>
        <label class="field pp-num">
          <span class="field-label">指令条数 n</span>
          <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.n} onInput={(event) => setDraft({ ...draft, n: event.currentTarget.value })} />
        </label>
        {tm === 'eq' ? (
          <label class="field pp-num">
            <span class="field-label">Δt（ns）</span>
            <input class="input is-mono" type="text" inputMode="decimal" autoComplete="off" value={draft.dt} onInput={(event) => setDraft({ ...draft, dt: event.currentTarget.value })} />
          </label>
        ) : (
          <>
            <label class="field pp-grow">
              <span class="field-label">
                各段时间（ns，{names.join('、')}）
              </span>
              <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} value={draft.st} onInput={(event) => setDraft({ ...draft, st: event.currentTarget.value })} />
            </label>
            <label class="field pp-num">
              <span class="field-label">
                <Rich text="τₗ（ns）" />
              </span>
              <input class="input is-mono" type="text" inputMode="decimal" autoComplete="off" value={draft.tl} onInput={(event) => setDraft({ ...draft, tl: event.currentTarget.value })} />
            </label>
          </>
        )}
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {built.problem ? (
        <p class="field-error" role="alert">
          {built.problem}。下面先按 4 段、6 条、Δt = 50 ns 画。
        </p>
      ) : (
        <p class="pp-note">
          k 取 2 到 {MAX_STAGES}，n 取 1 到 {MAX_TASKS}。各段时间用空格隔开，个数等于段数。
        </p>
      )}
      <Player
        levelNames={{ beat: '一个时钟周期' }}
        key={JSON.stringify(params)}
        trace={made.trace}
        scene={stage.scene}
        bind={stage.bind}
        frame={stage.frame}
        askFrame={stage.askFrame}
        names={stage.names}
        values={stage.values}
        onWrong={made.wrong}
        convention={made.convention}
      />
    </>
  );
}

const CLOCKS = [
  { key: 'avg', label: '各段的平均值' },
  { key: 'max', label: '最慢的段' },
  { key: 'book', label: '最慢的段 + τₗ' },
] as const;
type ClockKey = (typeof CLOCKS)[number]['key'];

/** 弄坏它：各段不等长时，把时钟周期取短一点。最慢的段做不完，半成品被打进下一段。 */
function Break() {
  const params = examples[2]!.params;
  const made = useRun(params);
  const { trace, stage } = made;
  const [clock, setClock] = useParam('clk', 'avg', (raw) => (CLOCKS.some((item) => item.key === raw) ? raw : 'avg'));
  const [, setStep] = useParam('s', '0');
  const times = params.stageTimes!;
  const names = stageNamesOf(params);
  const slow = times.indexOf(Math.max(...times));
  const latch = params.latch ?? 0;
  const chosen = clock === 'avg' ? times.reduce((a, b) => a + b, 0) / times.length : clock === 'max' ? times[slow]! : times[slow]! + latch;
  const shown = Number(chosen.toFixed(2));
  // 最慢的段里第一次有指令的那个周期之后。
  const firstBusy = trace.steps.findIndex((step) => step.level === 'beat' && step.state.grid[slow]?.[step.state.cycle - 1]);
  const breakIt = (state: SpacetimeState): Breakage | null => {
    if (clock === 'book' || state.cycle === 0 || !state.grid[slow]?.[state.cycle - 1] || slow === names.length - 1) return null;
    const items = lineItems(params, state.grid, state.cycle);
    const who = items[slow]!;
    const tags = names.map(() => '');
    const target = slow + 1;
    tags[target] = clock === 'avg' ? `${names[slow]} 没做完` : '没锁存好';
    const moved = items.slice();
    // 时钟一到，所有盒子往前挪一格：最慢那一段的盒子带着没做完的结果进下一段。
    for (let s = names.length - 1; s > 0; s--) moved[s] = items[s - 1] ?? '';
    moved[0] = '';
    return {
      label: `时钟取 ${shown} ns，推一拍`,
      patch: { line: { items: moved, tags, tones: names.map((_, s) => (s === target ? 'bad' : '')), crash: target, bad: [target] }, clock: { text: `时钟周期 τ = ${shown} ns`, changed: true } },
      moves: [{ value: clock === 'avg' ? '半成品' : '没锁存好', from: `line.0.${slow}`, to: `line.0.${target}`, arc: true }],
      message:
        clock === 'avg'
          ? `${who} 在 ${names[slow]} 段要 ${times[slow]} ns，时钟只给 ${shown} ns。时钟一到，它带着算了一半的结果被推进 ${names[target]} 段，后面每一段都拿着错的数接着做。真实的流水线不会报错，只会算出错的结果。`
          : `${names[slow]} 段刚好算完 ${times[slow]} ns，可结果还要 τₗ = ${latch} ns 才能稳稳打进段间的缓冲寄存器。时钟边沿来得太早，锁存进去的可能是变化中的值，${names[target]} 段拿到的数不可靠。`,
    };
  };
  return (
    <>
      <div class="pp-controls">
        <Field label="时钟周期取">
          <Seg label="时钟周期取" items={CLOCKS.map((item) => ({ key: item.key, label: item.label }))} value={clock as ClockKey} onChoose={(key) => setClock(key)} />
        </Field>
        {firstBusy >= 0 ? (
          <button type="button" class="btn" onClick={() => setStep(String(firstBusy + 1))}>
            翻到 {names[slow]} 段第一次有指令
          </button>
        ) : null}
      </div>
      <p class="pp-note">
        各段 {times.map((t, i) => `${names[i]} ${t} ns`).join('，')}，<Rich text={`τₗ = ${latch} ns`} />。选一个时钟周期，翻到 {names[slow]} 段里有指令的周期，点舞台下的按钮。
        {clock === 'book' ? '按教材取最慢的段加 τₗ，每一段都做得完，没有可弄坏的地方。' : ''}
      </p>
      <Player
        levelNames={{ beat: '一个时钟周期' }}
        key="break"
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        frame={stage.frame}
        names={stage.names}
        values={stage.values}
        breakIt={(state) => breakIt(state)}
      />
    </>
  );
}

export default function Page() {
  return <PageShell id="st" panels={{ '': Learn, try: Try, quiz: SpaceQuiz, break: Break }} />;
}
