import { Box3, Group, Mesh, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { box, prismGeometry } from '../kit';
import type { Kit } from '../kit';
import { linear } from '../motion';
import { sizes, timing } from '../theme';
import type { SignalProps, Vec2 } from '../types';
import { Part } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { isOn } from './gate';

const WIDTH = 0.08;
const Y = 0.03;

interface Piece {
  idle: Mesh;
  live: Mesh;
  a: Vector3;
  b: Vector3;
  start: number;
  length: number;
}

/**
 * 信号线：两个部件之间一根带箭头、带名字的线（BR、BG、BS、INTR 这类握手信号）。
 * 有效时实色从起点往终点走一遍，箭头落定；无效时是淡色。路线由场景按两端的部件算好再交给它。
 */
export class Signal extends Part<SignalProps> {
  private pieces: Piece[] = [];
  private heads: Mesh[] = [];
  private readonly label = new Group();
  private readonly card: Card;
  private points: Vector3[] = [];
  private total = 0;
  private on = false;
  override cause = true;
  /** 由场景设置：按两端部件算出路线（世界坐标的折线）。 */
  resolve: (props: SignalProps) => Vector3[] = () => [];

  constructor(kit: Kit, id: string, position: Vec2, props: SignalProps) {
    super(kit, id, position);
    // 部件本身放在原点，线按世界坐标画。
    this.group.position.set(0, 0, 0);
    this.card = new Card(kit, props.text, { kind: 'tile', height: 0.42, size: sizes.note, mono: true, minWidth: 0.42 });
    this.card.group.position.set(0, 0.21, 0);
    this.label.add(this.card.group);
    this.group.add(this.label);
    kit.facing.add(this.label);
    this.props = props;
  }

  /** 场景建好别的部件后调用一次。 */
  connect(): void {
    if (!this.props) return;
    this.points = this.resolve(this.props);
    this.build(this.props);
    this.update(this.props, false);
  }

  private build(props: SignalProps): void {
    const ink = props.ink ?? 'ctrl';
    let start = 0;
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i]!;
      const b = this.points[i + 1]!;
      const length = a.distanceTo(b);
      if (length < 1e-4) continue;
      const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      const make = (material: MeshLambertMaterial, y: number) => {
        const mesh = box(material, alongX ? length : WIDTH, 0.02, alongX ? WIDTH : length);
        mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
        mesh.receiveShadow = true;
        this.group.add(mesh);
        return mesh;
      };
      const idle = make(this.kit.mats[`${ink}Idle`], Y);
      const live = make(this.kit.mats[ink], Y + 0.004);
      live.visible = false;
      this.pieces.push({ idle, live, a, b, start, length });
      start += length;
    }
    this.total = start;
    const heads = props.heads ?? 'end';
    const head = (at: Vector3, from: Vector3) => {
      const mesh = new Mesh(prismGeometry(0.3, 0.34, 0.06), this.kit.mats[`${ink}Idle`]);
      const dir = at.clone().sub(from).normalize();
      // 三角柱的尖朝 -z：转到线的方向。
      mesh.rotation.y = Math.atan2(-dir.x, -dir.z);
      mesh.position.copy(at).sub(dir.clone().multiplyScalar(0.12)).setY(Y);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.heads.push(mesh);
    };
    const n = this.points.length;
    if (n >= 2 && heads !== 'none') head(this.points[n - 1]!, this.points[n - 2]!);
    if (n >= 2 && heads === 'both') head(this.points[0]!, this.points[1]!);
    const at = this.pointAt(props.labelAt ?? 0.5);
    this.label.position.set(at.x, 0.06, at.z - 0.18);
  }

  private pointAt(t: number): Vector3 {
    const s = t * this.total;
    for (const piece of this.pieces) {
      if (s <= piece.start + piece.length) return piece.a.clone().lerp(piece.b, (s - piece.start) / piece.length);
    }
    return this.points[this.points.length - 1]?.clone() ?? new Vector3();
  }

  /** 实色画到全长的 p（0–1）。 */
  private reveal(p: number): void {
    const s = p * this.total;
    for (const piece of this.pieces) {
      const f = Math.max(0, Math.min(1, (s - piece.start) / piece.length));
      piece.live.visible = f > 0;
      const alongX = Math.abs(piece.b.x - piece.a.x) > Math.abs(piece.b.z - piece.a.z);
      const full = piece.length;
      if (alongX) piece.live.scale.x = Math.max(0.001, full * f);
      else piece.live.scale.z = Math.max(0.001, full * f);
      const mid = piece.a.clone().lerp(piece.b, f / 2);
      piece.live.position.set(mid.x, Y + 0.004, mid.z);
    }
    this.kit.invalidate();
  }

  protected apply(next: SignalProps, previous: SignalProps | null, animate: Animate): void {
    if (this.pieces.length === 0) return;
    const ink = next.ink ?? 'ctrl';
    const on = isOn(next.on);
    if (!previous || next.text !== previous.text) this.card.set(next.text);
    // 没有名字的线不立空牌。
    this.label.visible = next.text !== '';
    this.card.setChanged(!!next.changed);
    if (on === this.on && previous) return;
    this.on = on;
    const heads = () => {
      for (const head of this.heads) head.material = on ? this.kit.mats[ink] : this.kit.mats[`${ink}Idle`];
    };
    if (!on || !animate || this.kit.reduced) {
      this.reveal(on ? 1 : 0);
      heads();
      return;
    }
    this.reveal(0);
    this.kit.motion.add({
      duration: Math.max(timing.cause, Math.min(520, this.total * 70)),
      ease: linear,
      update: (t) => this.reveal(t),
      done: () => {
        this.reveal(1);
        heads();
        this.kit.sound('click');
      },
    });
  }

  override get center(): Vector3 {
    return this.points.length ? this.pointAt(0.5) : new Vector3();
  }

  override bounds(): Box3 {
    const box = new Box3();
    for (const point of this.points) box.expandByPoint(point);
    if (box.isEmpty()) box.set(new Vector3(), new Vector3());
    box.expandByVector(new Vector3(0.3, 0, 0.3));
    box.min.z -= 0.4;
    box.max.y = 0.7;
    return box;
  }

  override anchor(): Vector3 {
    return this.label.position.clone().setY(0.3);
  }

  /** 信号线不垫焦点纸、不画四个角：线本身变实色就是标记。 */
  override setMarks(): void {}

  override shake(): void {
    if (this.kit.reduced) return;
    const z = this.label.position.z;
    this.kit.motion.add({ duration: timing.shake, ease: linear, update: (t) => (this.label.position.z = z + Math.sin(t * Math.PI * 6) * 0.06 * (1 - t)), done: () => (this.label.position.z = z) });
  }

  override dispose(): void {
    this.kit.facing.delete(this.label);
    this.card.dispose();
    super.dispose();
  }
}
