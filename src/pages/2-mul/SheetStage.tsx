/**
 * 练习的台面：一张答题纸摆在三维台面上，不带动画。画面只取决于学生填了什么、当前行和判分结果。
 * 宽屏上填写栏压在答题纸下方的垫板（看不见的 desk 部件）上；窄屏上排在舞台下面。
 * 学生可以直接点台面上的格子（翻位、选行），也可以在填写栏里打字，两边等价。
 * 2-mul 和 2-div 的练习共用。
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, CSSProperties } from 'preact';
import { useParam } from '../../app/url-state';
import { canUseWebGL, currentScheme, hashPose, loadRuntime } from '../../scene';
import type { Pose, Rect, SceneSpec, SceneView } from '../../scene';
import { FlatStage } from '../../player/FlatStage';
import '../../player/player.css';
import './sheet.css';

export function SheetStage({
  scene,
  pose,
  frame,
  wide,
  onPick,
  panel,
}: {
  scene: SceneSpec;
  pose: Pose;
  /** 镜头装进画面的部件；宽屏时会加上 desk。 */
  frame: string[];
  wide: boolean;
  onPick: (id: string, bit?: number) => void;
  panel: (anchored: CSSProperties | undefined, ref: (el: HTMLElement | null) => void) => ComponentChildren;
}) {
  const [flatParam] = useParam('flat', '');
  const [mode, setMode] = useState<'loading' | 'scene' | 'flat'>(() => (flatParam === '1' || !canUseWebGL() ? 'flat' : 'loading'));
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

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
        made.stage.onPick = (id, bit) => id && pickRef.current(id, bit);
        made.plan([wide ? [...frame, 'desk'] : frame]);
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

  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
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
    // 垫板在答题纸右边：填写栏和垫板一样宽，竖直方向居中，不盖住答题纸。
    const width = Math.round(Math.max(300, Math.min(440, desk.w, size.width - 16)));
    const left = Math.round(Math.max(8, Math.min(size.width - width - 8, desk.x + desk.w / 2 - width / 2)));
    const top = Math.round(Math.max(8, Math.min(size.height - panelHeight - 8, desk.y + desk.h / 2 - panelHeight / 2)));
    style = { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  }

  return (
    <>
      <div class={`pl-stage md-sheet${wide ? ' is-wide' : ''}`} data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
        {flat ? <FlatStage scene={scene} pose={pose} onPick={(id) => id && onPick(id)} picking={false} wrong={undefined} /> : <div class="pl-canvas" ref={canvasHost} />}
        {style && panel(style, setPanelEl)}
      </div>
      {!style && panel(undefined, setPanelEl)}
    </>
  );
}
