import { Box3, ExtrudeGeometry, Group, Mesh, Shape, Vector3 } from 'three';
import { TextPlane, blockGeometry, box, discGeometry } from '../kit';
import type { Kit } from '../kit';
import { arrive } from '../motion';
import { sizes, timing } from '../theme';
import type { DialProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { burst, rebound } from './effects';
import { isOn } from './gate';

const TOP = 0.16;

/** 第 k 格的角度：0 在正上方（远离观看者），顺时针。 */
const angleOf = (k: number, size: number) => (2 * Math.PI * k) / size;
const onRing = (theta: number, r: number) => new Vector3(Math.sin(theta) * r, 0, -Math.cos(theta) * r);

/** 扇形（平放，y 向上为厚度）。 */
function wedge(r0: number, r1: number, a0: number, a1: number, depth: number): ExtrudeGeometry {
  // 平面坐标 (x, y) 对应台面 (x, -z)：先在 xy 平面画，再转到台面上。
  const shape = new Shape();
  const p = (r: number, a: number) => [Math.sin(a) * r, Math.cos(a) * r] as const;
  shape.moveTo(...p(r0, a0));
  shape.lineTo(...p(r1, a0));
  const steps = 10;
  for (let i = 1; i <= steps; i++) shape.lineTo(...p(r1, a0 + ((a1 - a0) * i) / steps));
  shape.lineTo(...p(r0, a1));
  for (let i = steps - 1; i >= 0; i--) shape.lineTo(...p(r0, a0 + ((a1 - a0) * i) / steps));
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * 刻度盘：模 2^n 的一圈。指针指当前的数，加法是指针顺时针转过的格数，转过的那段画成弧。
 * 接缝在 +最大 和 −最小 之间：指针越过它就是溢出，接缝亮起强调色并崩一下。
 * sectors 为真时是节拍盘：每格一块扇形，当前那格亮起。
 */
export class Dial extends Part<DialProps> {
  private readonly radius: number;
  private readonly size: number;
  private readonly needle = new Group();
  private readonly arc = new Group();
  private readonly sectors: Mesh[] = [];
  private readonly texts: TextPlane[] = [];
  private readonly holders: Group[] = [];
  private seam: Mesh | null = null;
  private readonly chip: Card | null = null;
  private angle = 0;
  private lit = -1;

  constructor(kit: Kit, id: string, position: Vec2, props: DialProps) {
    super(kit, id, position);
    this.size = props.size;
    // 节拍盘是起因：换拍先亮，打入动作接着发生。
    this.cause = !!props.sectors;
    const marks = props.marks ?? [];
    this.radius = props.radius ?? (props.sectors ? 1.05 : Math.max(1.4, (marks.length * 0.9) / (2 * Math.PI)));
    const R = this.radius;
    this.footprint = { w: R * 2 + 0.2, d: R * 2 + 0.2 };
    const plate = solid(new Mesh(discGeometry(), kit.mats.block));
    plate.scale.set(R * 2, TOP, R * 2);
    plate.position.y = TOP / 2;
    this.group.add(plate);
    if (props.sectors) {
      for (let k = 0; k < this.size; k++) {
        const a0 = angleOf(k - 0.5, this.size) + 0.03;
        const a1 = angleOf(k + 0.5, this.size) - 0.03;
        const piece = new Mesh(wedge(R * 0.28, R * 0.92, a0, a1, 0.05), kit.mats.plinth);
        piece.position.y = TOP;
        piece.receiveShadow = true;
        this.sectors.push(piece);
        this.group.add(piece);
      }
    } else {
      // 刻度：格数不多时每格一道，太多时只画有字的。
      const ticks = this.size <= 32 ? [...Array(this.size).keys()] : marks.map(([k]) => k);
      for (const k of ticks) {
        const theta = angleOf(k, this.size);
        const tick = box(kit.mats.line, 0.04, 0.02, 0.2);
        tick.position.copy(onRing(theta, R - 0.16)).setY(TOP + 0.01);
        tick.rotation.y = -theta;
        this.group.add(tick);
      }
      this.group.add(this.arc);
      // 指针：一根深色的针加一个轴帽。
      const arm = box(kit.mats.chip, 0.09, 0.06, R - 0.32);
      arm.position.set(0, TOP + 0.06, -(R - 0.32) / 2);
      arm.castShadow = true;
      const tip = new Mesh(blockGeometry(0.16, 0.06, 0.16, 0.03), kit.mats.chip);
      tip.position.set(0, TOP + 0.03, -(R - 0.3));
      tip.rotation.y = Math.PI / 4;
      const hub = new Mesh(discGeometry(), kit.mats.chip);
      hub.scale.set(0.26, 0.1, 0.26);
      hub.position.y = TOP + 0.06;
      this.needle.add(arm, tip, hub);
      this.group.add(this.needle);
    }
    if (props.seam !== undefined) {
      const theta = angleOf(props.seam - 0.5, this.size);
      this.seam = solid(new Mesh(blockGeometry(0.1, 0.1, R * 0.5, 0.02), kit.mats.plinth));
      this.seam.position.copy(onRing(theta, R * 0.73)).setY(TOP);
      this.seam.rotation.y = -theta;
      this.group.add(this.seam);
    }
    for (const [k, text] of marks) {
      const theta = angleOf(k, this.size);
      const plane = new TextPlane(kit, text, { size: sizes.note, tone: 'text', mono: true });
      plane.place(0, sizes.note * 0.7);
      const r = props.sectors ? R * 0.6 : R + 0.3;
      const holder = this.holder(onRing(theta, r).setY(props.sectors ? TOP + 0.06 : 0.04));
      // 盘外的字往外推一点，宽的字不压到盘边。
      if (!props.sectors) holder.position.x += Math.sin(theta) * plane.width * 0.42;
      // 接缝两边的字各自往外让开，+最大 和 −最小 挨着时不叠在一起。
      if (!props.sectors && props.seam !== undefined) {
        const seamTheta = angleOf(props.seam - 0.5, this.size);
        const gap = Math.abs(Math.atan2(Math.sin(theta - seamTheta), Math.cos(theta - seamTheta)));
        if (gap < 0.5) {
          const away = Math.sign(Math.sin(theta) - Math.sin(seamTheta)) || (k < props.seam ? 1 : -1);
          holder.position.x = Math.sin(theta) * r + away * (plane.width / 2 + 0.12);
        }
      }
      holder.add(plane.mesh);
      this.texts.push(plane);
    }
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      this.chip.group.position.set(0, sizes.chipHeight / 2, 0);
      // 名牌放在盘的正后方（最上面那格的字再往后），不和盘边的字抢地方。
      this.holder(new Vector3(0, 0.02, -R - (marks.length && !props.sectors ? 0.85 : 0.3))).add(this.chip.group);
    }
    this.update(props, false);
  }

  private holder(at: Vector3): Group {
    const group = new Group();
    group.position.copy(at);
    this.group.add(group);
    this.kit.facing.add(group);
    this.holders.push(group);
    return group;
  }

  /** 从 a 转到 b 的弧（角度，弧度），画在刻度里面一圈。 */
  private drawArc(a: number, b: number, ink: DialProps['ink']): void {
    for (const child of [...this.arc.children]) child.removeFromParent();
    const span = b - a;
    if (Math.abs(span) < 1e-3) return;
    const r = this.radius - 0.42;
    const steps = Math.max(2, Math.ceil(Math.abs(span) / 0.08));
    const material = this.kit.mats[ink ?? 'data'];
    for (let i = 0; i < steps; i++) {
      const t0 = a + (span * i) / steps;
      const t1 = a + (span * (i + 1)) / steps;
      const p0 = onRing(t0, r);
      const p1 = onRing(t1, r);
      const piece = box(material, 0.1, 0.03, p0.distanceTo(p1) + 0.02);
      piece.position.copy(p0.clone().lerp(p1, 0.5)).setY(TOP + 0.01);
      piece.rotation.y = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
      this.arc.add(piece);
    }
    this.kit.invalidate();
  }

  protected apply(next: DialProps, previous: DialProps | null, animate: Animate): void {
    if (this.sectors.length) {
      // 指针为负：哪一格都不亮（例如还没开始走节拍）。
      const k = next.pointer < 0 ? -1 : ((next.pointer % this.size) + this.size) % this.size;
      if (k !== this.lit) {
        const before = this.sectors[this.lit];
        const after = this.sectors[k];
        if (before) before.material = this.kit.mats.plinth;
        if (after) {
          after.material = this.kit.mats[next.ink ?? 'ctrl'];
          if (animate && previous) {
            rebound(this.kit, after, -0.06);
            this.kit.sound('click');
          }
        }
        this.lit = k;
      }
      return;
    }
    const dir = next.dir ?? 1;
    const target = angleOf(next.pointer, this.size);
    const start = next.from === undefined ? null : angleOf(next.from, this.size);
    // 转的终点：从起点沿 dir 方向转到 pointer。
    let end = target;
    if (start !== null) {
      end = start + ((((target - start) * dir) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * dir;
    }
    const crossed = isOn(next.crossed);
    const wasCrossed = !!previous && isOn(previous.crossed);
    const seamMat = crossed ? this.kit.mats.accent : this.kit.mats.plinth;
    const finish = () => {
      this.needle.rotation.y = -end;
      this.angle = end;
      if (start !== null) this.drawArc(start, end, next.ink);
      else this.drawArc(0, 0, next.ink);
      if (this.seam) this.seam.material = seamMat;
    };
    // 只有指针真的要换位置（或这一步换了起点）才转。
    const moving = !!animate && !this.kit.reduced && !!previous && (Math.abs(this.angle - end) > 1e-3 || (start !== null && previous.from !== next.from));
    if (!moving) {
      finish();
      return;
    }
    const from = start ?? this.angle;
    if (this.seam) this.seam.material = this.kit.mats.plinth;
    const seamAngle = next.seam === undefined ? null : angleOf(next.seam - 0.5, this.size);
    let flashed = false;
    this.kit.motion.add({
      duration: Math.max(timing.travelMin, Math.min(1100, Math.abs(end - from) * 260)),
      ease: arrive,
      update: (t) => {
        const now = from + (end - from) * t;
        this.needle.rotation.y = -now;
        if (start !== null) this.drawArc(start, now, next.ink);
        // 指针经过接缝的那一刻：接缝亮起，崩一下。
        if (crossed && !wasCrossed && !flashed && seamAngle !== null && this.seam && passes(from, now, seamAngle)) {
          flashed = true;
          this.seam.material = this.kit.mats.accent;
          burst(this.kit, this.group, this.seam.position.clone().setY(TOP + 0.1), 8);
          this.kit.sound('crash');
        }
      },
      done: () => {
        finish();
        rebound(this.kit, this.needle, 0.03);
      },
    });
  }

  override bounds(): Box3 {
    const box = super.bounds();
    const out = this.texts.length && !this.sectors.length ? 0.9 : 0.2;
    box.expandByVector(new Vector3(out, 0, out * 0.5));
    box.min.z -= this.chip ? 0.6 : 0;
    box.max.y = Math.max(box.max.y, 0.7);
    return box;
  }

  override dispose(): void {
    for (const group of this.holders) this.kit.facing.delete(group);
    for (const text of this.texts) text.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}

/** 从 a 转到 b（任意方向）时是否经过角度 s（模 2π）。 */
function passes(a: number, b: number, s: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (let k = -2; k <= 2; k++) {
    const x = s + k * 2 * Math.PI;
    if (x > lo && x <= hi) return true;
  }
  return false;
}
