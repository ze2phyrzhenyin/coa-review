/**
 * 练习的答题纸：台面上一张按考试版式排的表，学生逐行填，交卷后由页面给的判分函数（读引擎的解题表）
 * 指出第一处错。纸面题不带动画：画面只取决于填了什么、当前行和判分结果。
 * 照 8-mask 的答题纸写（那一页在别的任务里，不跨页引用）。
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, TargetedEvent } from 'preact';
import type { Condition } from '../../engines/trace';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Ink, Pose, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import { Rich } from '../../player/Rich';
import { useParam } from '../../app/url-state';
import '../../player/player.css';
import './paper.css';

export interface PaperField {
  key: string;
  label: string;
  /** 'choice' 给一排按钮；其余是输入框。 */
  kind?: 'text' | 'choice';
  options?: string[];
  mono?: boolean;
  inputMode?: 'numeric' | 'decimal' | 'text';
  /** 只放格式示例。 */
  placeholder?: string;
}

export interface PaperColumn {
  title: string;
  width?: number;
  ink?: Ink;
}

export type Entry = Record<string, string>;

export interface PaperMiss {
  row: number;
  /** 错的那一格（字段 key）。 */
  field: string;
  /** 纸上标错的列，不写时按 columnOf(field)。 */
  column?: number;
  message: string;
}

export interface PaperProps {
  /** 本机草稿的键，含页面编号和题号。 */
  draftKey: string;
  seed: number;
  task: ComponentChildren;
  conditions: Condition[];
  title: string;
  columns: PaperColumn[];
  /** 行左边的标号。 */
  labels: string[];
  /** 填写栏的行标题。 */
  heads: string[];
  fields: (row: number) => PaperField[];
  /** 学生这一行写的 → 纸上这一行各列的字。 */
  cells: (entry: Entry, row: number) => string[];
  /** 字段 → 纸上的列号，用来标错。 */
  columnOf: (field: string) => number;
  /** 标准答案（取自引擎），看答案时填上。 */
  answer: Entry[];
  /** 判分：按行、按格的次序给出全部错处；空数组是全对。 */
  grade: (entries: Entry[]) => PaperMiss[];
  /** 全对时的一句读数。 */
  done: string;
  onNext: () => void;
  /** 去试一试看这一行，没有就不给按钮。 */
  onDemo?: ((row: number) => void) | undefined;
}

const blank = (fields: PaperField[]): Entry => Object.fromEntries(fields.map((field) => [field.key, '']));

export function Paper(props: PaperProps) {
  const { draftKey, labels, fields, cells, answer, grade, columns, title } = props;
  const count = labels.length;
  const empty = () => labels.map((_, r) => blank(fields(r)));
  const [entries, setEntriesRaw] = useState<Entry[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null') as Entry[] | null;
      if (Array.isArray(saved) && saved.length === count) return saved;
    } catch {
      // 读不到就从空表开始。
    }
    return empty();
  });
  const setEntries = (next: Entry[]) => {
    setEntriesRaw(next);
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      // 存不下时只是刷新后要重填。
    }
  };
  const [row, setRow] = useState(0);
  const [misses, setMisses] = useState<PaperMiss[] | null>(null);
  const [revealed, setRevealed] = useState(false);

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0],
          title,
          props: { name: title, columns, rows: labels.map(() => columns.map(() => '')), labels },
        },
      ],
      wires: [],
    }),
    [columns, labels, title],
  );

  const pose = useMemo<Pose>(() => {
    const changedCells = (misses ?? []).map((miss) => `${miss.row}.${miss.column ?? props.columnOf(miss.field)}`);
    return {
      parts: { paper: { ...scene.parts[0]!.props, rows: entries.map((entry, r) => cells(entry, r)), active: row, changedCells } },
      wires: {},
    };
  }, [scene, entries, row, misses, cells, props]);

  const [flatParam] = useParam('flat', '');
  const [mode, setMode] = useState<'loading' | 'scene' | 'flat'>(() => (flatParam === '1' || !canUseWebGL() ? 'flat' : 'loading'));
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
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
        made.plan([['paper']]);
        made.show(0, poseRef.current, { animate: false, forward: false, moves: [] });
        made.setScheme(currentScheme());
        view.current = made;
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

  const rowFields = fields(row);
  const entry = entries[row] ?? blank(rowFields);
  const wrongHere = new Set((misses ?? []).filter((miss) => miss.row === row).map((miss) => miss.field));
  const edit = (key: string, value: string) => {
    setEntries(entries.map((item, r) => (r === row ? { ...item, [key]: value } : item)));
    setMisses(null);
    setRevealed(false);
  };
  const check = () => {
    const found = grade(entries);
    setMisses(found);
    if (found.length > 0) setRow(found[0]!.row);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < count - 1) setRow(row + 1);
    else check();
  };
  const reveal = () => {
    setEntries(answer.map((item) => ({ ...item })));
    setRevealed(true);
    setMisses([]);
  };
  const reset = () => {
    setEntries(empty());
    setMisses(null);
    setRevealed(false);
    setRow(0);
  };

  const flat = mode === 'flat';
  const first = misses && misses.length > 0 ? misses[0]! : null;

  return (
    <div class="mpp">
      <div class="mpp-task">{props.task}</div>
      <dl class="pl-given">
        {props.conditions.map((condition) => (
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
          <dd class="tnum">{props.seed}</dd>
        </div>
      </dl>
      <div class="pl-stage mpp-stage" data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
        {flat ? <FlatStage scene={scene} pose={pose} onPick={() => {}} picking={false} wrong={undefined} /> : <div class="pl-canvas" ref={canvasHost} />}
      </div>
      <form class="mpp-fill" onSubmit={submit}>
        <p class="mpp-head">
          <span class="tnum">
            第 {row + 1} 行，共 {count} 行
          </span>
          <Rich text={props.heads[row] ?? ''} />
        </p>
        <div class="mpp-grid">
          {rowFields.map((field) =>
            field.kind === 'choice' ? (
              <div key={field.key} data-key={field.key} class={`mpp-field${wrongHere.has(field.key) ? ' is-wrong' : ''}`} role="group" aria-label={field.label}>
                <span class="mpp-label">
                  <Rich text={field.label} />
                </span>
                <div class="seg">
                  {(field.options ?? []).map((option) => (
                    <button key={option} type="button" aria-pressed={entry[field.key] === option} onClick={() => edit(field.key, option)}>
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <label key={field.key} data-key={field.key} class={`mpp-field${wrongHere.has(field.key) ? ' is-wrong' : ''}`}>
                <span class="mpp-label">
                  <Rich text={field.label} />
                </span>
                <input
                  class={`input${field.mono ? ' is-mono' : ''}`}
                  type="text"
                  inputMode={field.inputMode ?? 'text'}
                  autoComplete="off"
                  spellcheck={false}
                  placeholder={field.placeholder}
                  aria-invalid={wrongHere.has(field.key) ? 'true' : undefined}
                  value={entry[field.key] ?? ''}
                  onInput={(event) => edit(field.key, event.currentTarget.value)}
                />
              </label>
            ),
          )}
        </div>
        <div class="mpp-foot">
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
          <button type="button" class="btn is-quiet" onClick={reset}>
            清空
          </button>
        </div>
      </form>
      {misses && misses.length === 0 ? (
        <p class="mpp-verdict" role="status">
          <span class="is-ok-text">{revealed ? '答案已填上。' : '对。'}</span>
          <Rich text={props.done} />
          <button type="button" class="btn" onClick={props.onNext}>
            换一题
          </button>
        </p>
      ) : first ? (
        <p class="mpp-verdict" role="status">
          <span class="is-bad-text">不对。</span>
          <span>
            第 {first.row + 1} 行起有错：<Rich text={first.message} />
            {misses!.length > 1 ? `（一共 ${misses!.length} 格不对）` : ''}
          </span>
          {props.onDemo ? (
            <button type="button" class="btn" onClick={() => props.onDemo!(first.row)}>
              看这一行的演示
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
