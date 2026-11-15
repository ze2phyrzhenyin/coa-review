/**
 * 练习的答题纸：台面上一张纸，按考试的版式一行一行填，没有动画。3-expand 和 3-decode 共用。
 * 场景直接用 SceneView（不用播放器）：画面只取决于学生填的内容、当前行和判分结果。
 * 判分只拿学生写的和引擎给的结果比（grade.ts），页面不算答案。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Pose, Rect, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import { Rich } from '../../player/Rich';
import '../../player/player.css';
import { same, shown } from './grade';
import type { Field } from './grade';

export interface SheetRow {
  /** 答题纸左栏：项目。 */
  label: string;
  fields: Field[];
  /** 答错时的提示，一句。 */
  hint: string;
  /** 「看这一步的演示」跳到讲解的第几步；没有就不给按钮。 */
  demo?: () => void;
}

export interface PaperProps {
  /** 本机存草稿用的键（含题号）。 */
  storeKey: string;
  seed: number;
  task: string;
  conditions: { label: string; value: string }[];
  rows: SheetRow[];
  onNext: () => void;
}

type Entries = Record<string, string>[];

export function Paper({ storeKey, seed, task, conditions, rows, onNext }: PaperProps) {
  const count = rows.length;
  const [entries, setEntriesRaw] = useState<Entries>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as Entries | null;
      if (Array.isArray(saved) && saved.length === count) return saved;
    } catch {
      // 读不到就从空表开始。
    }
    return rows.map(() => ({}));
  });
  const setEntries = (next: Entries) => {
    setEntriesRaw(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      // 存不下时只是刷新后要重填。
    }
  };
  const [row, setRow] = useState(0);
  const [checked, setChecked] = useState<number[][] | null>(null);
  const [revealed, setRevealed] = useState(false);

  const grade = (list: Entries) => rows.map((r, i) => r.fields.flatMap((field, f) => (same(field, list[i]?.[field.key] ?? '') ? [] : [f])));
  const first = checked ? checked.findIndex((bad) => bad.length > 0) : -1;

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
              { title: '项目', width: 3.0 },
              { title: '答案', width: 4.2 },
            ],
            rows: rows.map((r) => [r.label, '']),
          },
        },
        ...(wide
          ? [
              {
                id: 'desk',
                kind: 'memory' as const,
                position: [0, count * 0.27 + 2.0] as const,
                props: { name: '填写', columns: [{ title: '', width: 7.0 }], rows: [[''], ['']], hidden: true },
              },
            ]
          : []),
      ],
      wires: [],
    }),
    [rows, wide, count],
  );

  const pose = useMemo<Pose>(() => {
    const changedCells = checked ? checked.flatMap((bad, r) => (bad.length > 0 ? [`${r}.1`] : [])) : [];
    return {
      parts: {
        paper: {
          ...scene.parts[0]!.props,
          rows: rows.map((r, i) => [r.label, r.fields.map((field) => shown(field, entries[i]?.[field.key] ?? '')).filter(Boolean).join('  ')]),
          active: row,
          changedCells,
        },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    };
  }, [scene, entries, row, checked, rows]);

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

  const current = rows[row]!;
  const entry = entries[row] ?? {};
  const wrongHere = checked?.[row] ?? [];
  const edit = (key: string, value: string) => {
    setEntries(entries.map((item, r) => (r === row ? { ...item, [key]: value } : item)));
    setChecked(null);
  };
  const check = () => {
    const graded = grade(entries);
    setChecked(graded);
    const at = graded.findIndex((bad) => bad.length > 0);
    if (at >= 0) setRow(at);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < count - 1) setRow(row + 1);
    else check();
  };
  const reveal = () => {
    const answers = rows.map((r) => Object.fromEntries(r.fields.map((field) => [field.key, field.show])));
    setEntries(answers);
    setRevealed(true);
    setChecked(grade(answers));
  };

  const flat = mode === 'flat';
  const desk = rects['desk'];
  let style: CSSProperties | undefined;
  if (!flat && wide && desk && size.width >= 560) {
    const width = Math.min(size.width - 16, 640);
    const left = Math.round(Math.max(8, Math.min(size.width - width - 8, desk.x + desk.w / 2 - width / 2)));
    const top = Math.round(Math.max(8, Math.min(size.height - panelHeight - 8, desk.y)));
    style = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  }

  const panel = (
    <form ref={panelRef} class={`xp-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <p class="xp-fill-head">
        第 {row + 1} 行，共 {count} 行：<Rich text={current.label} />
      </p>
      <div class="xp-fill-grid">
        {current.fields.map((field, f) =>
          field.kind === 'choice' ? (
            <div key={field.key} class={`field${wrongHere.includes(f) ? ' is-wrong' : ''}`} role="group" aria-label={field.title}>
              <span class="field-label">{field.title}</span>
              <div class="seg">
                {(field.options ?? []).map((option) => (
                  <button key={option} type="button" aria-pressed={entry[field.key] === option} onClick={() => edit(field.key, option)}>
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <label key={field.key} class={`field${wrongHere.includes(f) ? ' is-wrong' : ''}`}>
              <span class="field-label">{field.title}</span>
              <input
                class="input is-mono"
                type="text"
                inputMode={field.kind === 'num' ? 'numeric' : 'text'}
                autoComplete="off"
                spellcheck={false}
                placeholder={field.placeholder}
                aria-invalid={wrongHere.includes(f) ? 'true' : undefined}
                value={entry[field.key] ?? ''}
                onInput={(event) => edit(field.key, event.currentTarget.value)}
              />
            </label>
          ),
        )}
      </div>
      <div class="xp-fill-foot">
        <button type="button" class="btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
          上一行
        </button>
        <button type="button" class="btn" disabled={row === count - 1} onClick={() => setRow(row + 1)}>
          下一行
        </button>
        <button type="submit" class="btn is-primary">
          {row < count - 1 ? '填好了' : '交卷'}
        </button>
        {row < count - 1 && (
          <button type="button" class="btn" onClick={check}>
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
  if (checked && first < 0) {
    verdict = (
      <p class="xp-verdict" role="status">
        <span class="is-ok-text">对</span>
        {revealed ? '，答案已填上。' : '，全部填对。'}
        <button type="button" class="btn" onClick={onNext}>
          换一道
        </button>
      </p>
    );
  } else if (checked) {
    const bad = rows[first]!;
    verdict = (
      <p class="xp-verdict" role="status">
        <span class="is-bad-text">不对</span>：第 {first + 1} 行「<Rich text={bad.label} />」起有错。<Rich text={bad.hint} />
        {bad.demo ? (
          <button type="button" class="btn" onClick={bad.demo}>
            看这一步的演示
          </button>
        ) : null}
      </p>
    );
  }

  return (
    <div class="xp-quiz">
      <p class="xp-task">
        <Rich text={task} />
      </p>
      <dl class="pl-given">
        {conditions.map((condition) => (
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
      <div class={`pl-stage xp-paper${wide ? ' is-wide' : ''}`} data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
        {flat ? <FlatStage scene={scene} pose={pose} onPick={() => {}} picking={false} wrong={undefined} /> : <div class="pl-canvas" ref={canvasHost} />}
        {style && panel}
      </div>
      {!style && panel}
      {verdict}
    </div>
  );
}
