/**
 * 4-ea、4-opcode、5-flow、5-hardwired 四页共用的外壳：标签页、选项、表单栏、台面上的答题纸、题号和草稿。
 * 标签页在网址参数 t，各自记住自己的步数；题号在 q；草稿存在本机（读写都包在 try 里）。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, CSSProperties, JSX } from 'preact';
import { useParam } from '../../app/url-state';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Pose, Rect, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import '../../player/player.css';
import './shell.css';

export type TabKey = '' | 'try' | 'quiz';
const TABS: { key: TabKey; label: string }[] = [
  { key: '', label: '讲解' },
  { key: 'try', label: '试一试' },
  { key: 'quiz', label: '练习' },
];

/** 一页的三个标签页。panels 按标签页给出内容。 */
export function PageShell({ id, panels }: { id: string; panels: Record<TabKey, () => JSX.Element> }) {
  const [tab, setTab] = useParam('t', '', (raw) => (TABS.some((item) => item.key === raw) ? raw : ''));
  const [step, setStep] = useParam('s', '0');
  const [memo] = useState(() => new Map<string, string>());
  const current = tab as TabKey;
  const Panel = panels[current];
  return (
    <div class="ix">
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
      <div id={`${id}-panel`} class="ix-panel" role="tabpanel" aria-labelledby={`${id}-tab-${current || 'learn'}`}>
        <Panel />
      </div>
    </div>
  );
}

/** 一组互斥的选项。宽屏一排；放不下五项以上时窄屏换成下拉框。 */
export function Seg<T extends string>({ label, items, value, onChoose, mono }: { label: string; items: readonly { key: T; label: string }[]; value: T; onChoose: (key: T) => void; mono?: boolean }) {
  return (
    <div class="ix-seg-wrap">
      <span class="ix-seg-label">{label}</span>
      <div class={`seg${mono ? ' is-mono' : ''}${items.length > 4 ? ' ix-seg-many' : ''}`} role="group" aria-label={label}>
        {items.map((item) => (
          <button key={item.key} type="button" aria-pressed={item.key === value} onClick={() => item.key !== value && onChoose(item.key)}>
            {item.label}
          </button>
        ))}
      </div>
      {items.length > 4 ? (
        <select class="select ix-seg-select" aria-label={label} value={value} onChange={(event) => onChoose(event.currentTarget.value as T)}>
          {items.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/** 标签在上的一个表单项。 */
export function Field({ label, children, help, error, grow }: { label: string; children: ComponentChildren; help?: string; error?: string; grow?: boolean }) {
  return (
    <label class={`field ix-field${grow ? ' is-grow' : ''}`}>
      <span class="field-label">{label}</span>
      {children}
      {help ? <span class="field-help">{help}</span> : null}
      {error ? (
        <span class="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/**
 * 台面上的答题纸。scene 里要有 'paper'；宽屏时再有一块不显示的 'desk'（垫板），填写栏压在垫板的位置上；
 * 窄屏或平面模式时排在舞台下面。纸面题不带动画，画面只取决于学生填的内容。
 */
export function PaperStage({ scene, pose, frame, panel, wide }: { scene: SceneSpec; pose: Pose; frame: string[]; panel: (style: CSSProperties | undefined, ref: (el: HTMLFormElement | null) => void) => JSX.Element; wide: boolean }) {
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

  // 要看的部件变了（手机上换一条指令的表）：重新定镜头。
  const frameKey = frame.join('|');
  const lastFrame = useRef(frameKey);
  useEffect(() => {
    if (!view.current || lastFrame.current === frameKey) return;
    lastFrame.current = frameKey;
    view.current.plan([frame]);
    view.current.show(0, poseRef.current, { animate: false, forward: false, moves: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

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
  if (!flat && wide && desk && size.width >= 560) {
    const width = Math.min(size.width - 16, 680);
    const left = Math.round(Math.max(8, Math.min(size.width - width - 8, desk.x + desk.w / 2 - width / 2)));
    const top = Math.round(Math.max(8, Math.min(size.height - panelHeight - 8, desk.y)));
    style = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  }
  const filled = panel(style, setPanelEl);
  return (
    <>
      <div class={`pl-stage ix-paper${wide ? ' is-wide' : ''}`} data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
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

/** 已填的内容按题号存在本机，刷新后还在。key 变了重新读。 */
export function useDraft<T>(key: string, blank: () => T, ok: (value: unknown) => value is T): [T, (next: T) => void] {
  const read = (): T => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (ok(saved)) return saved;
    } catch {
      // 读不到就从空白开始。
    }
    return blank();
  };
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  useEffect(() => {
    if (state.key !== key) setState({ key, value });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = (next: T) => {
    setState({ key, value: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 存不下时只是刷新后要重填。
    }
  };
  return [value, set];
}

/** 种子随机数（练习出题用）。同一个种子同一串数。 */
export function seeded(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
