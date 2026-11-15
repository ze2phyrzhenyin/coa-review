/**
 * 练习：按题号出一条模型机指令，学生在台面的答题纸上写方框数，再逐个方框写电位信号和带节拍的脉冲信号。
 * 判分对照引擎 runFlow 的方框，指出第一个错的格子；做错了可以看这条指令的演示。
 */
import { useMemo, useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { format, meaning } from '../../engines/cpu/model';
import { runFlow } from '../../engines/hardwired/flow';
import type { FlowParams } from '../../engines/hardwired/flow';
import type { Pose, SceneSpec } from '../../scene';
import { makeInstruction, readSignals } from '../5-cycle/practice';
import { PaperStage, useDraft, useSeed, useWidePaper } from '../4-ea/shell';
import { FlowPlayer } from './play';

interface Sheet {
  count: string;
  rows: { level: string; pulse: string }[];
}
const blank = (): Sheet => ({ count: '', rows: [0, 1, 2].map(() => ({ level: '', pulse: '' })) });

export function FlowPaper() {
  const [seed, next] = useSeed();
  const [view, setView] = useParam('v', '');
  const [, setStep] = useParam('s', '0');
  const params = useMemo<FlowParams>(() => ({ instructions: [makeInstruction(seed)] }), [seed]);
  if (view === 'play') {
    return (
      <div class="ix-quiz">
        <button type="button" class="btn ix-back" onClick={() => setView('')}>
          回到答题纸
        </button>
        <FlowPlayer key={seed} params={params} lesson={false} />
      </div>
    );
  }
  return (
    <SheetView
      key={seed}
      seed={seed}
      params={params}
      onNext={next}
      onDemo={() => {
        setStep('0');
        setView('play');
      }}
    />
  );
}

const norm = (list: { name: string; beat: string | null }[]): string[] => list.map((x) => `${x.name}${x.beat ? `(${x.beat})` : ''}`).sort();

function SheetView({ seed, params, onNext, onDemo }: { seed: number; params: FlowParams; onNext: () => void; onDemo: () => void }) {
  const trace = useMemo(() => runFlow(params), [params]);
  const boxes = trace.steps[trace.steps.length - 1]!.state.boxes;
  const ins = params.instructions[0]!;
  const [sheet, setSheet] = useDraft<Sheet>(`coa:5-flow:quiz:${seed}`, blank, (v): v is Sheet => !!v && typeof v === 'object' && Array.isArray((v as Sheet).rows));
  const [row, setRow] = useState(0);
  const [result, setResult] = useState<{ row: number; col: number; text: string } | 'ok' | null>(null);
  const [revealed, setRevealed] = useState(false);
  const wide = useWidePaper();

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        { id: 'count', kind: 'register', position: [-2.6, -2.6], props: { name: '方框数', value: '', width: 1.8 } },
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0.4],
          title: '答题纸',
          props: {
            name: '答题纸',
            columns: [
              { title: '电位信号', width: 2.6 },
              { title: '脉冲信号', width: 3.8 },
            ],
            rows: [0, 1, 2].map(() => ['', '']),
            labels: ['方框 1', '方框 2', '方框 3'],
          },
        },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 4.4] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    [wide],
  );
  const bad = result && result !== 'ok' ? result : null;
  const pose = useMemo<Pose>(
    () => ({
      parts: {
        count: { ...scene.parts[0]!.props, value: sheet.count, changed: bad?.row === -1 },
        paper: { ...scene.parts[1]!.props, rows: sheet.rows.map((r) => [r.level, r.pulse]), active: row, changedCells: bad && bad.row >= 0 ? [`${bad.row}.${bad.col}`] : [] },
        ...(scene.parts[2] ? { desk: { ...scene.parts[2].props } } : {}),
      },
      wires: {},
    }),
    [scene, sheet, row, bad],
  );

  const check = (s: Sheet) => {
    if (Number(s.count) !== boxes.length) {
      setResult({ row: -1, col: 0, text: `方框数不对。数一数这条指令要让 DBUS 送几次数，每次一个方框，再加上取指的一个。` });
      return;
    }
    for (let r = 0; r < boxes.length; r++) {
      const box = boxes[r]!;
      const level = readSignals(s.rows[r]?.level ?? '');
      const pulse = readSignals(s.rows[r]?.pulse ?? '');
      if (level.some((x) => x.beat)) {
        setResult({ row: r, col: 0, text: `第 ${r + 1} 个方框：电位信号整个周期有效，不注节拍。` });
        setRow(r);
        return;
      }
      if (JSON.stringify(norm(level)) !== JSON.stringify([...box.level].map((x) => x.toUpperCase()).sort())) {
        setResult({ row: r, col: 0, text: `第 ${r + 1} 个方框的电位信号不对。看这个周期哪道门开着、存储器是不是一直在读。` });
        setRow(r);
        return;
      }
      if (pulse.some((x) => !x.beat)) {
        setResult({ row: r, col: 1, text: `第 ${r + 1} 个方框：脉冲信号要注明在哪一拍，写成 LDDR(T3) 这样。` });
        setRow(r);
        return;
      }
      if (JSON.stringify(norm(pulse)) !== JSON.stringify(readSignals(box.pulse.join(',')).map((x) => `${x.name}(${x.beat})`).sort())) {
        setResult({ row: r, col: 1, text: `第 ${r + 1} 个方框的脉冲信号不对。进 DR、IR 和写数存在 T3，进 AR、PC 和通用寄存器在 T4。` });
        setRow(r);
        return;
      }
    }
    for (let r = boxes.length; r < 3; r++) {
      if ((s.rows[r]?.level ?? '').trim() || (s.rows[r]?.pulse ?? '').trim()) {
        setResult({ row: r, col: 0, text: `只有 ${boxes.length} 个方框，第 ${r + 1} 行要空着。` });
        setRow(r);
        return;
      }
    }
    setResult('ok');
  };
  const edit = (patch: Partial<{ level: string; pulse: string }>) => {
    setSheet({ ...sheet, rows: sheet.rows.map((r, k) => (k === row ? { ...r, ...patch } : r)) });
    setResult(null);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < 2) setRow(row + 1);
    else check(sheet);
  };
  const reveal = () => {
    const filled: Sheet = { count: String(boxes.length), rows: [0, 1, 2].map((r) => ({ level: boxes[r]?.level.join('，') ?? '', pulse: boxes[r]?.pulse.join('，') ?? '' })) };
    setSheet(filled);
    setRevealed(true);
    check(filled);
  };
  const entry = sheet.rows[row] ?? { level: '', pulse: '' };

  const panel = (style: CSSProperties | undefined, ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`ix-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <div class="ix-fill-grid">
        <label class={bad?.row === -1 ? 'is-wrong' : ''}>
          <span>方框数</span>
          <input class="input is-mono" inputMode="numeric" autoComplete="off" value={sheet.count} onInput={(e) => (setSheet({ ...sheet, count: e.currentTarget.value }), setResult(null))} />
        </label>
        <label class={bad?.row === row && bad.col === 0 ? 'is-wrong' : ''}>
          <span>方框 {row + 1} 的电位信号</span>
          <input class="input is-mono" autoComplete="off" autoCapitalize="characters" spellcheck={false} placeholder="如 RD(I)" value={entry.level} onInput={(e) => edit({ level: e.currentTarget.value })} />
        </label>
        <label class={`is-span${bad?.row === row && bad.col === 1 ? ' is-wrong' : ''}`}>
          <span>方框 {row + 1} 的脉冲信号（注节拍）</span>
          <input class="input is-mono" autoComplete="off" autoCapitalize="characters" spellcheck={false} placeholder="如 LDIR(T3)，PC+1(T4)" value={entry.pulse} onInput={(e) => edit({ pulse: e.currentTarget.value })} />
        </label>
      </div>
      <div class="ix-fill-foot">
        <button type="button" class="btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
          上一框
        </button>
        <button type="button" class="btn" disabled={row === 2} onClick={() => setRow(row + 1)}>
          下一框
        </button>
        <button type="submit" class="btn is-primary">
          {row < 2 ? '填好了' : '交卷'}
        </button>
        {row < 2 && (
          <button type="button" class="btn" onClick={() => check(sheet)}>
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
        <button type="button" class="btn" onClick={onDemo}>
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
        {bad.text}
        <button type="button" class="btn" onClick={onDemo}>
          看这条指令的演示
        </button>
      </p>
    );
  }

  return (
    <div class="ix-quiz">
      <p class="ix-task">
        画 <code>{format(ins)}</code>（{meaning(ins)}）的方框图：一共几个方框，每个方框旁的电位信号和脉冲信号。用教材的信号名，脉冲信号注节拍，用不到的行空着。
      </p>
      <p class="ix-note tnum">题号 {seed}</p>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['count', 'paper', 'desk'] : ['count', 'paper']} panel={panel} wide={wide} />
      {verdict}
    </div>
  );
}
