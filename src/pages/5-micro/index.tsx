import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren, TargetedEvent } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { BOOK_STORE, FETCH_ADDRESS, WORD_BITS, run, runFields } from '../../engines/micro/model';
import type { FieldParams, MicroParams, MicroState, StoreWord, TestEncoding } from '../../engines/micro/model';
import type { Trace } from '../../engines/trace';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { coarseMoves, coarsen } from '../../player/coarsen';
import type { Grain } from '../../player/coarsen';
import {
  MICRO_CONCLUSION,
  MICRO_NEEDS,
  microAskFrame,
  microBind,
  microBreak,
  microCaption,
  microConvention,
  microFrame,
  microMistakes,
  microMoves,
  microNames,
  microQuestion,
  microScene,
  microValues,
  microWrong,
  rerun,
  tidy,
  generalize,
} from './scene';
import { fieldNames, fieldsBind, fieldsScene } from './fields';
import { fieldsExercise, practiceParams, practiceWrong, withAsks } from './practice';
import { Paper } from './Paper';
import type { Entry, PaperMiss } from './Paper';
import './micro.css';

// ---------- 标签页 ----------

interface TabSpec {
  id: string;
  name: string;
  render: () => ComponentChildren;
}

/** 讲解、试一试、练习、弄坏它。所在标签页写进网址参数 t；每个标签页记住自己的步数。 */
function PageTabs({ tabs }: { tabs: TabSpec[] }) {
  const ids = tabs.map((tab) => tab.id);
  const [tab, setTab] = useParam('t', ids[0]!, (raw) => (ids.includes(raw) ? raw : ids[0]!));
  const [step, setStep] = useIntParam('s', 0, 0, 10_000);
  const [memo] = useState(() => new Map<string, number>());
  const current = tabs.find((item) => item.id === tab) ?? tabs[0]!;
  return (
    <div class="mc">
      <div class="tabs" role="tablist" aria-label="本页">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`mc-tab-${item.id}`}
            aria-selected={item.id === current.id}
            aria-controls="mc-panel"
            onClick={() => {
              if (item.id === current.id) return;
              memo.set(current.id, step);
              setTab(item.id);
              setStep(memo.get(item.id) ?? 0);
            }}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div id="mc-panel" class="mc-panel" role="tabpanel" aria-labelledby={`mc-tab-${current.id}`}>
        {current.render()}
      </div>
    </div>
  );
}

function Seg<T extends string>({ label, value, options, names, onChange, mono }: { label: string; value: T; options: readonly T[]; names: (option: T) => string; onChange: (value: T) => void; mono?: boolean }) {
  return (
    <div class="mc-seg">
      <span class="mc-seg-label">{label}</span>
      <div class={`seg${mono ? ' is-mono' : ''}`} role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={option === value} onClick={() => option !== value && onChange(option)}>
            <Rich text={names(option)} />
          </button>
        ))}
      </div>
    </div>
  );
}

const oneOf = <T extends string>(list: readonly T[], fallback: T) => (raw: string): string => ((list as readonly string[]).includes(raw) ? raw : fallback);

// ---------- 微程序的播放器 ----------

const GRAINS = ['explain', 'cycle'] as const;
const GRAIN_NAMES: Record<(typeof GRAINS)[number], string> = { explain: '小步', cycle: '一条微指令' };

interface MicroPlayerProps {
  trace: Trace<MicroParams, MicroState>;
  /** 讲解：第 0 步的问题、结论、常见错误、弄坏它。 */
  lesson?: boolean;
  /** 控存里写不写「做什么」那一栏。 */
  notes?: boolean;
  /** 控存里标成强调色的格子。 */
  marked?: string[];
  onWrong?: typeof practiceWrong;
  children?: ComponentChildren;
}

function MicroPlayer({ trace: raw, lesson, notes = false, marked, onWrong, children }: MicroPlayerProps) {
  const trace = useMemo(() => tidy(raw), [raw]);
  const narrow = useNarrow();
  const [lv, setLv] = useParam('lv', 'explain', oneOf(GRAINS, 'explain'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const grain = lv as Grain;
  const scene = useMemo(() => microScene(trace, narrow, notes, marked), [trace, narrow, notes, marked]);
  const bind = useMemo(() => microBind(), []);
  const coarse = useMemo(() => coarsen(trace, grain), [trace, grain]);
  const moves = useMemo(() => coarseMoves(coarse.members, microMoves), [coarse]);
  const mistakes = useMemo(() => (lesson && grain === 'explain' ? microMistakes(trace) : undefined), [trace, lesson, grain]);
  const breakIt = useMemo(() => (lesson ? microBreak(trace) : undefined), [trace, lesson]);
  const askFrame = useMemo(() => microAskFrame(coarse.trace, narrow), [coarse, narrow]);
  return (
    <Player
      wide
      trace={coarse.trace}
      scene={scene}
      bind={bind}
      moves={moves}
      names={microNames}
      values={microValues}
      caption={microCaption}
      breakIt={breakIt}
      onWrong={onWrong ?? microWrong}
      askFrame={askFrame}
      flipPart={(ask) => (ask.kind === 'bits' && ask.answer.replace(/\s/g, '').length === 4 ? 'uAR' : null)}
      convention={microConvention}
      frame={narrow && grain === 'explain' ? microFrame : undefined}
      {...(lesson ? { question: microQuestion(trace, narrow), conclusion: MICRO_CONCLUSION, needs: MICRO_NEEDS, mistakes } : {})}
    >
      {children}
      <Seg
        label="一步走多少"
        value={lv as (typeof GRAINS)[number]}
        options={GRAINS}
        names={(g) => GRAIN_NAMES[g]}
        onChange={(next) => {
          const at = coarse.toFine(Number(new URLSearchParams(location.search).get('s') ?? 0));
          setLv(next);
          setStep(coarsen(trace, next).toCoarse(at));
        }}
      />
    </Player>
  );
}

/** 台面上各部件是什么，第一次出现的术语可以点开。 */
function Legend() {
  return (
    <p class="mc-note">
      左边是<Term k="微程序控制器" />：<Term k="控制存储器" />是一排抽屉，一个微地址一格；<Term k="微地址寄存器">μAR</Term> 指着要读的那一格；读出的 23 位
      <Term k="微指令" />滑进 <Term k="微指令寄存器">μIR</Term>，1–17 位一位一个<Term k="微命令" />，18、19 位是<Term k="判别测试字段">P 字段</Term>，20–23 位是
      <Term k="下地址字段" />；<Term k="地址转移逻辑" />按 P 字段用 IR 的 OP 或 <Term k="Cy">Cy</Term> 改下地址。右边是图 5.21 的运算器：X、Y 是 ALU 两个输入端的多路开关，接哪个寄存器由 R1→X 这类微命令选通，ALU 的结果经总线回到 R1–R3。
    </p>
  );
}

// ---------- 讲解 ----------

const EXAMPLES = [
  { id: '2+5', a: 2, b: 5 },
  { id: '7+6', a: 7, b: 6 },
] as const;

function Learn() {
  const ids = EXAMPLES.map((item) => item.id);
  const [ex, setEx] = useParam('ex', '2+5', oneOf(ids, '2+5'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const example = EXAMPLES.find((item) => item.id === ex) ?? EXAMPLES[0];
  const trace = useMemo(() => run({ a: example.a, b: example.b }), [example]);
  const other = EXAMPLES.find((item) => item.id !== example.id)!;
  const theirs = useMemo(() => run({ a: other.a, b: other.b }).result, [other]);
  return (
    <>
      <MicroPlayer key={example.id} trace={trace} lesson>
        <Seg
          label="例题"
          mono
          value={example.id}
          options={ids}
          names={(id) => {
            const item = EXAMPLES.find((e) => e.id === id)!;
            return `${item.a} + ${item.b}`;
          }}
          onChange={(id) => {
            setStep(0);
            setEx(id);
          }}
        />
      </MicroPlayer>
      <div class="mc-controls">
        <p class="mc-note">
          两道例题用同一段微程序（图 5.25）。{example.a} + {example.b} 走 <span class="mono">{trace.result['执行路径']}</span>，{other.a} + {other.b} 走{' '}
          <span class="mono">{theirs['执行路径']}</span>：分叉在 P<sub>2</sub> 测 Cy 的那一步。
        </p>
        <Legend />
      </div>
    </>
  );
}

// ---------- 试一试 ----------

const BOOK_TEXT = BOOK_STORE.map((w) => `${w.addr} ${w.word.replace(/\s+/g, '')}`).join('\n');
const encodeStore = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((line) => line.replace(' ', ':').replace(/\s+/g, ''))
    .join(';');
const decodeStore = (code: string): string => code.split(';').map((item) => item.replace(':', ' ')).join('\n');
const DEFAULT_CM = encodeStore(BOOK_TEXT);

function readStore(code: string): { store: StoreWord[]; problems: string[] } {
  const problems: string[] = [];
  const store: StoreWord[] = [];
  for (const item of code.split(';').filter(Boolean)) {
    const [addr = '', word = ''] = item.split(':');
    if (!/^[01]{4}$/.test(addr) || !new RegExp(`^[01]{${WORD_BITS}}$`).test(word)) {
      problems.push(`「${item.replace(':', ' ')}」要写成 4 位微地址、空格、${WORD_BITS} 位微指令`);
      continue;
    }
    const book = BOOK_STORE.find((w) => w.addr === addr && w.word.replace(/\s+/g, '') === word);
    store.push({ addr, word, note: book?.note ?? '' });
  }
  return { store, problems };
}

const digit = (raw: string, fallback: string) => (/^[0-9]$/.test(raw) ? raw : fallback);
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

function TryRun() {
  const [aText, setA] = useParam('a', '4', (raw) => digit(raw, '4'));
  const [bText, setB] = useParam('b', '9', (raw) => digit(raw, '9'));
  const [op, setOp] = useParam('op', '1010', (raw) => (/^[01]{4}$/.test(raw) ? raw : '1010'));
  const [cm, setCm] = useParam('cm', DEFAULT_CM);
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const [draft, setDraft] = useState({ op, cm: decodeStore(cm) });
  useEffect(() => setDraft({ op, cm: decodeStore(cm) }), [op, cm]);
  const made = useMemo(() => {
    const { store, problems } = readStore(cm);
    if (problems.length) return { trace: null, error: problems.join('；') };
    const params: MicroParams = { a: Number(aText), b: Number(bText), op };
    if (cm !== DEFAULT_CM) params.store = store;
    try {
      const trace = run(params);
      return { trace: params.store ? generalize(trace) : trace, error: '' };
    } catch (error) {
      return { trace: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [aText, bText, op, cm]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOp(draft.op.trim());
    setCm(encodeStore(draft.cm) || DEFAULT_CM);
    setStep(0);
  };
  const pickDigit = (set: (v: string) => void) => (event: TargetedEvent<HTMLSelectElement>) => {
    set(event.currentTarget.value);
    setStep(0);
  };
  return (
    <>
      <form class="mc-form" onSubmit={submit}>
        <label class="field">
          <span class="field-label">a（执行前在 R2）</span>
          <select class="select is-mono" value={aText} onChange={pickDigit(setA)}>
            {DIGITS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="field-label">b（执行前在 R3）</span>
          <select class="select is-mono" value={bText} onChange={pickDigit(setB)}>
            {DIGITS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="field-label">指令的 OP</span>
          <input class="input is-mono" inputMode="numeric" autoComplete="off" spellcheck={false} value={draft.op} placeholder="1010" onInput={(e) => setDraft({ ...draft, op: e.currentTarget.value })} />
        </label>
        <label class="field mc-wide">
          <span class="field-label">控存（一行一格：微地址、空格、23 位微指令）</span>
          <textarea class="input is-mono mc-cm" rows={4} spellcheck={false} value={draft.cm} onInput={(e) => setDraft({ ...draft, cm: e.currentTarget.value })} />
          <span class="field-help">改 a、b 让两数之和跨过 9，看 P<sub>2</sub> 那一步走哪一支；把 OP 改掉，看 P<sub>1</sub> 把地址带到哪一格。</span>
        </label>
        <div class="mc-actions">
          <button type="submit" class="btn is-primary">
            运行
          </button>
          <button
            type="button"
            class="btn is-quiet"
            onClick={() => {
              setOp('1010');
              setCm(DEFAULT_CM);
              setStep(0);
            }}
          >
            恢复图 5.25
          </button>
        </div>
      </form>
      {made.trace ? (
        <MicroPlayer key={`${aText}${bText}${op}${cm}`} trace={made.trace} />
      ) : (
        <p class="field-error mc-error" role="alert">
          <Rich text={made.error} />
        </p>
      )}
    </>
  );
}

interface FieldForm {
  direct: string;
  groups: string;
  conditions: string;
  enc: string;
  word: string;
  units: string;
  ins: string;
  per: string;
}
const FIELD_DEFAULT: FieldForm = { direct: '4', groups: '3,6,12', conditions: '3', enc: 'bit', word: '', units: '256', ins: '', per: '' };
const FIELD_KEYS: Record<keyof FieldForm, string> = { direct: 'fd', groups: 'fg', conditions: 'fc', enc: 'fe', word: 'fw', units: 'fu', ins: 'fi', per: 'fp' };

function readFields(form: FieldForm): { params: FieldParams | null; problem: string } {
  const num = (text: string) => (text.trim() === '' ? undefined : Number(text));
  const params: FieldParams = {};
  const direct = num(form.direct);
  if (direct !== undefined) params.direct = direct;
  const groups = form.groups.split(/[\s,，、]+/).filter(Boolean).map(Number);
  if (groups.length) params.groups = groups;
  const conditions = num(form.conditions);
  if (conditions !== undefined) params.conditions = conditions;
  params.testEncoding = (form.enc === 'code' ? '编码' : '每个条件一位') as TestEncoding;
  const word = num(form.word);
  if (word !== undefined) params.wordBits = word;
  const units = num(form.units);
  if (units !== undefined) params.cmWords = units;
  const ins = num(form.ins);
  const per = num(form.per);
  if (ins !== undefined && per !== undefined) params.program = { instructions: ins, perInstruction: per };
  try {
    runFields(params);
    return { params, problem: '' };
  } catch (error) {
    return { params: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

function useFieldForm(): [FieldForm, (next: FieldForm) => void] {
  const entries = (Object.keys(FIELD_KEYS) as (keyof FieldForm)[]).map((key) => [key, useParam(FIELD_KEYS[key], FIELD_DEFAULT[key])] as const);
  const form = Object.fromEntries(entries.map(([key, [value]]) => [key, value])) as unknown as FieldForm;
  return [form, (next) => entries.forEach(([key, [, set]]) => set(next[key]))];
}

function TryFields() {
  const narrow = useNarrow();
  const [form, setForm] = useFieldForm();
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const [draft, setDraft] = useState(form);
  const key = JSON.stringify(form);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(form), [key]);
  const made = useMemo(() => {
    const read = readFields(form);
    if (!read.params) return { trace: null, error: read.problem };
    return { trace: runFields(read.params), error: '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const scene = useMemo(() => (made.trace ? fieldsScene(made.trace, narrow) : null), [made, narrow]);
  const bind = useMemo(() => (made.trace ? fieldsBind(made.trace) : null), [made]);
  const input = (k: keyof FieldForm, label: string, help?: string) => (
    <label class="field">
      <span class="field-label">{label}</span>
      <input class="input is-mono" inputMode="numeric" autoComplete="off" spellcheck={false} value={draft[k]} onInput={(e) => setDraft({ ...draft, [k]: e.currentTarget.value })} />
      {help ? <span class="field-help">{help}</span> : null}
    </label>
  );
  return (
    <>
      <form
        class="mc-form"
        onSubmit={(event) => {
          event.preventDefault();
          setForm(draft);
          setStep(0);
        }}
      >
        {input('direct', '直接表示的微命令（个）')}
        {input('groups', '各相斥组的微命令数', '用逗号隔开，如 3,6,12')}
        {input('conditions', '转移条件（个）')}
        <div class="field">
          <span class="field-label">判别测试字段</span>
          <div class="seg" role="group" aria-label="判别测试字段">
            {[
              ['bit', '每个条件一位'],
              ['code', '编码'],
            ].map(([id, name]) => (
              <button key={id} type="button" aria-pressed={draft.enc === id} onClick={() => setDraft({ ...draft, enc: id! })}>
                {name}
              </button>
            ))}
          </div>
        </div>
        {input('units', '控存单元数', '2 的幂；不知道就空着')}
        {input('word', '微指令字长（位）', '不知道就空着')}
        {input('ins', '机器指令条数', '和下一格一起给，用来数微指令条数')}
        {input('per', '每条指令平均几条微指令（含取指）')}
        <div class="mc-actions">
          <button type="submit" class="btn is-primary">
            计算
          </button>
        </div>
      </form>
      {made.trace && scene && bind ? (
        <Player
          key={key}
          trace={made.trace}
          scene={scene}
          bind={bind}
          names={fieldNames}
          onWrong={(_ask, value, state) => ({
            label: '',
            patch: { CAP: { value: `${value} 个单元？` } },
            // 播放器演后果时镜头看移动的两头，移动不能是空的：从格式卡飞一张写着学生答案的牌到控存。
            moves: [{ value, from: 'FMT', to: 'CAP', arc: true }],
            message:
              state.nextBits === null
                ? '控存单元数看题目给的条件。'
                : made.trace!.params.cmWords !== undefined
                  ? '题目已经给了控存单元数。'
                  : `下地址 ${state.nextBits} 位，能指到的单元数是 2 的 ${state.nextBits} 次方；按微指令条数算时取题目给的条数。`,
          })}
        />
      ) : (
        <p class="field-error mc-error" role="alert">
          <Rich text={made.error} />
        </p>
      )}
    </>
  );
}

const TRY_KINDS = ['run', 'fields'] as const;
const TRY_NAMES: Record<(typeof TRY_KINDS)[number], string> = { run: '跑微程序', fields: '算字段和控存' };

function Try() {
  const [kind, setKind] = useParam('k', 'run', oneOf(TRY_KINDS, 'run'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  return (
    <>
      <Seg
        label="试什么"
        value={kind as (typeof TRY_KINDS)[number]}
        options={TRY_KINDS}
        names={(k) => TRY_NAMES[k]}
        onChange={(next) => {
          setKind(next);
          setStep(0);
        }}
      />
      {kind === 'run' ? <TryRun /> : <TryFields />}
    </>
  );
}

// ---------- 练习 ----------

function useSeed(): [number, (next: number) => void] {
  const [text, set] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(9999, Math.trunc(Number(raw)) || 1))));
  return [Number(text), (next) => set(String(Math.max(1, Math.min(9999, next))))];
}

function PracticeRead() {
  const [seed, setSeed] = useSeed();
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const params = useMemo(() => practiceParams(seed), [seed]);
  const trace = useMemo(() => generalize(withAsks(run(params))), [params]);
  const asks = trace.steps.filter((step) => step.ask).length;
  return (
    <>
      <div class="mc-controls">
        <p class="mc-note">
          题号 <span class="tnum">{seed}</span>。指令的 OP 是 <span class="mono">{params.op}</span>，控存里只放了取指微指令、OP 指向的那条运算微指令和它之后回到取指的空微指令。一路按「下一步」，遇到题目就在场景里作答（共 {asks}{' '}
          道）：下一微地址在 μAR 上逐位翻片，寄存器直接点。
        </p>
        <div class="mc-actions">
          <button
            type="button"
            class="btn"
            onClick={() => {
              setStep(0);
              setSeed(seed + 1);
            }}
          >
            换一题
          </button>
        </div>
      </div>
      <MicroPlayer key={seed} trace={trace} onWrong={practiceWrong} />
    </>
  );
}

function PracticeSheet() {
  const [seed, setSeed] = useSeed();
  const ex = useMemo(() => fieldsExercise(seed), [seed]);
  const rows = ex.trace.table.rows;
  const labels = [...rows.map((row) => row.cells[0]!), '控存单元数'];
  const answer: Entry[] = [...rows.map((row) => ({ bits: row.cells[2]! })), { bits: String(ex.words) }];
  const stepOf = new Map(ex.trace.steps.map((step) => [step.id, step]));
  const grade = (entries: Entry[]): PaperMiss[] =>
    answer.flatMap((right, r) => {
      const said = (entries[r]?.bits ?? '').trim();
      if (said !== '' && Number(said) === Number(right.bits)) return [];
      const step = r < rows.length && rows[r]!.step ? stepOf.get(rows[r]!.step!) : ex.trace.steps.at(-1);
      return [{ row: r, field: 'bits', message: `${labels[r]}。${step ? step.why : ''}` }];
    });
  return (
    <Paper
      key={seed}
      draftKey={`coa:5-micro:sheet:${seed}`}
      seed={seed}
      task={
        <p>
          按条件逐行写出微指令各字段的位数，最后写控存有多少个单元。相斥组每组编成一个字段，要留一个码表示不发微命令。
        </p>
      }
      conditions={ex.trace.conditions}
      title="答题纸"
      columns={[
        { title: '字段', width: 2.2 },
        { title: '位数', width: 1.1 },
      ]}
      labels={labels.map((_, i) => String(i + 1))}
      heads={labels}
      fields={() => [{ key: 'bits', label: '位数', mono: true, inputMode: 'numeric' }]}
      cells={(entry, r) => [labels[r]!, entry.bits ?? '']}
      columnOf={() => 1}
      answer={answer}
      grade={grade}
      done={`控存 ${ex.trace.result['控存容量']}。`}
      onNext={() => setSeed(seed + 1)}
    />
  );
}

const QUIZ_KINDS = ['read', 'sheet'] as const;
const QUIZ_NAMES: Record<(typeof QUIZ_KINDS)[number], string> = { read: '读微指令、算下一微地址', sheet: '答题纸：字段和控存' };

function Practice() {
  const [kind, setKind] = useParam('k', 'read', oneOf(QUIZ_KINDS, 'read'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  return (
    <>
      <Seg
        label="题型"
        value={kind as (typeof QUIZ_KINDS)[number]}
        options={QUIZ_KINDS}
        names={(k) => QUIZ_NAMES[k]}
        onChange={(next) => {
          setKind(next);
          setStep(0);
        }}
      />
      {kind === 'read' ? <PracticeRead /> : <PracticeSheet />}
    </>
  );
}

// ---------- 弄坏它 ----------

const BREAK_A = 2;
const BREAK_B = 5;
const FAULTS = [
  { id: 'p1', addr: FETCH_ADDRESS, label: `取指微指令的 P_1 写成 0`, edit: (bits: string) => bits.slice(0, 17) + '0' + bits.slice(18) },
  { id: 'p2', addr: BOOK_STORE[2]!.addr, label: `${BOOK_STORE[2]!.addr} 号的 P_2 写成 0`, edit: (bits: string) => bits.slice(0, 18) + '0' + bits.slice(19) },
  { id: 'next', addr: BOOK_STORE[1]!.addr, label: `${BOOK_STORE[1]!.addr} 号的下地址写成 ${BOOK_STORE[3]!.addr}`, edit: (bits: string) => bits.slice(0, 19) + BOOK_STORE[3]!.addr },
] as const;
const HARDWARE: Record<(typeof FAULTS)[number]['id'], string> = {
  p1: '真实机器里 P_1 写错，每条指令都只被取进 IR，执行微程序一条也走不到：程序计数器一直往前走，指令一条条被跳过，没有任何运算做成。',
  p2: '真实机器里少一个 P_2，十进制加法只在和大于 9 时碰巧对；和不超过 9 时多加的 6 留在结果里，得出的不是一位 BCD 码。',
  next: '真实机器里下地址写错，微程序跳过了中间一条微指令。控存是只读的，出厂就写死，这条指令永远算错，要换控存才能改。',
};

function Break() {
  const ids = FAULTS.map((f) => f.id);
  const [id, setId] = useParam('f', 'p2', oneOf(ids, 'p2'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const fault = FAULTS.find((f) => f.id === id) ?? FAULTS[1];
  const params: MicroParams = { a: BREAK_A, b: BREAK_B };
  const healthy = useMemo(() => run(params).result, []);
  const broken = useMemo(() => rerun(params, fault.addr, fault.edit), [fault]);
  // 改过的那一格在抽屉柜里标出来：P 字段在第 1 列，下地址在第 2 列。
  const marked = useMemo(() => {
    const row = broken.trace?.initial.cm.findIndex((w) => w.addr === fault.addr) ?? -1;
    return row < 0 ? [] : [`${row}.${fault.id === 'next' ? 2 : 1}`];
  }, [broken, fault]);
  return (
    <>
      <div class="mc-controls">
        <Seg
          label="改坏哪一处"
          value={fault.id}
          options={ids}
          names={(f) => FAULTS.find((item) => item.id === f)!.label}
          onChange={(next) => {
            setStep(0);
            setId(next);
          }}
        />
        <p class="mc-note">
          算 {BREAK_A} + {BREAK_B}。控存照图 5.25，只把 <Rich text={fault.label} />，再交给引擎从头跑一遍。
        </p>
        <dl class="mc-compare">
          <div>
            <dt>控存正确</dt>
            <dd>
              路径 <span class="mono">{healthy['执行路径']}</span>，R2 = <span class="mono">{healthy['R2']}</span>，Cy = {healthy['Cy']}
            </dd>
          </div>
          <div>
            <dt>改坏以后</dt>
            <dd>
              {broken.trace ? (
                <>
                  路径 <span class="mono">{broken.trace.result['执行路径']}</span>，R2 = <span class="mono">{broken.trace.result['R2']}</span>，Cy = {broken.trace.result['Cy']}
                </>
              ) : (
                <Rich text={broken.error} />
              )}
            </dd>
          </div>
        </dl>
        <p class="mc-note">
          <Rich text={HARDWARE[fault.id]} />
        </p>
      </div>
      {broken.trace ? <MicroPlayer key={fault.id} trace={broken.trace} marked={marked} /> : null}
    </>
  );
}

export default function Page() {
  return (
    <PageTabs
      tabs={[
        { id: 'learn', name: '讲解', render: () => <Learn /> },
        { id: 'try', name: '试一试', render: () => <Try /> },
        { id: 'quiz', name: '练习', render: () => <Practice /> },
        { id: 'break', name: '弄坏它', render: () => <Break /> },
      ]}
    />
  );
}
