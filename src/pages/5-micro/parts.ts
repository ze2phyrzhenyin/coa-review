/**
 * 页面自带部件：多路开关（图 5.21 里 ALU 的 X、Y 两个输入端）。
 * 一块底座上并排几个输入口，每个口写着接哪个寄存器；被微命令选中的口翻成深色、略往下按，
 * 输入线从前沿（朝寄存器的一边）各口接进来，输出从后沿接到 ALU。只由 props 决定画面。
 */
import { Mesh, Vector3 } from 'three';
import { Card, Part, blockGeometry, definePart, rebound, sizes, solid } from '../../scene/define';
import type { Animate, Kit, Side } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface MuxProps extends CommonProps {
  /** 名牌，例如 'X'。 */
  name: string;
  /** 输入口，从左到右，例如 ['DR', 'R1', 'R2']。 */
  inputs: string[];
  /** 选中的输入口，空串表示都没选。 */
  selected: string;
}

const PITCH = 0.86;
const SLOT = 0.74;

class Mux extends Part<MuxProps> {
  private readonly slots: Card[] = [];
  private readonly keys: Mesh[] = [];
  private readonly chip: Card;
  private readonly inputs: string[];

  constructor(kit: Kit, id: string, position: Vec2, props: MuxProps) {
    super(kit, id, position);
    this.inputs = props.inputs;
    const n = props.inputs.length;
    const width = n * PITCH + 0.3;
    const depth = 0.9;
    this.footprint = { w: width, d: depth };
    this.group.add(solid(new Mesh(blockGeometry(width, 0.24, depth), kit.mats.block)));
    props.inputs.forEach((name, i) => {
      const x = this.slotX(i);
      // 每个口一个小按键，选中时按下去。
      const key = solid(new Mesh(blockGeometry(SLOT - 0.08, 0.1, 0.36, 0.03), kit.mats.plinth));
      key.position.set(x, 0.29, -0.14);
      this.group.add(key);
      this.keys.push(key);
      const card = new Card(kit, name, { kind: 'tile', width: SLOT, height: sizes.chipHeight, size: sizes.name, mono: true, weight: 600 });
      card.group.position.set(x, sizes.chipHeight / 2, 0);
      this.face.add(card.group);
      this.slots.push(card);
    });
    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.5 });
    this.chip.group.position.set(-width / 2 - 0.1 - this.chip.width / 2, sizes.chipHeight / 2, 0);
    this.face.add(this.chip.group);
    this.face.position.set(0, 0.27, 0.22);
    this.faceHeight = sizes.chipHeight;
    this.faceWidth = width + this.chip.width * 2 + 0.2;
    this.update(props, false);
  }

  private slotX(i: number): number {
    return (i - (this.inputs.length - 1) / 2) * PITCH;
  }

  protected apply(next: MuxProps, previous: MuxProps | null, animate: Animate): void {
    this.inputs.forEach((name, i) => {
      const on = next.selected === name;
      const was = previous?.selected === name;
      const card = this.slots[i]!;
      if (animate && previous && on !== was) card.flipTo(name, 0, on ? 'chip' : 'tile');
      else card.setKind(on ? 'chip' : 'tile');
      card.setChanged(on && !!next.changed);
      const key = this.keys[i]!;
      key.position.y = on ? 0.23 : 0.29;
      key.material = on ? this.kit.mats.data : this.kit.mats.plinth;
      if (on && !was && animate) rebound(this.kit, key, -0.04);
    });
    if (animate && previous && next.selected && next.selected !== previous.selected) this.kit.sound('click');
  }

  /** 输入口：'X.R1' 接在那个口的后沿。 */
  override pin(name: string): { point: Vector3; side: Side } | null {
    const i = this.inputs.indexOf(name);
    if (i < 0) return null;
    const { d } = this.footprint;
    return { point: new Vector3(this.center.x + this.slotX(i), 0, this.center.z + d / 2), side: 's' };
  }

  override dispose(): void {
    for (const card of this.slots) card.dispose();
    this.chip.dispose();
    super.dispose();
  }
}

definePart('5-micro:mux', (kit, id, position, props) => new Mux(kit, id, position, props as unknown as MuxProps));
