import { Box3, Mesh, Vector3 } from 'three';
import { blockGeometry } from '../kit';
import type { Kit } from '../kit';
import { sizes, timing } from '../theme';
import type { DecoderProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate, Side } from './base';
import { Card } from './card';
import { isOn } from './gate';
import { PinGroup, spread } from './pins';

const H = 0.36;
const ROW = 0.62;
const W = 2.2;

const outName = (props: DecoderProps, i: number) => props.outputNames?.[i] ?? `Y_${i}`;

/**
 * 译码器：一块实体，左边输入、右边一列输出、前面使能端。有效的那根输出名牌换成强调色、腿换成实色。
 * 哪根有效由页面按引擎的状态给出（active），部件不自己译码。连线接引脚：'D.y3'、'D.in0'、'D.en'，也认名字 'D.Y_3'。
 */
export class Decoder extends Part<DecoderProps> {
  private readonly inputs: PinGroup[] = [];
  private readonly outputs: PinGroup[] = [];
  private readonly enable: PinGroup | null = null;
  private readonly chip: Card;
  private active = -1;

  constructor(kit: Kit, id: string, position: Vec2, props: DecoderProps) {
    super(kit, id, position);
    const n = props.outputs ?? 2 ** props.inputs.length;
    const D = Math.max(1.8, n * ROW + 0.3);
    this.footprint = { w: W, d: D };
    this.group.add(solid(new Mesh(blockGeometry(W, H, D), kit.mats.block)));
    const ins = spread(props.inputs.length, Math.min(D - 0.4, props.inputs.length * 0.9));
    props.inputs.forEach((name, i) => {
      this.inputs.push(new PinGroup(kit, this.group, { id: `in${i}`, name, side: 'w', at: ins[i]!, lines: 1, ink: 'addr', value: props.input?.[i] }, W / 2, D / 2));
    });
    const outs = spread(n, n * ROW);
    for (let i = 0; i < n; i++) {
      this.outputs.push(new PinGroup(kit, this.group, { id: `y${i}`, name: outName(props, i), side: 'e', at: outs[i]!, lines: 1, ink: 'ctrl' }, W / 2, D / 2));
    }
    const enableName = props.enableName ?? 'G';
    if (enableName !== '') this.enable = new PinGroup(kit, this.group, { id: 'en', name: enableName, side: 's', at: -W / 4, lines: 1, ink: 'ctrl' }, W / 2, D / 2);
    this.chip = new Card(kit, props.name ?? `${props.inputs.length}-${n} 译码器`, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.chip.group.position.set(0, sizes.chipHeight / 2, 0);
    this.face.add(this.chip.group);
    this.face.position.set(0, H + 0.03, 0);
    this.faceHeight = sizes.chipHeight;
    this.update(props, false);
  }

  /** 输出线上的电平：有效的那根是 1（低电平有效时是 0）。 */
  private level(props: DecoderProps, i: number): string {
    const hasInput = (props.input ?? '') !== '' || props.active !== undefined;
    if (!hasInput) return '';
    const on = i === (props.active ?? -1);
    return props.low ? (on ? '0' : '1') : on ? '1' : '0';
  }

  protected apply(next: DecoderProps, _previous: DecoderProps | null, animate: Animate): void {
    this.inputs.forEach((pin, i) => {
      const bit = next.input?.[i] ?? '';
      pin.set(bit, !!animate);
      pin.light(bit !== '');
    });
    if (this.enable) {
      const on = next.enable === undefined ? '' : isOn(next.enable) ? '1' : '0';
      this.enable.set(on, !!animate);
      this.enable.light(on === '1');
    }
    const active = next.active ?? -1;
    const changed = active !== this.active;
    this.outputs.forEach((pin, i) => {
      pin.set(this.level(next, i), !!animate);
      pin.light(i === active);
    });
    if (changed) {
      const before = this.outputs[this.active];
      const after = this.outputs[active];
      before?.name.setKind('chip');
      if (after) {
        if (animate && !this.kit.reduced) {
          after.name.flipTo(after.name.text, timing.cause, 'accent');
          this.kit.motion.after(timing.cause + timing.flip, () => this.kit.sound('click'));
        } else after.name.setKind('accent');
      }
      this.active = active;
    }
  }

  override pin(name: string): { point: Vector3; side: Side } | null {
    const all = [...this.inputs, ...this.outputs, ...(this.enable ? [this.enable] : [])];
    const found = all.find((pin) => pin.spec.id === name || pin.spec.name === name);
    if (!found) return null;
    return { point: found.tip.clone().add(this.center), side: found.spec.side };
  }

  override bounds(): Box3 {
    const box = super.bounds();
    const left = Math.max(0, ...this.inputs.map((pin) => pin.width)) + 0.5;
    const right = Math.max(0, ...this.outputs.map((pin) => pin.width)) + 0.6;
    box.min.x -= left;
    box.max.x += right;
    box.max.z += 0.6;
    return box;
  }

  override dispose(): void {
    for (const pin of [...this.inputs, ...this.outputs]) pin.dispose();
    this.enable?.dispose();
    this.chip.dispose();
    super.dispose();
  }
}
