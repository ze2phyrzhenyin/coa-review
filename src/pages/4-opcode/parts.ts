/**
 * 扩展操作码页自带的部件：一层抽屉柜。柜顶立着「用掉」的编码牌；柜里一格抽屉装「留作扩展」的码，
 * open 时抽屉真的朝观看的人拉出来，码牌跟着抽屉走。下一层的操作码就以这格抽屉里的码开头。
 */
import { Group, Mesh, Vector3 } from 'three';
import { Card, Part, blockGeometry, definePart, easeOut, rebound, sizes, solid } from '../../scene/define';
import type { Animate, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface CabinetProps extends CommonProps {
  /** 用掉的码：起、止、个数。空串是还没排。 */
  used: [string, string, string];
  /** 留作扩展的码：起、止、个数。 */
  kept: [string, string, string];
  /** 抽屉拉出来。 */
  open: boolean;
  /** 最后一类没有扩展抽屉要用，抽屉名牌不写。 */
  last: boolean;
  /** 一格码牌的宽度。 */
  codeWidth: number;
  /** 手机：起、止分两行。 */
  narrow: boolean;
  /** 这一步变了哪一格：'used'、'kept'。 */
  fresh: string[];
}

const DEPTH_WIDE = 1.7;
const DEPTH_NARROW = 2.9;
const PULL = 1.35;
const COUNT_W = 1.25;

class Row {
  readonly face = new Group();
  readonly chip: Card;
  readonly from: Card;
  readonly to: Card;
  readonly count: Card;
  constructor(kit: Kit, name: string, codeWidth: number, narrow: boolean) {
    const h = sizes.tileHeight * 0.86;
    const make = (width: number) => new Card(kit, '', { kind: 'slot', width, height: h, size: sizes.value * 0.92, mono: true });
    this.chip = new Card(kit, name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.from = make(codeWidth);
    this.to = make(codeWidth);
    this.count = make(COUNT_W);
    const gap = 0.06;
    if (narrow) {
      const total = codeWidth + gap + COUNT_W;
      this.from.group.position.set(-total / 2 + codeWidth / 2, h * 1.5 + gap, 0);
      this.count.group.position.set(total / 2 - COUNT_W / 2, h * 1.5 + gap, 0);
      this.to.group.position.set(-total / 2 + codeWidth / 2, h / 2, 0);
      this.chip.group.position.set(-total / 2 + this.chip.width / 2, h * 2 + gap * 2 + sizes.chipHeight / 2, 0);
    } else {
      const total = codeWidth * 2 + COUNT_W + gap * 2;
      this.from.group.position.set(-total / 2 + codeWidth / 2, h / 2, 0);
      this.to.group.position.set(-total / 2 + codeWidth * 1.5 + gap, h / 2, 0);
      this.count.group.position.set(total / 2 - COUNT_W / 2, h / 2, 0);
      this.chip.group.position.set(-total / 2 + this.chip.width / 2, h + gap + sizes.chipHeight / 2, 0);
    }
    this.face.add(this.chip.group, this.from.group, this.to.group, this.count.group);
  }
  set(values: [string, string, string], narrow: boolean, animate: Animate, fresh: boolean): void {
    const texts = [values[0], values[1] === '' ? '' : narrow ? `～${values[1]}` : values[1], values[2]];
    [this.from, this.to, this.count].forEach((card, i) => {
      const text = texts[i]!;
      const kind = text === '' ? 'slot' : 'tile';
      if (card.text !== text) {
        if (animate) card.flipTo(text, i * 40, kind);
        else {
          card.set(text);
          card.setKind(kind);
        }
      }
      card.setChanged(fresh && text !== '');
    });
  }
  dispose(): void {
    for (const card of [this.chip, this.from, this.to, this.count]) card.dispose();
  }
}

class Cabinet extends Part<CabinetProps> {
  private readonly drawer = new Group();
  private readonly used: Row;
  private readonly kept: Row;
  private readonly width: number;
  private readonly rowHeight: number;

  constructor(kit: Kit, id: string, position: Vec2, props: CabinetProps) {
    super(kit, id, position);
    const narrow = props.narrow;
    const DEPTH = narrow ? DEPTH_NARROW : DEPTH_WIDE;
    this.width = (narrow ? props.codeWidth + COUNT_W : props.codeWidth * 2 + COUNT_W) + 0.5;
    this.rowHeight = (narrow ? 2 : 1) * sizes.tileHeight * 0.86 + sizes.chipHeight + 0.2;
    this.footprint = { w: this.width, d: DEPTH };
    // 柜体，和里面一格抽屉。
    this.group.add(solid(new Mesh(blockGeometry(this.width, 0.62, DEPTH), kit.mats.block)));
    const tray = solid(new Mesh(blockGeometry(this.width - 0.24, 0.4, DEPTH - 0.1), kit.mats.plinth));
    tray.position.set(0, 0.06, 0.08);
    const front = solid(new Mesh(blockGeometry(this.width - 0.16, 0.5, 0.12), kit.mats.block));
    front.position.set(0, 0.03, DEPTH / 2 + 0.04);
    this.drawer.add(tray, front);
    this.group.add(this.drawer);
    // 「用掉」的牌立在柜顶靠后；「扩展」的牌立在抽屉前沿，跟着抽屉走。
    this.used = new Row(kit, '用掉', props.codeWidth, narrow);
    this.face.position.set(0, 0.62, -DEPTH / 2 + 0.35);
    this.face.add(this.used.face);
    this.kept = new Row(kit, props.last ? '没用的码' : '留作扩展', props.codeWidth, narrow);
    this.kept.face.position.set(0, 0.5, DEPTH / 2 + 0.12);
    this.drawer.add(this.kept.face);
    kit.facing.add(this.kept.face);
    this.faceHeight = this.rowHeight;
    this.faceWidth = this.width;
    this.update(props, false);
  }

  protected apply(next: CabinetProps, previous: CabinetProps | null, animate: Animate): void {
    this.used.set(next.used, next.narrow, animate, next.fresh.includes('used'));
    this.kept.set(next.kept, next.narrow, animate, next.fresh.includes('kept'));
    const to = next.open ? PULL : 0;
    const from = this.drawer.position.z;
    if (Math.abs(from - to) < 1e-3) return;
    if (!animate || this.kit.reduced || !previous) {
      this.drawer.position.z = to;
      return;
    }
    // 抽屉拉开：先动（起因），落定时顿一下。
    this.kit.motion.add({
      duration: 420,
      ease: easeOut,
      update: (t) => (this.drawer.position.z = from + (to - from) * t),
      done: () => {
        this.drawer.position.z = to;
        if (to > 0) {
          rebound(this.kit, this.drawer, -0.05);
          this.kit.sound('thud');
        }
      },
    });
  }

  /** 第 0 行是用掉的码，第 1 行是抽屉里的码；列 0 起、1 止、2 个数。 */
  override cellAnchor(r: number, c: number): Vector3 | null {
    const row = r === 0 ? this.used : this.kept;
    const card = c === 2 ? row.count : c === 1 ? row.to : row.from;
    const out = new Vector3();
    card.group.getWorldPosition(out);
    // 抽屉拉开的目标位置（动画没走完时也按落点算）。
    if (r === 1) out.z += (this.props?.open ? PULL : 0) - this.drawer.position.z;
    return out;
  }

  override bounds() {
    const b = super.bounds();
    b.max.z += PULL + 0.3;
    return b;
  }

  override dispose(): void {
    this.kit.facing.delete(this.kept.face);
    this.used.dispose();
    this.kept.dispose();
    super.dispose();
  }
}

definePart('4-opcode:cabinet', (kit, id, position, props) => new Cabinet(kit, id, position, props as unknown as CabinetProps));
