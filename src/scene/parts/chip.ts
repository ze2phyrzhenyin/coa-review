import { Box3, Mesh, Vector3 } from 'three';
import { blockGeometry } from '../kit';
import type { Kit } from '../kit';
import { sizes } from '../theme';
import type { ChipProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate, Side } from './base';
import { Card } from './card';
import { rebound } from './effects';
import { PinGroup, spread } from './pins';
import { isOn } from './gate';

const H = 0.34;
const LIFT = 0.42;

/**
 * 存储芯片：一块深色的芯片，四边伸出几束引脚（地址、数据、片选、读写），每束旁边一张名牌和读数。
 * 被片选选中时整块芯片从板上抬起，落定时回弹一下。连线接引脚：'U1.addr'。
 */
export class Chip extends Part<ChipProps> {
  private readonly groups = new Map<string, PinGroup>();
  private readonly tile: Card;
  private readonly chip: Card;
  private lifted = false;

  constructor(kit: Kit, id: string, position: Vec2, props: ChipProps) {
    super(kit, id, position);
    const W = props.width ?? 3.0;
    const D = props.depth ?? 1.7;
    this.footprint = { w: W, d: D };
    this.group.add(solid(new Mesh(blockGeometry(W, H, D, 0.05), kit.mats.chip)));
    // 一角的小缺口：芯片的方向标记。
    const notch = new Mesh(blockGeometry(0.22, 0.03, 0.22, 0.1), kit.mats.plinth);
    notch.position.set(-W / 2 + 0.26, H, -D / 2 + 0.26);
    this.group.add(notch);
    const bySide = new Map<Side, ChipProps['pins']>();
    for (const pin of props.pins) bySide.set(pin.side, [...(bySide.get(pin.side) ?? []), pin]);
    for (const [side, list] of bySide) {
      const along = side === 'n' || side === 's';
      const spots = spread(list.length, (along ? W : D) - 0.3);
      list.forEach((pin, i) => {
        const group = new PinGroup(kit, this.group, { id: pin.id, name: pin.name, side, at: spots[i]!, lines: pin.lines ?? 1, ink: pin.ink ?? 'addr', value: pin.value }, W / 2, D / 2);
        this.groups.set(pin.id, group);
      });
    }
    const tileWidth = Math.min(W - 0.5, 2.2);
    this.tile = new Card(kit, props.label ?? '', { kind: 'tile', width: tileWidth, height: sizes.tileHeight, size: sizes.value });
    this.tile.group.position.set(0, sizes.tileHeight / 2, 0);
    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.face.position.set(0, H + 0.03, 0.15);
    this.face.add(this.tile.group, this.chip.group);
    this.faceWidth = tileWidth;
    this.faceHeight = sizes.tileHeight + 0.04 + sizes.chipHeight;
    this.update(props, false);
  }

  protected apply(next: ChipProps, previous: ChipProps | null, animate: Animate): void {
    const label = next.label ?? '';
    this.tile.group.visible = label !== '';
    if (label !== this.tile.text) {
      if (animate && this.tile.text !== '') this.tile.flipTo(label);
      else this.tile.set(label);
    }
    if (!previous || next.name !== previous.name) this.chip.set(next.name);
    const top = label !== '' ? sizes.tileHeight + 0.04 : 0;
    this.chip.group.position.set(label !== '' ? -this.faceWidth / 2 + this.chip.width / 2 : 0, top + sizes.chipHeight / 2, 0);
    this.tile.setChanged(!!next.changed);
    for (const pin of next.pins) {
      const group = this.groups.get(pin.id);
      if (!group) continue;
      group.set(pin.value, !!animate);
      group.light(pin.value !== undefined && pin.value !== '');
    }
    this.lift(isOn(next.selected), !!animate);
  }

  /** 选中时抬起，没选中时落回板上。 */
  private lift(up: boolean, animate: boolean): void {
    if (up === this.lifted) return;
    this.lifted = up;
    const to = up ? LIFT : 0;
    if (!animate || this.kit.reduced) {
      this.group.position.y = to;
      return;
    }
    const from = this.group.position.y;
    this.kit.motion.add({
      duration: 300,
      ease: (t) => 1 - (1 - t) ** 3,
      update: (t) => (this.group.position.y = from + (to - from) * t),
      done: () => {
        this.group.position.y = to;
        rebound(this.kit, this.group, up ? -0.05 : 0.04);
        this.kit.sound(up ? 'click' : 'thud');
      },
    });
  }

  override pin(name: string): { point: Vector3; side: Side } | null {
    const group = this.groups.get(name);
    if (!group) return null;
    return { point: group.tip.clone().add(this.center), side: group.spec.side };
  }

  override bounds(): Box3 {
    const box = super.bounds();
    // 引脚和名牌伸到外面。
    box.expandByVector(new Vector3(0.9, 0, 0.6));
    box.max.y = Math.max(box.max.y, LIFT + H + this.faceHeight * 0.62);
    return box;
  }

  override dispose(): void {
    for (const group of this.groups.values()) group.dispose();
    this.tile.dispose();
    this.chip.dispose();
    super.dispose();
  }
}
