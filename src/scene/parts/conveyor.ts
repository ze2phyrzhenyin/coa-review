import { Box3, Group, Mesh, Vector3 } from 'three';
import { TextPlane, blockGeometry, box, discGeometry } from '../kit';
import type { Kit } from '../kit';
import { easeOut } from '../motion';
import { sizes, timing } from '../theme';
import type { ConveyorProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { rebound } from './effects';

const D = 1.0;
const H = 0.22;

/**
 * 传送带（a 进 c 出）：一条带子上排着槽，每个槽里立一张牌。
 * 新的从 a 端上方落进来，整排往 c 端挪；c 端的那张掉下去；命中时那一张被拎起来放回 a 端，其余的让位。
 * 部件按牌上的字认出谁移到了哪，所以同一行里的字要互不相同。
 */
export class Conveyor extends Part<ConveyorProps> {
  private readonly slotW: number;
  private readonly slots: number;
  private readonly cards = new Map<string, Card>();
  private readonly texts: TextPlane[] = [];
  private readonly holders: Group[] = [];
  private readonly chip: Card | null = null;
  private readonly rollers: Mesh[] = [];

  constructor(kit: Kit, id: string, position: Vec2, props: ConveyorProps) {
    super(kit, id, position);
    this.slots = props.slots;
    this.slotW = props.slotWidth ?? 1.0;
    const L = this.slots * this.slotW + 0.5;
    this.footprint = { w: L + 0.4, d: D };
    const belt = solid(new Mesh(blockGeometry(L, H, D, 0.1), kit.mats.plinth));
    this.group.add(belt);
    for (const side of [-1, 1]) {
      const roller = solid(new Mesh(discGeometry(), kit.mats.block));
      roller.rotation.x = Math.PI / 2;
      roller.scale.set(H + 0.12, D + 0.1, H + 0.12);
      roller.position.set(side * (L / 2), (H + 0.12) / 2, 0);
      this.group.add(roller);
      this.rollers.push(roller);
    }
    for (let k = 1; k < this.slots; k++) {
      const rule = box(kit.mats.line, 0.025, 0.01, D - 0.3);
      rule.position.set(this.slotX(k) - this.slotW / 2, H + 0.005, 0);
      this.group.add(rule);
    }
    const end = (text: string, x: number) => {
      const plane = new TextPlane(kit, text, { size: sizes.name, tone: 'text', weight: 600 });
      plane.place(0, sizes.name * 0.7);
      this.holder(x, D / 2 + 0.32, 0.02).add(plane.mesh);
      this.texts.push(plane);
    };
    end(props.inLabel ?? 'a', this.slotX(0));
    end(props.outLabel ?? 'c', this.slotX(this.slots - 1));
    this.face.position.set(0, H + 0.02, 0.05);
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      // 名牌在带子左端外面，不压到第一张牌。
      this.chip.group.position.set(-this.chip.width / 2, sizes.chipHeight / 2, 0);
      this.holder(-L / 2 - 0.3, 0, 0.02).add(this.chip.group);
    }
    this.faceHeight = sizes.tileHeight;
    this.update(props, false);
  }

  private slotX(k: number): number {
    return -(this.slots * this.slotW) / 2 + this.slotW * (k + 0.5);
  }

  private holder(x: number, z: number, y: number): Group {
    const group = new Group();
    group.position.set(x, y, z);
    this.group.add(group);
    this.kit.facing.add(group);
    this.holders.push(group);
    return group;
  }

  private make(text: string): Card {
    const card = new Card(this.kit, text, { kind: 'tile', width: this.slotW - 0.16, height: sizes.tileHeight, size: sizes.value, mono: true });
    this.face.add(card.group);
    this.cards.set(text, card);
    return card;
  }

  protected apply(next: ConveyorProps, previous: ConveyorProps | null, animate: Animate): void {
    const y = sizes.tileHeight / 2;
    const before = previous?.items ?? [];
    const moving = !!animate && !this.kit.reduced && !!previous;
    const present = new Set(next.items.filter((text) => text !== ''));
    // 掉下去的：c 端外面落下、淡出。
    for (const [text, card] of [...this.cards]) {
      if (present.has(text)) continue;
      this.cards.delete(text);
      if (!moving) {
        card.dispose();
        continue;
      }
      const x0 = card.group.position.x;
      const x1 = this.slotX(this.slots - 1) + this.slotW * 1.1;
      this.kit.motion.add({
        duration: 520,
        ease: (t) => t,
        update: (t) => {
          const slide = Math.min(1, t / 0.5);
          const fall = Math.max(0, (t - 0.45) / 0.55);
          card.group.position.set(x0 + (x1 - x0) * easeOut(slide), y - 1.2 * fall * fall, card.group.position.z);
          card.group.rotation.z = -0.5 * fall;
        },
        done: () => card.dispose(),
      });
    }
    let drops = 0;
    next.items.forEach((text, j) => {
      if (text === '') return;
      const x = this.slotX(j);
      let card = this.cards.get(text);
      const was = before.indexOf(text);
      if (!card) {
        card = this.make(text);
        if (moving) {
          // 新的从 a 端上方落进来，等让位的挪完。
          const target = card;
          target.group.position.set(x, y + 1.3, 0);
          target.group.visible = false;
          const delay = timing.cause + 120 * drops++;
          this.kit.motion.add({
            delay,
            duration: 300,
            ease: (t) => t * t,
            update: (t) => {
              target.group.visible = true;
              target.group.position.set(x, y + 1.3 * (1 - t), 0);
            },
            done: () => {
              target.group.position.set(x, y, 0);
              rebound(this.kit, target.group, 0.05);
              this.kit.sound('thud');
            },
          });
          return;
        }
        card.group.position.set(x, y, 0);
        return;
      }
      const from = card.group.position.x;
      if (!moving || Math.abs(from - x) < 1e-3) {
        card.group.position.set(x, y, 0);
        return;
      }
      // 往 a 端回去的（命中时拎回来）：抬起来从上面过；往 c 端的：贴着带子滑。
      const back = was > j;
      const target = card;
      this.kit.motion.add({
        delay: back ? 0 : 60,
        duration: back ? 620 : timing.cause + 140,
        ease: easeOut,
        update: (t) => {
          target.group.position.x = from + (x - from) * t;
          target.group.position.y = y + (back ? Math.sin(Math.PI * t) * 0.9 : 0);
        },
        done: () => {
          target.group.position.set(x, y, 0);
          if (back) {
            rebound(this.kit, target.group, 0.05);
            this.kit.sound('click');
          }
        },
      });
    });
    for (const card of this.cards.values()) card.setChanged(false);
    if (next.changed) for (const text of next.items) this.cards.get(text)?.setChanged(text === next.items[0]);
    // 带子在动时滚轮转一下。
    if (moving) {
      for (const roller of this.rollers) {
        const r0 = roller.rotation.y;
        this.kit.motion.add({ duration: 360, update: (t) => (roller.rotation.y = r0 - t * 1.2) });
      }
    }
  }

  override bounds(): Box3 {
    const box = super.bounds();
    box.max.z += 0.5;
    box.min.x -= this.chip ? this.chip.width + 0.4 : 0;
    box.max.y = Math.max(box.max.y, H + sizes.tileHeight + 0.2);
    return box;
  }

  override anchor(): Vector3 {
    return this.faceToWorld(this.slotX(0), sizes.tileHeight / 2);
  }

  override cellAnchor(_r: number, c: number): Vector3 | null {
    return c >= 0 && c < this.slots ? this.faceToWorld(this.slotX(c), sizes.tileHeight / 2) : null;
  }

  override dispose(): void {
    for (const holder of this.holders) this.kit.facing.delete(holder);
    for (const card of this.cards.values()) card.dispose();
    for (const text of this.texts) text.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
