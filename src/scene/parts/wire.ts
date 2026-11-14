import { Group, Mesh, Vector3 } from 'three';
import { box, discGeometry } from '../kit';
import type { Kit } from '../kit';
import type { Ink } from '../theme';
import type { Side } from './base';

const Y = 0.016;
const THICK = 0.026;

/** 从接点 a 到接点 b 的走线：只走横竖两个方向。 */
export function route(a: { point: Vector3; side: Side }, b: { point: Vector3; side: Side }, via: Vector3[]): Vector3[] {
  if (via.length) return [a.point, ...via, b.point];
  const p = a.point;
  const q = b.point;
  const eps = 0.02;
  if (Math.abs(p.x - q.x) < eps || Math.abs(p.z - q.z) < eps) return [p, q];
  const aVertical = a.side === 'n' || a.side === 's';
  const bVertical = b.side === 'n' || b.side === 's';
  if (aVertical && bVertical) {
    const z = (p.z + q.z) / 2;
    return [p, new Vector3(p.x, 0, z), new Vector3(q.x, 0, z), q];
  }
  if (!aVertical && !bVertical) {
    const x = (p.x + q.x) / 2;
    return [p, new Vector3(x, 0, p.z), new Vector3(x, 0, q.z), q];
  }
  return aVertical ? [p, new Vector3(p.x, 0, q.z), q] : [p, new Vector3(q.x, 0, p.z), q];
}

/**
 * 连线：贴在台面上的窄条。三种墨色同时用三种线型区分：数据是实线，地址是双线，控制是虚线。
 * 没有值走过时是淡色，这一步有值走过时是实色。
 */
export class Wire {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private active = false;

  constructor(
    private readonly kit: Kit,
    readonly id: string,
    readonly points: Vector3[],
    readonly ink: Ink,
  ) {
    const width = ink === 'ctrl' ? 0.07 : 0.14;
    const material = kit.mats[`${ink}Idle`];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const length = a.distanceTo(b);
      if (length < 1e-4) continue;
      const alongX = Math.abs(b.x - a.x) > Math.abs(b.z - a.z);
      const place = (from: number, to: number) => {
        const piece = box(material, alongX ? to - from : width, THICK, alongX ? width : to - from);
        const mid = (from + to) / 2 / length;
        piece.position.set(a.x + (b.x - a.x) * mid, Y, a.z + (b.z - a.z) * mid);
        piece.receiveShadow = true;
        this.meshes.push(piece);
        this.group.add(piece);
      };
      if (ink === 'ctrl') {
        const dash = 0.2;
        const gap = 0.13;
        const count = Math.max(1, Math.round((length + gap) / (dash + gap)));
        const step = (length + gap) / count;
        for (let k = 0; k < count; k++) place(k * step, k * step + step - gap);
      } else {
        place(0, length);
      }
      if (ink === 'addr') {
        // 中间一道台面色的细线，把实线分成双线。
        const groove = box(kit.mats.paper, alongX ? length : 0.04, THICK, alongX ? 0.04 : length);
        groove.position.set((a.x + b.x) / 2, Y + 0.002, (a.z + b.z) / 2);
        this.group.add(groove);
      }
    }
    if (ink !== 'ctrl') {
      // 拐点和两端用圆片收口，线宽处处一致。
      for (const point of points) {
        const joint = new Mesh(discGeometry(), material);
        joint.scale.set(width, THICK, width);
        joint.position.set(point.x, Y, point.z);
        joint.receiveShadow = true;
        this.meshes.push(joint);
        this.group.add(joint);
      }
    }
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    const material = active ? this.kit.mats[this.ink] : this.kit.mats[`${this.ink}Idle`];
    for (const mesh of this.meshes) mesh.material = material;
    // 实色的线略高一点，和重叠的淡色线不打架。
    this.group.position.y = active ? 0.004 : 0;
    this.kit.invalidate();
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
