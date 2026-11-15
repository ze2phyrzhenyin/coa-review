/**
 * 方框图页自带的部件：译码菱形。台面上一块转了 45° 的方片，上面立着「译码」两个字。
 * 教材图 5.15 里菱形表示按操作码分支，依附在取指方框后面，不占 CPU 周期。
 */
import { Mesh } from 'three';
import { Card, Part, blockGeometry, definePart, rebound, sizes, solid } from '../../scene/define';
import type { Animate, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface DiamondProps extends CommonProps {
  text: string;
  /** 已经画出来。没画时是一块淡色的底。 */
  drawn: boolean;
}

class Diamond extends Part<DiamondProps> {
  private readonly slab: Mesh;
  private readonly card: Card;
  constructor(kit: Kit, id: string, position: Vec2, props: DiamondProps) {
    super(kit, id, position);
    this.footprint = { w: 2.0, d: 1.5 };
    this.slab = solid(new Mesh(blockGeometry(1.45, 0.14, 1.45, 0.03), kit.mats.plinth));
    this.slab.rotation.y = Math.PI / 4;
    this.slab.scale.set(1, 1, 1);
    this.group.add(this.slab);
    this.card = new Card(kit, props.text, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.card.group.position.set(0, sizes.chipHeight / 2, 0);
    this.face.position.set(0, 0.16, 0);
    this.face.add(this.card.group);
    this.faceHeight = sizes.chipHeight;
    this.faceWidth = 1.2;
    this.update(props, false);
  }
  protected apply(next: DiamondProps, previous: DiamondProps | null, animate: Animate): void {
    this.slab.material = next.drawn ? this.kit.mats.block : this.kit.mats.plinth;
    this.card.group.visible = next.drawn;
    if (this.card.text !== next.text) this.card.set(next.text);
    if (animate && previous && next.drawn && !previous.drawn) {
      rebound(this.kit, this.slab, -0.06);
      this.kit.sound('click');
    }
  }
  override dispose(): void {
    this.card.dispose();
    super.dispose();
  }
}

definePart('5-flow:diamond', (kit, id, position, props) => new Diamond(kit, id, position, props as unknown as DiamondProps));
