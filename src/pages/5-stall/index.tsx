import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { checkStall, MAX_STALL_INSTRUCTIONS, MODES, runStall } from '../../engines/pipeline/stall';
import type { Mode, StallParams, StallState } from '../../engines/pipeline/stall';
import { parseInstruction } from '../../engines/pipeline/instr';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { Field, PageShell, Seg } from '../5-spacetime/kit';
import { polishTrace } from '../5-spacetime/polish';
import { STALL_CONCLUSION, STALL_NEEDS, STALL_QUESTION, lineAt, stageNames, stallConvention, stallMistakes, stallStage, stallWrong } from './scene';
import { StallQuiz } from './quiz';

function useRun(params: StallParams) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    // 时空表画在台面上（表 5.4(b) 的版式），播放器下面不再重复一张。
    const trace = { ...polishTrace(runStall(params)), table: { columns: [], rows: [] } };
    const stage = stallStage(trace, narrow);
    return { trace, stage, wrong: stallWrong(trace, stage.timing), mistakes: stallMistakes(trace, stage.timing), convention: stallConvention(params, stage.timing) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

const examples: { key: string; label: string; stages: 4 | 5; instructions: string[]; lead: string }[] = [
  { key: 'four', label: '四段', stages: 4, instructions: ['ADD R1,R2,R3', 'SUB R4,R1,R5', 'AND R6,R7,R4'], lead: '四段流水线（IF、ID、EX、WB），三条指令：SUB 要用 ADD 写的 R1，AND 又要用 SUB 写的 R4。' },
  { key: 'five', label: '五段', stages: 5, instructions: ['SUB R2,R1,R3', 'ADD R4,R2,R5', 'OR R6,R2,R7', 'AND R1,R4,R2'], lead: '五段流水线（IF、ID、EX、MEM、WB）。后面三条都要读 SUB 写的 R2。' },
  { key: 'lad', label: 'LAD 之后', stages: 5, instructions: ['LAD R1,M(y)', 'ADD R2,R1,R3', 'SUB R4,R5,R6'], lead: '五段流水线，ADD 紧跟在 LAD 后面，要用 LAD 从内存取来的 R1。' },
];

const MODE_ITEMS = MODES.map((mode) => ({ key: mode, label: mode }));

function Lead() {
  return (
    <p class="pp-lead">
      前一条还没把结果写回，后一条就要读它（<Term k="RAW">RAW</Term>）。教材的口径：写回寄存器之后的<strong>下一个周期</strong>才读得到。三种做法：不处理（读到旧值），<Term k="后推">后推</Term>（在 ID 停下来等），<Term k="定向">定向</Term>（结果一算出来就从专用通路送过去）。
    </p>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'four', (raw) => (examples.some((item) => item.key === raw) ? raw : 'four'));
  const [mode, setMode] = useParam('m', '后推', (raw) => ((MODES as readonly string[]).includes(raw) ? raw : '后推'));
  const [, setStep] = useParam('s', '0');
  const example = examples.find((item) => item.key === ex) ?? examples[0]!;
  const params = useMemo<StallParams>(() => ({ stages: example.stages, instructions: example.instructions, mode: mode as Mode }), [example, mode]);
  const made = useRun(params);
  const { stage } = made;
  return (
    <>
      <div class="pp-controls">
        <Field label="例题">
          <Seg label="例题" items={examples.map((item) => ({ key: item.key, label: item.label }))} value={example.key} onChoose={(key) => (setStep('0'), setEx(key))} />
        </Field>
        <Field label="处理方式">
          <Seg label="处理方式" items={MODE_ITEMS} value={mode as Mode} onChoose={(key) => (setStep('0'), setMode(key))} />
        </Field>
      </div>
      <Lead />
      <p class="pp-lead">
        <Rich text={`${example.lead}只换处理方式，看停顿和总周期数怎么变。`} />
      </p>
      <Player
        key={`${example.key}-${mode}`}
        trace={made.trace}
        scene={stage.scene}
        bind={stage.bind}
        frame={stage.frame}
        askFrame={stage.askFrame}
        names={stage.names}
        values={stage.values}
        onWrong={made.wrong}
        question={STALL_QUESTION}
        conclusion={STALL_CONCLUSION}
        needs={STALL_NEEDS}
        mistakes={made.mistakes}
        convention={made.convention}
      />
    </>
  );
}

const TRY_DEFAULT = 'LAD R1,M(x);ADD R2,R1,R3;SUB R4,R2,R5;STO M(y),R4';

/** 试一试：段数、处理方式、指令、单端口存储器、时钟周期都在网址里。 */
function Try() {
  const [kText, setK] = useParam('k', '5', (raw) => (raw === '4' ? '4' : '5'));
  const [mode, setMode] = useParam('m', '后推', (raw) => ((MODES as readonly string[]).includes(raw) ? raw : '后推'));
  const [ins, setIns] = useParam('ins', TRY_DEFAULT);
  const [mem, setMem] = useParam('mem', '0', (raw) => (raw === '1' ? '1' : '0'));
  const [dt, setDt] = useParam('dt', '');
  const [, setStep] = useParam('s', '0');
  const lines = ins.split(';').map((line) => line.trim()).filter(Boolean);
  const built = useMemo(() => {
    const params: StallParams = { stages: kText === '4' ? 4 : 5, instructions: lines, mode: mode as Mode, ...(mem === '1' && kText === '5' ? { sharedMemory: true } : {}), ...(dt.trim() ? { dt: Number(dt) } : {}) };
    const problems = checkStall(params);
    try {
      lines.forEach(parseInstruction);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    return { params, problem: problems.join('；') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kText, mode, ins, mem, dt]);
  const fallback = useMemo<StallParams>(() => ({ stages: 5, instructions: TRY_DEFAULT.split(';'), mode: '后推' }), []);
  const params = built.problem ? fallback : built.params;
  const made = useRun(params);
  const { stage } = made;
  const [draft, setDraft] = useState({ ins: lines.join('\n'), dt });
  useEffect(() => setDraft({ ins: ins.split(';').join('\n'), dt }), [ins, dt]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStep('0');
    setIns(
      draft.ins
        .split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ','))
        .filter(Boolean)
        .join(';'),
    );
    setDt(draft.dt.trim());
  };
  return (
    <>
      <div class="pp-controls">
        <Field label="段数">
          <Seg
            label="段数"
            items={[
              { key: '4', label: '四段' },
              { key: '5', label: '五段' },
            ]}
            value={kText as '4' | '5'}
            onChoose={(key) => (setStep('0'), setK(key))}
          />
        </Field>
        <Field label="处理方式">
          <Seg label="处理方式" items={MODE_ITEMS} value={mode as Mode} onChoose={(key) => (setStep('0'), setMode(key))} />
        </Field>
        {kText === '5' ? (
          <Field label="指令和数据">
            <Seg
              label="指令和数据"
              items={[
                { key: '0', label: '分开存放' },
                { key: '1', label: '同一个单端口存储器' },
              ]}
              value={mem as '0' | '1'}
              onChoose={(key) => (setStep('0'), setMem(key))}
            />
          </Field>
        ) : null}
      </div>
      <form class="pp-form" onSubmit={submit}>
        <label class="field pp-grow">
          <span class="field-label">指令（一行一条，最多 {MAX_STALL_INSTRUCTIONS} 条）</span>
          <textarea class="input is-mono" rows={5} spellcheck={false} autoComplete="off" value={draft.ins} onInput={(event) => setDraft({ ...draft, ins: event.currentTarget.value })} />
        </label>
        <label class="field pp-num">
          <span class="field-label">时钟周期（ns，可不填）</span>
          <input class="input is-mono" type="text" inputMode="decimal" autoComplete="off" value={draft.dt} onInput={(event) => setDraft({ ...draft, dt: event.currentTarget.value })} />
        </label>
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {built.problem ? (
        <p class="field-error" role="alert">
          {built.problem}。下面先按原来的四条画。
        </p>
      ) : (
        <p class="pp-note">写法同教材 5.6 节：目标在最前，LAD R1,M(x) 取数，STO M(x),R1 存数。</p>
      )}
      {made.trace.result['用时'] ? (
        <p class="pp-sum">
          <span>
            总周期数 <b>{made.trace.result['总周期数']}</b>
          </span>
          <span>
            用时 <b>{made.trace.result['用时']}</b>
          </span>
        </p>
      ) : null}
      <Player
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

/** 弄坏它：后推时 ID 里的盒子不等了，直接带着读到的值往前走。 */
function Break() {
  const params = useMemo<StallParams>(() => ({ stages: 5, instructions: examples[1]!.instructions, mode: '后推' }), []);
  const made = useRun(params);
  const { trace, stage } = made;
  const { timing } = stage;
  const names = stageNames(5);
  const [, setStep] = useParam('s', '0');
  const firstHold = trace.steps.findIndex((step) => step.level === 'cycle' && step.state.waiting.some((w) => w.includes('停在 ID')));
  const breakIt = (state: StallState): Breakage | null => {
    if (state.cycle === 0 || state.total !== null) return null;
    const at = lineAt(timing, names, state.cycle);
    const s = 1;
    const who = at.items[s];
    if (!who || who.startsWith('~')) return null;
    const j = Number(who.slice(1)) - 1;
    const why = timing.reason[j]?.[2];
    if (!why || why.kind !== 'data' || state.cycle >= timing.enter[j]![2]! - 1) return null;
    const moved = at.items.slice();
    moved[2] = who;
    moved[1] = '';
    const tags = names.map((_, i) => (i === 2 ? `${why.reg} 旧值` : ''));
    return {
      label: `不等了，${who} 现在就读 ${why.reg}`,
      patch: { line: { items: moved, tags, tones: names.map((_, i) => (i === 2 ? 'bad' : '')), crash: 2, bad: [2] } },
      moves: [{ value: `${why.reg} 旧值`, from: 'line.0.1', to: 'line.0.2', arc: true }],
      message: `${who} 第 ${state.cycle} 个周期就读 ${why.reg}，I${why.from} 第 ${why.ready - 1} 个周期才写回，它拿走的是旧值。之后的 EX、MEM、WB 都照常进行，硬件不报错，${who} 写进寄存器的结果是错的，再用这个结果的指令也跟着错。`,
    };
  };
  return (
    <>
      <div class="pp-controls">
        {firstHold >= 0 ? (
          <button type="button" class="btn" onClick={() => setStep(String(firstHold + 1))}>
            翻到第一次停顿
          </button>
        ) : null}
      </div>
      <p class="pp-note">五段流水线，后推。翻到某条指令在 ID 里等数的周期，点舞台下的按钮，让它不等了。</p>
      <Player
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
  return <PageShell id="sl" panels={{ '': Learn, try: Try, quiz: StallQuiz, break: Break }} />;
}
