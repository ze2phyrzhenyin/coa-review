import { Box3, Group, Mesh, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { TextPlane, blockGeometry, cardGeometry } from '../kit';
import type { Kit } from '../kit';
import { easeOut } from '../motion';
import { sizes, timing } from '../theme';
import type { CardStackProps, StackCard, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { rebound } from './effects';

const H = 0.92;
const STRIP = 0.5;

interface Drawn {
  group: Group;
  slab: Mesh;
  title: TextPlane;
  note: TextPlane;
  data: StackCard;
}

/**
 * 一叠程序卡（中断嵌套）：最上面一张是正在运行的程序。响应中断时新卡从上方落下压住它，
 * 被压住的卡只露出一条，卡角写着断点；返回时最上面那张被抽走，下面那张重新露出来。
 */
export class CardStack extends Part<CardStackProps> {
  private readonly width: number;
  private drawn: Drawn[] = [];
  private readonly chip: Card | null = null;

  constructor(kit: Kit, id: string, position: Vec2, props: CardStackProps) {
    super(kit, id, position);
    this.width = props.width ?? 3.2;
    this.footprint = { w: this.width + 0.4, d: 0.9 };
    this.group.add(solid(new Mesh(blockGeometry(this.width + 0.4, 0.14, 0.9), kit.mats.block)));
    this.face.position.set(0, 0.17, 0.12);
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      this.face.add(this.chip.group);
    }
    this.update(props, false);
  }

  private y(i: number): number {
    return H / 2 + i * STRIP;
  }

  private make(card: StackCard, i: number): Drawn {
    const group = new Group();
    const slab = solid(new Mesh(cardGeometry(this.width, H, sizes.cardDepth, sizes.radius), this.kit.mats.tile));
    group.add(slab);
    // 字都写在卡的下沿那一条：被压住时露出来的正好是这一条。
    const title = new TextPlane(this.kit, card.title, { size: sizes.note, tone: 'tileText', weight: 600, align: 'left' });
    title.place(-this.width / 2 + 0.18, -H / 2 + STRIP / 2);
    const note = new TextPlane(this.kit, card.note ?? '', { size: sizes.note, tone: 'muted', align: 'right', mono: true });
    note.place(this.width / 2 - 0.18, -H / 2 + STRIP / 2);
    group.add(title.mesh, note.mesh);
    group.position.set(0, this.y(i), 0.03 * i);
    this.face.add(group);
    return { group, slab, title, note, data: card };
  }

  private remove(drawn: Drawn, animate: boolean): void {
    const finish = () => {
      drawn.title.dispose();
      drawn.note.dispose();
      drawn.group.removeFromParent();
    };
    if (!animate || this.kit.reduced) {
      finish();
      return;
    }
    // 抽走：往上抽出、淡出。
    const material = (this.kit.mats.tile as MeshLambertMaterial).clone();
    material.transparent = true;
    drawn.slab.material = material;
    const y0 = drawn.group.position.y;
    this.kit.motion.add({
      duration: 360,
      ease: easeOut,
      update: (t) => {
        drawn.group.position.y = y0 + t * 1.1;
        material.opacity = 1 - t;
        drawn.title.opacity = 1 - t;
        drawn.note.opacity = 1 - t;
      },
      done: () => {
        finish();
        material.dispose();
      },
    });
  }

  protected apply(next: CardStackProps, _previous: CardStackProps | null, animate: Animate): void {
    const moving = !!animate && !this.kit.reduced;
    let same = 0;
    while (same < this.drawn.length && same < next.cards.length && this.drawn[same]!.data.title === next.cards[same]!.title) same++;
    for (const drawn of this.drawn.slice(same).reverse()) this.remove(drawn, moving);
    const kept = this.drawn.slice(0, same);
    kept.forEach((drawn, i) => {
      const note = next.cards[i]!.note ?? '';
      if (drawn.note.text !== note) drawn.note.set(note);
      drawn.data = next.cards[i]!;
    });
    let delay = moving && this.drawn.length > same ? 280 : 0;
    for (let i = same; i < next.cards.length; i++) {
      const drawn = this.make(next.cards[i]!, i);
      kept.push(drawn);
      if (moving) {
        const y = this.y(i);
        drawn.group.position.y = y + 1.4;
        drawn.group.visible = false;
        this.kit.motion.add({
          delay,
          duration: 320,
          ease: (t) => t * t,
          update: (t) => {
            drawn.group.visible = true;
            drawn.group.position.y = y + 1.4 * (1 - t);
          },
          done: () => {
            drawn.group.position.y = y;
            rebound(this.kit, drawn.group, 0.06);
            this.kit.sound('thud');
          },
        });
        delay += timing.cause;
      }
    }
    this.drawn = kept;
    kept.forEach((drawn, i) => drawn.title.set(drawn.data.title, { tone: i === kept.length - 1 && next.changed ? 'accentOnTile' : 'tileText' }));
    const top = this.y(Math.max(0, kept.length - 1)) + H / 2;
    this.faceHeight = top + (this.chip ? 0.04 + sizes.chipHeight : 0);
    this.faceWidth = this.width;
    this.chip?.group.position.set(-this.width / 2 + this.chip.width / 2, top + 0.04 + sizes.chipHeight / 2, 0.03 * kept.length);
  }

  override anchor(): Vector3 {
    return this.faceToWorld(0, this.y(Math.max(0, this.drawn.length - 1)));
  }

  override bounds(): Box3 {
    const box = super.bounds();
    box.max.y = Math.max(box.max.y, 1.2);
    return box;
  }

  override dispose(): void {
    for (const drawn of this.drawn) {
      drawn.title.dispose();
      drawn.note.dispose();
    }
    this.chip?.dispose();
    super.dispose();
  }
}
