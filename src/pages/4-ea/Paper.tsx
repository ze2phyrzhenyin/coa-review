/**
 * 练习：按题号出两三条指令字，学生在台面上的答题纸里逐条填寻址方式、EA、操作数、访存次数。
 * 判分只对照引擎的解题表，指出第一个错的格子；做错了可以在台面上看这道题的演示。
 */
import { useMemo, useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { run } from '../../engines/ea/model';
import type { EaParams } from '../../engines/ea/model';
import { Rich } from '../../player/Rich';
import type { Pose, SceneSpec } from '../../scene';
import { makeExercise } from './setup';
import { PaperStage, useDraft, useSeed, useWidePaper } from './shell';
import { EaPlayer } from './play';

interface Entry {
  mode: string;
  ea: string;
  operand: string;
  count: string;
}
const blank = (): Entry => ({ mode: '', ea: '', operand: '', count: '' });
const COLS = ['寻址方式', '有效地址 EA', '操作数', '访存次数'] as const;
/** 解题表里对应的列：指令｜特征｜形式地址｜寻址方式｜EA｜操作数｜访存次数。 */
const TABLE_COL = [3, 4, 5, 6];

const hexValue = (text: string): number | null => {
  const t = text.trim().replace(/\s+/g, '').replace(/[hH]$/, '');
  if (t === '' || t === '—' || t === '-' || t === '无') return null;
  if (!/^[0-9A-Fa-f]+$/.test(t)) return Number.NaN;
  return parseInt(t, 16);
};

/** 一格对不对。EA 和操作数按十六进制的值比（前导 0、H 可写可不写），没有 EA 时写「—」或留空都算对。 */
function same(col: number, said: string, want: string): boolean {
  if (col === 0) return said.trim() === want;
  if (col === 3) return said.trim() !== '' && Number(said.trim()) === Number(want);
  const a = hexValue(said);
  const b = hexValue(want);
  if (b === null) return a === null;
  return a !== null && !Number.isNaN(a) && a === b;
}

const HINTS = [
  '寻址方式看寻址特征那几位，对照题目给的表。',
  'EA 按方式的公式算：变址、基址加寄存器，相对加 (PC) 且 A 按补码看，间接要先访存取出地址。',
  '操作数是按 EA 从主存读出的数；立即寻址就是 A，寄存器寻址是寄存器里的数。',
  '访存次数不算取指令那一次：直接、变址、基址、相对各 1 次，间接类 2 次，立即和寄存器寻址 0 次。',
];

export function EaPaper() {
  const [seed, next] = useSeed();
  const [view, setView] = useParam('v', '');
  const [, setStep] = useParam('s', '0');
  const params = useMemo(() => makeExercise(seed), [seed]);
  if (view === 'play') {
    return (
      <div class="ix-quiz">
        <button type="button" class="btn ix-back" onClick={() => setView('')}>
          回到答题纸
        </button>
        <EaPlayer key={seed} params={params} lesson={false} />
      </div>
    );
  }
  return (
    <Sheet
      key={seed}
      seed={seed}
      params={params}
      onNext={next}
      onDemo={(step) => {
        setStep(String(step));
        setView('play');
      }}
    />
  );
}

function Sheet({ seed, params, onNext, onDemo }: { seed: number; params: EaParams; onNext: () => void; onDemo: (step: number) => void }) {
  const trace = useMemo(() => run(params), [params]);
  const rows = trace.table.rows;
  const kinds = [...new Set(Object.values(params.modes).map((m) => m.kind))];
  const [entries, setEntries] = useDraft<Entry[]>(`coa:4-ea:quiz:${seed}`, () => rows.map(blank), (v): v is Entry[] => Array.isArray(v) && v.length === rows.length);
  const [row, setRow] = useState(0);
  const [result, setResult] = useState<{ row: number; col: number } | null | 'ok'>(null);
  const [revealed, setRevealed] = useState(false);
  const wide = useWidePaper();

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0],
          title: '答题纸',
          props: {
            name: '答题纸',
            columns: [
              { title: '寻址方式', width: 2.2 },
              { title: 'EA', width: 1.4, ink: 'addr' },
              { title: '操作数', width: 1.4 },
              { title: '访存', width: 0.9 },
            ],
            rows: rows.map(() => ['', '', '', '']),
            labels: rows.map((r) => r.cells[0]!),
          },
        },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 4.4] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    [rows, wide],
  );
  const bad = result && result !== 'ok' ? result : null;
  const pose = useMemo<Pose>(
    () => ({
      parts: {
        paper: { ...scene.parts[0]!.props, rows: entries.map((e) => [e.mode, e.ea, e.operand, e.count]), active: row, changedCells: bad ? [`${bad.row}.${bad.col}`] : [] },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    }),
    [scene, entries, row, bad],
  );

  const entry = entries[row] ?? blank();
  const edit = (patch: Partial<Entry>) => {
    setEntries(entries.map((item, r) => (r === row ? { ...item, ...patch } : item)));
    setResult(null);
  };
  const check = (list: Entry[]) => {
    for (let r = 0; r < rows.length; r++) {
      const e = list[r] ?? blank();
      const said = [e.mode, e.ea, e.operand, e.count];
      for (let c = 0; c < 4; c++) {
        if (!same(c, said[c]!, rows[r]!.cells[TABLE_COL[c]!]!)) {
          setResult({ row: r, col: c });
          setRow(r);
          return;
        }
      }
    }
    setResult('ok');
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < rows.length - 1) setRow(row + 1);
    else check(entries);
  };
  const reveal = () => {
    const filled = rows.map((r) => ({ mode: r.cells[3]!, ea: r.cells[4]!, operand: r.cells[5]!, count: r.cells[6]! }));
    setEntries(filled);
    setRevealed(true);
    check(filled);
  };
  /** 演示停在这一条指令的第一步之前。 */
  const demoStep = (r: number) => Math.max(0, trace.steps.findIndex((s) => s.state.current === r));

  const panel = (style: CSSProperties | undefined, ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`ix-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <p class="ix-fill-head">
        第 {row + 1} 条：{rows[row]!.cells[0]}
      </p>
      <div class="ix-fill-grid">
        <label class={bad?.row === row && bad.col === 0 ? 'is-wrong' : ''}>
          <span>{COLS[0]}</span>
          <select class="select" value={entry.mode} onChange={(e) => edit({ mode: e.currentTarget.value })}>
            <option value="">选方式</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ['ea', 1, 'text'],
            ['operand', 2, 'text'],
            ['count', 3, 'numeric'],
          ] as const
        ).map(([key, col, mode]) => (
          <label key={key} class={bad?.row === row && bad.col === col ? 'is-wrong' : ''}>
            <span>{COLS[col]}</span>
            <input class="input is-mono" type="text" inputMode={mode} autoComplete="off" spellcheck={false} placeholder={col === 3 ? '' : '如 01A0H'} value={entry[key]} onInput={(e) => edit({ [key]: e.currentTarget.value })} />
          </label>
        ))}
      </div>
      <div class="ix-fill-foot">
        <button type="button" class="btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
          上一条
        </button>
        <button type="button" class="btn" disabled={row === rows.length - 1} onClick={() => setRow(row + 1)}>
          下一条
        </button>
        <button type="submit" class="btn is-primary">
          {row < rows.length - 1 ? '填好了' : '交卷'}
        </button>
        {row < rows.length - 1 && (
          <button type="button" class="btn" onClick={() => check(entries)}>
            交卷
          </button>
        )}
        <button type="button" class="btn is-quiet" onClick={reveal}>
          看答案
        </button>
      </div>
    </form>
  );

  let verdict = null;
  if (result === 'ok') {
    verdict = (
      <p class="ix-verdict" role="status">
        <span class="is-ok-text">{revealed ? '答案已填上。' : '对。'}</span>
        <button type="button" class="btn" onClick={() => onDemo(0)}>
          看演示
        </button>
        <button type="button" class="btn" onClick={onNext}>
          换一题
        </button>
      </p>
    );
  } else if (bad) {
    verdict = (
      <p class="ix-verdict" role="status">
        <span class="is-bad-text">不对。</span>第 {bad.row + 1} 条「{COLS[bad.col]}」一栏错了。{HINTS[bad.col]}
        <button type="button" class="btn" onClick={() => onDemo(demoStep(bad.row))}>
          看这一条的演示
        </button>
      </p>
    );
  }

  return (
    <div class="ix-quiz">
      <p class="ix-task">按下面的格式和条件，逐条填出寻址方式、有效地址 EA、操作数和取操作数要访存几次（不算取指令）。十六进制写 H。</p>
      <dl class="pl-given">
        {trace.conditions.map((condition) => (
          <div key={condition.label}>
            <dt>
              <Rich text={condition.label} />
            </dt>
            <dd>
              <Rich text={condition.value} />
            </dd>
          </div>
        ))}
        <div>
          <dt>题号</dt>
          <dd class="tnum">{seed}</dd>
        </div>
      </dl>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['paper', 'desk'] : ['paper']} panel={panel} wide={wide} />
      {verdict}
    </div>
  );
}
