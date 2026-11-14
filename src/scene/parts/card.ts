import { Group, Mesh } from 'three';
import type { MeshLambertMaterial } from 'three';
import { TextPlane, box, cardGeometry } from '../kit';
import type { Kit, TextTone } from '../kit';
import { easeIn, easeOut } from '../motion';
import { sizes, timing } from '../theme';

export type CardKind = 'tile' | 'chip' | 'accent';

export interface CardOptions {
  kind: CardKind;
  height: number;
  /** 不写则按文字定宽。 */
  width?: number;
  minWidth?: number;
  /** 字高。 */
  size: number;
  mono?: boolean;
  weight?: number;
}

const textTone = (kind: CardKind, changed: boolean): TextTone => (kind === 'tile' ? (changed ? 'accentOnTile' : 'tileText') : 'chipText');

/**
 * 一张牌：圆角薄片加一行字，挂在正对屏幕的组里。值牌、名牌、位片、表格里的格子都是它。
 * 翻面、被顶出都在这里做。
 */
export class Card {
  readonly group = new Group();
  width = 0;
  readonly height: number;
  text: string;
  private kind: CardKind;
  private changed = false;
  private readonly slab: Mesh;
  private readonly label: TextPlane;
  private bar: Mesh | null = null;

  constructor(
    private readonly kit: Kit,
    text: string,
    private readonly options: CardOptions,
  ) {
    this.kind = options.kind;
    this.height = options.height;
    this.text = text;
    this.slab = new Mesh(undefined, kit.mats[this.kind]);
    this.slab.castShadow = true;
    this.slab.receiveShadow = true;
    this.label = new TextPlane(kit, text, { size: options.size, tone: textTone(this.kind, false), mono: options.mono ?? false, weight: options.weight ?? 500 });
    this.group.add(this.slab, this.label.mesh);
    this.fit();
  }

  private fit(): void {
    const { options } = this;
    // 定宽的牌：字放不下时缩小字号，不出边。
    if (options.width !== undefined) {
      this.label.set(this.text, { size: options.size });
      const room = options.width - options.size * 0.5;
      if (this.label.width > room && this.label.width > 0) this.label.set(this.text, { size: (options.size * room) / this.label.width });
    }
    const wanted = options.width ?? Math.max(options.minWidth ?? 0, this.label.width + options.size * 0.7);
    const width = Math.ceil(wanted * 50) / 50;
    if (width !== this.width) {
      this.width = width;
      this.slab.geometry = cardGeometry(width, this.height, sizes.cardDepth, sizes.radius);
      if (this.bar) this.bar.scale.x = width - 0.24;
    }
  }

  /** 直接换字，不带动画。 */
  set(text: string): void {
    this.text = text;
    this.label.set(text);
    this.fit();
  }

  setKind(kind: CardKind): void {
    if (kind === this.kind) return;
    this.kind = kind;
    this.slab.material = this.kit.mats[kind];
    this.label.set(this.text, { tone: textTone(kind, this.changed) });
  }

  /** 标成「这一步变了」：字换强调色，底边加一条强调色。 */
  setChanged(changed: boolean): void {
    if (changed === this.changed) return;
    this.changed = changed;
    this.label.set(this.text, { tone: textTone(this.kind, changed) });
    if (changed && !this.bar) {
      // 小牌上的强调条细一些、贴着底边，不压到字。
      const small = this.height < 0.5;
      this.bar = box(this.kit.mats.accent, 1, small ? 0.03 : 0.055, 0.012);
      this.bar.scale.x = this.width - 0.24;
      this.bar.position.set(0, -this.height / 2 + (small ? 0.04 : 0.085), 0.006);
      this.group.add(this.bar);
    }
    if (this.bar) this.bar.visible = changed;
  }

  /** 原地翻面：转到侧面时换字（和底色）。 */
  flipTo(text: string, delay = 0, kind?: CardKind): void {
    const swap = () => {
      this.set(text);
      if (kind) this.setKind(kind);
    };
    if (this.kit.reduced) {
      swap();
      return;
    }
    const { motion } = this.kit;
    const half = timing.flip / 2;
    motion.add({
      delay,
      duration: half,
      ease: easeIn,
      update: (t) => (this.group.rotation.x = (t * Math.PI) / 2),
      done: () => {
        swap();
        motion.add({ duration: half, ease: easeOut, update: (t) => (this.group.rotation.x = ((t - 1) * Math.PI) / 2), done: () => (this.group.rotation.x = 0) });
      },
    });
  }

  /** 新值落下：旧值的牌被顶上去并淡出，看得见它去了哪。 */
  landTo(text: string): void {
    if (!this.kit.reduced && this.group.visible && this.text !== '') this.ghost();
    this.set(text);
  }

  /** 让这张牌带着旧字升起淡出，本体立刻隐藏或换字由调用方决定。 */
  ghost(): void {
    if (this.kit.reduced) return;
    const { kit } = this;
    const material = (this.slab.material as MeshLambertMaterial).clone();
    material.transparent = true;
    const slab = new Mesh(this.slab.geometry, material);
    const label = new TextPlane(kit, this.text, { size: this.options.size, tone: textTone(this.kind, false), mono: this.options.mono ?? false, weight: this.options.weight ?? 500 });
    const ghost = new Group();
    ghost.add(slab, label.mesh);
    ghost.position.copy(this.group.position);
    ghost.position.z -= 0.02;
    const parent = this.group.parent;
    if (!parent) return;
    parent.add(ghost);
    const y = ghost.position.y;
    kit.motion.add({
      duration: timing.push,
      ease: easeOut,
      update: (t) => {
        ghost.position.y = y + t * this.height * 0.95;
        material.opacity = 1 - t;
        label.opacity = 1 - t;
      },
      done: () => {
        ghost.removeFromParent();
        label.dispose();
        material.dispose();
      },
    });
  }

  dispose(): void {
    this.label.dispose();
    this.group.removeFromParent();
  }
}
