/**
 * 练习：按题号出一道扩展操作码题，学生在台面的答题纸上逐类填操作码位数、可用编码数、条数和留作扩展的码数。
 * 判分只对照引擎的状态，指出第一个错的格子；做错了可以看这道题的演示。
 */
import { useMemo, useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { generate, levelName, run } from '../../engines/opcode/model';
import type { OpcodeParams } from '../../engines/opcode/model';
import type { Pose, SceneSpec } from '../../scene';
import { PaperStage, useDraft, useSeed, useWidePaper } from '../4-ea/shell';
import { OpcodePlayer } from './play';

interface Entry {
  bits: string;
  avail: string;
  count: string;
  kept: string;
}
const blank = (): Entry => ({ bits: '', avail: '', count: '', kept: '' });
const COLS = ['操作码位数', '可用编码数', '条数', '留作扩展'] as const;
const HINTS = [
  '操作码位数 = 字长 − 地址数 × 地址码位数。',
  '第一类是 2 的操作码位数次方；以后每类是上一类留下的码数乘 2 的多出位数次方。',
  '求最多的那一类：后面几类要的前缀先扣下来，其余都给它；最后一类就是它的全部可用编码。',
  '留作扩展 = 这一级可用 − 这一级用掉。',
];

export function OpcodePaper() {
  const [seed, next] = useSeed();
  const [view, setView] = useParam('v', '');
  const [, setStep] = useParam('s', '0');
  const params = useMemo(() => generate(seed), [seed]);
  if (view === 'play') {
    return (
      <div class="ix-quiz">
        <button type="button" class="btn ix-back" onClick={() => setView('')}>
          回到答题纸
        </button>
        <OpcodePlayer key={seed} params={params} lesson={false} />
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

function Sheet({ seed, params, onNext, onDemo }: { seed: number; params: OpcodeParams; onNext: () => void; onDemo: (step: number) => void }) {
  const trace = useMemo(() => run(params), [params]);
  const final = trace.steps[trace.steps.length - 1]!.state;
  const n = params.levels.length;
  const want = (r: number): string[] => {
    const l = final.levels[r]!;
    return [String(l.opBits), String(l.available ?? ''), String(l.used ?? ''), r === n - 1 ? '' : String(l.reserved ?? '')];
  };
  const [entries, setEntries] = useDraft<Entry[]>(`coa:4-opcode:quiz:${seed}`, () => params.levels.map((l) => ({ ...blank(), count: l.count === undefined ? '' : String(l.count) })), (v): v is Entry[] => Array.isArray(v) && v.length === n);
  const [row, setRow] = useState(0);
  const [result, setResult] = useState<{ row: number; col: number } | 'ok' | null>(null);
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
              { title: '位数', width: 1.0 },
              { title: '可用', width: 1.2 },
              { title: '条数', width: 1.2 },
              { title: '扩展', width: 1.2 },
            ],
            rows: params.levels.map(() => ['', '', '', '']),
            labels: params.levels.map((l) => levelName(l.addresses)),
          },
        },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 3.6 + n * 0.3] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    [params, wide, n],
  );
  const bad = result && result !== 'ok' ? result : null;
  const pose = useMemo<Pose>(
    () => ({
      parts: {
        paper: { ...scene.parts[0]!.props, rows: entries.map((e, r) => [e.bits, e.avail, e.count, r === n - 1 ? '—' : e.kept]), active: row, changedCells: bad ? [`${bad.row}.${bad.col}`] : [] },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    }),
    [scene, entries, row, bad, n],
  );
  const entry = entries[row] ?? blank();
  const edit = (patch: Partial<Entry>) => {
    setEntries(entries.map((item, r) => (r === row ? { ...item, ...patch } : item)));
    setResult(null);
  };
  const check = (list: Entry[]) => {
    for (let r = 0; r < n; r++) {
      const e = list[r] ?? blank();
      const said = [e.bits, e.avail, e.count, e.kept];
      const right = want(r);
      for (let c = 0; c < 4; c++) {
        if (r === n - 1 && c === 3) continue;
        if (said[c]!.trim() === '' || Number(said[c]) !== Number(right[c])) {
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
    if (row < n - 1) setRow(row + 1);
    else check(entries);
  };
  const reveal = () => {
    const filled = params.levels.map((_, r) => {
      const [bits, avail, count, kept] = want(r);
      return { bits: bits!, avail: avail!, count: count!, kept: kept! };
    });
    setEntries(filled);
    setRevealed(true);
    check(filled);
  };
  const demoStep = (r: number) => Math.max(0, trace.steps.findIndex((s) => s.state.current === r));
  const asked = params.levels[row]!.count === undefined;

  const panel = (style: CSSProperties | undefined, ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`ix-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <p class="ix-fill-head">
        第 {row + 1} 类：{levelName(params.levels[row]!.addresses)}指令{asked ? '，求最多几条' : `，要 ${params.levels[row]!.count} 条`}
      </p>
      <div class="ix-fill-grid">
        {(
          [
            ['bits', 0],
            ['avail', 1],
            ['count', 2],
            ['kept', 3],
          ] as const
        ).map(([key, col]) =>
          col === 3 && row === n - 1 ? null : (
            <label key={key} class={bad?.row === row && bad.col === col ? 'is-wrong' : ''}>
              <span>{col === 2 && !asked ? '条数（题目给的）' : COLS[col]}</span>
              <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" readOnly={col === 2 && !asked} value={entry[key]} onInput={(e) => edit({ [key]: e.currentTarget.value })} />
            </label>
          ),
        )}
      </div>
      <div class="ix-fill-foot">
        <button type="button" class="btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
          上一类
        </button>
        <button type="button" class="btn" disabled={row === n - 1} onClick={() => setRow(row + 1)}>
          下一类
        </button>
        <button type="submit" class="btn is-primary">
          {row < n - 1 ? '填好了' : '交卷'}
        </button>
        {row < n - 1 && (
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
        <span class="is-bad-text">不对。</span>
        {levelName(params.levels[bad.row]!.addresses)}的{COLS[bad.col]}错了。{HINTS[bad.col]}
        <button type="button" class="btn" onClick={() => onDemo(demoStep(bad.row))}>
          看这一类的演示
        </button>
      </p>
    );
  }

  return (
    <div class="ix-quiz">
      <p class="ix-task">
        指令字 {params.wordBits} 位，等长，每个地址码 {params.addressBits} 位，用扩展操作码。
        {params.levels.map((l) => `${levelName(l.addresses)}${l.count === undefined ? '尽量多' : ` ${l.count} 条`}`).join('，')}。逐类填出操作码位数、可用编码数、条数和留作扩展的码数。
      </p>
      <p class="ix-note tnum">题号 {seed}</p>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['paper', 'desk'] : ['paper']} panel={panel} wide={wide} />
      {verdict}
    </div>
  );
}
