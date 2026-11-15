/**
 * 流水线三页（5-spacetime、5-hazard、5-stall）共用的外壳和答题纸舞台。
 * 外壳：讲解、试一试、练习、弄坏它四个标签页，标签页在网址参数 t，各自记住自己的步数。
 * 答题纸舞台：台面上一张答题纸，学生点格子、填写栏里填；没有动画，画面只取决于学生填的内容和判分结果。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, CSSProperties, JSX } from 'preact';
import { useParam } from '../../app/url-state';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Pose, Rect, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import { Rich } from '../../player/Rich';
import '../../player/player.css';
import './pipe.css';

export type TabKey = '' | 'try' | 'quiz' | 'break';
const TABS: { key: TabKey; label: string }[] = [
  { key: '', label: '讲解' },
  { key: 'try', label: '试一试' },
  { key: 'quiz', label: '练习' },
  { key: 'break', label: '弄坏它' },
];

/** 一页的四个标签页。 */
export function PageShell({ id, panels }: { id: string; panels: Record<TabKey, () => JSX.Element> }) {
  const [tab, setTab] = useParam('t', '', (raw) => (TABS.some((item) => item.key === raw) ? raw : ''));
  const [step, setStep] = useParam('s', '0');
  const [memo] = useState(() => new Map<string, string>());
  const current = tab as TabKey;
  const Panel = panels[current];
  return (
    <div class="pp">
      <div class="tabs" role="tablist" aria-label="这一页的部分">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`${id}-tab-${item.key || 'learn'}`}
            aria-selected={item.key === current}
            aria-controls={`${id}-panel`}
            onClick={() => {
              if (item.key === current) return;
              memo.set(current, step);
              setTab(item.key);
              setStep(memo.get(item.key) ?? '0');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} class="pp-panel" role="tabpanel" aria-labelledby={`${id}-tab-${current || 'learn'}`}>
        <Panel />
      </div>
    </div>
  );
}

/** 一组互斥的选项。选中的实心墨色。 */
export function Seg<T extends string>({ label, items, value, onChoose, mono }: { label: string; items: readonly { key: T; label: string }[]; value: T; onChoose: (key: T) => void; mono?: boolean }) {
  return (
    <div class={`seg${mono ? ' is-mono' : ''}`} role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.key} type="button" aria-pressed={item.key === value} onClick={() => item.key !== value && onChoose(item.key)}>
          <Rich text={item.label} />
        </button>
      ))}
    </div>
  );
}

/** 看得见的标签加控件，竖排：标签在上。 */
export function Field({ label, children, help, error }: { label: string; children: ComponentChildren; help?: string; error?: string }) {
  return (
    <div class="field pp-field">
      <span class="field-label">
        <Rich text={label} />
      </span>
      {children}
      {help ? <span class="field-help">{help}</span> : null}
      {error ? (
        <span class="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** 题目的已知条件，和播放器的条件区同一版式。 */
export function Given({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl class="pl-given">
      {items.map((item) => (
        <div key={item.label}>
          <dt>
            <Rich text={item.label} />
          </dt>
          <dd>
            <Rich text={item.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 台面上的答题纸。scene 里的部件按 pose 摆；frame 是镜头要看的部件；onPick 收到学生点的部件和格子（bit = 行 × 1000 + 列）。
 * 填写栏 panel 排在舞台下面。
 */
export function PaperStage({ scene, pose, frame, panel, onPick, tall }: { scene: SceneSpec; pose: Pose; frame: string[]; panel: JSX.Element; onPick?: (id: string, bit?: number) => void; tall?: boolean }) {
  const [flatParam] = useParam('flat', '');
  const [mode, setMode] = useState<'loading' | 'scene' | 'flat'>(() => (flatParam === '1' || !canUseWebGL() ? 'flat' : 'loading'));
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const [, setRects] = useState<Record<string, Rect>>({});
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const frameKey = frame.join(',');

  useEffect(() => {
    if (mode === 'flat') return;
    let alive = true;
    let made: SceneView | null = null;
    void Promise.all([loadRuntime(), scene.kinds?.()])
      .then(([{ SceneView: View }]) => {
        if (!alive || !stage.current || !canvasHost.current) return;
        made = new View(stage.current, canvasHost.current, scene, poseRef.current);
        made.onRects = setRects;
        made.stage.onPick = (id, bit) => id && pickRef.current?.(id, bit);
        made.plan([frame], [], [poseRef.current]);
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
    const current = view.current;
    if (!current) return;
    current.plan([frame], [], [pose]);
    current.show(0, pose, { animate: false, forward: false, moves: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pose, frameKey]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => view.current?.setScheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const flat = mode === 'flat';
  return (
    <>
      <div class={`pl-stage pp-paper${tall ? ' is-tall' : ''}`} data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
        {flat ? <FlatStage scene={scene} pose={pose} onPick={(id) => id && onPick?.(id)} picking={false} wrong={undefined} /> : <div class="pl-canvas" ref={canvasHost} />}
      </div>
      {panel}
    </>
  );
}

/** 练习的题号：网址参数 q，1–99999。 */
export function useSeed(): [number, () => void] {
  const [seedText, setSeed] = useParam('q', '1');
  const seed = Math.max(1, Math.min(99999, Math.trunc(Number(seedText)) || 1));
  return [seed, () => setSeed(String(seed + 1))];
}

/** 已填的内容按题号存在本机，刷新后还在。读写都包在 try 里。 */
export function useDraft<T>(key: string, blank: () => T, ok: (value: unknown) => value is T): [T, (next: T) => void] {
  const [value, setRaw] = useState<T>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (ok(saved)) return saved;
    } catch {
      // 读不到就从空白开始。
    }
    return blank();
  });
  const set = (next: T) => {
    setRaw(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 存不下时只是刷新后要重填。
    }
  };
  return [value, set];
}

/** 判分结果的一行：「对」「不对」加说明，旁边可以放按钮。 */
export function Verdict({ ok, children }: { ok: boolean; children: ComponentChildren }) {
  return (
    <p class="pp-verdict" role="status">
      <span class={ok ? 'is-ok-text' : 'is-bad-text'}>{ok ? '对' : '不对'}</span>
      {children}
    </p>
  );
}

/** 单独成行的公式：居左，不加底色。text 用 Rich 的写法（T_k、C_k）。 */
export function Formula({ text }: { text: string }) {
  return (
    <p class="pp-formula">
      <Rich text={text} />
    </p>
  );
}

export type { CSSProperties };
