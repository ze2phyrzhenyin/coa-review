/**
 * 练习：台面上一张空白的时空图（考试版式：段为行，纵轴自下而上），学生一列一列填，再写时钟周期、T_k、C_k、T_p。
 * 题目由引擎按种子出；标准答案只取自引擎（runSpacetime 的状态、spacetimeFigures）。判分指出第一处错的格子。
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { useParam } from '../../app/url-state';
import { generateSpacetime, runSpacetime, spacetimeFigures, stageNamesOf } from '../../engines/pipeline/spacetime';
import type { SpacetimeParams } from '../../engines/pipeline/spacetime';
import { fmt } from '../../engines/pipeline/instr';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { Given, PaperStage, Verdict, useDraft, useSeed } from './kit';
import type { ChartProps } from './part-types';
import { polishTrace } from './polish';
import { chartCells, kinds } from './scene';

interface Draft {
  cells: string[][];
  clock: string;
  Tk: string;
  Ck: string;
  Tp: string;
}

interface Result {
  /** 第一处错的格子；-1 表示表全对。 */
  row: number;
  col: number;
  wrong: Set<'clock' | 'Tk' | 'Ck' | 'Tp'>;
}

const near = (text: string, want: number, tolerance: number): boolean => {
  const v = Number(text.trim().replace(/\s*(ns|MIPS)$/i, ''));
  return text.trim() !== '' && Number.isFinite(v) && Math.abs(v - want) <= tolerance;
};

export function SpaceQuiz() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<SpacetimeParams>(() => generateSpacetime(seed), [seed]);
  const trace = useMemo(() => polishTrace(runSpacetime(params)), [params]);
  const figures = useMemo(() => spacetimeFigures(params), [params]);
  const names = stageNamesOf(params);
  const k = names.length;
  const Tk = figures.Tk;
  const columns = Tk + 2;
  const rows = [...names].reverse();
  const last = trace.steps.filter((step) => step.level === 'cycle').pop()!.state;
  const answer = useMemo(() => chartCells(params, last.grid, Tk, columns), [params, last, Tk, columns]);
  const narrow = useNarrow();

  const blank = (): Draft => ({ cells: rows.map(() => Array.from({ length: columns }, () => '')), clock: '', Tk: '', Ck: '', Tp: '' });
  const isDraft = (value: unknown): value is Draft => !!value && typeof value === 'object' && Array.isArray((value as Draft).cells) && (value as Draft).cells.length === rows.length && (value as Draft).cells[0]?.length === columns;
  const [draft, setDraft] = useDraft(`coa:5-spacetime:quiz:${seed}`, blank, isDraft);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState(rows.length - 1);
  const [result, setResult] = useState<Result | null>(null);
  const [revealed, setRevealed] = useState(false);
  const selects = useRef<(HTMLSelectElement | null)[]>([]);
  const [, setTab] = useParam('t', '');
  const [, setStep] = useParam('s', '0');
  const [, setK] = useParam('k', '4');
  const [, setN] = useParam('n', '6');
  const [, setTm] = useParam('tm', 'eq');
  const [, setDt] = useParam('dt', '50');
  const [, setSt] = useParam('st', '');
  const [, setTl] = useParam('tl', '5');

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'paper',
          kind: '5-spacetime:chart',
          position: [0, 0],
          title: '答题纸',
          pick: true,
          props: {
            name: '答题纸：时空图',
            corner: '段＼周期',
            columns: Array.from({ length: columns }, (_, c) => String(c + 1)),
            rows,
            cells: rows.map(() => Array.from({ length: columns }, () => '')),
            cellWidth: params.n >= 10 ? 0.82 : 0.7,
            window: narrow ? 6 : 0,
          } satisfies ChartProps,
          describe: () => '答题纸：时空图',
        },
      ],
      wires: [],
      kinds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, narrow],
  );

  const pose = useMemo<Pose>(
    () => ({
      parts: {
        paper: {
          ...scene.parts[0]!.props,
          cells: draft.cells,
          current: col,
          picked: `${row}.${col}`,
          badCells: result && result.row >= 0 ? [`${result.row}.${result.col}`] : [],
        },
      },
      wires: {},
    }),
    [scene, draft, col, row, result],
  );

  const setCell = (r: number, value: string) => {
    setDraft({ ...draft, cells: draft.cells.map((line, i) => (i === r ? line.map((cell, c) => (c === col ? value : cell)) : line)) });
    setResult(null);
  };
  const setField = (key: 'clock' | 'Tk' | 'Ck' | 'Tp', value: string) => {
    setDraft({ ...draft, [key]: value });
    setResult(null);
  };
  const pick = (_id: string, bit?: number) => {
    if (bit === undefined) return;
    const r = Math.floor(bit / 1000);
    const c = bit % 1000;
    setCol(c);
    setRow(r);
    requestAnimationFrame(() => selects.current[r]?.focus({ preventScroll: true }));
  };
  const check = () => {
    let first = { row: -1, col: -1 };
    outer: for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows.length; r++) {
        if ((draft.cells[r]?.[c] ?? '') !== (answer[r]?.[c] ?? '')) {
          first = { row: r, col: c };
          break outer;
        }
      }
    }
    const wrong = new Set<'clock' | 'Tk' | 'Ck' | 'Tp'>();
    if (!near(draft.clock, figures.clock, 0.005)) wrong.add('clock');
    if (!near(draft.Tk, figures.Tk, 0)) wrong.add('Tk');
    if (!near(draft.Ck, Number(fmt(figures.speedup)), 0.011)) wrong.add('Ck');
    if (!near(draft.Tp, Number(fmt(figures.throughputMips)), 0.011)) wrong.add('Tp');
    setResult({ ...first, wrong });
    if (first.col >= 0) {
      setCol(first.col);
      setRow(first.row);
    }
  };
  const reveal = () => {
    setDraft({ cells: answer.map((line) => [...line]), clock: fmt(figures.clock), Tk: String(figures.Tk), Ck: fmt(figures.speedup), Tp: fmt(figures.throughputMips) });
    setRevealed(true);
    setResult({ row: -1, col: -1, wrong: new Set() });
  };
  /** 到试一试里看同一组参数逐周期怎么走，停在出错的那一列。 */
  const demo = (c: number) => {
    setK(String(params.k));
    setN(String(params.n));
    if (params.dt !== undefined) {
      setTm('eq');
      setDt(String(params.dt));
    } else {
      setTm('neq');
      setSt(params.stageTimes!.join(','));
      setTl(String(params.latch ?? 0));
    }
    setStep(String(Math.min(c + 2, trace.steps.length)));
    setTab('try');
  };

  const options = ['', ...Array.from({ length: params.n }, (_, i) => `I${i + 1}`)];
  const given = [
    { label: '段数 k', value: `${k}（${names.join('、')}）` },
    { label: '指令条数 n', value: String(params.n) },
    ...(params.dt !== undefined ? [{ label: '时钟周期 Δt', value: `${params.dt} ns，各段都是一个时钟周期` }] : [{ label: '各段时间', value: params.stageTimes!.map((t, i) => `${names[i]} ${t} ns`).join('，') }, { label: '缓冲寄存器延时 τₗ', value: `${params.latch ?? 0} ns` }]),
    { label: '题号', value: String(seed) },
  ];

  const panel = (
    <form
      class="pp-fill"
      onSubmit={(event) => {
        event.preventDefault();
        check();
      }}
    >
      <p class="pp-fill-head">第 {col + 1} 个周期这一列（从上往下 {rows.join('、')}）</p>
      <div class="pp-fill-grid">
        {rows.map((name, r) => {
          const bad = result && result.row === r && result.col === col;
          return (
            <label key={name} class={bad ? 'is-wrong' : ''}>
              <span>{name} 段</span>
              <select
                ref={(el) => {
                  selects.current[r] = el;
                }}
                class="select is-mono"
                value={draft.cells[r]?.[col] ?? ''}
                aria-invalid={bad ? 'true' : undefined}
                onFocus={() => setRow(r)}
                onChange={(event) => setCell(r, event.currentTarget.value)}
              >
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option || '空'}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <div class="pp-fill-foot">
        <button type="button" class="btn" disabled={col === 0} onClick={() => setCol(col - 1)}>
          上一列
        </button>
        <button type="button" class="btn" disabled={col === columns - 1} onClick={() => setCol(col + 1)}>
          下一列
        </button>
      </div>
      <div class="pp-fill-grid">
        {(
          [
            ['clock', '时钟周期 τ（ns）'],
            ['Tk', 'T_k（个周期）'],
            ['Ck', 'C_k（两位小数）'],
            ['Tp', 'T_p（MIPS，两位小数）'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} class={result?.wrong.has(key) ? 'is-wrong' : ''}>
            <span>
              <Rich text={label} />
            </span>
            <input class="input is-mono" type="text" inputMode="decimal" autoComplete="off" value={draft[key]} aria-invalid={result?.wrong.has(key) ? 'true' : undefined} onInput={(event) => setField(key, event.currentTarget.value)} />
          </label>
        ))}
      </div>
      <div class="pp-fill-foot">
        <button type="button" class="btn is-quiet" onClick={reveal}>
          看答案
        </button>
        <button type="button" class="btn" onClick={onNext}>
          换一题
        </button>
        <button type="submit" class="btn is-primary">
          交卷
        </button>
      </div>
    </form>
  );

  let verdict = null;
  if (result) {
    if (result.row < 0 && result.wrong.size === 0) {
      verdict = (
        <Verdict ok>
          {revealed ? '答案已经填在纸上。' : '时空图和四个数都对。'}
          <Rich text={`T_k = ${figures.Tk}，C_k ≈ ${fmt(figures.speedup)}，T_p ≈ ${fmt(figures.throughputMips)} MIPS。`} />
        </Verdict>
      );
    } else if (result.row >= 0) {
      const t = result.col + 1;
      verdict = (
        <Verdict ok={false}>
          <Rich text={`第 ${t} 列 ${rows[result.row]} 段这一格不对（纸上框出来了）。第 i 条指令在第 t 个周期处在第 t − i + 1 段，所以第 t 列从下往上依次是第 t 条、第 t − 1 条……编号不在 1 到 ${params.n} 之间的格子空着。`} />
          <button type="button" class="btn" onClick={() => demo(result.col)}>
            看这一列的演示
          </button>
        </Verdict>
      );
    } else {
      const parts: string[] = [];
      if (result.wrong.has('clock')) parts.push(params.dt !== undefined ? '时钟周期就是题目给的 Δt' : '时钟周期取最慢的段再加 τₗ');
      if (result.wrong.has('Tk')) parts.push('T_k 数时空图里最后一格在第几列');
      if (result.wrong.has('Ck')) parts.push(params.dt !== undefined ? 'C_k = n·k / T_k' : 'C_k = n 个任务不用流水的时间（各段之和乘 n）÷ T_k·τ');
      if (result.wrong.has('Tp')) parts.push('T_p = n / (T_k·τ)，τ 用 ns 时乘 1000 得 MIPS');
      verdict = (
        <Verdict ok={false}>
          <Rich text={`时空图对了。${parts.join('；')}。`} />
        </Verdict>
      );
    }
  }

  return (
    <div class="pp-quiz">
      <p class="pp-task">
        <Rich text="按下面的条件画出时空图（段为行，纵轴自下而上），再写出时钟周期、T_k、C_k 和 T_p。点纸上的格子跳到那一列，在下面的填写栏里选指令。" />
      </p>
      <Given items={given} />
      <PaperStage scene={scene} pose={pose} frame={['paper']} panel={panel} onPick={pick} />
      {verdict}
    </div>
  );
}
