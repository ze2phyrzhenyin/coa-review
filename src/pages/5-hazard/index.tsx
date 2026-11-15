import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { MAX_HAZARD_INSTRUCTIONS, runHazard } from '../../engines/pipeline/hazard';
import type { HazardParams, HazardState } from '../../engines/pipeline/hazard';
import { parseInstruction } from '../../engines/pipeline/instr';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { Field, Formula, PageShell, Seg } from '../5-spacetime/kit';
import { polishTrace } from '../5-spacetime/polish';
import { HAZARD_CONCLUSION, HAZARD_NEEDS, HAZARD_QUESTION, hazardMistakes, hazardStage, hazardWrong } from './scene';
import { HazardQuiz } from './quiz';

function useRun(params: HazardParams, regs?: string[]) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = polishTrace(runHazard(params));
    const stage = hazardStage(trace, narrow, regs ? { regs } : {});
    return { trace, stage, wrong: hazardWrong(trace, stage.stamps), mistakes: hazardMistakes(trace) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow, regs?.join()]);
}

const examples: { key: string; label: string; params: HazardParams; lead: string }[] = [
  {
    key: 'mix',
    label: '三地址',
    params: { instructions: ['MUL R2,R1,R3', 'ADD R4,R2,R5', 'SUB R5,R6,R7', 'AND R4,R5,R1'] },
    lead: '四条三地址指令，目标寄存器写在最前（MUL R2,R1,R3 是 R1×R3→R2）。编号小的先进流水线。',
  },
  {
    key: 'two',
    label: '两地址',
    params: { instructions: ['LAD R3,M(a)', 'ADD R3,R1', 'MUL R1,R3'] },
    lead: '换成两地址写法：结果回到第一个寄存器，ADD R3,R1 是 R3+R1→R3，第一个寄存器既读又写。',
  },
  {
    key: 'mem',
    label: '存储单元',
    params: { instructions: ['STO M(x),R2', 'LAD R2,M(x)'] },
    lead: '相关也可以落在存储单元上：STO 写 M(x)，LAD 读 M(x)。',
  },
];

function Lead() {
  return (
    <>
      <p class="pp-lead">
        <Term k="数据相关">数据相关</Term>看两条指令有没有碰到同一个寄存器（或存储单元）。I<sub>i</sub> 在前、I<sub>j</sub> 在后，各写出读集合和写集合，比三个交集：
      </p>
      <Formula text="后读∩前写 ≠ ∅：RAW（写后读）　　后写∩前读 ≠ ∅：WAR（读后写）　　后写∩前写 ≠ ∅：WAW（写后写）" />
    </>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'mix', (raw) => (examples.some((item) => item.key === raw) ? raw : 'mix'));
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
        key={example.key}
        trace={made.trace}
        scene={stage.scene}
        bind={stage.bind}
        frame={stage.frame}
        askFrame={stage.askFrame}
        names={stage.names}
        values={stage.values}
        onWrong={made.wrong}
        question={HAZARD_QUESTION}
        conclusion={HAZARD_CONCLUSION}
        needs={HAZARD_NEEDS}
        mistakes={made.mistakes}
      />
    </>
  );
}

const TRY_DEFAULT = 'ADD R1,R2,R3;SUB R4,R1,R5;AND R6,R1,R7;OR R1,R4,R6';

/** 试一试：自己写 2 到 6 条指令。指令在网址参数 ins，分号隔开。 */
function Try() {
  const [ins, setIns] = useParam('ins', TRY_DEFAULT);
  const [, setStep] = useParam('s', '0');
  const lines = ins.split(';').map((line) => line.trim()).filter(Boolean);
  const parsed = useMemo(() => {
    try {
      if (lines.length < 2 || lines.length > MAX_HAZARD_INSTRUCTIONS) throw new Error(`要 2 到 ${MAX_HAZARD_INSTRUCTIONS} 条指令`);
      lines.forEach(parseInstruction);
      return { params: { instructions: lines } as HazardParams, problem: '' };
    } catch (error) {
      return { params: null, problem: error instanceof Error ? error.message : String(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ins]);
  const fallback = useMemo<HazardParams>(() => ({ instructions: TRY_DEFAULT.split(';') }), []);
  const params = parsed.params ?? fallback;
  const made = useRun(params);
  const { stage } = made;
  const [draft, setDraft] = useState(lines.join('\n'));
  useEffect(() => setDraft(ins.split(';').join('\n')), [ins]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStep('0');
    setIns(
      draft
        .split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ','))
        .filter(Boolean)
        .join(';'),
    );
  };
  return (
    <>
      <form class="pp-form" onSubmit={submit}>
        <label class="field pp-grow">
          <span class="field-label">指令（一行一条，先写的先进流水线）</span>
          <textarea class="input is-mono" rows={5} spellcheck={false} autoComplete="off" value={draft} onInput={(event) => setDraft(event.currentTarget.value)} />
        </label>
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {parsed.problem ? (
        <p class="field-error" role="alert">
          {parsed.problem}。下面先按原来的四条画。
        </p>
      ) : (
        <p class="pp-note">可用 ADD SUB MUL DIV AND OR（三地址或两地址）、MOV、NOT、LAD R1,M(x)、STO M(x),R1。目标写在最前。</p>
      )}
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
      />
    </>
  );
}

const PAIRS = [
  { key: 'raw', label: 'RAW', ins: ['ADD R1,R2,R3', 'SUB R4,R1,R5'], regs: ['R1', 'R4'] },
  { key: 'war', label: 'WAR', ins: ['STO M(x),R3', 'ADD R3,R4,R5'], regs: ['R3', 'M(x)'] },
  { key: 'waw', label: 'WAW', ins: ['MUL R3,R1,R2', 'ADD R3,R4,R5'], regs: ['R3'] },
] as const;

/** 弄坏它：让后一条先做完。三种相关各演一遍后果。 */
function Break() {
  const [which, setWhich] = useParam('pair', 'raw', (raw) => (PAIRS.some((item) => item.key === raw) ? raw : 'raw'));
  const [, setStep] = useParam('s', '0');
  const pair = PAIRS.find((item) => item.key === which) ?? PAIRS[0];
  const params = useMemo<HazardParams>(() => ({ instructions: [...pair.ins] }), [pair]);
  const regs = useMemo(() => [...pair.regs], [pair]);
  const made = useRun(params, regs);
  const { trace, stage } = made;
  const pairStep = trace.steps.findIndex((step) => step.state.current === 0);
  const rows = (values: string[]) => regs.map((reg, k) => [reg, values[k] ?? '原来的值']);
  const breakIt = (state: HazardState): Breakage | null => {
    if (state.current !== 0) return null;
    if (pair.key === 'raw') {
      return {
        label: '让 I2 先读 R1',
        patch: { regs: { rows: rows(['原来的值', 'R1 旧值 − R5']) }, deps: { badReads: [[], ['R1']] } },
        moves: [{ value: 'R1 旧值', from: 'regs.0.1', to: 'deps.1.0', arc: true }],
        message: 'I1 还没把 R2+R3 写进 R1，I2 就读了 R1，拿到的是旧值，R4 算错。硬件不会报警，错的 R4 会一路传给后面用它的指令。',
      };
    }
    if (pair.key === 'war') {
      return {
        label: '让 I2 先写 R3',
        patch: { regs: { rows: rows(['R4+R5', 'R4+R5']) }, deps: { badReads: [['R3'], []] } },
        moves: [{ value: 'R4+R5', from: 'deps.1.1', to: 'regs.0.1', arc: true }],
        message: 'I1 要把 R3 原来的值存进 M(x)，可 I2 先把 R4+R5 写进了 R3。I1 再去读，存进内存的成了 I2 的结果，原来的值丢了。',
      };
    }
    return {
      label: '让 I2 先写完',
      patch: { regs: { rows: rows(['R1×R2']) } },
      moves: [{ value: 'R1×R2', from: 'deps.0.1', to: 'regs.0.1', arc: true }],
      message: '乘法慢、加法快。I2 的 R4+R5 先写进 R3，I1 的乘积后到，把它盖掉。程序本来要 R3 最后是和，留下的却是积。',
    };
  };
  return (
    <>
      <div class="pp-controls">
        <Field label="哪一种">
          <Seg label="哪一种" items={PAIRS.map((item) => ({ key: item.key, label: item.label }))} value={pair.key} onChoose={(key) => (setStep('0'), setWhich(key))} />
        </Field>
        {pairStep >= 0 ? (
          <button type="button" class="btn" onClick={() => setStep(String(pairStep + 1))}>
            翻到判类型那一步
          </button>
        ) : null}
      </div>
      <p class="pp-note">
        I1 {pair.ins[0]}，I2 {pair.ins[1]}。翻到判出类型的那一步，点舞台下的按钮，让 I2 抢在 I1 前面。
      </p>
      <Player
        key={`break-${pair.key}`}
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
  return <PageShell id="hz" panels={{ '': Learn, try: Try, quiz: HazardQuiz, break: Break }} />;
}
