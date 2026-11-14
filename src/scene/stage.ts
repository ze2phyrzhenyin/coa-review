/**
 * 舞台：渲染器、灯光、台面、镜头。按需渲染：没有动画、没有操作时不重绘。
 * 镜头只在焦点移出画面时平滑移动，不旋转世界；学生可以小幅转动和缩放，双击复位。
 */
import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { makeMats, rethemeMats } from './kit';
import type { Kit } from './kit';
import { Motion, easeInOut } from './motion';
import { currentScheme, palettes, prefersReducedMotion, sizes, timing } from './theme';
import type { Scheme } from './theme';

export interface CamPose {
  target: Vector3;
  dist: number;
  /** 方位角：绕竖直轴，0 是正对。 */
  az: number;
  /** 俯角：镜头视线与台面的夹角。 */
  el: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Boxed {
  bounds(): Box3;
  focusBox(props?: Record<string, unknown>): Box3 | null;
}

const FOV = 20;
/** 场景里字的最小字高（世界单位）。部件不要用更小的字。 */
export const MIN_TEXT = 0.31;
const TAN = Math.tan((FOV * Math.PI) / 360);
export const HOME_EL = (52 * Math.PI) / 180;
const LIMIT = { az: 0.42, elUp: 0.2, elDown: 0.16, zoomIn: 2.4, zoomOut: 0.6 };
/** 贴图比屏幕密一些，镜头移动时字也不糊。 */
const OVERSAMPLE = 1.5;

/** 没有可用的 WebGL（或只有软件渲染）时抛出，播放器改用平面模式。 */
export class NoWebGL extends Error {}

export class Stage {
  readonly scene = new Scene();
  readonly root = new Group();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.5, 300);
  readonly motion = new Motion();
  readonly kit: Kit;
  readonly canvas = document.createElement('canvas');
  width = 1;
  height = 1;

  /** 点到了哪个部件（没点到部件时为 null）。 */
  /** bit 是点到的位片序号（点在 bits 部件的某一位上时）。 */
  onPick: (id: string | null, bit?: number) => void = () => {};
  /** 学生转动或缩放停下来之后、以及尺寸变了之后：页面上跟着部件走的控件要重新摆。 */
  onView: () => void = () => {};
  onResize: () => void = () => {};

  private readonly renderer: WebGLRenderer;
  private readonly sun = new DirectionalLight(0xffffff, 1.55);
  private readonly sky = new HemisphereLight(0xffffff, 0xd8d2c4, 1.95);
  private readonly ground: Mesh<PlaneGeometry, ShadowMaterial>;
  private readonly parts = new Map<string, Boxed>();
  private readonly pickable = new Set<string>();
  private readonly scratch = new PerspectiveCamera(FOV, 1, 0.5, 300);
  private readonly raycaster = new Raycaster();
  private readonly observer: ResizeObserver;
  private readonly cleanups: (() => void)[] = [];
  private base: CamPose = { target: new Vector3(), dist: 20, az: 0, el: HOME_EL };
  /** 镜头要去的位置。动画中 base 还在路上。 */
  private goalPose: CamPose = this.base;
  private readonly user = { az: 0, el: 0, zoom: 1, pan: new Vector3() };
  private request = 0;
  private idle: (() => void)[] = [];
  private viewTimer = 0;
  private disposed = false;

  /** host 收指针事件、定尺寸；画布挂在 mount 里（不写就是 host）。 */
  constructor(
    private readonly host: HTMLElement,
    mount: HTMLElement = host,
  ) {
    const context = this.canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true });
    if (!context) throw new NoWebGL('webgl2');
    this.renderer = new WebGLRenderer({ canvas: this.canvas, context, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    const palette = palettes[currentScheme()];
    this.kit = {
      palette,
      mats: makeMats(palette),
      motion: this.motion,
      camera: this.camera,
      reduced: prefersReducedMotion(),
      textScale: 64 * this.dpr * OVERSAMPLE,
      texts: new Set(),
      facing: new Set(),
      invalidate: () => this.invalidate(),
    };
    this.motion.onWake = () => this.invalidate();

    const small = Math.min(host.clientWidth, host.clientHeight) < 420;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    this.sun.shadow.radius = 5;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.ground = new Mesh(new PlaneGeometry(400, 400), new ShadowMaterial({ opacity: palette.shadow }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.sky, this.sun, this.sun.target, this.ground, this.root);
    this.applyPalette();

    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;outline:none';
    this.canvas.setAttribute('aria-hidden', 'true');
    mount.append(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize(true);
    this.listen();
  }

  private get dpr(): number {
    return Math.min(devicePixelRatio || 1, 2);
  }

  // ---------- 渲染 ----------

  /** 要求重绘一帧。空闲时不会有任何绘制。 */
  invalidate(): void {
    if (this.request || this.disposed) return;
    this.request = requestAnimationFrame((now) => {
      this.request = 0;
      this.frameNow(now);
    });
  }

  private frameNow(now: number): void {
    if (this.disposed) return;
    const active = this.motion.tick(now);
    this.draw();
    if (active) this.invalidate();
    else this.flushIdle();
  }

  private draw(): void {
    this.applyCamera(this.camera, this.effective(this.base));
    for (const object of this.kit.facing) object.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
  }

  /** 所有动画做完并且画完最后一帧之后调用一次。 */
  whenIdle(callback: () => void): void {
    this.idle.push(callback);
    this.invalidate();
  }

  private flushIdle(): void {
    const callbacks = this.idle;
    this.idle = [];
    for (const callback of callbacks) callback();
  }

  /** 立刻做完所有动画并画出最终画面。 */
  finish(): void {
    this.motion.finishAll();
    if (this.request) cancelAnimationFrame(this.request);
    this.request = 0;
    this.draw();
    this.flushIdle();
  }

  // ---------- 主题 ----------

  setScheme(scheme: Scheme): void {
    this.kit.palette = palettes[scheme];
    rethemeMats(this.kit.mats, this.kit.palette);
    this.applyPalette();
    for (const text of this.kit.texts) text.redraw();
    this.invalidate();
  }

  private applyPalette(): void {
    const { palette } = this.kit;
    this.renderer.setClearColor(palette.paper, 1);
    this.ground.material.opacity = palette.shadow;
    this.sky.groundColor.set(palette.paper);
  }

  // ---------- 部件登记 ----------

  register(id: string, part: Boxed, pickable: boolean): void {
    this.parts.set(id, part);
    if (pickable) this.pickable.add(id);
  }

  /** 部件都放好之后调用：按全场范围摆灯和阴影。 */
  layout(): void {
    const all = this.sceneBox();
    const center = all.getCenter(new Vector3());
    const radius = Math.max(4, all.getSize(new Vector3()).length() / 2 + 1.5);
    this.sun.target.position.copy(center);
    // 光从左前上方来，影子落向右后。
    this.sun.position.copy(center).add(new Vector3(-0.36, 0.82, 0.45).multiplyScalar(60));
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = 1;
    shadowCamera.far = 140;
    shadowCamera.updateProjectionMatrix();
    this.invalidate();
  }

  sceneBox(): Box3 {
    const box = new Box3();
    for (const part of this.parts.values()) box.union(part.bounds());
    if (box.isEmpty()) box.set(new Vector3(-1, 0, -1), new Vector3(1, 1, 1));
    return box;
  }

  boxesOf(ids: string[], focus = true, props?: Record<string, Record<string, unknown>>): Box3[] {
    const boxes: Box3[] = [];
    for (const id of ids) {
      const part = this.parts.get(id);
      const box = part ? (focus ? part.focusBox(props?.[id]) : part.bounds()) : null;
      if (box) boxes.push(box);
    }
    return boxes;
  }

  // ---------- 镜头 ----------

  /** 每个世界单位在屏幕上至少多少像素。再小字就读不清了，所以手机上镜头跟着焦点走，不把整张图缩小。 */
  get minScale(): number {
    return this.width < 520 ? 50 : 44;
  }

  /** 值牌上的字（sizes.value）不小于 14 像素时的比例。镜头缩小的下限。 */
  get legibleScale(): number {
    // 场景里最小的字是 0.31（名牌、说明）：这个比例下它是 12 像素，值牌上的字约 14 像素。
    // 手机上再留 17%：台面后排离镜头远，透视下字会小一些。
    return (12 / MIN_TEXT) * (this.width < 600 ? 1.17 : 1);
  }

  /** 宽屏上为了整张台面入画，可以比下限再小一点（字约 10–12 像素）；手机上不行。 */
  get wholeSlack(): number {
    return this.width >= 600 ? 0.9 : 1;
  }

  /** 全景最多放大到这个程度。 */
  get maxScale(): number {
    return this.width < 520 ? 60 : 76;
  }

  scaleOf(pose: CamPose): number {
    return this.height / (2 * pose.dist * TAN);
  }

  private distFor(scale: number): number {
    return this.height / (2 * scale * TAN);
  }

  private effective(pose: CamPose): CamPose {
    const { user } = this;
    return { target: pose.target.clone().add(user.pan), dist: pose.dist / user.zoom, az: pose.az + user.az, el: pose.el + user.el };
  }

  private applyCamera(camera: PerspectiveCamera, pose: CamPose): void {
    const horizontal = Math.cos(pose.el) * pose.dist;
    camera.position.set(pose.target.x + Math.sin(pose.az) * horizontal, pose.target.y + Math.sin(pose.el) * pose.dist, pose.target.z + Math.cos(pose.az) * horizontal);
    camera.lookAt(pose.target);
    camera.updateMatrixWorld();
  }

  /**
   * 把这些范围装进画面的镜头位置。floorFactor 是允许的最小比例相对 minScale 的倍数（装不下时字最多缩到这个程度）。
   */
  fit(boxes: Box3[], floorFactor: number | boolean = 1, top = 0, follow = false): CamPose {
    const az = 0;
    const el = HOME_EL;
    const forward = new Vector3(-Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el));
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward);
    const points: [number, number, number][] = [];
    for (const box of boxes) {
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            const p = new Vector3(x, y, z);
            points.push([p.dot(right), p.dot(up), p.dot(forward)]);
          }
        }
      }
    }
    if (points.length === 0) return this.goalPose;
    const margin = this.width < 520 ? 0.9 : 0.93;
    const tx = TAN * (this.width / this.height) * margin;
    // top：画面上方被题目栏占掉的像素。上半边能用的视角相应变小。
    const tyDown = TAN * margin;
    const tyUp = TAN * Math.max(0.2, margin - (2 * top) / this.height);
    let cz = Infinity;
    for (const a of points) {
      for (const b of points) {
        cz = Math.min(cz, (a[2] + b[2]) / 2 - Math.abs(a[0] - b[0]) / (2 * tx), (a[2] * tyUp + b[2] * tyDown - (a[1] - b[1])) / (tyUp + tyDown));
      }
    }
    let lowX = -Infinity;
    let highX = Infinity;
    let lowY = -Infinity;
    let highY = Infinity;
    let near = Infinity;
    let far = -Infinity;
    for (const [x, y, z] of points) {
      lowX = Math.max(lowX, x - (z - cz) * tx);
      highX = Math.min(highX, x + (z - cz) * tx);
      lowY = Math.max(lowY, y - (z - cz) * tyUp);
      highY = Math.min(highY, y + (z - cz) * tyDown);
      near = Math.min(near, z);
      far = Math.max(far, z);
    }
    const eye = right
      .clone()
      .multiplyScalar((lowX + highX) / 2)
      .add(up.clone().multiplyScalar((lowY + highY) / 2))
      .add(forward.clone().multiplyScalar(cz));
    let dist = (near + far) / 2 - cz;
    const target = eye.add(forward.clone().multiplyScalar(dist));
    const scale = this.height / (2 * dist * TAN);
    let floor = this.minScale * (floorFactor === true ? 1 : floorFactor === false ? 0.62 : floorFactor);
    // 跟随焦点时只平移、几乎不放大：周围的部件尽量留在画面里。
    // 整张台面横向装得下（字不小于 14 像素）时，不放大到左右被裁掉。
    let cap = follow ? this.minScale * 1.06 : this.maxScale;
    if (follow) {
      const all = this.sceneBox();
      const across = (this.width * 0.94) / Math.max(1, all.max.x - all.min.x);
      // 差一点（值牌的字约 13.5 像素）也算装得下：左右不裁比字大一点要紧。
      if (across >= this.legibleScale * this.wholeSlack) cap = Math.min(cap, across);
    }
    floor = Math.min(floor, cap);
    if (scale > cap) dist = this.distFor(cap);
    else if (scale < floor) dist = this.distFor(floor);
    return { target, dist, az, el };
  }

  /**
   * 跟随焦点时不让画面滑到台面以外：全场比画面大的方向，边上不留空白；比画面小的方向，居中。
   * 这样焦点在角落里时，画面仍然是排满的。
   */
  keepInScene(pose: CamPose, top = 0): CamPose {
    let out = pose;
    const all = this.sceneBox();
    const pad = 14;
    for (let pass = 0; pass < 2; pass++) {
      const rect = this.project(all, out);
      const shift = (low: number, high: number, from: number, to: number) => {
        const room = to - from;
        if (high - low <= room) return (from + to) / 2 - (low + high) / 2;
        if (low > from) return from - low;
        if (high < to) return to - high;
        return 0;
      };
      const dx = shift(rect.x, rect.x + rect.w, pad, this.width - pad);
      const dy = shift(rect.y, rect.y + rect.h, pad + top, this.height - pad);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;
      // 画面内容要右移 dx、下移 dy，镜头就反过来移。
      const unit = 1 / this.scaleOf(out);
      const target = out.target.clone();
      target.x -= dx * unit * Math.cos(out.az) + (dy * unit * Math.sin(out.az)) / Math.sin(out.el);
      target.z -= -dx * unit * Math.sin(out.az) + (dy * unit * Math.cos(out.az)) / Math.sin(out.el);
      out = { ...out, target };
    }
    return out;
  }

  /**
   * 画面上看得见的字里，最小的字号（CSS 像素）。字号按字高在那个位置投到屏幕上的长度算；
   * 不在画面里、隐藏、透明、没有字的不算；下标、上标按 0.68 倍另算在内的不计。
   */
  minTextPx(): { px: number; text: string } {
    this.draw();
    const camera = this.camera;
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const a = new Vector3();
    const b = new Vector3();
    let min = Infinity;
    let which = '';
    for (const text of this.kit.texts) {
      if (!text.text || text.opacity < 0.5) continue;
      let shown = true;
      for (let node: Object3D | null = text.mesh; node; node = node.parent) if (!node.visible) shown = false;
      if (!shown) continue;
      text.mesh.getWorldPosition(a);
      b.copy(a).addScaledVector(up, text.size);
      a.project(camera);
      b.project(camera);
      if (Math.abs(a.x) > 1 || Math.abs(a.y) > 1 || a.z > 1) continue;
      const px = Math.hypot(((b.x - a.x) / 2) * this.width, ((b.y - a.y) / 2) * this.height);
      if (px < min) {
        min = px;
        which = text.text;
      }
    }
    return { px: Number.isFinite(min) ? Math.round(min * 10) / 10 : 0, text: which };
  }

  /**
   * 画面上互相压住的字：两段字的框（去掉留白）有交叠。返回前几对的文字。只看看得见的字，
   * 同一张牌上的字不会叠，所以有交叠就是排版问题。
   */
  textOverlaps(): string[] {
    this.draw();
    const camera = this.camera;
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const boxes: { text: string; x0: number; x1: number; y0: number; y1: number }[] = [];
    const p = new Vector3();
    const toScreen = (v: Vector3) => {
      p.copy(v).project(camera);
      return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height, z: p.z };
    };
    for (const text of this.kit.texts) {
      if (!text.text || text.opacity < 0.5) continue;
      let shown = true;
      for (let node: Object3D | null = text.mesh; node; node = node.parent) if (!node.visible) shown = false;
      if (!shown) continue;
      const center = text.mesh.getWorldPosition(new Vector3());
      // 去掉贴图四周的留白：字宽按量出的宽，字高按字号。
      const halfW = Math.max(0, text.width / 2 - text.size * 0.12);
      const halfH = text.size * 0.5;
      const a = toScreen(center.clone().addScaledVector(right, -halfW).addScaledVector(up, halfH));
      const b = toScreen(center.clone().addScaledVector(right, halfW).addScaledVector(up, -halfH));
      if (a.z > 1 || b.x < 0 || a.x > this.width || b.y < 0 || a.y > this.height) continue;
      boxes.push({ text: text.text, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
    }
    const found: string[] = [];
    for (let i = 0; i < boxes.length && found.length < 3; i++) {
      for (let j = i + 1; j < boxes.length && found.length < 3; j++) {
        const m = boxes[i]!;
        const n = boxes[j]!;
        const dx = Math.min(m.x1, n.x1) - Math.max(m.x0, n.x0);
        const dy = Math.min(m.y1, n.y1) - Math.max(m.y0, n.y0);
        // 左右之间至少留 3 像素：挨着也算压住。
        if (dx > -3 && dy > 1) found.push(`${m.text}／${n.text}`);
      }
    }
    return found;
  }

  /** 在这个镜头位置下，这些范围是否都在画面里。 */
  sees(pose: CamPose, boxes: Box3[], margin = 0.03, top = 0): boolean {
    this.scratch.aspect = this.width / this.height;
    this.scratch.updateProjectionMatrix();
    this.applyCamera(this.scratch, pose);
    const p = new Vector3();
    for (const box of boxes) {
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            p.set(x, y, z).project(this.scratch);
            if (Math.abs(p.x) > 1 - margin || p.y < -1 + margin || p.y > 1 - margin - (2 * top) / this.height) return false;
          }
        }
      }
    }
    return true;
  }

  get goal(): CamPose {
    return this.goalPose;
  }

  /** 镜头移到指定位置。animate 为真时用先加速后减速，约 0.76 秒。 */
  moveTo(pose: CamPose, animate: boolean): void {
    const from = this.base;
    this.goalPose = pose;
    const same = from.target.distanceTo(pose.target) < 1e-3 && Math.abs(from.dist - pose.dist) < 1e-3 && from.az === pose.az && from.el === pose.el;
    if (!animate || this.kit.reduced || same) {
      this.base = pose;
      this.afterCamera();
      this.invalidate();
      return;
    }
    const start = { target: from.target.clone(), dist: from.dist, az: from.az, el: from.el };
    this.motion.add({
      duration: timing.camera,
      ease: easeInOut,
      update: (t) => {
        this.base = {
          target: start.target.clone().lerp(pose.target, t),
          dist: start.dist * (pose.dist / start.dist) ** t,
          az: start.az + (pose.az - start.az) * t,
          el: start.el + (pose.el - start.el) * t,
        };
      },
      done: () => {
        this.base = pose;
        this.afterCamera();
      },
    });
  }

  /** 焦点移出画面时才移动镜头。 */
  frame(ids: string[]): void {
    const boxes = this.boxesOf(ids);
    if (boxes.length === 0 || this.sees(this.effective(this.goalPose), boxes)) return;
    this.resetView(true);
    this.moveTo(this.keepInScene(this.fit(boxes, true, 0, true)), true);
  }

  /** 学生自己转过、放大过之后，新一步的焦点如果不在画面里，就把视角还原。 */
  ensureVisible(pose: CamPose, boxes: Box3[]): void {
    if (this.touched && boxes.length > 0 && !this.sees(this.effective(pose), boxes, 0)) this.resetView(true);
  }

  private get touched(): boolean {
    const { user } = this;
    return user.az !== 0 || user.el !== 0 || user.zoom !== 1 || user.pan.lengthSq() > 0;
  }

  /** 双击复位。 */
  resetView(animate: boolean): void {
    if (!this.touched) return;
    const { user } = this;
    const from = { az: user.az, el: user.el, zoom: user.zoom, pan: user.pan.clone() };
    const set = (t: number) => {
      user.az = from.az * (1 - t);
      user.el = from.el * (1 - t);
      user.zoom = from.zoom ** (1 - t);
      user.pan.copy(from.pan).multiplyScalar(1 - t);
    };
    if (animate && !this.kit.reduced) this.motion.add({ duration: 360, ease: easeInOut, update: set, done: () => (set(1), this.afterCamera(), this.onView()) });
    else {
      set(1);
      this.afterCamera();
      this.onView();
      this.invalidate();
    }
  }

  /** 镜头停下后按当前远近重画文字贴图。 */
  private afterCamera(): void {
    const wanted = this.scaleOf(this.effective(this.base)) * this.dpr * OVERSAMPLE;
    const ratio = wanted / this.kit.textScale;
    if (ratio > 1.12 || ratio < 0.8) {
      this.kit.textScale = wanted;
      for (const text of this.kit.texts) text.redraw();
    }
  }

  /** 一个范围在画面上的位置（相对舞台左上角的 CSS 像素）。pose 不写时用镜头的目标位置加学生的调整。 */
  project(box: Box3, pose: CamPose = this.effective(this.goalPose)): Rect {
    this.scratch.aspect = this.width / this.height;
    this.scratch.updateProjectionMatrix();
    this.applyCamera(this.scratch, pose);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const p = new Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          p.set(x, y, z).project(this.scratch);
          const sx = ((p.x + 1) / 2) * this.width;
          const sy = ((1 - p.y) / 2) * this.height;
          x0 = Math.min(x0, sx);
          x1 = Math.max(x1, sx);
          y0 = Math.min(y0, sy);
          y1 = Math.max(y1, sy);
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** 部件在画面上的位置，按 pose（一步的目标镜头）加学生的调整来算。 */
  rectOf(id: string, pose: CamPose): Rect | null {
    const part = this.parts.get(id);
    return part ? this.project(part.bounds(), this.effective(pose)) : null;
  }

  // ---------- 尺寸 ----------

  private resize(first = false): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    if (!first && width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!first) {
      this.onResize();
      // 尺寸变了要立刻有画面，不等下一帧，免得闪一下空白。
      this.draw();
    }
  }

  // ---------- 操作 ----------

  private listen(): void {
    const host = this.host;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; time: number; id: number } | null = null;
    let moved = false;
    let pinch = 0;
    let lastTap = { x: 0, y: 0, time: 0 };
    const { user } = this;

    const viewChanged = () => {
      this.invalidate();
      clearTimeout(this.viewTimer);
      this.viewTimer = window.setTimeout(() => {
        this.afterCamera();
        this.onView();
        this.invalidate();
      }, 140);
    };
    const clamp = () => {
      user.az = Math.max(-LIMIT.az, Math.min(LIMIT.az, user.az));
      user.el = Math.max(-LIMIT.elDown, Math.min(LIMIT.elUp, user.el));
      user.zoom = Math.max(LIMIT.zoomOut, Math.min(LIMIT.zoomIn, user.zoom));
      const reach = this.sceneBox().getSize(new Vector3()).length() / 2;
      if (user.pan.length() > reach) user.pan.setLength(reach);
      user.pan.y = 0;
    };
    /** 屏幕上的位移换成台面上的平移。 */
    const pan = (dx: number, dy: number) => {
      const unit = 1 / (this.scaleOf(this.base) * user.zoom);
      const az = this.base.az + user.az;
      const rightX = Math.cos(az);
      const rightZ = -Math.sin(az);
      const depth = unit / Math.sin(this.base.el + user.el);
      user.pan.x += -dx * unit * rightX - dy * depth * Math.sin(az);
      user.pan.z += -dx * unit * rightZ - dy * depth * Math.cos(az);
    };
    const isControl = (target: EventTarget | null) => target instanceof Element && !!target.closest('button, input, select, textarea, a, [data-no-orbit]');

    const onDown = (event: PointerEvent) => {
      moved = false;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (isControl(event.target) && !(event.target as Element).closest('[data-pick]')) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        down = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId };
        moved = false;
      } else {
        down = null;
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      }
    };
    const onMove = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      if (pointers.size === 1) {
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) moved = true;
        if (moved) {
          if (event.shiftKey) pan(dx, dy);
          else {
            user.az -= dx * 0.005;
            if (event.pointerType === 'mouse') user.el += dy * 0.004;
          }
          clamp();
          viewChanged();
        }
        last.x = event.clientX;
        last.y = event.clientY;
      } else if (pointers.size === 2) {
        last.x = event.clientX;
        last.y = event.clientY;
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0) user.zoom *= distance / pinch;
        pinch = distance;
        pan(dx / 2, dy / 2);
        moved = true;
        clamp();
        viewChanged();
      }
    };
    const onUp = (event: PointerEvent) => {
      const had = pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!had || !down || down.id !== event.pointerId) return;
      const tap = !moved && performance.now() - down.time < 600;
      down = null;
      if (!tap) return;
      const now = performance.now();
      if (now - lastTap.time < 340 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 32) {
        lastTap.time = 0;
        this.resetView(true);
        return;
      }
      lastTap = { x: event.clientX, y: event.clientY, time: now };
      // 点在页面按钮上的，由按钮自己处理。
      if (isControl(event.target)) return;
      const hit = this.pickAt(event.clientX, event.clientY);
      this.onPick(hit?.id ?? null, hit?.bit);
    };
    const onCancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      down = null;
      pinch = 0;
    };
    /** 拖动之后浏览器补发的 click 不算点选。 */
    const onClick = (event: MouseEvent) => {
      if (moved) {
        event.stopPropagation();
        event.preventDefault();
        moved = false;
      }
    };
    const onWheel = (event: WheelEvent) => {
      // 普通滚轮留给页面滚动；触控板捏合（带 ctrl）或按住 ctrl/⌘ 才缩放。
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      user.zoom *= Math.exp(-event.deltaY * 0.012);
      clamp();
      viewChanged();
    };
    const onVisibility = () => {
      if (document.hidden && this.motion.active) this.finish();
    };
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => (this.kit.reduced = media.matches);

    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onCancel);
    host.addEventListener('pointerleave', onCancel);
    host.addEventListener('click', onClick, true);
    host.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('visibilitychange', onVisibility);
    media.addEventListener('change', onMotion);
    this.cleanups.push(() => {
      host.removeEventListener('pointerdown', onDown);
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerup', onUp);
      host.removeEventListener('pointercancel', onCancel);
      host.removeEventListener('pointerleave', onCancel);
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('wheel', onWheel);
      document.removeEventListener('visibilitychange', onVisibility);
      media.removeEventListener('change', onMotion);
    });
  }

  /** 屏幕上这一点下面的可点选部件。 */
  pickAt(clientX: number, clientY: number): { id: string; bit?: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const point = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(point, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.root.children, true)) {
      let object: Object3D | null = hit.object;
      let bit: number | undefined;
      while (object && object !== this.root) {
        if (bit === undefined && typeof object.userData.bit === 'number') bit = object.userData.bit as number;
        const id = object.userData.partId as string | undefined;
        if (id && this.pickable.has(id)) return bit === undefined ? { id } : { id, bit };
        object = object.parent;
      }
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.request);
    clearTimeout(this.viewTimer);
    this.observer.disconnect();
    for (const cleanup of this.cleanups) cleanup();
    for (const material of Object.values(this.kit.mats)) material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
