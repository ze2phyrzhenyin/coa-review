import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import { run, sampleParams } from '../../engines/cpu/model';
import type { Instruction, Params, SignalNames } from '../../engines/cpu/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { coarseMoves, coarsen, grainNames } from '../../player/coarsen';
import type { Grain } from '../../player/coarsen';
import { Gallery } from '../../player/Gallery';
import { MACHINE_CONCLUSION, MACHINE_NEEDS, MACHINE_QUESTION, machineBind, machineBreak, machineCaption, machineFrame, machineConvention, machineMistakes, machineMoves, machineNames, machineScene, machineValues, machineWrong, withNotes } from './machine';
import { answerRows, describe, grade, makeInstruction } from './practice';
import type { Entry, Grade } from './practice';
import { TRY_DEFAULT, toParams } from './program';
import './cycle.css';

/** 讲解的例题：一条指令，或样例程序。指令放在指存 32 号单元，寄存器和数存用样例程序的初值。 */
const choices: { id: string; label: string; ins: Instruction | null }[] = [
  { id: 'LAD', label: 'LAD', ins: { op: 'LAD', rx: 'R0', addr: 9 } },
  { id: 'ADD', label: 'ADD', ins: { op: 'ADD', rx: 'R0', ry: 'R1' } },
  { id: 'STO', label: 'STO', ins: { op: 'STO', rx: 'R1', ry: 'R3' } },
  { id: 'JMP', label: 'JMP', ins: { op: 'JMP', addr: 37 } },
  { id: 'MOV', label: 'MOV', ins: { op: 'MOV', rx: 'R2', ry: 'R1' } },
  { id: 'NOT', label: 'NOT', ins: { op: 'NOT', rx: 'R1', ry: 'R0' } },
  { id: 'prog', label: '程序', ins: null },
];
const grains: Grain[] = ['explain', 'beat', 'cycle', 'instruction'];
const signalSets: SignalNames[] = ['book', 'solutions'];
const signalNames: Record<SignalNames, string> = { book: '教材', solutions: '解析书' };
const TABS = [
  { id: 'learn', name: '讲解' },
  { id: 'try', name: '试一试' },
  { id: 'quiz', name: '练习' },
] as const;

const oneOf = <T extends string>(list: readonly T[], fallback: T) => (raw: string): string => ((list as readonly string[]).includes(raw) ? raw : fallback);

function paramsFor(choice: string, names: SignalNames): Params {
  const sample = sampleParams(names);
  const ins = choices.find((item) => item.id === choice)?.ins;
  if (ins === null) return sample;
  return { ...sample, program: [{ addr: sample.registers.PC, ins: ins ?? choices[0]!.ins! }], limit: 1 };
}

/** 宽屏是一排按钮；窄屏换成下拉框，只占一行。两者只显示一个。 */
function Choice<T extends string>({ label, value, options, names, onChange }: { label: string; value: T; options: readonly T[]; names: (option: T) => string; onChange: (value: T) => void }) {
  return (
    <>
      <div class="pl-choice">
        <span class="pl-choice-label">{label}</span>
        <div class="seg" role="radiogroup" aria-label={label}>
          {options.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={option === value} onClick={() => onChange(option)}>
              {names(option)}
            </button>
          ))}
        </div>
      </div>
      <label class="pl-select">
        <span class="pl-choice-label">{label}</span>
        <select value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {names(option)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** 一份参数 → 播放器要的全部东西。粒度换了，场景不变。 */
function useMachine(params: Params | null, grain: Grain) {
  const full = useMemo(() => {
    if (!params) return { trace: null, error: '' };
    try {
      return { trace: withNotes(run(params)), error: '' };
    } catch (error) {
      return { trace: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [params]);
  const scene = useMemo(() => (full.trace ? machineScene(full.trace) : null), [full]);
  const bind = useMemo(() => (full.trace ? machineBind(full.trace) : null), [full]);
  const coarse = useMemo(() => (full.trace ? coarsen(full.trace, grain) : null), [full, grain]);
  const moves = useMemo(() => (coarse ? coarseMoves(coarse.members, machineMoves) : undefined), [coarse]);
  const wrong = useMemo(() => (full.trace ? machineWrong(full.trace) : undefined), [full]);
  const mistakes = useMemo(() => (coarse ? machineMistakes(coarse.trace) : undefined), [coarse]);
  // 「选寄存器」这一步教材没有单独的信号名，是本站为讲清楚拆出来的：标「本站约定」。
  const convention = useMemo(() => machineConvention, []);
  return { ...full, scene, bind, coarse, moves, wrong, mistakes, convention };
}

function useGrain() {
  const [grainParam, setGrain] = useParam('lv', 'explain', oneOf(grains, 'explain'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  return {
    grain: grainParam as Grain,
    /** 换粒度时停在同一个时刻：先换成原始步数，再换成新粒度下的步数。 */
    change(next: Grain, toFine: (i: number) => number, toCoarse: (grain: Grain, fine: number) => number) {
      const at = toFine(Number(new URLSearchParams(location.search).get('s') ?? 0));
      setGrain(next);
      setStep(toCoarse(next, at));
    },
  };
}

function Machine({ params, error, controls }: { params: Params | null; error?: string; controls?: preact.ComponentChildren }) {
  const { grain, change } = useGrain();
  const made = useMachine(params, grain);
  if (error || made.error || !made.trace || !made.coarse || !made.scene || !made.bind) {
    return (
      <>
        {controls}
        <p class="cy-error" role="alert">
          <Rich text={error || made.error || '参数有误'} />
        </p>
      </>
    );
  }
  const { trace, coarse } = made;
  return (
    <Player
      wide
      trace={coarse.trace}
      scene={made.scene}
      bind={made.bind}
      moves={made.moves}
      names={machineNames}
      values={machineValues}
      caption={machineCaption}
      breakIt={machineBreak}
      onWrong={made.wrong}
      frame={grain === 'explain' ? machineFrame : undefined}
      question={MACHINE_QUESTION}
      conclusion={MACHINE_CONCLUSION}
      needs={MACHINE_NEEDS}
      mistakes={made.mistakes}
      convention={made.convention}
    >
      {controls}
      <Choice
        label="一步走多少"
        value={grain}
        options={grains}
        names={(g) => grainNames[g]}
        onChange={(next) => next !== grain && change(next, coarse.toFine, (g, fine) => coarsen(trace, g).toCoarse(fine))}
      />
    </Player>
  );
}

function SignalChoice() {
  const [sig, setSig] = useParam('sig', 'book', oneOf(signalSets, 'book'));
  return <Choice label="信号名" value={sig as SignalNames} options={signalSets} names={(n) => signalNames[n]} onChange={(n) => setSig(n)} />;
}

function Learn() {
  const [choice, setChoice] = useParam('ins', 'LAD', oneOf(choices.map((item) => item.id), 'LAD'));
  const [sig] = useParam('sig', 'book', oneOf(signalSets, 'book'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const params = useMemo(() => paramsFor(choice, sig as SignalNames), [choice, sig]);
  return (
    <Machine
      params={params}
      controls={
        <>
          <Choice
            label="例题"
            value={choice}
            options={choices.map((item) => item.id)}
            names={(id) => choices.find((item) => item.id === id)?.label ?? id}
            onChange={(id) => {
              setChoice(id);
              setStep(0);
            }}
          />
          <SignalChoice />
        </>
      }
    />
  );
}

/** 试一试：学生自己写一段程序和初值，引擎跑出来。参数都在网址里。 */
function Try() {
  const [program, setProgram] = useParam('prog', TRY_DEFAULT.program);
  const [registers, setRegisters] = useParam('reg', TRY_DEFAULT.registers);
  const [memory, setMemory] = useParam('mem', TRY_DEFAULT.memory);
  const [sig] = useParam('sig', 'book', oneOf(signalSets, 'book'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const [draft, setDraft] = useState({ program: program.replace(/;/g, '\n'), registers, memory });
  useEffect(() => setDraft({ program: program.replace(/;/g, '\n'), registers, memory }), [program, registers, memory]);
  const read = useMemo(() => toParams({ program, registers, memory }, sig as SignalNames), [program, registers, memory, sig]);

  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProgram(draft.program.split('\n').map((line) => line.trim()).filter(Boolean).join(';'));
    setRegisters(draft.registers.trim());
    setMemory(draft.memory.trim());
    setStep(0);
  };

  return (
    <>
      <form class="cy-form" onSubmit={submit}>
        <label class="cy-field cy-program">
          <span>程序（一行一条，从指存 32 号单元放起）</span>
          <textarea rows={4} spellcheck={false} value={draft.program} onInput={(e) => setDraft({ ...draft, program: e.currentTarget.value })} />
        </label>
        <label class="cy-field">
          <span>R0、R1、R2、R3 的初值</span>
          <input spellcheck={false} autoComplete="off" value={draft.registers} onInput={(e) => setDraft({ ...draft, registers: e.currentTarget.value })} />
        </label>
        <label class="cy-field">
          <span>数存初值（单元号:数）</span>
          <input spellcheck={false} autoComplete="off" value={draft.memory} onInput={(e) => setDraft({ ...draft, memory: e.currentTarget.value })} />
        </label>
        <button type="submit" class="pl-btn is-primary cy-run">
          运行
        </button>
      </form>
      <Machine params={read.params} error={read.problems.join(' ')} controls={<SignalChoice />} />
    </>
  );
}

const DRAFT_KEY = (seed: number, sig: string) => `coa:5-cycle:quiz:${sig}:${seed}`;

function loadDraft(key: string, rows: number): Entry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Entry[] | null;
    if (Array.isArray(saved) && saved.length === rows) return saved;
  } catch {
    // 读不到就从空表开始。
  }
  return Array.from({ length: rows }, () => ({ cycle: '', beat: '', op: '', signals: '' }));
}

/** 练习：按种子出一条指令，学生在答题纸上填每个微操作的操作、节拍和控制信号，按引擎的表逐格判。 */
function Quiz() {
  const [seedText, setSeed] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(9999, Math.trunc(Number(raw)) || 1))));
  const [sig] = useParam('sig', 'book', oneOf(signalSets, 'book'));
  const seed = Number(seedText);
  const ins = useMemo(() => makeInstruction(seed), [seed]);
  const rows = useMemo(() => answerRows(ins, sig as SignalNames), [ins, sig]);
  const ops = useMemo(() => [...new Set(rows.map((row) => row.op))].sort((a, b) => a.localeCompare(b, 'zh')), [rows]);
  const key = DRAFT_KEY(seed, sig);
  const [entries, setEntries] = useState<Entry[]>(() => loadDraft(key, rows.length));
  const [result, setResult] = useState<Grade | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setEntries(loadDraft(key, rows.length));
    setResult(null);
    setShown(false);
  }, [key, rows.length]);
  const update = (i: number, patch: Partial<Entry>) => {
    const next = entries.map((entry, k) => (k === i ? { ...entry, ...patch } : entry));
    setEntries(next);
    setResult(null);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 存不下时只是刷新后要重填。
    }
  };
  const tryHref = `?t=try&prog=${encodeURIComponent(describe(ins).split('（')[0]!)}&sig=${sig}`;

  return (
    <div class="cy-quiz">
      <div class="pl-controls">
        <SignalChoice />
      </div>
      <p class="cy-task">
        指令 <strong>{describe(ins)}</strong>。按图 5.1 的模型机，逐个微操作填出它属于哪个 CPU 周期、操作、节拍和控制信号（{signalNames[sig as SignalNames]}的写法）。脉冲信号的节拍写不写都行，写了要对；没有信号的格子空着。
      </p>
      <div class="cy-sheet" role="group" aria-label="答题纸">
        <div class="cy-row cy-head" aria-hidden="true">
          <span>CPU 周期</span>
          <span>操作</span>
          <span>节拍</span>
          <span>控制信号</span>
        </div>
        {rows.map((row, i) => {
          const entry = entries[i] ?? { cycle: '', beat: '', op: '', signals: '' };
          const bad = result && !result.ok && result.row === i ? result.cell : null;
          return (
            <div key={i} class={`cy-row${bad ? ' is-bad' : ''}`}>
              <select aria-label={`第 ${i + 1} 行属于哪个 CPU 周期`} class={`cy-cycle${bad === 'cycle' ? ' is-bad' : ''}`} value={entry.cycle ?? ''} onChange={(e) => update(i, { cycle: e.currentTarget.value })}>
                <option value="">周期</option>
                {['取指', '执行', '执行一', '执行二'].map((cycle) => (
                  <option key={cycle} value={cycle}>
                    {cycle}
                  </option>
                ))}
              </select>
              <select aria-label={`第 ${i + 1} 行的操作`} class={bad === 'op' ? 'is-bad' : ''} value={entry.op} onChange={(e) => update(i, { op: e.currentTarget.value })}>
                <option value="">选操作</option>
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <select aria-label={`第 ${i + 1} 行的节拍`} class={bad === 'beat' ? 'is-bad' : ''} value={entry.beat} onChange={(e) => update(i, { beat: e.currentTarget.value })}>
                <option value="">节拍</option>
                {['T1', 'T2', 'T3', 'T4', '—'].map((beat) => (
                  <option key={beat} value={beat}>
                    {beat === '—' ? '不占' : beat}
                  </option>
                ))}
              </select>
              <input aria-label={`第 ${i + 1} 行的控制信号`} class={bad === 'signals' ? 'is-bad' : ''} spellcheck={false} autoComplete="off" value={entry.signals} onInput={(e) => update(i, { signals: e.currentTarget.value })} />
              {shown ? (
                <span class="cy-key">
                  {row.cycle}，{row.op}，{row.beat === '—' ? '不占节拍' : row.beat}，{row.signals.join('、') || '无'}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div class="pl-actions">
        <button type="button" class="pl-btn is-primary" onClick={() => setResult(grade(rows, entries, (row) => row.pulse))}>
          判分
        </button>
        <button type="button" class="pl-btn" onClick={() => setShown(true)}>
          看答案
        </button>
        <a class="pl-btn cy-link" href={tryHref}>
          在试一试里走一遍
        </a>
        <button type="button" class="pl-btn" onClick={() => setSeed(String(seed + 1))}>
          换一题
        </button>
      </div>
      {result ? (
        <p class={result.ok ? 'cy-ok' : 'cy-bad'} role="status">
          <Rich text={result.message} />
        </p>
      ) : null}
    </div>
  );
}

function Machinery() {
  const [tab, setTab] = useParam('t', 'learn', oneOf(TABS.map((item) => item.id), 'learn'));
  // 每个标签页记住自己的步数，切回来还在原处。
  const [step, setStep] = useIntParam('s', 0, 0, 10_000);
  const [memo] = useState(() => new Map<string, number>());
  const choose = (id: string) => {
    if (id === tab) return;
    memo.set(tab, step);
    setTab(id);
    setStep(memo.get(id) ?? 0);
  };
  return (
    <div class="cy">
      <div class="tabs" role="tablist" aria-label="本页">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === tab} onClick={() => choose(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'learn' && <Learn />}
        {tab === 'try' && <Try />}
        {tab === 'quiz' && <Quiz />}
      </div>
    </div>
  );
}

/** 模型机的指令周期。?demo=parts（或 kit）是部件样张，给写页面的人对照部件用。 */
export default function Page() {
  const [demo] = useParam('demo', '');
  if (demo === 'parts' || demo === 'kit') return <Gallery />;
  return <Machinery />;
}
