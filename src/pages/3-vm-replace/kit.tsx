/**
 * 3-cache-addr、3-cache-perf、3-vm-addr、3-vm-replace 四页共用的外壳和答题纸舞台。
 * 外壳：讲解、试一试、练习、弄坏它四个标签页，标签页在网址参数 t，各自记住自己的步数。
 * 答题纸舞台：台面上一张答题纸（部件 id 'paper'），填写栏压在它下方的垫板（'desk'）上；没有动画，画面只取决于学生填的内容。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, CSSProperties, JSX } from 'preact';
import { useParam } from '../../app/url-state';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Pose, Rect, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import { Rich } from '../../player/Rich';
import '../../player/player.css';
import './kit.css';

export type TabKey = '' | 'try' | 'quiz' | 'break';
const TABS: { key: TabKey; label: string }[] = [
  { key: '', label: '讲解' },
  { key: 'try', label: '试一试' },
  { key: 'quiz', label: '练习' },
  { key: 'break', label: '弄坏它' },
];

/** 一页的四个标签页。panels 按标签页给出内容。 */
export function PageShell({ id, panels }: { id: string; panels: Record<TabKey, () => JSX.Element> }) {
  const [tab, setTab] = useParam('t', '', (raw) => (TABS.some((item) => item.key === raw) ? raw : ''));
  const [step, setStep] = useParam('s', '0');
  // 每个标签页记住自己的步数：讲解 → 练习 → 讲解，回到原来那一步。
  const [memo] = useState(() => new Map<string, string>());
  const current = tab as TabKey;
  const Panel = panels[current];
  return (
    <div class="t4">
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
      <div id={`${id}-panel`} class="t4-panel" role="tabpanel" aria-labelledby={`${id}-tab-${current || 'learn'}`}>
        <Panel />
      </div>
    </div>
  );
}

/** 一组互斥的选项（例题、映射方式、算法）。选中的实心墨色。 */
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

/** 看得见的标签加一组选项，竖排：标签在上。 */
export function Field({ label, children, help, error }: { label: string; children: ComponentChildren; help?: string; error?: string }) {
  return (
    <div class="field t4-field">
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

/**
 * 台面上的答题纸。scene 里要有 'paper'（答题纸），宽屏时再有一块不显示的 'desk'（垫板），
 * 填写栏 panel 压在垫板的位置上；窄屏或平面模式时排在舞台下面。
 */
export function PaperStage({ scene, pose, frame, panel, wide, compact }: { scene: SceneSpec; pose: Pose; frame: string[]; panel: (style: CSSProperties | undefined, ref: (el: HTMLFormElement | null) => void) => JSX.Element; wide: boolean; compact?: boolean }) {
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
    void Promise.all([loadRuntime(), scene.kinds?.()])
      .then(([{ SceneView: View }]) => {
        if (!alive || !stage.current || !canvasHost.current) return;
        made = new View(stage.current, canvasHost.current, scene, poseRef.current);
        made.onRects = (next) => {
          setRects(next);
          if (made) setSize(made.size);
        };
        made.plan([frame]);
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

  const [panelEl, setPanelEl] = useState<HTMLFormElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(170);
  useEffect(() => {
    if (!panelEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setPanelHeight(panelEl.offsetHeight));
    observer.observe(panelEl);
    return () => observer.disconnect();
  }, [panelEl]);

  const flat = mode === 'flat';
  const desk = rects['desk'];
  let style: CSSProperties | undefined;
  const paper = rects['paper'];
  const below = useRef(false);
  if (!flat && wide && desk && size.width >= 560) {
    const width = Math.min(size.width - 16, 680);
    const left = Math.round(Math.max(8, Math.min(size.width - width - 8, desk.x + desk.w / 2 - width / 2)));
    const top = Math.round(Math.max(8, Math.min(size.height - panelHeight - 8, desk.y)));
    // 垫板放不下填写栏、会压住答题纸时，填写栏排到舞台下面。
    // 一旦放到下面就不再挪回去（填写栏宽度变了高度也变，来回切会抖）。
    if (paper && top < paper.y + paper.h - 4) below.current = true;
    if (!below.current) style = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  }
  const filled = panel(style, setPanelEl);
  return (
    <>
      <div class={`pl-stage t4-paper${wide ? ' is-wide' : ''}${compact ? ' is-compact' : ''}`} data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
        {flat ? <FlatStage scene={scene} pose={pose} onPick={() => {}} picking={false} wrong={undefined} /> : <div class="pl-canvas" ref={canvasHost} />}
        {style && filled}
      </div>
      {!style && filled}
    </>
  );
}

/** 宽屏（≥ 600 px）时答题纸下面留垫板放填写栏。只在建场景时取一次。 */
export function useWidePaper(): boolean {
  const [wide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 600px)').matches);
  return wide;
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
