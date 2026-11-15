/**
 * 码盘：n+1 位机器码的全部 2^(n+1) 种写法排成一圈（0 在正上方，顺时针），盘边写出这一种码把几个关键格子读成多少。
 * 指针指 x 的机器码所在的格子；写不出时没有指针，盘心放一张「无」。0 有两种写法的码多一根浅色的针。
 * 负数占的那半圈在刻度里面垫一条深色的带：原码、反码、补码是后半圈，移码是前半圈。
 * 由场景按需加载（SceneSpec.kinds），只在这里引用 three.js。
 */
import { Box3, ExtrudeGeometry, Group, Mesh, Shape, Vector3 } from 'three';
import { Card, Part, TextPlane, arrive, blockGeometry, box, definePart, discGeometry, rebound, sizes, solid, timing } from '../../scene/define';
import type { Animate, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface RingProps extends CommonProps {
  name: string;
  /** 一圈几格：2^(n+1)。 */
  size: number;
  /** 盘边的字：[格, 字, 加粗]。建好后不变。 */
  marks: [number, string, boolean?][];
  /** 负数占的格：[起, 格数]。建好后不变。 */
  neg: [number, number];
  /** 指针指的格；-1 没有指针。 */
  pointer: number;
  /** 第二根浅色的针（0 的另一种写法）；-1 没有。 */
  ghost: number;
  /** 盘下面的读数，空串不显示。 */
  reading: string;
  /** 没有指针时盘心的字。 */
  empty: string;
  /** 这一步从哪一格转过来（画一段弧）；-1 不画。 */
  from: number;
  /** 1 顺时针，-1 逆时针。 */
  dir: number;
  /** 读数放在盘的下面（窄屏）。建好后不变。 */
  below?: boolean;
}

const TOP = 0.16;
const angleOf = (k: number, size: number) => (2 * Math.PI * k) / size;
const onRing = (theta: number, r: number) => new Vector3(Math.sin(theta) * r, 0, -Math.cos(theta) * r);

function band(r0: number, r1: number, a0: number, a1: number, depth: number): ExtrudeGeometry {
  const shape = new Shape();
  const p = (r: number, a: number) => [Math.sin(a) * r, Math.cos(a) * r] as const;
  const steps = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 0.06));
  shape.moveTo(...p(r0, a0));
  for (let i = 0; i <= steps; i++) shape.lineTo(...p(r1, a0 + ((a1 - a0) * i) / steps));
  for (let i = steps; i >= 0; i--) shape.lineTo(...p(r0, a0 + ((a1 - a0) * i) / steps));
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function needle(kit: Kit, R: number, light: boolean): Group {
  const group = new Group();
  const mat = light ? kit.mats.line : kit.mats.chip;
  const arm = box(mat, light ? 0.06 : 0.09, 0.05, R - 0.34);
  arm.position.set(0, TOP + (light ? 0.04 : 0.06), -(R - 0.34) / 2);
  arm.castShadow = true;
  const tip = new Mesh(blockGeometry(0.16, 0.05, 0.16, 0.03), mat);
  tip.position.set(0, TOP + (light ? 0.015 : 0.03), -(R - 0.32));
  tip.rotation.y = Math.PI / 4;
  group.add(arm, tip);
  if (!light) {
    const hub = new Mesh(discGeometry(), mat);
    hub.scale.set(0.26, 0.1, 0.26);
    hub.position.y = TOP + 0.06;
    group.add(hub);
  }
  return group;
}

class Ring extends Part<RingProps> {
  private readonly radius: number;
  private readonly size: number;
  private readonly hand: Group;
  private readonly shade: Group;
  private readonly arc = new Group();
  private readonly texts: TextPlane[] = [];
  private readonly holders: Group[] = [];
  private readonly chip: Card | null;
  private readonly reading: Card;
  private readonly hole: Card;
  private angle = 0;
  private readonly below: boolean;

  constructor(kit: Kit, id: string, position: Vec2, props: RingProps) {
    super(kit, id, position);
    this.size = props.size;
    const R = 1.3;
    this.radius = R;
    this.footprint = { w: R * 2 + 0.2, d: R * 2 + 0.2 };
    const plate = solid(new Mesh(discGeometry(), kit.mats.block));
    plate.scale.set(R * 2, TOP, R * 2);
    plate.position.y = TOP / 2;
    this.group.add(plate);
    // 负数的那半圈：刻度里面一条深色的带。
    const [start, count] = props.neg;
    const a0 = angleOf(start - 0.5, this.size) + 0.02;
    const a1 = angleOf(start + count - 0.5, this.size) - 0.02;
    const strip = new Mesh(band(R - 0.5, R - 0.3, a0, a1, 0.025), kit.mats.plinth);
    strip.position.y = TOP;
    strip.receiveShadow = true;
    this.group.add(strip);
    // 刻度：格数不多时每格一道，多时只画有字的格。
    const ticks = this.size <= 64 ? [...Array(this.size).keys()] : props.marks.map(([k]) => k);
    const labelled = new Set(props.marks.map(([k]) => k));
    for (const k of ticks) {
      const theta = angleOf(k, this.size);
      const long = labelled.has(k);
      const tick = box(kit.mats.line, long ? 0.05 : 0.03, 0.02, long ? 0.26 : 0.16);
      tick.position.copy(onRing(theta, R - (long ? 0.15 : 0.12))).setY(TOP + 0.01);
      tick.rotation.y = -theta;
      this.group.add(tick);
    }
    this.group.add(this.arc);
    this.shade = needle(kit, R, true);
    this.hand = needle(kit, R, false);
    this.group.add(this.shade, this.hand);
    // 盘边的字：上下两头相邻的两格各往一边让开。
    const half = this.size / 2;
    for (const [k, text, strong] of props.marks) {
      const theta = angleOf(k, this.size);
      // 右半圈（含正上方）的字往右排，左半圈（含正下方）的往左排。
      const right = k >= 0 && k < half;
      const plane = new TextPlane(kit, text, { size: sizes.note, tone: strong ? 'text' : 'muted', weight: strong ? 600 : 500, mono: true, align: right ? 'left' : 'right' });
      plane.place(0, sizes.note * 0.7);
      const at = onRing(theta, R + 0.2);
      at.x += right ? 0.06 : -0.06;
      at.z += Math.cos(theta) > 0 ? -0.08 : 0.04;
      const holder = this.holder(at.setY(0.04));
      holder.add(plane.mesh);
      this.texts.push(plane);
    }
    this.chip = props.name ? new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 }) : null;
    if (this.chip) {
      this.chip.group.position.set(0, sizes.chipHeight / 2, 0);
      this.holder(new Vector3(0, 0.02, -R - 0.75)).add(this.chip.group);
    }
    this.reading = new Card(kit, ' ', { kind: 'tile', height: sizes.tileHeight * 0.8, size: sizes.value, mono: true, weight: 600, minWidth: 1.2 });
    this.reading.group.position.set(0, (sizes.tileHeight * 0.8) / 2, 0);
    // 读数在盘的右边，左边缘对齐盘边。
    this.below = !!props.below;
    this.holder(this.below ? new Vector3(0, 0.02, R + 1.0) : new Vector3(R + 0.3, 0.02, 0.1)).add(this.reading.group);
    this.hole = new Card(kit, '无', { kind: 'tile', height: 0.56, size: sizes.value, weight: 600, minWidth: 0.7 });
    this.hole.group.position.set(0, 0.28, 0);
    this.holder(new Vector3(0, TOP + 0.08, 0)).add(this.hole.group);
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

  private drawArc(a: number, b: number): void {
    for (const child of [...this.arc.children]) child.removeFromParent();
    const span = b - a;
    if (Math.abs(span) < 1e-3) return;
    const r = this.radius - 0.62;
    const steps = Math.max(2, Math.ceil(Math.abs(span) / 0.08));
    for (let i = 0; i < steps; i++) {
      const p0 = onRing(a + (span * i) / steps, r);
      const p1 = onRing(a + (span * (i + 1)) / steps, r);
      const piece = box(this.kit.mats.data, 0.09, 0.03, p0.distanceTo(p1) + 0.02);
      piece.position.copy(p0.clone().lerp(p1, 0.5)).setY(TOP + 0.01);
      piece.rotation.y = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
      this.arc.add(piece);
    }
    this.kit.invalidate();
  }

  protected apply(next: RingProps, previous: RingProps | null, animate: Animate): void {
    const has = next.pointer >= 0;
    this.hand.visible = has;
    this.shade.visible = next.ghost >= 0;
    if (next.ghost >= 0) this.shade.rotation.y = -angleOf(next.ghost, this.size);
    this.hole.group.visible = !has && next.empty !== '';
    if (!previous || previous.empty !== next.empty) this.hole.set(next.empty || ' ');
    const text = next.reading;
    this.reading.group.visible = text !== '';
    if (text !== '' && (!previous || previous.reading !== text)) {
      if (animate && previous && previous.reading !== '') this.reading.flipTo(text);
      else this.reading.set(text);
    }
    this.reading.group.position.x = this.below ? 0 : this.reading.width / 2;
    this.reading.setChanged(!!next.changed && text !== '');
    if (!has) {
      this.drawArc(0, 0);
      return;
    }
    const target = angleOf(next.pointer, this.size);
    const start = next.from >= 0 ? angleOf(next.from, this.size) : null;
    const dir = next.dir < 0 ? -1 : 1;
    let end = target;
    if (start !== null) end = start + ((((target - start) * dir) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * dir;
    const finish = () => {
      this.hand.rotation.y = -end;
      this.angle = end;
      if (start !== null) this.drawArc(start, end);
      else this.drawArc(0, 0);
    };
    const wasShown = !!previous && previous.pointer >= 0;
    let from = start ?? (wasShown ? this.angle : 0);
    // 没有起点时走最近的一边。
    if (start === null) {
      const delta = Math.atan2(Math.sin(end - from), Math.cos(end - from));
      from = end - delta;
    }
    const moving = !!animate && !this.kit.reduced && !!previous && Math.abs(from - end) > 1e-3;
    if (!moving) {
      finish();
      return;
    }
    this.kit.motion.add({
      duration: Math.max(timing.travelMin, Math.min(1000, Math.abs(end - from) * 240)),
      ease: arrive,
      update: (t) => {
        const now = from + (end - from) * t;
        this.hand.rotation.y = -now;
        if (start !== null) this.drawArc(start, now);
      },
      done: () => {
        finish();
        rebound(this.kit, this.hand, 0.03);
        this.kit.sound('click');
      },
    });
  }

  override bounds(): Box3 {
    const box3 = super.bounds();
    box3.expandByVector(new Vector3(0.7, 0, 0.35));
    if (this.below) box3.max.z += 1.1;
    else box3.max.x += this.reading.group.visible ? this.reading.width + 0.1 : 0;
    box3.max.y = Math.max(box3.max.y, 0.7);
    return box3;
  }

  override anchor(): Vector3 {
    return this.group.position.clone().add(new Vector3(0, 0.5, 0));
  }

  override dispose(): void {
    for (const group of this.holders) this.kit.facing.delete(group);
    for (const text of this.texts) text.dispose();
    this.chip?.dispose();
    this.reading.dispose();
    this.hole.dispose();
    super.dispose();
  }
}

definePart('2-codes:ring', (kit, id, position, props) => new Ring(kit, id, position, props as unknown as RingProps));
