import { Mesh } from 'three';
import { blockGeometry } from '../kit';
import type { Kit } from '../kit';
import { hop } from '../motion';
import { sizes, timing } from '../theme';
import type { BitsProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';

const TILE = 0.5;
const GAP = 0.06;
const GROUP_GAP = 0.2;

/**
 * 位串：一排翻片，白面是 0，深色面是 1。多位同时变时从低位起逐位错开翻。
 * 进位是一张强调色的小牌，从产生进位的那一列跳到左边一列的上方。
 */
export class BitRow extends Part<BitsProps> {
  private readonly tiles: Card[] = [];
  private readonly xs: number[] = [];
  private readonly chip: Card | null;
  private readonly carry: Card;
  private readonly carryY: number;

  constructor(kit: Kit, id: string, position: Vec2, props: BitsProps) {
    super(kit, id, position);
    const n = props.bits.length;
    const group = props.group ?? 4;
    let x = 0;
    for (let i = 0; i < n; i++) {
      // 从右往左每 group 位空一格。
      if (i > 0) x += TILE + GAP + ((n - i) % group === 0 ? GROUP_GAP : 0);
      this.xs.push(x);
    }
    const span = x;
    for (let i = 0; i < n; i++) this.xs[i] = this.xs[i]! - span / 2;
    const width = span + TILE + 0.4;
    this.footprint = { w: width, d: 0.9 };
    this.group.add(solid(new Mesh(blockGeometry(width, 0.3, 0.9), kit.mats.block)));
    this.face.position.set(0, 0.33, 0.2);
    for (let i = 0; i < n; i++) {
      const bit = props.bits[i] === '1' ? '1' : '0';
      const tile = new Card(kit, bit, { kind: bit === '1' ? 'chip' : 'tile', width: TILE, height: sizes.tileHeight, size: 0.38, mono: true, weight: 600 });
      tile.group.position.set(this.xs[i]!, sizes.tileHeight / 2, 0);
      this.tiles.push(tile);
      this.face.add(tile.group);
    }
    this.carryY = sizes.tileHeight + 0.06 + 0.17;
    this.carry = new Card(kit, '1', { kind: 'accent', width: 0.34, height: 0.34, size: 0.22, mono: true, weight: 600 });
    this.carry.group.visible = false;
    this.face.add(this.carry.group);
    this.chip = props.name ? new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 }) : null;
    if (this.chip) {
      // 名牌在左侧，不占进位牌的那一行。
      this.chip.group.position.set(-span / 2 - TILE / 2 - 0.12 - this.chip.width / 2, sizes.tileHeight / 2, 0);
      this.face.add(this.chip.group);
      this.footprint.w = width + this.chip.width * 2 + 0.24;
    }
    this.faceHeight = this.carryY + 0.2;
    this.faceWidth = this.footprint.w;
    this.update(props, false);
  }

  private column(i: number): number {
    return i < 0 ? this.xs[0]! - (TILE + GAP) : (this.xs[i] ?? this.xs[this.xs.length - 1]!);
  }

  protected apply(next: BitsProps, previous: BitsProps | null, animate: Animate): void {
    const n = this.tiles.length;
    const order: number[] = [];
    for (let i = 0; i < n; i++) {
      const bit = next.bits[i] === '1' ? '1' : '0';
      if (this.tiles[i]!.text !== bit) order.push(i);
    }
    if ((next.from ?? 'right') === 'right') order.reverse();
    order.forEach((i, k) => {
      const bit = next.bits[i] === '1' ? '1' : '0';
      const kind = bit === '1' ? 'chip' : 'tile';
      if (animate) this.tiles[i]!.flipTo(bit, k * timing.stagger, kind);
      else {
        this.tiles[i]!.set(bit);
        this.tiles[i]!.setKind(kind);
      }
    });

    const carry = next.carry ?? null;
    const before = previous?.carry ?? null;
    this.carry.group.visible = carry !== null;
    if (carry !== null) {
      const to = this.column(carry - 1);
      if (animate && carry !== before && !this.kit.reduced) {
        const start = this.column(carry);
        this.kit.motion.add({
          delay: order.length * timing.stagger,
          duration: 420,
          ease: (t) => t,
          update: (t) => this.carry.group.position.set(start + (to - start) * hop(t), this.carryY + Math.sin(Math.PI * t) * 0.32, 0),
          done: () => this.carry.group.position.set(to, this.carryY, 0),
        });
        this.carry.group.position.set(start, this.carryY, 0);
      } else {
        this.carry.group.position.set(to, this.carryY, 0);
      }
    }
  }

  override dispose(): void {
    for (const tile of this.tiles) tile.dispose();
    this.carry.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
