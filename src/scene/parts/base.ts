import { Box3, Group, Mesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { box, cardGeometry } from '../kit';
import type { Kit } from '../kit';
import { timing } from '../theme';
import type { CommonProps, Vec2 } from '../types';

/** 更新的方式：不动、原地翻面、有值落进来。 */
export type Animate = false | 'flip' | 'land';
export type Side = 'n' | 's' | 'e' | 'w';

const DEFAULT_ELEVATION = (52 * Math.PI) / 180;
/** 不是主角时字的浓度。 */
const DIM = 0.5;

/**
 * 部件的基类。本体放在台面上（group），文字和牌放在正对屏幕的 face 里。
 * update(props, animate) 之后的画面只取决于 props。
 */
export abstract class Part<P extends CommonProps = CommonProps> {
  readonly group = new Group();
  readonly face = new Group();
  /** 占地：宽（x）和深（z）。连线接在它的四条边上。 */
  protected footprint = { w: 1, d: 1 };
  /** face 竖起来的高度，用来算包围盒。 */
  protected faceHeight = 0.7;
  protected faceWidth = 0;
  protected props: P | null = null;
  /** 起因类的部件（门、信号、标签）：前进一步时先变，值再走。 */
  cause = false;
  private dimmed = false;
  private ring: Group | null = null;
  private brackets: Group | null = null;
  private readonly home: Vector3;

  constructor(
    protected readonly kit: Kit,
    readonly id: string,
    position: Vec2,
  ) {
    this.group.position.set(position[0], 0, position[1]);
    this.home = this.group.position.clone();
    this.group.add(this.face);
    this.group.userData.partId = id;
    kit.facing.add(this.face);
  }

  update(props: P, animate: Animate): void {
    const previous = this.props;
    this.props = props;
    this.apply(props, previous, previous ? animate : false);
    this.group.visible = !props.hidden;
    this.setMarks(!!props.focus, !!props.pickable);
    this.kit.invalidate();
  }

  protected abstract apply(next: P, previous: P | null, animate: Animate): void;

  /** 只摆位置、不改内容。换步时在值开始走之前调用，落点才准。 */
  place(_props: P): void {}

  get center(): Vector3 {
    return this.home.clone();
  }

  /** 世界坐标下的包围盒，含竖起来的牌。 */
  bounds(): Box3 {
    const { w, d } = this.footprint;
    const half = Math.max(w, this.faceWidth) / 2;
    const facePos = this.face.position;
    const rise = facePos.y + this.faceHeight * Math.cos(DEFAULT_ELEVATION);
    const back = Math.min(-d / 2, facePos.z - this.faceHeight * Math.sin(DEFAULT_ELEVATION));
    return new Box3(new Vector3(this.home.x - half, 0, this.home.z + back), new Vector3(this.home.x + half, rise, this.home.z + d / 2));
  }

  /** 镜头跟随时要看住的范围。默认是整个部件。props 是那一步的属性（值牌的位置可能随步变）。 */
  focusBox(_props?: P): Box3 | null {
    return this.bounds();
  }

  /** 连线的接点。side 为 null 时取朝向对方的那一边。 */
  port(side: Side | null, toward: Vector3): { point: Vector3; side: Side } {
    const { w, d } = this.footprint;
    const dx = toward.x - this.home.x;
    const dz = toward.z - this.home.z;
    const chosen: Side = side ?? (Math.abs(dz) * (w / d) >= Math.abs(dx) * 0.999 ? (dz < 0 ? 'n' : 's') : dx < 0 ? 'w' : 'e');
    const point = this.home.clone();
    const inset = 0.3;
    if (chosen === 'n' || chosen === 's') {
      point.z += chosen === 'n' ? -d / 2 : d / 2;
      point.x += Math.max(-(w / 2 - inset), Math.min(w / 2 - inset, dx));
    } else {
      point.x += chosen === 'w' ? -w / 2 : w / 2;
      point.z += Math.max(-(d / 2 - inset), Math.min(d / 2 - inset, dz));
    }
    return { point, side: chosen };
  }

  /** 值停靠的位置（世界坐标）：值牌的中心。走动的值从这里出发、落到这里。 */
  anchor(): Vector3 {
    return this.faceToWorld(0, this.faceHeight / 2);
  }

  protected faceToWorld(x: number, y: number): Vector3 {
    return new Vector3(x, y, 0).applyQuaternion(this.kit.camera.quaternion).add(this.face.position).add(this.group.position);
  }

  /** 连线、信号接到一个具名引脚上（'U1.addr'）。没有这个引脚时返回 null，按边处理。 */
  pin(_name: string): { point: Vector3; side: Side } | null {
    return null;
  }

  /** 'id.行.列' 的格子中心（世界坐标）。值可以从格子出发、落进格子。没有格子的部件返回 null。 */
  cellAnchor(_r: number, _c: number): Vector3 | null {
    return null;
  }

  /** 不是这一拍主角时变淡一点：只调字的浓淡，动作结束后恢复。 */
  dim(on: boolean, instant = false): void {
    if (on === this.dimmed) return;
    this.dimmed = on;
    const texts = [...this.kit.texts].filter((text) => {
      for (let node: Object3D | null = text.mesh; node; node = node.parent) if (node === this.group) return true;
      return false;
    });
    const to = on ? DIM : 1;
    if (this.kit.reduced || instant) {
      for (const text of texts) if (text.opacity > 0) text.opacity = to;
      this.kit.invalidate();
      return;
    }
    const from = texts.map((text) => text.opacity);
    this.kit.motion.add({
      duration: timing.fade,
      update: (t) => texts.forEach((text, i) => from[i]! > 0 && (text.opacity = from[i]! + (to - from[i]!) * t)),
    });
  }

  /** 被拒绝的选择：轻摇。 */
  shake(): void {
    if (this.kit.reduced) return;
    const x = this.home.x;
    this.kit.motion.add({
      duration: timing.shake,
      ease: (t) => t,
      update: (t) => (this.group.position.x = x + Math.sin(t * Math.PI * 6) * 0.07 * (1 - t)),
      done: () => (this.group.position.x = x),
    });
  }

  /** 台面上的标记：焦点是垫在部件下面的一张深一点的纸，等待点选是四个角。 */
  setMarks(focus: boolean, pickable: boolean): void {
    if (focus && !this.ring) {
      const { w, d } = this.footprint;
      const pad = new Mesh(cardGeometry(w + 0.44, d + 0.44, 0.012, 0.16), this.kit.mats.pad);
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.014;
      pad.receiveShadow = true;
      this.ring = new Group();
      this.ring.add(pad);
      this.group.add(this.ring);
    }
    if (pickable && !this.brackets) {
      this.brackets = this.corners();
      this.group.add(this.brackets);
    }
    if (this.ring) this.ring.visible = focus;
    if (this.brackets) this.brackets.visible = pickable;
    this.kit.invalidate();
  }

  private corners(): Group {
    const { w, d } = this.footprint;
    const m = 0.2;
    const t = 0.04;
    const W = w + m * 2;
    const D = d + m * 2;
    const group = new Group();
    const arm = Math.min(0.36, w / 3, d / 3);
    const add = (bw: number, bd: number, x: number, z: number) => {
      const bar = box(this.kit.mats.mark, bw, 0.01, bd);
      bar.position.set(x, 0.022, z);
      group.add(bar);
    };
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(arm, t, sx * (W / 2 - arm / 2), sz * (D / 2));
        add(t, arm, sx * (W / 2), sz * (D / 2 - arm / 2));
      }
    }
    return group;
  }

  /** 射线点选用：命中这些对象就算点到本部件。 */
  pickTargets(): Object3D[] {
    return [this.group];
  }

  dispose(): void {
    this.kit.facing.delete(this.face);
    this.group.removeFromParent();
  }
}

/** 给实体开投影。 */
export function solid<T extends Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
