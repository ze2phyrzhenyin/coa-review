import { Box3, Group, Mesh, Vector3 } from 'three';
import { TextPlane, blockGeometry, box } from '../kit';
import type { Kit } from '../kit';
import { sizes } from '../theme';
import type { BusProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate, Side } from './base';
import { Card } from './card';

export function driverList(drivers: BusProps['drivers']): string[] {
  if (!drivers) return [];
  const list = Array.isArray(drivers) ? drivers : drivers.split(/[、,，\s]+/);
  return list.map((name) => name.trim()).filter((name) => name !== '' && name !== 'null' && name !== 'undefined');
}

const H = 0.2;
const D = 0.6;

/**
 * 总线：一条导轨。有部件驱动时，值牌停在导轨上（可以停在驱动者正对的位置），牌旁写明谁在驱动。
 * 两个部件同时驱动是冲突：两张牌叠在一起，导轨换成强调色。
 */
export class Bus extends Part<BusProps> {
  private readonly tile: Card;
  private readonly second: Card;
  private readonly chip: Card;
  /** 导轨左端：没有部件驱动时的说明。 */
  private readonly idle: TextPlane;
  /** 值牌右边：谁在驱动。 */
  private readonly caption: TextPlane;
  private readonly strip: Mesh;
  private readonly side = new Group();
  private readonly length: number;
  /** 值牌能停的范围（相对中心的 x），避开左端的名牌。 */
  private readonly range: [number, number];
  private tileAt: number;

  constructor(kit: Kit, id: string, position: Vec2, props: BusProps) {
    super(kit, id, position);
    this.length = props.length;
    this.footprint = { w: props.length, d: D };
    this.group.add(solid(new Mesh(blockGeometry(props.length, H, D, 0.08), kit.mats.plinth)));
    this.strip = box(kit.mats[`${props.ink ?? 'data'}Idle`], props.length - 0.36, 0.03, 0.18);
    this.strip.position.set(0, H + 0.012, 0);
    this.strip.receiveShadow = true;
    this.group.add(this.strip);

    const tileOptions = { kind: 'tile' as const, height: sizes.tileHeight, size: sizes.value, mono: true, minWidth: 1.1 };
    this.tile = new Card(kit, '', tileOptions);
    this.tile.group.position.set(0, sizes.tileHeight / 2, 0);
    this.second = new Card(kit, '', tileOptions);
    this.second.group.position.set(0.16, sizes.tileHeight / 2 + 0.12, -0.03);
    this.second.group.rotation.z = 0.1;
    this.second.group.visible = false;
    this.caption = new TextPlane(kit, '', { size: sizes.note, tone: 'text', align: 'left' });
    this.face.add(this.second.group, this.tile.group, this.caption.mesh);
    this.faceHeight = sizes.tileHeight;
    this.faceWidth = 0;

    // 名牌放在导轨左端。
    this.side.position.set(-props.length / 2 + 0.2, H + 0.04, 0.16);
    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.chip.group.position.set(this.chip.width / 2, sizes.chipHeight / 2, 0);
    this.idle = new TextPlane(kit, '', { size: sizes.note, tone: 'muted', align: 'left' });
    this.idle.place(this.chip.width + 0.14, sizes.chipHeight / 2);
    this.side.add(this.chip.group, this.idle.mesh);
    this.group.add(this.side);
    kit.facing.add(this.side);

    const left = -props.length / 2 + 0.2 + this.chip.width + 0.2;
    const right = props.length / 2 - 0.2;
    this.range = [left, right];
    this.tileAt = props.tileAt ?? (left + right) / 2;
    this.face.position.set(this.tileAt, H + 0.04, 0.16);
    this.update(props, false);
  }

  /** 值牌的位置只取决于属性，换步时先放好，走动的值才落得准。 */
  /** 值牌中心停在哪（相对导轨中心）。 */
  private tileX(props: Partial<BusProps> | undefined): number {
    const at = props?.tileAt ?? this.tileAt;
    const half = Math.max(0.55, this.tile.width / 2);
    const [left, right] = this.range;
    return right - left < half * 2 ? (left + right) / 2 : Math.max(left + half, Math.min(right - half, at));
  }

  override place(props: BusProps): void {
    const x = this.tileX(props);
    if (Math.abs(x - this.face.position.x) > 1e-4) {
      this.face.position.x = x;
      this.kit.invalidate();
    }
  }

  protected apply(next: BusProps, previous: BusProps | null, animate: Animate): void {
    const drivers = driverList(next.drivers);
    const clash = drivers.length > 1;
    const was = previous ? (driverList(previous.drivers).length > 1 ? '冲突' : previous.value) : '';
    const shown = clash ? '冲突' : next.value;
    const ink = next.ink ?? 'data';

    if (shown !== was || !previous) {
      if (shown === '') {
        if (animate && this.tile.group.visible) this.tile.ghost();
        this.tile.group.visible = false;
        this.tile.set('');
      } else {
        this.tile.group.visible = true;
        if (animate === 'land') this.tile.landTo(shown);
        else if (animate === 'flip' && was !== '') this.tile.flipTo(shown);
        else this.tile.set(shown);
      }
    }
    this.place(next);
    this.tile.setChanged(!!next.changed || clash);
    this.tile.group.rotation.z = clash ? -0.06 : 0;
    this.second.group.visible = clash;
    if (clash) this.second.set(next.value);
    this.strip.material = clash ? this.kit.mats.accent : drivers.length ? this.kit.mats[ink] : this.kit.mats[`${ink}Idle`];

    const show = next.showDriver !== false;
    const caption = !show || shown === '' ? '' : clash ? `${drivers.join('、')} 同时驱动` : drivers.length ? `${drivers[0]} 驱动` : '';
    this.caption.set(caption, { tone: clash ? 'accent' : 'text' });
    this.caption.place(this.tile.width / 2 + 0.14, sizes.tileHeight / 2);
    this.idle.set(show && shown === '' ? '没有部件驱动' : '');
    if (clash && animate && !(previous && driverList(previous.drivers).length > 1)) this.shake();
  }

  /** 接在对方正对的位置。 */
  override port(side: Side | null, toward: Vector3): { point: Vector3; side: Side } {
    const center = this.center;
    const chosen: Side = side ?? (toward.z < center.z ? 'n' : 's');
    const half = this.length / 2 - 0.3;
    const point = new Vector3(center.x + Math.max(-half, Math.min(half, toward.x - center.x)), 0, center.z);
    if (chosen === 'n' || chosen === 's') point.z += chosen === 'n' ? -this.footprint.d / 2 : this.footprint.d / 2;
    else point.x = center.x + (chosen === 'w' ? -this.length / 2 : this.length / 2);
    return { point, side: chosen };
  }

  override anchor(): Vector3 {
    return this.faceToWorld(0, sizes.tileHeight / 2);
  }

  /** 镜头只需看住值牌附近，不必把整条导轨装进画面。 */
  override focusBox(props?: BusProps): Box3 | null {
    // 总线空着时没有要看的东西。
    if (props && props.value === '' && driverList(props.drivers).length === 0) return null;
    const center = this.center;
    const x = center.x + (props ? this.tileX(props) : this.face.position.x);
    const half = Math.max(1.2, this.tile.width / 2 + 0.2);
    return new Box3(new Vector3(x - half, 0, center.z - 0.8), new Vector3(x + half + (this.caption.width > 0 ? this.caption.width : 0), 0.75, center.z + 0.4));
  }

  override bounds(): Box3 {
    const center = this.center;
    return new Box3(new Vector3(center.x - this.length / 2, 0, center.z - 0.8), new Vector3(center.x + this.length / 2, 0.75, center.z + 0.3));
  }

  override dispose(): void {
    this.kit.facing.delete(this.side);
    this.tile.dispose();
    this.second.dispose();
    this.chip.dispose();
    this.caption.dispose();
    this.idle.dispose();
    super.dispose();
  }
}
