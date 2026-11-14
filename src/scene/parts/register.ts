import { Mesh } from 'three';
import { blockGeometry } from '../kit';
import type { Kit } from '../kit';
import { sizes } from '../theme';
import type { RegisterProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';

/** 寄存器：一块实体，上面斜立着值牌，左上角是名牌。 */
export class Register extends Part<RegisterProps> {
  private readonly tile: Card;
  private readonly chip: Card;

  constructor(kit: Kit, id: string, position: Vec2, props: RegisterProps) {
    super(kit, id, position);
    const w = props.width ?? 2.4;
    const h = 0.4;
    const d = 1.2;
    this.footprint = { w, d };
    this.group.add(solid(new Mesh(blockGeometry(w, h, d), kit.mats.block)));
    const tileWidth = w - 0.3;
    this.tile = new Card(kit, props.value, { kind: 'tile', width: tileWidth, height: sizes.tileHeight, size: sizes.value, mono: true });
    this.tile.group.position.set(0, sizes.tileHeight / 2, 0);
    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.chip.group.position.set(-tileWidth / 2 + this.chip.width / 2, sizes.tileHeight + 0.04 + sizes.chipHeight / 2, 0);
    this.face.position.set(0, h + 0.03, 0.3);
    this.face.add(this.tile.group, this.chip.group);
    this.faceHeight = sizes.tileHeight + 0.04 + sizes.chipHeight;
    this.faceWidth = tileWidth;
    this.update(props, false);
  }

  protected apply(next: RegisterProps, previous: RegisterProps | null, animate: Animate): void {
    if (!previous || next.value !== previous.value) {
      if (animate === 'land') this.tile.landTo(next.value);
      else if (animate === 'flip') this.tile.flipTo(next.value);
      else this.tile.set(next.value);
    }
    if (!previous || next.name !== previous.name) {
      this.chip.set(next.name);
      this.chip.group.position.x = -this.faceWidth / 2 + this.chip.width / 2;
    }
    this.tile.setChanged(!!next.changed);
  }

  override anchor() {
    return this.faceToWorld(0, sizes.tileHeight / 2);
  }

  override dispose(): void {
    this.tile.dispose();
    this.chip.dispose();
    super.dispose();
  }
}
