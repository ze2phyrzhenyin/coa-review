import { Group, Vector3 } from 'three';
import type { Object3D } from 'three';
import { box } from '../kit';
import type { Kit } from '../kit';
import { arrive as decelerate } from '../motion';
import { sizes, timing } from '../theme';
import type { Ink } from '../theme';
import type { TokenProps, Vec2 } from '../types';
import { Part } from './base';
import type { Animate } from './base';
import { Card } from './card';

/** 一条路：折线的拐角切成圆弧，按弧长取点。 */
export class Path {
  private readonly points: Vector3[] = [];
  private readonly lengths: number[] = [0];
  readonly length: number;

  constructor(corners: Vector3[], radius = 0.28) {
    const pts = corners.filter((p, i) => i === 0 || p.distanceTo(corners[i - 1]!) > 1e-4);
    if (pts.length === 0) pts.push(new Vector3());
    this.points.push(pts[0]!.clone());
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1]!;
      const here = pts[i]!;
      const next = pts[i + 1]!;
      const r = Math.min(radius, here.distanceTo(prev) / 2, here.distanceTo(next) / 2);
      const a = here.clone().add(prev.clone().sub(here).setLength(r));
      const b = here.clone().add(next.clone().sub(here).setLength(r));
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        // 二次贝塞尔：a → here → b
        this.points.push(
          a
            .clone()
            .multiplyScalar((1 - t) ** 2)
            .add(here.clone().multiplyScalar(2 * t * (1 - t)))
            .add(b.clone().multiplyScalar(t * t)),
        );
      }
    }
    if (pts.length > 1) this.points.push(pts[pts.length - 1]!.clone());
    for (let i = 1; i < this.points.length; i++) this.lengths.push(this.lengths[i - 1]! + this.points[i]!.distanceTo(this.points[i - 1]!));
    this.length = this.lengths[this.lengths.length - 1]!;
  }

  /** t 从 0 到 1。 */
  at(t: number, out = new Vector3()): Vector3 {
    const s = Math.max(0, Math.min(1, t)) * this.length;
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i]! < s) i++;
    const a = this.points[i - 1]!;
    const b = this.points[i] ?? a;
    const span = (this.lengths[i] ?? 0) - this.lengths[i - 1]!;
    return out.copy(a).lerp(b, span > 0 ? (s - this.lengths[i - 1]!) / span : 0);
  }
}

/** 时长随距离，280–900 毫秒。 */
export function travelTime(length: number): number {
  return Math.max(timing.travelMin, Math.min(timing.travelMax, length * timing.travelPerUnit));
}

/** 把起点、沿线的拐点、终点连成值走的路：离开部件后升到线的上方，到了再落下。 */
export function flightPath(from: Vector3, wirePoints: Vector3[], to: Vector3): Path {
  const lifted = wirePoints.map((p) => new Vector3(p.x, sizes.hover, p.z));
  return new Path([from, ...lifted, to]);
}

/** 值牌的样子：一张值牌，左边一道墨色表明它是数据、地址还是控制。 */
export function makeValueCard(kit: Kit, value: string, ink: Ink): { group: Group; card: Card } {
  const card = new Card(kit, value, { kind: 'tile', height: sizes.tileHeight, size: sizes.value, mono: true, minWidth: 1.1 });
  const group = new Group();
  const stripe = box(kit.mats[ink], 0.07, sizes.tileHeight - 0.2, 0.012);
  stripe.position.set(-card.width / 2 + 0.11, 0, 0.006);
  card.group.add(stripe);
  group.add(card.group);
  return { group, card };
}

/**
 * 让一个值沿路走一趟。走完调用 arrive，然后自己消失（落点的部件接着显示这个值）。
 * 返回用时。
 */
export function sendValue(kit: Kit, root: Object3D, value: string, ink: Ink, path: Path, delay: number, arrive: () => void, shape: 'card' | 'pulse' | 'level' = 'card'): number {
  const duration = travelTime(path.length);
  const { group, card, facing } = shape === 'card' ? { ...makeValueCard(kit, value, ink), facing: null } : makeSignalShape(kit, value, ink, shape);
  group.visible = false;
  group.renderOrder = 5;
  path.at(0, group.position);
  root.add(group);
  if (facing) kit.facing.add(facing);
  else kit.facing.add(group);
  kit.motion.add({
    delay,
    duration,
    ease: decelerate,
    update: (t) => {
      group.visible = true;
      path.at(t, group.position);
    },
    done: () => {
      kit.facing.delete(facing ?? group);
      group.removeFromParent();
      card.dispose();
      arrive();
    },
  });
  return duration;
}

/**
 * 控制信号的样子：脉冲是一根窄而高的尖块，电位是一段扁平的长条。旁边一张小牌写信号名。
 * 两种形状不靠颜色区分，读屏和色弱也分得清。
 */
export function makeSignalShape(kit: Kit, name: string, ink: Ink, shape: 'pulse' | 'level'): { group: Group; card: Card; facing: Group } {
  const group = new Group();
  const body = shape === 'pulse' ? box(kit.mats[ink], 0.13, 0.62, 0.13) : box(kit.mats[ink], 0.9, 0.12, 0.2);
  body.position.y = shape === 'pulse' ? 0.0 : -0.25;
  body.castShadow = true;
  group.add(body);
  const facing = new Group();
  const card = new Card(kit, name, { kind: 'chip', height: 0.4, size: sizes.name, weight: 600, minWidth: 0.5 });
  card.group.position.set(card.width / 2 + (shape === 'pulse' ? 0.16 : 0.52), 0.05, 0);
  facing.add(card.group);
  group.add(facing);
  return { group, card, facing };
}

/**
 * 作为部件的值牌：停在 at 指的部件上；at 变了就沿 via 的连线走过去。
 * 走哪条路由场景来算，所以这里只管停在哪。
 */
export class Token extends Part<TokenProps> {
  private readonly card: Card;
  /** 由场景设置：给出 at 对应的停靠点，以及从旧位置到新位置的路。 */
  resolve: (at: string) => Vector3 | null = () => null;
  pathBetween: (from: string, to: string, via: string[]) => Path | null = () => null;

  constructor(kit: Kit, id: string, position: Vec2, props: TokenProps) {
    super(kit, id, position);
    const made = makeValueCard(kit, props.value, props.ink ?? 'data');
    this.card = made.card;
    this.face.add(made.group);
    this.faceHeight = sizes.tileHeight;
    this.footprint = { w: this.card.width, d: 0.4 };
    this.update(props, false);
  }

  protected apply(next: TokenProps, previous: TokenProps | null, animate: Animate): void {
    if (!previous || next.value !== previous.value) {
      if (animate) this.card.flipTo(next.value);
      else this.card.set(next.value);
    }
    this.card.setChanged(!!next.changed);
    const target = this.resolve(next.at);
    if (!target) return;
    const moved = previous && previous.at !== next.at;
    const path = moved && animate && !this.kit.reduced ? this.pathBetween(previous.at, next.at, next.via ?? []) : null;
    if (path) {
      this.kit.motion.add({ duration: travelTime(path.length), ease: decelerate, update: (t) => path.at(t, this.group.position), done: () => this.group.position.copy(target) });
    } else {
      this.group.position.copy(target);
    }
  }

  /** 场景建好连线后调用一次，把牌放到 at 的位置。 */
  settle(): void {
    const target = this.props ? this.resolve(this.props.at) : null;
    if (target) this.group.position.copy(target);
  }

  override dispose(): void {
    this.card.dispose();
    super.dispose();
  }
}
