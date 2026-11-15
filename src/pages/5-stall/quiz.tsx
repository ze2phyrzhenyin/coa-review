/**
 * 练习：引擎按种子出一串指令、段数和处理方式。学生在答题纸上填每条指令进入各段的周期和总周期数，
 * 台面上的时空表按学生填的数照表 5.4(b) 的写法画出来。判分只看引擎的 schedule()，指出第一处错的格子。
 */
import { useMemo, useState } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { useParam } from '../../app/url-state';
import { parseInstruction } from '../../engines/pipeline/instr';
import { generateStall, schedule } from '../../engines/pipeline/stall';
import type { StallParams } from '../../engines/pipeline/stall';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { Given, PaperStage, Verdict, useDraft, useSeed } from '../5-spacetime/kit';
import type { ChartProps } from '../5-spacetime/part-types';
import { drawRow, kinds, stageNames } from './scene';

interface Draft {
  enter: string[][];
  total: string;
}

export function StallQuiz() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<StallParams>(() => generateStall(seed), [seed]);
  const timing = useMemo(() => schedule(params), [params]);
  const list = useMemo(() => params.instructions.map(parseInstruction), [params]);
  const names = stageNames(params.stages);
  const k = names.length;
  const n = list.length;
  const columns = timing.total + 3;
  const narrow = useNarrow();
  const blank = (): Draft => ({ enter: list.map(() => names.map(() => '')), total: '' });
  const isDraft = (value: unknown): value is Draft => !!value && typeof value === 'object' && Array.isArray((value as Draft).enter) && (value as Draft).enter.length === n && (value as Draft).enter[0]?.length === k;
  const [draft, setDraft] = useDraft(`coa:5-stall:quiz:${seed}`, blank, isDraft);
  const [row, setRow] = useState(0);
  const [result, setResult] = useState<{ row: number; stage: number; total: boolean } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [, setTab] = useParam('t', '');
  const [, setStep] = useParam('s', '0');
  const [, setK] = useParam('k', '5');
  const [, setM] = useParam('m', '后推');
  const [, setIns] = useParam('ins', '');
  const [, setMem] = useParam('mem', '0');

  const rows = list.map((x, j) => (narrow ? `I${j + 1}` : `I${j + 1} ${x.text}`));
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
            name: '答题纸：时空表',
            corner: '指令＼周期',
            columns: Array.from({ length: columns }, (_, c) => String(c + 1)),
            rows,
            cells: rows.map(() => Array.from({ length: columns }, () => '')),
            cellWidth: narrow ? (k === 5 ? 0.82 : 0.74) : 0.8,
            window: narrow ? 6 : 0,
          } satisfies ChartProps,
          describe: () => '答题纸：时空表',
        },
      ],
      wires: [],
      kinds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, narrow],
  );

  const numbers = (j: number): (number | null)[] => (draft.enter[j] ?? []).map((text) => (/^\d+$/.test(text.trim()) ? Number(text) : null));
  const pose = useMemo<Pose>(() => {
    const cells = list.map((_, j) => drawRow(numbers(j), columns, names));
    const bad = result && result.row >= 0 ? numbers(result.row)[result.stage] : null;
    const firstCol = numbers(row).find((v) => v !== null) ?? 1;
    return {
      parts: {
        paper: {
          ...scene.parts[0]!.props,
          cells,
          current: -1,
          picked: `${row}.${Math.min(columns - 1, Math.max(0, firstCol - 1))}`,
          badCells: result && result.row >= 0 && bad != null && bad >= 1 && bad <= columns ? [`${result.row}.${bad - 1}`] : [],
          window: narrow ? 6 : 0,
        },
      },
      wires: {},
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, draft, result, row]);

  const edit = (j: number, s: number, value: string) => {
    setDraft({ ...draft, enter: draft.enter.map((line, i) => (i === j ? line.map((cell, c) => (c === s ? value : cell)) : line)) });
    setResult(null);
  };
  const check = () => {
    for (let j = 0; j < n; j++) {
      for (let s = 0; s < k; s++) {
        if (Number(draft.enter[j]?.[s]) !== timing.enter[j]![s]) {
          setResult({ row: j, stage: s, total: false });
          setRow(j);
          return;
        }
      }
    }
    setResult({ row: -1, stage: -1, total: Number(draft.total) !== timing.total });
  };
  const reveal = () => {
    setDraft({ enter: timing.enter.map((line) => line.map(String)), total: String(timing.total) });
    setRevealed(true);
    setResult({ row: -1, stage: -1, total: false });
  };
  const demo = (j: number) => {
    setK(String(params.stages));
    setM(params.mode);
    setIns(params.instructions.map(String).join(';'));
    setMem('0');
    setStep(String(Math.min(timing.enter[j]![0]! + 1, timing.total + 1)));
    setTab('try');
  };
  const pick = (_id: string, bit?: number) => {
    if (bit === undefined) return;
    setRow(Math.floor(bit / 1000));
  };

  const panel = (
    <form
      class="pp-fill"
      onSubmit={(event) => {
        event.preventDefault();
        check();
      }}
    >
      <p class="pp-fill-head">
        I{row + 1} {list[row]!.text}：进入各段的周期
      </p>
      <div class="pp-fill-grid">
        {names.map((name, s) => {
          const bad = result && result.row === row && result.stage === s;
          return (
            <label key={name} class={bad ? 'is-wrong' : ''}>
              <span>进 {name}</span>
              <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.enter[row]?.[s] ?? ''} aria-invalid={bad ? 'true' : undefined} onInput={(event) => edit(row, s, event.currentTarget.value)} />
            </label>
          );
        })}
      </div>
      <div class="pp-fill-foot">
        <button type="button" class="btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
          上一条
        </button>
        <button type="button" class="btn" disabled={row === n - 1} onClick={() => setRow(row + 1)}>
          下一条
        </button>
      </div>
      <div class="pp-fill-grid">
        <label class={result?.total ? 'is-wrong' : ''}>
          <span>总周期数</span>
          <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={draft.total} aria-invalid={result?.total ? 'true' : undefined} onInput={(event) => (setDraft({ ...draft, total: event.currentTarget.value }), setResult(null))} />
        </label>
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
    if (result.row < 0 && !result.total) {
      verdict = <Verdict ok>{revealed ? '答案已经填好，纸上的时空表照着画出来了。' : `全对，共 ${timing.total} 个周期。`}</Verdict>;
    } else if (result.row >= 0) {
      const why = timing.reason[result.row]![result.stage];
      const hint =
        result.stage === 2 && params.mode === '后推'
          ? '找要读的寄存器在哪个周期写回：下一个周期才能在 ID 读，再下一个周期进 EX。'
          : result.stage === 2 && params.mode === '定向'
            ? '找结果在哪一段末尾算出来：下一个周期就能进 EX。'
            : why?.kind === 'memory'
              ? '取指和访存用的是同一个存储器。'
              : '一段一个周期只能放一条：前一条还没离开下一段，这一条就留在原段。';
      verdict = (
        <Verdict ok={false}>
          <Rich text={`I${result.row + 1} 进 ${names[result.stage]} 的周期不对（纸上框出来了）。${hint}`} />
          <button type="button" class="btn" onClick={() => demo(result.row)}>
            看这一条的演示
          </button>
        </Verdict>
      );
    } else {
      verdict = <Verdict ok={false}>各段的周期都对，总周期数看最后一条进 WB 的周期。</Verdict>;
    }
  }

  return (
    <div class="pp-quiz">
      <p class="pp-task">
        {params.stages} 段流水线（{names.join('、')}），处理方式：{params.mode}。写回寄存器的下一个周期才读得到。填出每条指令进入各段的周期和总周期数，纸上的时空表会照你填的数画出来。
      </p>
      <Given items={[...list.map((x, j) => ({ label: `I${j + 1}`, value: `${x.text}（${x.meaning}）` })), { label: '题号', value: String(seed) }]} />
      <PaperStage scene={scene} pose={pose} frame={['paper']} panel={panel} onPick={pick} />
      {verdict}
    </div>
  );
}
