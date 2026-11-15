/**
 * 带放大镜的尺子：数轴上相邻的三段 [2^(b−1), 2^b)、[2^b, 2^(b+1))、[2^(b+1), 2^(b+2))，按真实长度画（1 : 2 : 4）。
 * 每段里能表示的数一样多（尺上每段只画 8 格），段越往右越长，相邻两数的间隔跟着翻倍。
 * 指针停在 |x| 上；中间那段就是 1.M × 2^e 的 e 决定的那一段，所以 1.M 的那个 1 不用存：知道在哪一段就知道它。
 * 段的分界下面写 e，知道阶码后再写一行 E = e + 偏移量：同一把尺，只是刻度数字整体挪了偏移量。
 * 由场景按需加载（SceneSpec.kinds），只在这里引用 three.js。
 */
import { Box3, Group, Mesh, Vector3 } from 'three';
import { Card, Part, TextPlane, arrive, blockGeometry, box, definePart, rebound, sizes, solid, timing } from '../../scene/define';
import type { Animate, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';

export interface RulerProps extends CommonProps {
  /** 中间一段的指数 b；null 时尺上没有指针（零、无穷大、NaN、非规格化数）。 */
  binade: number | null;
  /** 指针在中间一段里的位置：|x| / 2^b，1 到 2。 */
  frac: number;
  /** 指针挪到第几段（−1、0、1，学生答错时演用）；超出尺子就停在端头。 */
  shift: number;
  /** 指针上的牌。 */
  pin: string;
  /** 分界下面第二行的偏移量；null 时不写 E。 */
  bias: number | null;
  /** 放大镜里的字：中间一段相邻两数的间隔。 */
  lens: string;
  /** 没有指针时尺子中间的一句。 */
  empty: string;
  /** 窄屏：尺子短一些。建好后不变。 */
  compact?: boolean;
}

const TICKS = 8;

class Ruler extends Part<RulerProps> {
  private readonly pinGroup = new Group();
  private readonly pinCard: Card;
  private readonly band: Mesh;
  private readonly heads: TextPlane[] = [];
  private readonly es: TextPlane[] = [];
  private readonly Es: TextPlane[] = [];
  private readonly holders: Group[] = [];
  private readonly lens: Card;
  private readonly lensRing: Group;
  private readonly empty: Card;
  private x = 0;
  private readonly STARTS: number[];

  constructor(kit: Kit, id: string, position: Vec2, props: RulerProps) {
    super(kit, id, position);
    const LENGTH = props.compact ? 5.8 : 9.6;
    const UNIT = LENGTH / 7;
    const STARTS = [0, UNIT, 3 * UNIT, 7 * UNIT].map((x) => x - LENGTH / 2);
    this.STARTS = STARTS;
    this.footprint = { w: LENGTH + 0.6, d: 1.0 };
    this.group.add(solid(new Mesh(blockGeometry(LENGTH + 0.6, 0.14, 1.0, 0.05), kit.mats.block)));
    // 中间一段垫一条深色的带。
    this.band = new Mesh(blockGeometry(STARTS[2]! - STARTS[1]!, 0.02, 0.5, 0.01), kit.mats.plinth);
    this.band.position.set((STARTS[1]! + STARTS[2]!) / 2, 0.14, 0.12);
    this.group.add(this.band);
    for (let s = 0; s < 3; s++) {
      const a = STARTS[s]!;
      const b = STARTS[s + 1]!;
      for (let k = 0; k < TICKS; k++) {
        const major = k === 0;
        const tick = box(kit.mats.line, major ? 0.05 : 0.03, 0.02, major ? 0.62 : 0.3);
        tick.position.set(a + ((b - a) * k) / TICKS, 0.15, major ? 0 : -0.14);
        this.group.add(tick);
      }
    }
    const end = box(kit.mats.line, 0.05, 0.02, 0.62);
    end.position.set(STARTS[3]!, 0.15, 0);
    this.group.add(end);
    for (let i = 0; i < 4; i++) {
      const x = STARTS[i]!;
      const head = new TextPlane(kit, ' ', { size: sizes.note, tone: 'text', mono: true, weight: 600 });
      head.place(0, 0);
      this.holder(new Vector3(x, 0.05, 0.8)).add(head.mesh);
      this.heads.push(head);
      const e = new TextPlane(kit, ' ', { size: sizes.note, tone: 'text', mono: true });
      e.place(0, 0);
      this.holder(new Vector3(x, 0.05, 1.3)).add(e.mesh);
      this.es.push(e);
      const E = new TextPlane(kit, ' ', { size: sizes.note, tone: 'addr', mono: true });
      E.place(0, 0);
      this.holder(new Vector3(x, 0.05, 1.8)).add(E.mesh);
      this.Es.push(E);
    }
    for (const [text, z, tone] of [['e', 1.3, 'text'], ['E', 1.8, 'addr']] as const) {
      const head = new TextPlane(kit, text, { size: sizes.note, tone, weight: 600, align: 'right' });
      head.place(0, 0);
      this.holder(new Vector3(STARTS[0]! - 0.32, 0.05, z)).add(head.mesh);
      this.heads.push(head);
    }
    // 指针：一根细杆加一张牌。
    const stem = solid(new Mesh(blockGeometry(0.07, 0.65, 0.07, 0.02), kit.mats.accent));
    stem.position.y = 0.14;
    this.pinGroup.add(stem);
    this.group.add(this.pinGroup);
    this.pinCard = new Card(kit, ' ', { kind: 'chip', height: sizes.chipHeight, size: sizes.name, mono: true, weight: 600, minWidth: 0.6 });
    const pinHolder = new Group();
    pinHolder.position.set(0, 0.85, 0);
    pinHolder.add(this.pinCard.group);
    this.pinGroup.add(pinHolder);
    kit.facing.add(pinHolder);
    this.holders.push(pinHolder);
    // 放大镜：一圈细框加一张牌，悬在中间一段的上方。
    this.lensRing = new Group();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const seg = box(kit.mats.line, 0.06, 0.03, 0.16);
      seg.position.set(Math.cos(a) * 0.42, 0.2, Math.sin(a) * 0.42);
      seg.rotation.y = -a;
      this.lensRing.add(seg);
    }
    this.group.add(this.lensRing);
    this.lens = new Card(kit, ' ', { kind: 'tile', height: sizes.chipHeight, size: sizes.note, weight: 500, minWidth: 0.6 });
    this.lens.group.position.set(0, sizes.chipHeight / 2, 0);
    this.holder(new Vector3(0, 0.05, -1.5)).add(this.lens.group);
    this.empty = new Card(kit, ' ', { kind: 'tile', height: sizes.chipHeight, size: sizes.note, minWidth: 0.6 });
    this.empty.group.position.set(0, sizes.chipHeight / 2, 0);
    this.holder(new Vector3(0, 0.2, 0)).add(this.empty.group);
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

  private where(props: RulerProps): number {
    const shift = Math.max(-1, Math.min(1, props.shift));
    const s = 1 + shift;
    const a = this.STARTS[s]!;
    const b = this.STARTS[s + 1]!;
    const frac = Math.max(1, Math.min(1.999, props.frac));
    return a + (b - a) * (frac - 1);
  }

  protected apply(next: RulerProps, previous: RulerProps | null, animate: Animate): void {
    const has = next.binade !== null;
    const b = next.binade ?? 0;
    const sign = (k: number) => String(k).replace('-', '−');
    for (let i = 0; i < 4; i++) {
      const k = b - 1 + i;
      this.heads[i]!.set(has ? `2^${k}` : ' ');
      this.es[i]!.set(has ? sign(k) : ' ');
      this.Es[i]!.set(has && next.bias !== null ? sign(k + next.bias) : ' ');
    }
    this.heads[4]!.set(has ? 'e' : ' ');
    this.heads[5]!.set(has && next.bias !== null ? 'E' : ' ');
    this.pinGroup.visible = has && next.pin !== '';
    this.band.visible = has;
    this.lensRing.visible = has && next.lens !== '';
    this.lens.group.visible = has && next.lens !== '';
    if (next.lens) this.lens.set(next.lens);
    this.empty.group.visible = !has && next.empty !== '';
    if (next.empty) this.empty.set(next.empty);
    if (next.pin) this.pinCard.set(next.pin);
    this.pinCard.setChanged(!!next.changed);
    const target = has ? this.where(next) : 0;
    this.lensRing.position.x = has ? this.where({ ...next, shift: 0 }) : 0;
    const moving = !!animate && !this.kit.reduced && !!previous && previous.binade !== null && Math.abs(target - this.x) > 1e-3;
    if (!moving) {
      this.x = target;
      this.pinGroup.position.x = target;
      return;
    }
    const from = this.x;
    this.x = target;
    this.kit.motion.add({
      duration: Math.max(timing.travelMin, Math.min(timing.travelMax, Math.abs(target - from) * timing.travelPerUnit)),
      ease: arrive,
      update: (t) => (this.pinGroup.position.x = from + (target - from) * t),
      done: () => {
        this.pinGroup.position.x = target;
        rebound(this.kit, this.pinGroup, 0.04);
        this.kit.sound('click');
      },
    });
  }

  override bounds(): Box3 {
    const box3 = super.bounds();
    box3.min.x -= 0.7;
    box3.min.z -= 1.9;
    box3.max.z += 2.0;
    box3.max.y = Math.max(box3.max.y, 1.2);
    return box3;
  }

  override anchor(): Vector3 {
    return this.group.position.clone().add(new Vector3(this.x, 1.0, 0));
  }

  override dispose(): void {
    for (const group of this.holders) this.kit.facing.delete(group);
    for (const text of [...this.heads, ...this.es, ...this.Es]) text.dispose();
    this.pinCard.dispose();
    this.lens.dispose();
    this.empty.dispose();
    super.dispose();
  }
}

definePart('2-ieee:ruler', (kit, id, position, props) => new Ruler(kit, id, position, props as unknown as RulerProps));
