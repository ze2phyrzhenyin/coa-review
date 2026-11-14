import { Group, Mesh } from 'three';
import { blockGeometry } from '../kit';
import type { Kit } from '../kit';
import { sizes } from '../theme';
import type { RegisterProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';

const LID_OPEN = -0.95;

/** 寄存器：一块实体，上面斜立着值牌，左上角是名牌。顶上有一块盖板：打入时掀开、合上「咔」一下。 */
export class Register extends Part<RegisterProps> {
  private readonly tile: Card;
  private readonly chip: Card;
  private readonly hinge = new Group();

  constructor(kit: Kit, id: string, position: Vec2, props: RegisterProps) {
    super(kit, id, position);
    const w = props.width ?? 2.4;
    const h = 0.4;
    const d = 1.2;
    this.footprint = { w, d };
    this.group.add(solid(new Mesh(blockGeometry(w, h, d), kit.mats.block)));
    // 盖板：铰链在后沿，平时合着贴在顶上。
    const lid = solid(new Mesh(blockGeometry(w - 0.22, 0.05, d - 0.5, 0.02), kit.mats.plinth));
    lid.position.set(0, 0, (d - 0.5) / 2);
    this.hinge.position.set(0, h, -d / 2 + 0.12);
    this.hinge.add(lid);
    this.group.add(this.hinge);
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
      if (animate === 'land') {
        this.tile.landTo(next.value);
        this.latch();
      }
      else if (animate === 'flip') this.tile.flipTo(next.value);
      else this.tile.set(next.value);
    }
    if (!previous || next.name !== previous.name) {
      this.chip.set(next.name);
      this.chip.group.position.x = -this.faceWidth / 2 + this.chip.width / 2;
    }
    this.tile.setChanged(!!next.changed);
  }

  /** 打入：盖板一下掀开，再合上，合上时略弹一下。 */
  private latch(): void {
    if (this.kit.reduced) return;
    const { hinge, kit } = this;
    kit.motion.add({
      duration: 90,
      update: (t) => (hinge.rotation.x = LID_OPEN * t),
      done: () =>
        kit.motion.add({
          duration: 200,
          ease: (t) => t,
          update: (t) => {
            // 合上，碰到顶面时回弹一点点。
            const close = 1 - (1 - t) ** 2;
            hinge.rotation.x = LID_OPEN * (1 - close) + (t > 0.7 ? -0.08 * Math.sin(((t - 0.7) / 0.3) * Math.PI) : 0);
          },
          done: () => {
            hinge.rotation.x = 0;
            kit.sound('latch');
          },
        }),
    });
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
