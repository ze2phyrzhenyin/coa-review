/**
 * 2-mul、2-div 共用的页面自带部件：一格一张翻片（位格）。
 * 比内置的 bits 窄，几十格排成方阵时互不相碰；底座分三种：
 *   bit   浅色底座，放位积、操作数、积的各位；
 *   fa    深色底座，全加器：翻片是这个全加器的和；
 *   carry 没有底座的小牌，进位 1 用强调色，进位 0 是白牌。
 * drop 为真时，从空槽变出数的那一下从上方落进格子（位积一行行落下）；否则原地翻面。
 * overflow 变为真时崩出碎片并轻摇（商的整数位放不下 1）。
 * 由 SceneSpec.kinds 按需加载；画面只取决于属性。
 */
import { Mesh, Vector3 } from 'three';
import { Card, Part, blockGeometry, burst, definePart, easeOut, rebound, sizes, solid } from '../../scene/define';
import type { Animate, CardKind, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface CellProps extends CommonProps {
  /** '0'、'1'，其余（空串、空格）是还没写的空槽。 */
  bits: string;
  variant?: 'bit' | 'fa' | 'carry';
  drop?: boolean;
  overflow?: boolean;
}

/** 底座宽、深；牌宽。格距 0.7 以上时相邻两格不相碰。 */
export const CELL = { w: 0.62, d: 0.76, tile: 0.5, carry: 0.42 };

const look = (bit: string | undefined, variant: CellProps['variant']): { text: string; kind: CardKind } => {
  if (bit === '1') return { text: '1', kind: variant === 'carry' ? 'accent' : 'chip' };
  if (bit === '0') return { text: '0', kind: 'tile' };
  return { text: '', kind: 'slot' };
};

class Cell extends Part<CellProps> {
  private readonly tile: Card;
  private readonly variant: NonNullable<CellProps['variant']>;
  private readonly rest: number;

  constructor(kit: Kit, id: string, position: Vec2, props: CellProps) {
    super(kit, id, position);
    this.variant = props.variant ?? 'bit';
    const small = this.variant === 'carry';
    if (small) {
      this.footprint = { w: CELL.carry, d: 0.36 };
      this.face.position.set(0, 0.02, 0);
    } else {
      const h = this.variant === 'fa' ? 0.26 : 0.2;
      this.footprint = { w: CELL.w, d: CELL.d };
      this.group.add(solid(new Mesh(blockGeometry(CELL.w, h, CELL.d, 0.05), this.variant === 'fa' ? kit.mats.plinth : kit.mats.block)));
      this.face.position.set(0, h + 0.02, 0.12);
    }
    const height = small ? CELL.carry : sizes.tileHeight;
    const first = look(props.bits[0], this.variant);
    this.tile = new Card(kit, first.text, { kind: first.kind, width: small ? CELL.carry : CELL.tile, height, size: small ? 0.31 : 0.38, mono: true, weight: 600 });
    this.rest = height / 2;
    this.tile.group.position.set(0, this.rest, 0);
    // 翻位片作答时点到这张牌，算第 0 位。
    this.tile.group.traverse((object) => (object.userData.bit = 0));
    this.face.add(this.tile.group);
    this.faceHeight = height;
    this.faceWidth = small ? CELL.carry : CELL.tile;
    this.update(props, false);
  }

  protected apply(next: CellProps, previous: CellProps | null, animate: Animate): void {
    const { text, kind } = look(next.bits[0], this.variant);
    if (text !== this.tile.text || !previous) {
      const before = this.tile.text;
      if (!animate || this.kit.reduced) {
        this.tile.set(text);
        this.tile.setKind(kind);
      } else if (animate === 'land') {
        this.tile.landTo(text);
        this.tile.setKind(kind);
        this.kit.sound('flip');
      } else if (next.drop && before === '' && text !== '') {
        this.fall(text, kind);
      } else {
        this.tile.flipTo(text, 0, kind);
      }
    }
    this.tile.setChanged(!!next.changed);
    if (animate && next.overflow && !previous?.overflow) {
      burst(this.kit, this.group, new Vector3(0, this.face.position.y + this.rest * 1.6, this.face.position.z));
      this.kit.sound('crash');
      this.shake();
    }
  }

  /** 从上方落进格子：落定时压一下。 */
  private fall(text: string, kind: CardKind): void {
    const { tile, kit } = this;
    tile.set(text);
    tile.setKind(kind);
    const top = this.rest + 1.1;
    tile.group.position.y = top;
    kit.motion.add({
      duration: 360,
      ease: easeOut,
      update: (t) => {
        tile.group.position.y = top + (this.rest - top) * t;
        kit.invalidate();
      },
      done: () => {
        tile.group.position.y = this.rest;
        rebound(kit, tile.group, 0.04);
      },
    });
  }

  override anchor() {
    return this.faceToWorld(0, this.rest);
  }

  override dispose(): void {
    this.tile.dispose();
    super.dispose();
  }
}

definePart('2-mul:cell', (kit, id, position, props) => new Cell(kit, id, position, props as unknown as CellProps));
