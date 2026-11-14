import { Box3, Group, Mesh, Vector3 } from 'three';
import { blockGeometry, box, discGeometry } from '../kit';
import type { Kit } from '../kit';
import { sizes } from '../theme';
import type { BalanceProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';

const HALF = 1.7;
const POST = 1.95;
const HANG = 0.98;
const TILT = 0.16;

const tiltOf = (value: BalanceProps['tilt']): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.sign(n) : 0;
};

/**
 * 天平：中间一根立柱，横梁两头挂着秤盘，盘上立着值牌。哪边沉哪边落下，落定时略晃一下。
 * 除法里比较余数和除数：够减上商 1，不够上商 0。
 */
export class Balance extends Part<BalanceProps> {
  private readonly beam = new Group();
  private readonly pans: Group[] = [];
  private readonly cards: Card[] = [];
  private readonly names: Card[] = [];
  private readonly holders: Group[] = [];
  private readonly tags: Group[] = [];
  private readonly chip: Card | null = null;
  private tilt = 0;

  constructor(kit: Kit, id: string, position: Vec2, props: BalanceProps) {
    super(kit, id, position);
    this.footprint = { w: HALF * 2 + 1.0, d: 1.4 };
    const base = solid(new Mesh(blockGeometry(1.1, 0.14, 0.8, 0.05), kit.mats.plinth));
    const post = solid(new Mesh(blockGeometry(0.16, POST, 0.16, 0.04), kit.mats.block));
    this.group.add(base, post);
    this.beam.position.y = POST;
    const bar = solid(box(kit.mats.block, HALF * 2, 0.1, 0.14));
    this.beam.add(bar);
    const knob = new Mesh(discGeometry(), kit.mats.chip);
    knob.rotation.x = Math.PI / 2;
    knob.scale.set(0.18, 0.2, 0.18);
    this.beam.add(knob);
    this.group.add(this.beam);
    for (const side of [-1, 1]) {
      const pan = new Group();
      const cord = box(kit.mats.line, 0.025, HANG, 0.025);
      cord.position.y = HANG / 2;
      const dish = solid(new Mesh(discGeometry(), kit.mats.block));
      dish.scale.set(1.0, 0.06, 0.8);
      pan.add(cord, dish);
      pan.position.set(side * HALF, POST - HANG, 0);
      this.group.add(pan);
      this.pans.push(pan);
      const holder = new Group();
      holder.position.copy(pan.position).setY(POST - HANG + 0.05);
      this.group.add(holder);
      kit.facing.add(holder);
      this.holders.push(holder);
      const card = new Card(kit, side < 0 ? props.left : props.right, { kind: 'tile', height: sizes.tileHeight, size: sizes.value, mono: true, minWidth: 1.0 });
      card.group.position.set(0, sizes.tileHeight / 2, 0);
      holder.add(card.group);
      this.cards.push(card);
      // 盘的名字写在台面上、盘的正前方，不随横梁动。
      const name = new Card(kit, (side < 0 ? props.leftName : props.rightName) ?? '', { kind: 'chip', height: 0.4, size: sizes.name, weight: 600, minWidth: 0.5 });
      name.group.position.set(0, 0.2, 0);
      name.group.visible = name.text !== '';
      const tag = new Group();
      tag.position.set(side * HALF, 0.02, 0.75);
      tag.add(name.group);
      this.group.add(tag);
      kit.facing.add(tag);
      this.tags.push(tag);
      this.names.push(name);
    }
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      this.chip.group.position.set(0, sizes.chipHeight / 2, 0);
      const holder = new Group();
      holder.position.set(0, 0.16, -0.7);
      holder.add(this.chip.group);
      this.group.add(holder);
      kit.facing.add(holder);
      this.holders.push(holder);
    }
    this.update(props, false);
  }

  private pose(angle: number): void {
    this.beam.rotation.z = angle;
    // 横梁绕 z 轴转：angle 为正时右端抬起、左端落下。
    [-1, 1].forEach((side, i) => {
      const dy = side * Math.sin(angle) * HALF;
      this.pans[i]!.position.y = POST - HANG + dy;
      this.holders[i]!.position.y = POST - HANG + 0.05 + dy;
    });
    this.kit.invalidate();
  }

  protected apply(next: BalanceProps, previous: BalanceProps | null, animate: Animate): void {
    [next.left, next.right].forEach((text, i) => {
      const card = this.cards[i]!;
      if (card.text !== text) {
        if (animate) card.flipTo(text);
        else card.set(text);
      }
      card.setChanged(!!next.changed);
    });
    [next.leftName, next.rightName].forEach((text, i) => {
      const name = this.names[i]!;
      if ((text ?? '') !== name.text) name.set(text ?? '');
      name.group.visible = (text ?? '') !== '';
    });
    const tilt = tiltOf(next.tilt);
    // tilt = -1 左边沉：左端落下，angle 为正。
    const to = -tilt * TILT;
    if (!previous || !animate || this.kit.reduced || tilt === this.tilt) {
      this.tilt = tilt;
      this.pose(to);
      return;
    }
    const from = this.beam.rotation.z;
    this.tilt = tilt;
    this.kit.motion.add({
      duration: 520,
      ease: (t) => t,
      update: (t) => {
        // 摆过头一点再回来，像真的秤。
        const settle = 1 - Math.cos(t * Math.PI * 2.5) * (1 - t) ** 2;
        this.pose(from + (to - from) * settle);
      },
      done: () => {
        this.pose(to);
        this.kit.sound('thud');
      },
    });
  }

  override bounds(): Box3 {
    const box = super.bounds();
    box.min.x = this.center.x - HALF - 0.8;
    box.max.x = this.center.x + HALF + 0.8;
    box.max.y = POST + 0.3;
    box.max.z += 0.5;
    return box;
  }

  override anchor(): Vector3 {
    return this.center.setY(POST);
  }

  override dispose(): void {
    for (const holder of [...this.holders, ...this.tags]) this.kit.facing.delete(holder);
    for (const card of [...this.cards, ...this.names]) card.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
