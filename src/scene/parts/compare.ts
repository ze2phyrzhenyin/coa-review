import { Mesh } from 'three';
import { TextPlane, blockGeometry } from '../kit';
import type { Kit } from '../kit';
import { sizes, timing } from '../theme';
import type { CompareProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { rebound } from './effects';
import { estimateWidth } from './memory';

const GAP = 0.6;

/**
 * 比较：两张卡并排。一致时两张靠拢扣上，中间写「=」；不一致时碰一下又弹开，中间写「≠」。
 * cache 的标记比较、TLB 的页号比较都用它。
 */
export class Compare extends Part<CompareProps> {
  private readonly left: Card;
  private readonly right: Card;
  private readonly names: Card[] = [];
  private readonly sign: TextPlane;
  private readonly chip: Card | null = null;
  private result = '';
  private readonly cardW: number;

  constructor(kit: Kit, id: string, position: Vec2, props: CompareProps) {
    super(kit, id, position);
    for (const text of [props.leftName ?? '', props.rightName ?? '']) {
      const name = new Card(kit, text, { kind: 'chip', height: 0.4, size: sizes.name, weight: 600, minWidth: 0.5 });
      name.group.visible = text !== '';
      this.names.push(name);
      this.face.add(name.group);
    }
    // 两张卡一样宽，至少和上面的名牌一样宽：扣上时正好贴在一起，名牌也不会叠住。
    this.cardW = Math.max(1.3, ...this.names.map((name) => (name.text ? name.width : 0)), estimateWidth(props.left, sizes.value) + 0.4, estimateWidth(props.right, sizes.value) + 0.4);
    const options = { kind: 'tile' as const, height: sizes.tileHeight, size: sizes.value, mono: true, width: this.cardW };
    this.left = new Card(kit, props.left, options);
    this.right = new Card(kit, props.right, options);
    this.sign = new TextPlane(kit, '', { size: sizes.value, tone: 'text', weight: 700 });
    this.face.add(this.left.group, this.right.group, this.sign.mesh);
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      this.face.add(this.chip.group);
    }
    const W = this.cardW * 2 + GAP + 0.6;
    this.footprint = { w: W, d: 0.9 };
    this.group.add(solid(new Mesh(blockGeometry(W, 0.16, 0.9), kit.mats.block)));
    this.face.position.set(0, 0.19, 0.12);
    this.faceWidth = W;
    this.faceHeight = sizes.tileHeight + 0.5 + (this.chip ? sizes.chipHeight : 0);
    this.layout(GAP);
    this.update(props, false);
  }

  /** 两张卡之间的空隙为 gap 时的位置。 */
  private layout(gap: number): void {
    const y = sizes.tileHeight / 2;
    const half = this.cardW / 2 + gap / 2;
    this.left.group.position.set(-half, y, 0);
    this.right.group.position.set(half, y, 0);
    this.names[0]!.group.position.set(-half, sizes.tileHeight + 0.26, 0);
    this.names[1]!.group.position.set(half, sizes.tileHeight + 0.26, 0);
    // 扣上时中间没有空，「=」写在右边那张卡的右侧。
    this.sign.place(gap < 0.3 ? half + this.cardW / 2 + 0.28 : 0, y, 0.02);
    this.chip?.group.position.set(-this.faceWidth / 2 + this.chip.width / 2 + 0.1, sizes.tileHeight + 0.7 + sizes.chipHeight / 2, 0);
    this.kit.invalidate();
  }

  protected apply(next: CompareProps, previous: CompareProps | null, animate: Animate): void {
    const flip = (card: Card, text: string) => {
      if (card.text === text) return;
      if (animate) card.flipTo(text);
      else card.set(text);
    };
    flip(this.left, next.left);
    flip(this.right, next.right);
    [next.leftName ?? '', next.rightName ?? ''].forEach((text, i) => {
      const name = this.names[i]!;
      if (name.text !== text) name.set(text);
      name.group.visible = text !== '';
    });
    const result = next.result ?? '';
    const gapOf = (r: string) => (r === 'match' ? 0.04 : r === 'mismatch' ? 0.9 : GAP);
    const sign = result === 'match' ? '=' : result === 'mismatch' ? '≠' : '';
    const tone = result === 'match' ? 'addr' : result === 'mismatch' ? 'accent' : 'text';
    this.left.setChanged(result === 'mismatch');
    this.right.setChanged(result === 'mismatch');
    if (result === this.result || !previous || !animate || this.kit.reduced) {
      this.result = result;
      this.sign.set(sign, { tone });
      this.layout(gapOf(result));
      return;
    }
    this.result = result;
    this.sign.set('', { tone });
    const from = gapOf(previous.result ?? '');
    const to = gapOf(result);
    if (result === 'mismatch') {
      // 先靠拢碰一下，再弹开。
      this.kit.motion.add({
        duration: 520,
        ease: (t) => t,
        update: (t) => {
          const g = t < 0.45 ? from + (0.04 - from) * (t / 0.45) ** 2 : 0.04 + (to - 0.04) * (1 - (1 - (t - 0.45) / 0.55) ** 3);
          this.layout(g);
        },
        done: () => {
          this.layout(to);
          this.sign.set(sign, { tone });
        },
      });
      this.kit.motion.after(520 * 0.45, () => this.kit.sound('thud'));
      return;
    }
    this.kit.motion.add({
      duration: timing.cause + 120,
      ease: (t) => t * t,
      update: (t) => this.layout(from + (to - from) * t),
      done: () => {
        this.layout(to);
        this.sign.set(sign, { tone });
        if (result === 'match') {
          rebound(this.kit, this.left.group, 0.04, 0, 'x');
          rebound(this.kit, this.right.group, -0.04, 0, 'x');
          this.kit.sound('click');
        }
      },
    });
  }

  override dispose(): void {
    this.left.dispose();
    this.right.dispose();
    for (const name of this.names) name.dispose();
    this.sign.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
