/**
 * 部件样张里的「页面自带部件」示例：一盏指示灯。写法和页面自己的 parts.ts 一样，
 * 由 SceneSpec.kinds 按需加载，模块一加载就登记。
 */
import { Mesh } from 'three';
import { Card, Part, blockGeometry, definePart, discGeometry, rebound, sizes, solid } from '../scene/define';
import type { Animate, Kit } from '../scene/define';
import type { CommonProps, Vec2 } from '../scene';

export interface LampProps extends CommonProps {
  name: string;
  /** 亮着。 */
  on: boolean;
}

class Lamp extends Part<LampProps> {
  private readonly bulb: Mesh;
  private readonly chip: Card;

  constructor(kit: Kit, id: string, position: Vec2, props: LampProps) {
    super(kit, id, position);
    this.footprint = { w: 1.2, d: 1.2 };
    this.group.add(solid(new Mesh(blockGeometry(1.2, 0.2, 1.2), kit.mats.block)));
    this.bulb = solid(new Mesh(discGeometry(), kit.mats.plinth));
    this.bulb.scale.set(0.7, 0.16, 0.7);
    this.bulb.position.y = 0.28;
    this.group.add(this.bulb);
    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.chip.group.position.set(0, sizes.chipHeight / 2, 0);
    this.face.position.set(0, 0.2, 0.75);
    this.face.add(this.chip.group);
    this.faceHeight = sizes.chipHeight;
    this.update(props, false);
  }

  protected apply(next: LampProps, previous: LampProps | null, animate: Animate): void {
    this.bulb.material = next.on ? this.kit.mats.accent : this.kit.mats.plinth;
    if (animate && previous && next.on && !previous.on) {
      rebound(this.kit, this.bulb, -0.08);
      this.kit.sound('click');
    }
  }

  override dispose(): void {
    this.chip.dispose();
    super.dispose();
  }
}

definePart('gallery:lamp', (kit, id, position, props) => new Lamp(kit, id, position, props as unknown as LampProps));
