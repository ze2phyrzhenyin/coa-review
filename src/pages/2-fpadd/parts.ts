/**
 * 尾数滑轨：一排位片固定在小数点两边，右边连着一个小盒子，对阶、规格化右移出去的位掉进盒子里，舍入时才用。
 * 新的位串和旧的只差整体挪了几格时，整排位片真的滑过去：右移时最右边的片落进盒子，左移时最左边的片滑出去。
 * 其余情况原地翻面。白面 0，深色面 1，与 bits 部件一致。
 * 由场景按需加载（SceneSpec.kinds），只在这里引用 three.js。
 */
import { Box3, Group, Mesh, Vector3 } from 'three';
import { Card, Part, TextPlane, arrive, blockGeometry, definePart, rebound, sizes, solid, timing } from '../../scene/define';
import type { Animate, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface TrackProps extends CommonProps {
  name: string;
  /** 尾数写法：11.110101、−1.010、10.001；空串是还没写。 */
  mant: string;
  /** 移出去、还没舍入的位。 */
  out: string;
  /** 小数点左边几格、右边几格、盒子几格。建好后不变。 */
  int: number;
  frac: number;
  box: number;
  /** 窄屏：盒子上的字写短。 */
  compact?: boolean;
}

const TILE = 0.5;
const PITCH = 0.56;
const DROP = 0.12;

/** 位串按小数点摆进固定的格子：左边不够补空，右边接盒子里的位。 */
export function stream(mant: string, out: string, int: number, frac: number, box: number): { sign: string; chars: string[] } {
  const sign = /^[−-]/.test(mant) ? '−' : '';
  const body = mant.replace(/^[−-]/, '');
  const [ip = '', fp = ''] = body.split('.');
  const chars = [...ip.padStart(int, ' ').slice(-int), ...fp.padEnd(frac, ' ').slice(0, frac), ...out.padEnd(box, ' ').slice(0, box)];
  return { sign, chars };
}

const look = (ch: string | undefined): { text: string; kind: 'tile' | 'chip' | 'slot' } => (ch === '1' ? { text: '1', kind: 'chip' } : ch === '0' ? { text: '0', kind: 'tile' } : { text: '', kind: 'slot' });

/** 新旧两串只差整体挪了 k 格时返回 k（正数右移，负数左移）；否则 0。 */
function shiftOf(a: string[], b: string[]): number {
  const z = (ch: string | undefined) => (ch === '1' ? '1' : '0');
  if (a.every((ch) => ch === ' ') || a.join('') === b.join('')) return 0;
  const n = a.length;
  for (let k = 1; k < n; k++) {
    let right = true;
    let left = true;
    for (let i = 0; i + k < n; i++) {
      if (z(b[i + k]) !== z(a[i])) right = false;
      if (z(b[i]) !== z(a[i + k])) left = false;
    }
    if (right) return k;
    if (left) return -k;
  }
  return 0;
}

class Track extends Part<TrackProps> {
  private readonly tiles: Card[] = [];
  private readonly xs: number[] = [];
  private readonly base: number[] = [];
  private readonly chip: Card;
  private readonly sign: TextPlane;
  private readonly extras: TextPlane[] = [];
  private chars: string[] = [];
  private readonly count: number;

  constructor(kit: Kit, id: string, position: Vec2, props: TrackProps) {
    super(kit, id, position);
    const { int, frac, box } = props;
    this.count = int + frac + box;
    const POINT = 0.22;
    const WALL = 0.34;
    let x = 0;
    for (let i = 0; i < this.count; i++) {
      if (i > 0) x += PITCH + (i === int ? POINT : 0) + (i === int + frac ? WALL : 0);
      this.xs.push(x);
    }
    const span = x;
    for (let i = 0; i < this.count; i++) this.xs[i] = this.xs[i]! - span / 2;
    const left = this.xs[0]! - TILE / 2 - 0.2;
    const boxLeft = this.xs[int + frac]! - TILE / 2 - 0.12;
    const right = this.xs[this.count - 1]! + TILE / 2 + 0.16;
    // 滑轨本体，盒子是右边一块矮一点的槽，中间一道挡板。
    const rail = solid(new Mesh(blockGeometry(boxLeft - left - 0.06, 0.3, 0.9), kit.mats.block));
    rail.position.x = (left + boxLeft - 0.06) / 2;
    this.group.add(rail);
    const tray = solid(new Mesh(blockGeometry(right - boxLeft, 0.16, 0.9), kit.mats.plinth));
    tray.position.x = (boxLeft + right) / 2;
    this.group.add(tray);
    const wall = solid(new Mesh(blockGeometry(0.08, 0.55, 0.9, 0.02), kit.mats.line));
    wall.position.x = boxLeft - 0.03;
    this.group.add(wall);
    this.footprint = { w: right - left, d: 0.9 };
    this.face.position.set(0, 0.33, 0.2);
    for (let i = 0; i < this.count; i++) {
      const tile = new Card(kit, '', { kind: 'slot', width: TILE, height: sizes.tileHeight, size: 0.38, mono: true, weight: 600 });
      const y = sizes.tileHeight / 2 - (i >= int + frac ? DROP : 0);
      tile.group.position.set(this.xs[i]!, y, 0);
      this.base.push(y);
      this.tiles.push(tile);
      this.face.add(tile.group);
    }
    // 小数点：小数点左右两格中间的一个圆点。
    const dot = new TextPlane(kit, '.', { size: 0.5, tone: 'text', weight: 700 });
    dot.place((this.xs[int - 1]! + this.xs[int]!) / 2, 0.02);
    this.face.add(dot.mesh);
    this.extras.push(dot);
    this.sign = new TextPlane(kit, '', { size: 0.42, tone: 'text', weight: 600, align: 'right' });
    this.sign.place(left - 0.05, sizes.tileHeight / 2 - 0.2);
    this.face.add(this.sign.mesh);
    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.chip.group.position.set(left - 0.42 - this.chip.width / 2, sizes.tileHeight / 2, 0);
    this.face.add(this.chip.group);
    const boxName = new TextPlane(kit, props.compact ? '移出' : '移出的位', { size: 0.31, tone: 'muted' });
    boxName.place((boxLeft + right) / 2, sizes.tileHeight + 0.12);
    // 「移出的位」比一格的小盒宽：边界要算上它，否则窄屏取景会把它裁掉。
    this.boxLabelRight = (boxLeft + right) / 2 + ((props.compact ? 2 : 4) * 0.31 * 1.15) / 2;
    this.face.add(boxName.mesh);
    this.extras.push(boxName);
    this.faceHeight = sizes.tileHeight + 0.2;
    this.faceWidth = this.footprint.w + this.chip.width * 2 + 1.2;
    this.update(props, false);
  }

  private boxLabelRight = 0;

  override bounds(): Box3 {
    const box3 = super.bounds();
    box3.min.x = this.center.x + this.xs[0]! - TILE / 2 - this.chip.width - 1.0;
    box3.max.x = this.center.x + Math.max(this.xs[this.count - 1]! + TILE / 2, this.boxLabelRight) + 0.3;
    return box3;
  }

  private paint(chars: string[], changed: boolean, flip: boolean, prev: string[]): void {
    chars.forEach((ch, i) => {
      const tile = this.tiles[i]!;
      const face = look(ch);
      if (tile.text === face.text) {
        tile.setKind(face.kind);
      } else if (flip) tile.flipTo(face.text, (chars.length - i) * timing.stagger * 0.5, face.kind);
      else {
        tile.set(face.text);
        tile.setKind(face.kind);
      }
      tile.setChanged(changed && ch !== ' ' && ch !== prev[i]);
    });
  }

  protected apply(next: TrackProps, previous: TrackProps | null, animate: Animate): void {
    const { sign, chars } = stream(next.mant, next.out, next.int, next.frac, next.box);
    this.sign.set(sign);
    const old = this.chars.length ? this.chars : chars.map(() => ' ');
    const k = animate && previous && !this.kit.reduced ? shiftOf(old, chars) : 0;
    if (!k) {
      this.paint(chars, !!next.changed, !!animate && !!previous, old);
      this.chars = chars;
      return;
    }
    // 整排滑 k 格：出了右边的片落进盒子，出了两头的片淡出；滑完按新的位串摆好。
    const from = this.tiles.map((tile) => tile.group.position.x);
    const fromY = this.tiles.map((tile) => tile.group.position.y);
    const steps = Math.abs(k);
    this.kit.motion.add({
      duration: Math.max(timing.travelMin, Math.min(timing.travelMax, 260 + steps * 160)),
      ease: arrive,
      update: (t) => {
        this.tiles.forEach((tile, i) => {
          const j = i + k;
          const tx = j >= 0 && j < this.count ? this.xs[j]! : this.xs[i]! + k * PITCH;
          const ty = j >= 0 && j < this.count ? this.base[j]! : this.base[i]! - 0.4;
          tile.group.position.x = from[i]! + (tx - from[i]!) * t;
          tile.group.position.y = fromY[i]! + (ty - fromY[i]!) * t;
        });
      },
      done: () => {
        this.tiles.forEach((tile, i) => {
          tile.group.position.x = this.xs[i]!;
          tile.group.position.y = this.base[i]!;
        });
        this.paint(chars, !!next.changed, false, old);
        this.chars = chars;
        rebound(this.kit, this.face, 0.03);
        this.kit.sound('flip');
      },
    });
    this.chars = chars;
  }

  override dispose(): void {
    for (const tile of this.tiles) tile.dispose();
    this.chip.dispose();
    this.sign.dispose();
    for (const text of this.extras) text.dispose();
    super.dispose();
  }
}

definePart('2-fpadd:track', (kit, id, position, props) => new Track(kit, id, position, props as unknown as TrackProps));
