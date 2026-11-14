/**
 * 部件共用的东西：材质、几何、正对屏幕的文字。只在三维运行时里用（引用 three.js）。
 */
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  ExtrudeGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Shape,
} from 'three';
import type { BufferGeometry, Object3D, PerspectiveCamera } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Motion } from './motion';
import { parseRich } from './rich';
import type { Run } from './rich';
import { fonts, mix } from './theme';
import type { Ink, Palette } from './theme';

export type MatName = 'block' | 'plinth' | 'tile' | 'chip' | 'line' | 'accent' | 'pad' | Ink | `${Ink}Idle`;
export type Mats = Record<MatName, MeshLambertMaterial> & { mark: MeshBasicMaterial; paper: MeshBasicMaterial };

const inks: Ink[] = ['data', 'addr', 'ctrl'];

function matColor(palette: Palette, name: MatName): string {
  if (name.endsWith('Idle')) return mix(palette[name.slice(0, -4) as Ink], palette.paper, 0.62);
  // 焦点垫：比台面深一点的纸。
  if (name === 'pad') return mix(palette.paper, palette.text, 0.11);
  return palette[name as Exclude<MatName, `${Ink}Idle` | 'pad'>];
}

export function makeMats(palette: Palette): Mats {
  const names: MatName[] = ['block', 'plinth', 'tile', 'chip', 'line', 'accent', 'pad', ...inks, ...inks.map((ink) => `${ink}Idle` as const)];
  const mats = {} as Mats;
  for (const name of names) mats[name] = new MeshLambertMaterial({ color: matColor(palette, name) });
  mats.mark = new MeshBasicMaterial({ color: palette.text });
  mats.paper = new MeshBasicMaterial({ color: palette.paper });
  return mats;
}

export function rethemeMats(mats: Mats, palette: Palette): void {
  for (const name of Object.keys(mats) as (MatName | 'mark' | 'paper')[]) {
    if (name === 'mark') mats.mark.color.set(palette.text);
    else if (name === 'paper') mats.paper.color.set(palette.paper);
    else mats[name].color.set(matColor(palette, name));
  }
}

/** 部件拿到的环境。 */
export interface Kit {
  palette: Palette;
  mats: Mats;
  motion: Motion;
  camera: PerspectiveCamera;
  /** 系统要求减少动态效果：不做位移，直接切换。 */
  reduced: boolean;
  /** 文字贴图的密度：每个世界单位多少设备像素。 */
  textScale: number;
  texts: Set<TextPlane>;
  /** 每帧渲染前转到正对屏幕的对象。 */
  facing: Set<Object3D>;
  invalidate(): void;
}

// ---------- 几何（按尺寸缓存，部件之间共用） ----------

const geometries = new Map<string, BufferGeometry>();

function cached<T extends BufferGeometry>(key: string, make: () => T): T {
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = make();
    geometries.set(key, geometry);
  }
  return geometry as T;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function roundedRect(w: number, h: number, r: number): Shape {
  const shape = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  const k = Math.min(r, w / 2, h / 2);
  shape.moveTo(x + k, y);
  shape.lineTo(x + w - k, y);
  shape.absarc(x + w - k, y + k, k, -Math.PI / 2, 0, false);
  shape.lineTo(x + w, y + h - k);
  shape.absarc(x + w - k, y + h - k, k, 0, Math.PI / 2, false);
  shape.lineTo(x + k, y + h);
  shape.absarc(x + k, y + h - k, k, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + k);
  shape.absarc(x + k, y + k, k, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/** 牌：圆角薄片，正面在 z=0，向后有厚度。 */
export function cardGeometry(w: number, h: number, depth: number, r: number): BufferGeometry {
  return cached(`card:${round(w)}:${round(h)}:${round(depth)}:${round(r)}`, () => {
    const geometry = new ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: false, curveSegments: 5 });
    geometry.translate(0, 0, -depth);
    return geometry;
  });
}

/** 实体块：圆角长方体，底面在 y=0。 */
export function blockGeometry(w: number, h: number, d: number, r = 0.06): BufferGeometry {
  return cached(`block:${round(w)}:${round(h)}:${round(d)}:${round(r)}`, () => {
    const geometry = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, h / 2, w / 2, d / 2));
    geometry.translate(0, h / 2, 0);
    return geometry;
  });
}

export function boxGeometry(): BufferGeometry {
  return cached('box', () => new BoxGeometry(1, 1, 1));
}

export function discGeometry(): BufferGeometry {
  return cached('disc', () => new CylinderGeometry(0.5, 0.5, 1, 20));
}

/** 三角柱：尖朝 -z（远离观看者），底面在 y=0。三态门用。 */
export function prismGeometry(base: number, length: number, height: number): BufferGeometry {
  return cached(`prism:${round(base)}:${round(length)}:${round(height)}`, () => {
    const shape = new Shape();
    const r = 0.07;
    // 三个角略切圆。
    shape.moveTo(-base / 2 + r, -length / 2);
    shape.lineTo(base / 2 - r, -length / 2);
    shape.quadraticCurveTo(base / 2, -length / 2, base / 2 - r * 0.45, -length / 2 + r * 1.2);
    shape.lineTo(r * 0.6, length / 2 - r * 1.3);
    shape.quadraticCurveTo(0, length / 2, -r * 0.6, length / 2 - r * 1.3);
    shape.lineTo(-base / 2 + r * 0.45, -length / 2 + r * 1.2);
    shape.quadraticCurveTo(-base / 2, -length / 2, -base / 2 + r, -length / 2);
    const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  });
}

const unitPlane = () => cached('plane', () => new PlaneGeometry(1, 1));

// ---------- 文字 ----------

export type TextTone = 'tileText' | 'chipText' | 'text' | 'muted' | 'accent' | 'accentOnTile' | Ink;

export interface TextStyle {
  /** 字高，世界单位。 */
  size: number;
  tone: TextTone;
  weight?: number;
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
}

const MAX_CANVAS = 2048;
/** 下标、上标的字号比例。 */
const SMALL = 0.68;

/**
 * 正对屏幕的一行字：系统字体画到 canvas，按设备分辨率出贴图。挂在已经正对屏幕的组里。
 * 镜头缩放后由舞台统一重画，所以任何时候都是清楚的。
 */
export class TextPlane {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  /** 世界单位下的宽和高。 */
  width = 0;
  height = 0;
  text = '';
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private anchor: [number, number, number] = [0, 0, 0];

  constructor(
    private readonly kit: Kit,
    text: string,
    private style: TextStyle,
  ) {
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.mesh = new Mesh(unitPlane(), new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false }));
    this.mesh.renderOrder = 2;
    kit.texts.add(this);
    this.set(text);
  }

  /** 对齐点的位置（所在组的局部坐标）。align 决定字相对它往哪边排。 */
  place(x: number, y: number, z = 0.006): this {
    this.anchor = [x, y, z];
    this.layout();
    return this;
  }

  set(text: string, style?: Partial<TextStyle>): void {
    const next = style ? { ...this.style, ...style } : this.style;
    if (text === this.text && next === this.style && this.width > 0) return;
    if (style && text === this.text && this.width > 0 && Object.entries(style).every(([k, v]) => this.style[k as keyof TextStyle] === v)) return;
    this.text = text;
    this.style = next;
    this.redraw();
  }

  get opacity(): number {
    return this.mesh.material.opacity;
  }

  set opacity(value: number) {
    this.mesh.material.opacity = value;
    this.mesh.visible = value > 0.001 && this.text !== '';
  }

  /** 量一段字的宽度（世界单位），不改当前内容。下标、上标按小字算。 */
  measure(text: string): number {
    const px = this.style.size * this.kit.textScale;
    return this.runsWidth(this.canvas.getContext('2d')!, parseRich(text), px) / this.kit.textScale;
  }

  private font(px: number): string {
    return `${this.style.weight ?? 500} ${px}px ${this.style.mono ? fonts.mono : fonts.sans}`;
  }

  /** 一串文字段的总宽（像素）。下标、上标用 0.68 倍字号。 */
  private runsWidth(context: CanvasRenderingContext2D, runs: Run[], px: number): number {
    let width = 0;
    for (const run of runs) {
      context.font = this.font(run.kind === 'base' ? px : px * SMALL);
      width += context.measureText(run.text).width + (run.kind === 'base' ? 0 : px * 0.04);
    }
    return width;
  }

  redraw(): void {
    const { kit, style, canvas } = this;
    let scale = kit.textScale;
    const context = canvas.getContext('2d')!;
    const runs = parseRich(this.text || ' ');
    let px = style.size * scale;
    let textWidth = this.runsWidth(context, runs, px);
    if (textWidth + px > MAX_CANVAS) {
      scale *= MAX_CANVAS / (textWidth + px);
      px = style.size * scale;
      textWidth = this.runsWidth(context, runs, px);
    }
    const pad = Math.ceil(px * 0.12);
    const w = Math.max(2, Math.ceil(textWidth) + pad * 2);
    const h = Math.max(2, Math.ceil(px * 1.36));
    // 贴图的存储大小是定死的：画布尺寸变了要先释放，下次绘制时重新分配。
    if (canvas.width !== w || canvas.height !== h) this.texture.dispose();
    canvas.width = w;
    canvas.height = h;
    context.fillStyle = kit.palette[style.tone];
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    // 以大写字母的高度居中：数字、字母、汉字的视觉中心都落在中线附近。
    const baseline = h / 2 + px * 0.355;
    let x = (w - textWidth) / 2;
    for (const run of runs) {
      if (run.kind === 'base') {
        context.font = this.font(px);
        context.fillText(run.text, x, baseline);
        x += context.measureText(run.text).width;
      } else {
        context.font = this.font(px * SMALL);
        x += px * 0.02;
        context.fillText(run.text, x, baseline + (run.kind === 'sub' ? px * 0.2 : -px * 0.42));
        x += context.measureText(run.text).width + px * 0.02;
      }
    }
    this.texture.needsUpdate = true;
    this.width = w / scale;
    this.height = h / scale;
    this.mesh.scale.set(this.width, this.height, 1);
    this.mesh.visible = this.mesh.material.opacity > 0.001 && this.text !== '';
    this.layout();
    kit.invalidate();
  }

  private layout(): void {
    const [x, y, z] = this.anchor;
    const align = this.style.align ?? 'center';
    const inset = this.style.size * 0.12;
    const dx = align === 'left' ? this.width / 2 - inset : align === 'right' ? -this.width / 2 + inset : 0;
    this.mesh.position.set(x + dx, y, z);
  }

  dispose(): void {
    this.kit.texts.delete(this);
    this.mesh.removeFromParent();
    this.texture.dispose();
    this.mesh.material.dispose();
  }
}

/** 一个缩放到指定尺寸的方块。 */
export function box(material: MeshLambertMaterial | MeshBasicMaterial, w: number, h: number, d: number): Mesh {
  const mesh = new Mesh(boxGeometry(), material);
  mesh.scale.set(w, h, d);
  return mesh;
}
