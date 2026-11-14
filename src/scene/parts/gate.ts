import { Group, Mesh, Vector3 } from 'three';
import { blockGeometry, prismGeometry } from '../kit';
import type { Kit } from '../kit';
import { easeOut } from '../motion';
import { timing } from '../theme';
import type { GateProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate, Side } from './base';
import { Card } from './card';

export const isOn = (value: unknown): boolean => value === true || value === '1' || value === 'true';

const angles: Record<Side, number> = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 };
const LENGTH = 1.0;
const BASE = 0.7;
const HEIGHT = 0.26;
/** 接线点离中心的距离：导通时三角正好搭上两头的线。 */
const REACH = 0.52;

/**
 * 三态门：一块三角形的实体，尖指向数据的流向。
 * 导通时转到与连线对齐、落在线上，换成墨色；关断时横过来并抬起，两头的线断开。旁边的小牌写着状态。
 */
export class Gate extends Part<GateProps> {
  private readonly pivot = new Group();
  private readonly prism: Mesh;
  private readonly chip: Card;
  private readonly state: Card;
  private readonly dir: Side;
  private open = false;

  constructor(kit: Kit, id: string, position: Vec2, props: GateProps) {
    super(kit, id, position);
    this.dir = props.dir ?? 's';
    const along = this.dir === 'n' || this.dir === 's';
    this.footprint = along ? { w: BASE + 0.1, d: REACH * 2 } : { w: REACH * 2, d: BASE + 0.1 };
    this.prism = solid(new Mesh(prismGeometry(BASE, LENGTH, HEIGHT), kit.mats.line));
    this.pivot.add(this.prism);
    // 底下的小垫片标出门的位置，关断时也看得见这里有一个门。
    const pad = new Mesh(blockGeometry(0.34, 0.05, 0.34, 0.02), kit.mats.plinth);
    pad.receiveShadow = true;
    this.group.add(pad, this.pivot);

    this.chip = new Card(kit, props.name, { kind: 'chip', height: 0.36, size: 0.24, weight: 600, minWidth: 0.5 });
    this.state = new Card(kit, '', { kind: 'tile', height: 0.36, size: 0.23, minWidth: 0.42 });
    this.face.add(this.chip.group, this.state.group);
    this.face.position.set((along ? BASE / 2 : REACH) + 0.22, 0.04, along ? 0.12 : BASE / 2 + 0.45);
    this.faceHeight = 0.36;
    this.layout();
    this.update(props, false);
  }

  private layout(): void {
    this.chip.group.position.set(this.chip.width / 2, 0.18, 0);
    this.state.group.position.set(this.chip.width + 0.05 + this.state.width / 2, 0.18, 0);
    this.faceWidth = 0;
  }

  private pose(t: number): void {
    // t=1 导通。
    this.pivot.rotation.y = angles[this.dir] + ((1 - t) * Math.PI) / 2;
    this.pivot.position.y = (1 - t) * 0.16;
  }

  protected apply(next: GateProps, previous: GateProps | null, animate: Animate): void {
    const open = isOn(next.open);
    const states = next.states ?? (['关', '通'] as const);
    const ink = next.ink ?? 'data';
    const finish = () => {
      this.prism.material = open ? this.kit.mats[ink] : this.kit.mats.line;
      this.state.set(states[open ? 1 : 0]);
      this.layout();
    };
    if (!previous || open !== this.open) {
      this.open = open;
      if (animate && !this.kit.reduced) {
        const from = open ? 0 : 1;
        if (open) finish();
        this.kit.motion.add({
          duration: timing.cause,
          ease: easeOut,
          update: (t) => this.pose(from + (open ? t : -t)),
          done: () => {
            this.pose(open ? 1 : 0);
            finish();
          },
        });
      } else {
        this.pose(open ? 1 : 0);
        finish();
      }
    }
    if (!previous || next.name !== previous.name) {
      this.chip.set(next.name);
      this.layout();
    }
    this.state.setChanged(!!next.changed);
  }

  /** 进线口在流向的反方向，出线口在流向上；垂直方向是控制端。 */
  override port(side: Side | null, toward: Vector3): { point: Vector3; side: Side } {
    const center = this.center;
    const dx = toward.x - center.x;
    const dz = toward.z - center.z;
    const along = this.dir === 'n' || this.dir === 's';
    const chosen: Side = side ?? (along ? (Math.abs(dz) >= Math.abs(dx) * 0.5 ? (dz < 0 ? 'n' : 's') : dx < 0 ? 'w' : 'e') : Math.abs(dx) >= Math.abs(dz) * 0.5 ? (dx < 0 ? 'w' : 'e') : dz < 0 ? 'n' : 's');
    const onAxis = (chosen === 'n' || chosen === 's') === along;
    const reach = onAxis ? REACH : BASE / 2;
    const point = center.clone();
    if (chosen === 'n') point.z -= reach;
    else if (chosen === 's') point.z += reach;
    else if (chosen === 'w') point.x -= reach;
    else point.x += reach;
    return { point, side: chosen };
  }

  override anchor(): Vector3 {
    return this.center.setY(0.5);
  }

  override dispose(): void {
    this.chip.dispose();
    this.state.dispose();
    super.dispose();
  }
}
