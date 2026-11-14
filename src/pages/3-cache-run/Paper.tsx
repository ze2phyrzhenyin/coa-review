/**
 * 练习：台面上一张答题纸，按考试版式一行一行填。没有动画；判分只看引擎的解题表。
 * 场景直接用 SceneView（不用播放器）：画面只取决于学生填的内容、当前行和判分结果。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { layout, run } from '../../engines/cache/model';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Pose, Rect, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import '../../player/player.css';
import { blankEntry, entryCells, entryOf, grade, makeExercise } from './exercise';
import type { Entry, Grade } from './exercise';
import { encodeSequence, mappingKey, policyKey } from './setup';

const COLUMNS = ['块号', '', '标记', '结果', '换出'];

export function Paper() {
  const [seedText, setSeed] = useParam('q', '1');
  const seed = Math.max(1, Math.min(99999, Math.trunc(Number(seedText)) || 1));
  return <Sheet key={seed} seed={seed} onNext={() => setSeed(String(seed + 1))} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo(() => makeExercise(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const g = useMemo(() => layout(params), [params]);
  const indexTitle = trace.table.columns[2] ?? '行号';
  const count = trace.table.rows.length;
  const hasWrite = params.accesses.some((a) => a.op === '写');

  const [entries, setEntries] = useState<Entry[]>(() => Array.from({ length: count }, blankEntry));
  const [row, setRow] = useState(0);
  const [result, setResult] = useState<Grade | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [, setTab] = useParam('t', '');
  const [, setMap] = useParam('map', 'direct');
  const [, setRep] = useParam('rep', 'lru');
  const [, setSeq] = useParam('seq', '');
  const [, setStep] = useParam('s', '0');

  // 宽屏上填写栏压在答题纸下方的垫板上；窄屏上排在舞台下面，不要垫板。
  const [wide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 600px)').matches);
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
              { title: '块号', width: 0.9 },
              { title: indexTitle, width: 0.9 },
              { title: '标记', width: 0.9, ink: 'addr' },
              { title: '结果', width: 0.9 },
              { title: '换出', width: 2.0 },
            ],
            rows: Array.from({ length: count }, () => ['', '', '', '', '']),
            labels: trace.table.rows.map((r) => r.cells[0] ?? ''),
          },
        },
        // 不显示的垫板：镜头把它和答题纸一起装进画面，填写栏就压在它的位置上，不挡答题纸。
        ...(wide
          ? [
              {
                id: 'desk',
                kind: 'memory' as const,
                position: [0, 4.6] as const,
                props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true },
              },
            ]
          : []),
      ],
      wires: [],
    }),
    [count, indexTitle, trace, wide],
  );

  const pose = useMemo<Pose>(() => {
    const changedCells = result ? result.wrong.flatMap((bad, r) => bad.map((c) => `${r}.${c}`)) : [];
    return {
      parts: {
        paper: { ...scene.parts[0]!.props, rows: entries.map(entryCells), active: row, changedCells },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    };
  }, [scene, entries, row, result]);

  // 三维场景：建一次；内容变了直接切换，纸面题不带动画。
  const [flatParam] = useParam('flat', '');
  const [mode, setMode] = useState<'loading' | 'scene' | 'flat'>(() => (flatParam === '1' || !canUseWebGL() ? 'flat' : 'loading'));
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const poseRef = useRef(pose);
  poseRef.current = pose;

  useEffect(() => {
    if (mode === 'flat') return;
    let alive = true;
    let made: SceneView | null = null;
    void loadRuntime()
      .then(({ SceneView: View }) => {
        if (!alive || !stage.current || !canvasHost.current) return;
        made = new View(stage.current, canvasHost.current, scene, poseRef.current);
        made.onRects = (next) => {
          setRects(next);
          if (made) setSize(made.size);
        };
        made.plan([wide ? ['paper', 'desk'] : ['paper']]);
        made.show(0, poseRef.current, { animate: false, forward: false, moves: [] });
        made.setScheme(currentScheme());
        view.current = made;
        setSize(made.size);
        setRects(made.rects());
        setMode('scene');
      })
      .catch(() => alive && setMode('flat'));
    return () => {
      alive = false;
      made?.dispose();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, mode === 'flat']);

  useEffect(() => {
    view.current?.show(0, pose, { animate: false, forward: false, moves: [] });
  }, [pose]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => view.current?.setScheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const panelRef = useRef<HTMLFormElement>(null);
  const [panelHeight, setPanelHeight] = useState(170);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setPanelHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const entry = entries[row] ?? blankEntry();
  const edit = (patch: Partial<Entry>) => {
    setEntries((list) => list.map((item, r) => (r === row ? { ...item, ...patch } : item)));
    setResult(null);
  };
  const check = () => {
    const graded = grade(trace, entries);
    setResult(graded);
    if (graded.first >= 0) setRow(graded.first);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < count - 1) setRow(row + 1);
    else check();
  };
  const reveal = () => {
    setEntries(trace.table.rows.map((r) => entryOf(r.cells)));
    setRevealed(true);
    setResult(grade(trace, trace.table.rows.map((r) => entryOf(r.cells))));
  };
  /** 去试一试看这一次访问：同一组参数，停在这次访问的第一步之前。 */
  const demo = (r: number) => {
    const id = trace.table.rows[r]?.step;
    const end = id ? trace.steps.findIndex((step) => step.id === id) + 1 : 0;
    const startOf = Math.max(0, end - 5);
    setMap(mappingKey(params.mapping));
    if (params.replacement) setRep(policyKey(params.replacement));
    setSeq(encodeSequence(params.accesses));
    setStep(String(startOf));
    setTab('try');
  };

  const access = params.accesses[row];
  const wrongHere = result?.wrong[row] ?? [];
  const names = [COLUMNS[0], indexTitle, COLUMNS[2], COLUMNS[3], COLUMNS[4]];
  const flat = mode === 'flat';

  // 填写栏压在垫板的位置上；窄屏或没有位置时排在舞台下面。
  const desk = rects['desk'];
  let style: CSSProperties | undefined;
  if (!flat && wide && desk && size.width >= 560) {
    const width = Math.min(size.width - 16, 680);
    const left = Math.round(Math.max(8, Math.min(size.width - width - 8, desk.x + desk.w / 2 - width / 2)));
    const top = Math.round(Math.max(8, Math.min(size.height - panelHeight - 8, desk.y)));
    style = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  }

  const panel = (
    <form ref={panelRef} class={`cr-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <p class="cr-fill-head">
        第 {row + 1} 行，{access?.op}地址 {access?.address}
      </p>
      <div class="cr-fill-grid">
        {(
          [
            ['block', 0],
            ['index', 1],
            ['tag', 2],
          ] as const
        ).map(([key, column]) => (
          <label key={key} class={wrongHere.includes(column) ? 'is-wrong' : ''}>
            <span>{names[column]}</span>
            <input
              class="pl-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={entry[key]}
              onInput={(event) => edit({ [key]: event.currentTarget.value })}
            />
          </label>
        ))}
        <div class={`cr-fill-result${wrongHere.includes(3) ? ' is-wrong' : ''}`} role="group" aria-label="结果">
          <span>结果</span>
          <div>
            {(['命中', '缺失'] as const).map((value) => (
              <button
                key={value}
                type="button"
                class={`pl-btn${entry.result === value ? ' is-on' : ''}`}
                aria-pressed={entry.result === value}
                onClick={() => edit({ result: value })}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        <label class={wrongHere.includes(4) ? 'is-wrong' : ''}>
          <span>换出的块</span>
          <input
            class="pl-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={entry.out}
            onInput={(event) => edit({ out: event.currentTarget.value })}
          />
        </label>
        {hasWrite && (
          <label class={`cr-check${wrongHere.includes(4) ? ' is-wrong' : ''}`}>
            <input type="checkbox" checked={entry.writeBack} onChange={(event) => edit({ writeBack: event.currentTarget.checked })} />
            <span>写回</span>
          </label>
        )}
      </div>
      <div class="cr-fill-foot">
        <button type="button" class="pl-btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
          上一行
        </button>
        <button type="button" class="pl-btn" disabled={row === count - 1} onClick={() => setRow(row + 1)}>
          下一行
        </button>
        <button type="submit" class="pl-btn is-primary">
          {row < count - 1 ? '填好了' : '交卷'}
        </button>
        {row < count - 1 && (
          <button type="button" class="pl-btn" onClick={check}>
            交卷
          </button>
        )}
        <button type="button" class="pl-btn is-quiet" onClick={reveal}>
          看答案
        </button>
      </div>
    </form>
  );

  let verdict = null;
  if (result && result.first < 0) {
    verdict = (
      <p class="cr-verdict" role="status">
        {revealed ? '答案已填上。' : '全对。'}命中 {trace.result['命中次数']} 次，h = {trace.result['h']}。
        <button type="button" class="pl-btn" onClick={onNext}>
          换一道
        </button>
      </p>
    );
  } else if (result) {
    const bad = result.wrong[result.first] ?? [];
    verdict = (
      <p class="cr-verdict is-wrong" role="status">
        第 {result.first + 1} 行起有错：{bad.map((c) => names[c]).join('、')}。
        {bad.includes(1) && g.mapping !== '全相联' ? `${indexTitle}看块号除以${g.mapping === '直接' ? '行数' : '组数'}的余数。` : ''}
        <button type="button" class="pl-btn" onClick={() => demo(result.first)}>
          看这次访问的演示
        </button>
      </p>
    );
  }

  return (
    <div class="cr-quiz">
      <p class="cr-task">依次访问下面的地址，开始时 cache 是空的。逐行填出块号、{indexTitle}、标记、命中还是缺失、换出的块，没有换出就空着。</p>
      <dl class="pl-given">
        {trace.conditions.map((condition) => (
          <div key={condition.label}>
            <dt>{condition.label}</dt>
            <dd>{condition.value}</dd>
          </div>
        ))}
        <div>
          <dt>题号</dt>
          <dd>{seed}</dd>
        </div>
      </dl>
      <div class={`pl-stage cr-paper${wide ? ' is-wide' : ''}`} data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
        {flat ? <FlatStage scene={scene} pose={pose} onPick={() => {}} picking={false} wrong={undefined} /> : <div class="pl-canvas" ref={canvasHost} />}
        {style && panel}
      </div>
      {!style && panel}
      {verdict}
    </div>
  );
}
