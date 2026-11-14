/**
 * 引脚：从部件边上伸出的一束腿，旁边一张名牌（可带一张值牌）。芯片、译码器共用。
 */
import { Group, Mesh, Vector3 } from 'three';
import { box } from '../kit';
import type { Kit } from '../kit';
import type { Ink } from '../theme';
import { sizes } from '../theme';
import type { Side } from './base';
import { Card } from './card';

const LEG = 0.34;
const LEG_GAP = 0.13;
const LABEL = 0.4;

export interface PinSpec {
  id: string;
  name: string;
  side: Side;
  /** 在这条边上的位置（相对部件中心，沿边的方向）。 */
  at: number;
  lines: number;
  ink: Ink;
  value?: string | undefined;
}

/** 一组引脚。腿贴在台面上，名牌立着正对屏幕，放在腿的外侧旁边，不压在出线上。 */
export class PinGroup {
  readonly legs: Mesh[] = [];
  readonly label = new Group();
  readonly name: Card;
  readonly value: Card;
  /** 腿尖中心（部件局部坐标），连线从这里出。 */
  readonly tip: Vector3;
  private lit = false;

  constructor(
    private readonly kit: Kit,
    parent: Group,
    readonly spec: PinSpec,
    halfW: number,
    halfD: number,
  ) {
    const { side, at, lines } = spec;
    const along = side === 'n' || side === 's';
    const sign = side === 'n' || side === 'w' ? -1 : 1;
    const count = Math.max(1, Math.min(8, lines));
    const span = (count - 1) * LEG_GAP;
    const edge = along ? halfD : halfW;
    for (let k = 0; k < count; k++) {
      const offset = -span / 2 + k * LEG_GAP;
      const leg = box(kit.mats[`${spec.ink}Idle`], along ? 0.06 : LEG, 0.05, along ? LEG : 0.06);
      if (along) leg.position.set(at + offset, 0.06, sign * (edge + LEG / 2));
      else leg.position.set(sign * (edge + LEG / 2), 0.06, at + offset);
      leg.castShadow = true;
      this.legs.push(leg);
      parent.add(leg);
    }
    this.tip = along ? new Vector3(at, 0, sign * (edge + LEG)) : new Vector3(sign * (edge + LEG), 0, at);
    this.name = new Card(kit, spec.name, { kind: 'chip', height: LABEL, size: sizes.name, weight: 600, minWidth: 0.5 });
    this.value = new Card(kit, spec.value ?? '', { kind: 'tile', height: LABEL, size: sizes.name, mono: true, minWidth: 0.42 });
    this.label.add(this.name.group, this.value.group);
    parent.add(this.label);
    kit.facing.add(this.label);
    this.layout();
    // 名牌在腿的旁边：上下两边的放在腿右侧；左右两边的放在腿尖外、出线的正上方（画面上像写在线上方）。
    // 前面（s）的名牌放到腿尖外：立着的牌向后仰，太靠里会被部件本体挡住。
    if (along) this.label.position.set(at + span / 2 + 0.16, 0.05, sign * (edge + (sign > 0 ? LEG + 0.3 : LEG * 0.55)));
    else this.label.position.set(sign * (edge + LEG + 0.08) + (sign < 0 ? -this.width : 0), 0.05, at - span / 2 - 0.2);
  }

  get width(): number {
    return this.name.width + (this.value.text ? this.value.width + 0.05 : 0);
  }

  private layout(): void {
    this.name.group.position.set(this.name.width / 2, LABEL / 2, 0);
    this.value.group.visible = this.value.text !== '';
    this.value.group.position.set(this.name.width + 0.05 + this.value.width / 2, LABEL / 2, 0);
  }

  set(value: string | undefined, animate: boolean): void {
    const text = value ?? '';
    if (text === this.value.text) return;
    const before = this.label.position.x;
    const grew = this.spec.side === 'w' ? this.width : 0;
    if (animate && this.value.text !== '' && text !== '') this.value.flipTo(text);
    else this.value.set(text);
    this.layout();
    // 左边一组的名牌右对齐在腿旁边。
    if (this.spec.side === 'w') this.label.position.x = before + grew - this.width;
  }

  /** 这一组线上有信号：腿换成实色。 */
  light(on: boolean): void {
    if (on === this.lit) return;
    this.lit = on;
    for (const leg of this.legs) leg.material = on ? this.kit.mats[this.spec.ink] : this.kit.mats[`${this.spec.ink}Idle`];
    this.kit.invalidate();
  }

  dispose(): void {
    this.kit.facing.delete(this.label);
    this.name.dispose();
    this.value.dispose();
  }
}

/** 一条边上排 n 组：均匀分布在边长里。 */
export function spread(n: number, length: number): number[] {
  if (n <= 0) return [];
  const step = length / n;
  return Array.from({ length: n }, (_, i) => -length / 2 + step * (i + 0.5));
}
