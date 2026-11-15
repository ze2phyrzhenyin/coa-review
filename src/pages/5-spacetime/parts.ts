/**
 * 流水线三页（5-spacetime、5-hazard、5-stall）自带的部件。由 SceneSpec.kinds 按需加载，模块一加载就登记。
 *
 * - '5-spacetime:line'  装配线：指令是盒子，在 IF、ID、EX… 各工位之间前进；停顿是塞进线上的空泡，后面的盒子原地等。
 * - '5-spacetime:chart' 时空图：斜立的板，行是段（或指令），列是时钟周期；一格一格翻成白牌，可以画箭头。
 * - '5-spacetime:deps'  相关连线：几条指令一行一条，读、写的寄存器是小牌；写的和读的之间拉线，RAW、WAR、WAW 各一种线形。
 *
 * 画面只取决于 props。动作：起因 → 移动 → 落定，落定时回弹一下。减少动态效果时直接到位。
 */
import { Box3, Group, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3 } from 'three';
import type { Object3D } from 'three';
import { Card, Part, TextPlane, blockGeometry, box, burst, cardGeometry, definePart, easeInOut, easeOut, estimateWidth, rebound, sizes, solid, timing } from '../../scene/define';
import type { Animate, Kit } from '../../scene/define';
import type { CommonProps, Vec2 } from '../../scene';
import type { LineProps, ChartProps, ChartLink, DepsProps, LinkKind, LinkTone } from './part-types';

// ---------- 共用：线、箭头、小牌 ----------

type Hue = 'ink' | 'muted' | 'line' | 'accent' | 'bad' | 'ok' | 'paper';

/** 线和箭头用不受光照影响的纯色，两种模式下都按当前调色板取色。 */
function hue(kit: Kit, name: Hue): MeshBasicMaterial {
  const store = (kit as unknown as { __pipeMats?: Map<Hue, MeshBasicMaterial> }).__pipeMats ?? new Map<Hue, MeshBasicMaterial>();
  (kit as unknown as { __pipeMats?: Map<Hue, MeshBasicMaterial> }).__pipeMats = store;
  const color = { ink: kit.palette.text, muted: kit.palette.muted, line: kit.palette.line, accent: kit.palette.accent, bad: kit.palette.bad, ok: kit.palette.ok, paper: kit.palette.paper }[name];
  let material = store.get(name);
  if (!material) {
    material = new MeshBasicMaterial({ color });
    store.set(name, material);
  } else material.color.set(color);
  return material;
}

function toneHue(tone: LinkTone | undefined): Hue {
  return tone === 'hot' ? 'accent' : tone === 'bad' ? 'bad' : tone === 'faint' ? 'line' : 'ink';
}

const triangle = (() => {
  let geometry: ShapeGeometry | null = null;
  return () => {
    if (!geometry) {
      const shape = new Shape();
      shape.moveTo(0, 0);
      shape.lineTo(-1, 0.5);
      shape.lineTo(-1, -0.5);
      shape.lineTo(0, 0);
      geometry = new ShapeGeometry(shape);
    }
    return geometry;
  };
})();

/**
 * 一条画在板面上的线（板的局部坐标，x 向右 y 向上）：实线、虚线、双线三种线形，终点一个箭头。
 * 按长度切成小段，「画出来」时按顺序一段段显示。
 */
class Stroke {
  readonly group = new Group();
  private readonly pieces: { mesh: Mesh; at: number }[] = [];
  private readonly head: Mesh | null;
  private readonly total: number;
  private shown = 1;

  constructor(
    private readonly kit: Kit,
    points: Vector2[],
    style: LinkKind,
    material: MeshBasicMaterial,
    arrow = true,
    width = 0.05,
  ) {
    let total = 0;
    const segs: { a: Vector2; b: Vector2; len: number; start: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = a.distanceTo(b);
      if (len < 1e-4) continue;
      segs.push({ a, b, len, start: total });
      total += len;
    }
    this.total = total;
    const add = (a: Vector2, b: Vector2, at: number, offset: number) => {
      const len = a.distanceTo(b);
      if (len < 1e-4) return;
      const dir = b.clone().sub(a).normalize();
      const normal = new Vector2(-dir.y, dir.x).multiplyScalar(offset);
      const mesh = box(material, len + (offset === 0 ? width * 0.6 : 0), offset === 0 ? width : width * 0.55, 0.01);
      mesh.rotation.z = Math.atan2(dir.y, dir.x);
      mesh.position.set((a.x + b.x) / 2 + normal.x, (a.y + b.y) / 2 + normal.y, 0.02);
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.pieces.push({ mesh, at });
    };
    const DASH = 0.16;
    const GAP = 0.11;
    for (const seg of segs) {
      if (style === 'WAR') {
        // 虚线：按全长的位置切（第 m 段虚线占 [m·P, m·P + DASH]），拐角处不断开得太突兀。
        const P = DASH + GAP;
        const end = seg.start + seg.len;
        for (let m = Math.floor(seg.start / P); m * P < end; m++) {
          const a = Math.max(seg.start, m * P);
          const b = Math.min(end, m * P + DASH);
          if (b - a > 1e-3) add(seg.a.clone().lerp(seg.b, (a - seg.start) / seg.len), seg.a.clone().lerp(seg.b, (b - seg.start) / seg.len), a, 0);
        }
      } else {
        const steps = Math.max(1, Math.ceil(seg.len / 0.35));
        for (let k = 0; k < steps; k++) {
          const a = seg.a.clone().lerp(seg.b, k / steps);
          const b = seg.a.clone().lerp(seg.b, (k + 1) / steps);
          const at = seg.start + (seg.len * k) / steps;
          if (style === 'WAW') {
            add(a, b, at, width * 0.75);
            add(a, b, at, -width * 0.75);
          } else add(a, b, at, 0);
        }
      }
    }
    const last = segs[segs.length - 1];
    if (arrow && last) {
      const dir = last.b.clone().sub(last.a).normalize();
      const head = new Mesh(triangle(), material);
      const size = 0.24;
      head.scale.set(size, size * 0.95, 1);
      head.rotation.z = Math.atan2(dir.y, dir.x);
      head.position.set(last.b.x, last.b.y, 0.025);
      head.renderOrder = 1;
      this.group.add(head);
      this.head = head;
    } else this.head = null;
  }

  setMaterial(material: MeshBasicMaterial): void {
    for (const piece of this.pieces) piece.mesh.material = material;
    if (this.head) this.head.material = material;
  }

  /** 画到全长的 p（0–1）。 */
  reveal(p: number): void {
    this.shown = p;
    const s = p * this.total;
    for (const piece of this.pieces) piece.mesh.visible = p > 0 && piece.at <= s;
    if (this.head) this.head.visible = p >= 0.999;
    this.kit.invalidate();
  }

  draw(delay = 0): void {
    if (this.kit.reduced) {
      this.reveal(1);
      return;
    }
    this.reveal(0);
    this.kit.motion.add({ delay, duration: Math.max(280, Math.min(720, this.total * 110)), ease: easeOut, update: (t) => this.reveal(t), done: () => this.reveal(1) });
  }

  get visible(): boolean {
    return this.shown > 0;
  }
}

/** 小牌：圆角薄片加一行字，颜色可换（普通、强调、错、深色）。 */
class Tag {
  readonly group = new Group();
  private readonly slab: Mesh;
  private readonly label: TextPlane;
  private tone: LinkTone | 'dark' | '' = '';
  width = 0;

  constructor(
    private readonly kit: Kit,
    text: string,
    private readonly size = sizes.note,
    private readonly height = 0.44,
    mono = true,
  ) {
    this.slab = new Mesh(undefined, kit.mats.tile);
    this.slab.castShadow = true;
    this.label = new TextPlane(kit, text, { size, tone: 'tileText', mono, weight: 600 });
    this.label.place(0, 0, 0.008);
    this.group.add(this.slab, this.label.mesh);
    this.set(text, '');
  }

  set(text: string, tone: LinkTone | 'dark' | ''): void {
    const textTone = tone === '' || tone === 'faint' ? 'tileText' : 'chipText';
    this.label.set(text, { tone: textTone });
    this.tone = tone;
    const w = Math.max(0.5, Math.ceil((this.label.width + this.size * 0.6) * 20) / 20);
    if (w !== this.width) {
      this.width = w;
      this.slab.geometry = cardGeometry(w, this.height, sizes.cardDepth, sizes.radius);
    }
    this.slab.material = tone === 'hot' ? this.kit.mats.accent : tone === 'bad' ? hue(this.kit, 'bad') : tone === 'dark' ? this.kit.mats.chip : this.kit.mats.tile;
    this.group.visible = text !== '';
  }

  get text(): string {
    return this.label.text;
  }

  get currentTone() {
    return this.tone;
  }

  dispose(): void {
    this.label.dispose();
    this.group.removeFromParent();
  }
}

// ---------- 装配线 ----------

const BELT_H = 0.2;

interface Crate {
  text: string;
  group: Group;
  holder: Group;
  tag: Tag | null;
  bubble: boolean;
}

class Line extends Part<LineProps> {
  private readonly k: number;
  private readonly sw: number;
  private readonly bw: number;
  private readonly bh = 0.62;
  private readonly bd = 0.78;
  private readonly depth = 1.25;
  private readonly crates = new Map<string, Crate>();
  private readonly texts: TextPlane[] = [];
  private readonly chips: Card[] = [];
  private readonly holders: Group[] = [];
  private readonly rollers: Mesh[] = [];
  private readonly queueText: TextPlane;
  private readonly doneText: TextPlane;
  private readonly pad: number;
  private readonly sphere = new SphereGeometry(0.5, 20, 14);

  constructor(kit: Kit, id: string, position: Vec2, props: LineProps) {
    super(kit, id, position);
    this.k = props.stations.length;
    this.sw = props.stationWidth ?? 1.8;
    this.bw = Math.min(1.05, this.sw - 0.34);
    this.pad = props.padWidth ?? 1.5;
    const span = this.k * this.sw;
    const W = span + 2 * (this.pad + 0.3);
    this.footprint = { w: W, d: this.depth + 0.6 };
    const belt = solid(new Mesh(blockGeometry(span + 0.24, BELT_H, this.depth, 0.08), kit.mats.plinth));
    this.group.add(belt);
    for (const side of [-1, 1]) {
      const roller = solid(new Mesh(new SphereGeometry(0.5, 12, 8), kit.mats.block));
      roller.scale.set(BELT_H + 0.1, this.depth * 0.5, BELT_H + 0.1);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(side * (span / 2 + 0.12), (BELT_H + 0.1) / 2, 0);
      this.group.add(roller);
      this.rollers.push(roller);
    }
    for (let s = 1; s < this.k; s++) {
      const rule = box(kit.mats.line, 0.03, 0.012, this.depth - 0.24);
      rule.position.set(this.stationX(s) - this.sw / 2, BELT_H + 0.006, 0);
      this.group.add(rule);
    }
    // 进口的托盘（待取的指令）和出口的筐（做完的）。
    const tray = (x: number, height: number) => {
      const block = solid(new Mesh(blockGeometry(this.pad, height, this.depth * 0.9, 0.08), kit.mats.block));
      block.position.set(x, 0, 0);
      this.group.add(block);
    };
    tray(this.queueX(), 0.12);
    tray(this.doneX(), 0.3);
    // 工位名牌：在带子前沿，正对屏幕。
    props.stations.forEach((name, s) => {
      const holder = this.holder(this.stationX(s), this.depth / 2 + 0.36);
      const chip = new Card(kit, name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62, mono: true });
      const note = props.notes?.[s] ?? '';
      if (note) {
        const text = new TextPlane(kit, note, { size: sizes.note, tone: 'muted', align: 'left' });
        const total = chip.width + 0.1 + text.width;
        chip.group.position.set(-total / 2 + chip.width / 2, sizes.chipHeight / 2, 0);
        text.place(-total / 2 + chip.width + 0.1, sizes.chipHeight / 2);
        holder.add(text.mesh);
        this.texts.push(text);
      } else chip.group.position.set(0, sizes.chipHeight / 2, 0);
      holder.add(chip.group);
      this.chips.push(chip);
    });
    this.queueText = new TextPlane(kit, '', { size: sizes.note, tone: 'muted' });
    this.queueText.place(0, sizes.note * 0.75);
    this.holder(this.queueX(), this.depth / 2 + 0.36).add(this.queueText.mesh);
    this.doneText = new TextPlane(kit, '', { size: sizes.note, tone: 'muted' });
    this.doneText.place(0, sizes.note * 0.75);
    this.holder(this.doneX(), this.depth / 2 + 0.36).add(this.doneText.mesh);
    this.texts.push(this.queueText, this.doneText);
    if (props.name) {
      const name = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      name.group.position.set(name.width / 2, sizes.chipHeight / 2, 0);
      this.holder(-W / 2, -this.depth / 2 - 0.15).add(name.group);
      this.chips.push(name);
    }
    this.faceHeight = 1.9;
    this.update(props, false);
  }

  private stationX(s: number): number {
    return -(this.k * this.sw) / 2 + this.sw * (s + 0.5);
  }
  private queueX(): number {
    return -(this.k * this.sw) / 2 - 0.3 - this.pad / 2;
  }
  private doneX(): number {
    return (this.k * this.sw) / 2 + 0.3 + this.pad / 2;
  }

  private holder(x: number, z: number, y = 0.02): Group {
    const group = new Group();
    group.position.set(x, y, z);
    this.group.add(group);
    this.kit.facing.add(group);
    this.holders.push(group);
    return group;
  }

  private makeCrate(text: string): Crate {
    const group = new Group();
    const bubble = text.startsWith('~');
    const holder = new Group();
    let tag: Tag | null = null;
    if (bubble) {
      // 空泡：一颗扁一点的白球，不写字。
      const ball = solid(new Mesh(this.sphere, this.kit.mats.tile));
      ball.scale.set(0.62, 0.5, 0.62);
      ball.position.y = 0.27;
      group.add(ball);
    } else {
      const body = solid(new Mesh(blockGeometry(this.bw, this.bh, this.bd, 0.06), this.kit.mats.chip));
      group.add(body);
      // 盒子正面挂一张写着指令号的牌。
      tag = new Tag(this.kit, text, sizes.value, 0.5);
      holder.position.set(0, this.bh * 0.5, this.bd / 2 + 0.24);
      holder.add(tag.group);
      group.add(holder);
      this.kit.facing.add(holder);
    }
    this.face.add(group);
    const crate: Crate = { text, group, holder, tag, bubble };
    this.crates.set(text, crate);
    return crate;
  }

  /** 每个盒子上方的小牌（读 R1、等 R1、R1 旧值）。 */
  private notes = new Map<string, { holder: Group; tag: Tag }>();

  private note(crate: Crate, text: string, tone: LinkTone | ''): void {
    let entry = this.notes.get(crate.text);
    if (!text) {
      if (entry) entry.tag.group.visible = false;
      return;
    }
    if (!entry) {
      const holder = new Group();
      holder.position.set(0, this.bh + 0.42, 0);
      const tag = new Tag(this.kit, text, sizes.note, 0.42);
      holder.add(tag.group);
      crate.group.add(holder);
      this.kit.facing.add(holder);
      entry = { holder, tag };
      this.notes.set(crate.text, entry);
    }
    entry.tag.set(text, tone);
  }

  private dropCrate(text: string): void {
    const crate = this.crates.get(text);
    if (!crate) return;
    this.crates.delete(text);
    const note = this.notes.get(text);
    if (note) {
      this.kit.facing.delete(note.holder);
      note.tag.dispose();
      this.notes.delete(text);
    }
    this.kit.facing.delete(crate.holder);
    crate.tag?.dispose();
    crate.group.removeFromParent();
  }

  protected apply(next: LineProps, previous: LineProps | null, animate: Animate): void {
    const moving = !!animate && !!previous && !this.kit.reduced;
    const where = new Map<string, number>();
    next.items.forEach((text, s) => text && where.set(text, s));
    const queue = next.queue ?? [];
    if (queue[0]) where.set(queue[0], -1);
    const was = new Map<string, number>();
    previous?.items.forEach((text, s) => text && was.set(text, s));
    if (previous?.queue?.[0]) was.set(previous.queue[0], -1);
    const xOf = (s: number) => (s === -1 ? this.queueX() : this.stationX(s));
    const y = BELT_H;
    let moved = false;

    // 离开的：走完最后一段的进完成筐，其余的（回退、换题）直接拿走。
    for (const [text, crate] of [...this.crates]) {
      if (where.has(text)) continue;
      const from = was.get(text);
      if (moving && from !== undefined && from === this.k - 1) {
        this.crates.delete(text);
        moved = true;
        const x0 = crate.group.position.x;
        const x1 = this.doneX();
        const target = crate;
        this.kit.motion.add({
          delay: 0,
          duration: 520,
          ease: easeInOut,
          update: (t) => {
            target.group.position.x = x0 + (x1 - x0) * t;
            target.group.position.y = y + Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.22 - (t > 0.7 ? (t - 0.7) * 0.9 : 0);
            const s = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
            target.group.scale.setScalar(Math.max(0.001, s));
          },
          done: () => {
            this.crates.set(text, target);
            this.dropCrate(text);
            this.kit.sound('thud');
          },
        });
        continue;
      }
      this.dropCrate(text);
    }

    // 从前往后排：前面的先走，后面的跟上；原地等的不动。
    const order = [...where.entries()].sort((a, b) => b[1] - a[1]);
    let stagger = 0;
    for (const [text, s] of order) {
      let crate = this.crates.get(text);
      const x = xOf(s);
      if (!crate) {
        crate = this.makeCrate(text);
        crate.group.position.set(x, y, 0);
        if (moving) {
          const target = crate;
          if (crate.bubble) {
            // 空泡塞进来：在后面的盒子停住之后鼓起来。
            target.group.scale.setScalar(0.001);
            this.kit.motion.add({
              delay: timing.cause + 200,
              duration: 300,
              ease: easeOut,
              update: (t) => target.group.scale.setScalar(Math.max(0.001, t)),
              done: () => {
                target.group.scale.setScalar(1);
                rebound(this.kit, target.group, 0.05);
                this.kit.sound('click');
              },
            });
          } else {
            // 新的一条落到托盘上。
            target.group.position.y = y + 1.1;
            target.group.visible = false;
            this.kit.motion.add({
              delay: timing.cause + 260,
              duration: 300,
              ease: (t) => t * t,
              update: (t) => {
                target.group.visible = true;
                target.group.position.y = y + 1.1 * (1 - t);
              },
              done: () => {
                target.group.position.y = y;
                rebound(this.kit, target.group, 0.04);
              },
            });
          }
          moved = true;
        }
      } else {
        const from = crate.group.position.x;
        if (moving && Math.abs(from - x) > 1e-3) {
          const target = crate;
          const delay = stagger;
          stagger += 40;
          moved = true;
          this.kit.motion.add({
            delay,
            duration: Math.min(timing.travelMax, Math.max(timing.travelMin + 140, Math.abs(x - from) * 240)),
            ease: easeOut,
            update: (t) => {
              target.group.position.x = from + (x - from) * t;
              target.group.position.y = y + Math.sin(Math.PI * t) * 0.16;
            },
            done: () => {
              target.group.position.set(x, y, 0);
              if (!target.bubble) {
                rebound(this.kit, target.group, 0.03);
                this.kit.sound('click');
              }
            },
          });
        } else crate.group.position.set(x, y, 0);
      }
    }

    // 盒子上方的小牌。
    for (const [text, s] of where) {
      const crate = this.crates.get(text);
      if (!crate || crate.bubble) continue;
      const tagText = s >= 0 ? (next.tags?.[s] ?? '') : '';
      const tone = s >= 0 ? (next.tones?.[s] ?? '') : '';
      this.note(crate, tagText, tone as LinkTone | '');
      // 窄屏上相邻工位的小牌会碰在一起：单数工位的抬高一层。
      const entry = this.notes.get(text);
      if (entry) entry.holder.position.y = this.bh + 0.42 + (next.compact && s % 2 === 1 ? 0.5 : 0);
      crate.tag?.set(text, s >= 0 && next.hot?.includes(s) ? 'hot' : s >= 0 && next.bad?.includes(s) ? 'bad' : '');
    }

    const unit = next.compact ? '' : ' 条';
    this.queueText.set(queue.length ? `待取 ${queue.length}${unit}` : '');
    this.doneText.set(`完成 ${next.done ?? 0}${unit}`);

    // 定向：结果从一个工位抛到另一个工位。
    const pass = next.pass;
    const passKey = pass ? `${pass.from}>${pass.to}:${pass.text}` : '';
    const wasPass = previous?.pass ? `${previous.pass.from}>${previous.pass.to}:${previous.pass.text}` : '';
    if (pass && moving && passKey !== wasPass) this.throwCard(pass.text, pass.from, pass.to, timing.cause + 520);

    // 撞车：这一格的盒子拿着错的值往前走，崩一下。
    const crash = next.crash ?? -1;
    if (crash >= 0 && moving && crash !== (previous?.crash ?? -1)) {
      const at = new Vector3(this.stationX(crash), BELT_H + this.bh + 0.2, 0);
      this.kit.motion.after(timing.cause + 540, () => {
        burst(this.kit, this.group, at, 12);
        this.kit.sound('crash');
        const crate = [...where.entries()].find(([, s]) => s === crash)?.[0];
        const target = crate ? this.crates.get(crate) : undefined;
        if (target) rebound(this.kit, target.group, 0.12, 0, 'x');
      });
    }

    if (moved) {
      for (const roller of this.rollers) {
        const r0 = roller.rotation.y;
        this.kit.motion.add({ duration: 480, update: (t) => (roller.rotation.y = r0 - t * 1.4) });
      }
    }
  }

  /** 一张小牌从 from 工位的盒子上方抛到 to 工位的盒子上方。 */
  private throwCard(text: string, from: number, to: number, delay: number): void {
    const tag = new Tag(this.kit, text, sizes.note, 0.42);
    tag.set(text, 'hot');
    const holder = new Group();
    holder.add(tag.group);
    this.group.add(holder);
    this.kit.facing.add(holder);
    const x0 = this.stationX(from);
    const x1 = this.stationX(to);
    const y0 = BELT_H + this.bh + 0.95;
    holder.position.set(x0, y0, 0);
    holder.visible = false;
    const finish = () => {
      this.kit.facing.delete(holder);
      tag.dispose();
      holder.removeFromParent();
      this.kit.invalidate();
    };
    if (this.kit.reduced) {
      finish();
      return;
    }
    this.kit.motion.add({
      delay,
      duration: Math.max(420, Math.abs(x1 - x0) * 260),
      ease: easeInOut,
      update: (t) => {
        holder.visible = true;
        holder.position.set(x0 + (x1 - x0) * t, y0 + Math.sin(Math.PI * t) * 0.9, 0);
      },
      done: () => {
        this.kit.sound('latch');
        this.kit.motion.add({ duration: 200, update: (t) => (tag.group.scale.setScalar(1 - t * 0.9)), done: finish });
      },
    });
  }

  override bounds(): Box3 {
    const c = this.center;
    const { w } = this.footprint;
    return new Box3(new Vector3(c.x - w / 2 - 0.35, 0, c.z - this.depth / 2 - 0.5), new Vector3(c.x + w / 2 + 0.35, 2.2, c.z + this.depth / 2 + 0.9));
  }

  override cellAnchor(_r: number, c: number): Vector3 | null {
    const x = c === this.k ? this.doneX() : c === this.k + 1 ? this.queueX() : c >= 0 && c < this.k ? this.stationX(c) : null;
    if (x === null) return null;
    return new Vector3(x, BELT_H + this.bh + 0.5, 0).add(this.group.position);
  }

  override anchor(): Vector3 {
    return new Vector3(0, BELT_H + this.bh + 0.5, 0).add(this.group.position);
  }

  override dispose(): void {
    for (const text of [...this.crates.keys()]) this.dropCrate(text);
    for (const holder of this.holders) this.kit.facing.delete(holder);
    for (const text of this.texts) text.dispose();
    for (const chip of this.chips) chip.dispose();
    super.dispose();
  }
}

// ---------- 时空图 ----------

const ROW = 0.54;
const GAP = 0.05;
const HEAD = 0.48;
const PAD = 0.16;
const HEAD_TEXT = 0.31;

/** 四根细条围成的框。 */
function outline(material: MeshBasicMaterial, w: number, h: number, t = 0.05): Group {
  const group = new Group();
  const add = (bw: number, bh: number, x: number, y: number) => {
    const bar = box(material, bw, bh, 0.012);
    bar.position.set(x, y, 0.03);
    bar.renderOrder = 1;
    group.add(bar);
  };
  add(w + t, t, 0, h / 2);
  add(w + t, t, 0, -h / 2);
  add(t, h, -w / 2, 0);
  add(t, h, w / 2, 0);
  return group;
}

class Chart extends Part<ChartProps> {
  private readonly cells: Card[][] = [];
  private readonly rowTexts: TextPlane[] = [];
  private readonly texts: TextPlane[] = [];
  private readonly bubbles = new Map<string, Mesh>();
  private readonly frames = new Map<string, Group>();
  private readonly chip: Card | null;
  private readonly frame: Mesh;
  private readonly colX: number[] = [];
  private readonly rowY: number[] = [];
  private readonly cellW: number;
  private readonly frameY: number;
  private readonly height: number;
  private readonly labelLeft: number;
  private readonly links = new Group();
  private linkKey = '';
  private readonly sphere = new SphereGeometry(0.5, 16, 10);

  constructor(kit: Kit, id: string, position: Vec2, props: ChartProps) {
    super(kit, id, position);
    const all = props.cells.flat();
    this.cellW =
      props.cellWidth ?? Math.max(0.62, ...all.map((text) => estimateWidth(text, sizes.value * 0.92) + 0.26), ...props.columns.map((text) => estimateWidth(text, HEAD_TEXT) + 0.16));
    const labelWidth = Math.max(estimateWidth(props.corner ?? '', HEAD_TEXT), ...props.rows.map((text) => estimateWidth(text, HEAD_TEXT)), ...(props.rowChoices ?? []).map((text) => estimateWidth(text, HEAD_TEXT))) + 0.24;
    const gridWidth = props.columns.length * (this.cellW + GAP) - GAP;
    const W = gridWidth + labelWidth + PAD * 2;
    const H = HEAD + props.rows.length * (ROW + GAP) + PAD;
    this.height = H;
    this.footprint = { w: W + 0.2, d: 1.0 };
    this.group.add(solid(new Mesh(blockGeometry(W + 0.2, 0.26, 1.0), kit.mats.block)));
    this.face.position.set(0, 0.29, 0.25);
    const board = solid(new Mesh(cardGeometry(W, H, 0.05, 0.1), kit.mats.plinth));
    board.position.set(0, H / 2, -0.07);
    this.face.add(board);
    const left = -W / 2 + PAD + labelWidth;
    this.labelLeft = -W / 2 + PAD;
    props.columns.forEach((title, c) => {
      const x = left + c * (this.cellW + GAP) + this.cellW / 2;
      this.colX.push(x);
      const head = new TextPlane(kit, title, { size: HEAD_TEXT, tone: 'muted', mono: true });
      head.place(x, H - HEAD / 2 - 0.02);
      this.texts.push(head);
      this.face.add(head.mesh);
    });
    if (props.corner) {
      const corner = new TextPlane(kit, props.corner, { size: HEAD_TEXT, tone: 'muted', align: 'right' });
      corner.place(left - 0.12, H - HEAD / 2 - 0.02);
      this.texts.push(corner);
      this.face.add(corner.mesh);
    }
    props.rows.forEach((title, r) => {
      const y = H - HEAD - (r + 0.5) * (ROW + GAP);
      this.rowY.push(y);
      const label = new TextPlane(kit, title, { size: HEAD_TEXT, tone: 'muted', align: 'right', mono: true });
      label.place(left - 0.12, y);
      this.rowTexts.push(label);
      this.face.add(label.mesh);
      const line: Card[] = [];
      props.columns.forEach((_, c) => {
        const text = props.cells[r]?.[c] ?? '';
        const cell = new Card(kit, text, { kind: text === '' ? 'slot' : 'tile', width: this.cellW, height: ROW, size: sizes.value * 0.92, mono: true });
        cell.group.position.set(this.colX[c]!, y, 0);
        cell.group.traverse((object: Object3D) => (object.userData.bit = r * 1000 + c));
        line.push(cell);
        this.face.add(cell.group);
      });
      this.cells.push(line);
    });
    this.frame = new Mesh(cardGeometry(this.cellW + 0.12, props.rows.length * (ROW + GAP) + 0.07, 0.02, 0.09), kit.mats.chip);
    this.frame.visible = false;
    this.face.add(this.frame);
    this.face.add(this.links);
    this.chip = props.name ? new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 }) : null;
    if (this.chip) {
      this.chip.group.position.set(-W / 2 + this.chip.width / 2, H + 0.04 + sizes.chipHeight / 2, 0);
      this.face.add(this.chip.group);
    }
    this.frameY = H - HEAD - (props.rows.length * (ROW + GAP)) / 2;
    this.faceHeight = H + (this.chip ? 0.04 + sizes.chipHeight : 0);
    this.faceWidth = W;
    this.update(props, false);
  }

  protected apply(next: ChartProps, previous: ChartProps | null, animate: Animate): void {
    const changed = new Set(next.changedCells ?? []);
    const hot = new Set(next.hotCells ?? []);
    const bad = new Set(next.badCells ?? []);
    const stalls = new Set(next.bubbles ?? []);
    // 前进一步只换一列：等装配线先动（lag），这一列从上往下错开翻。跳转、回退会换很多格：不等，几乎一起翻。
    let changes = 0;
    for (let r = 0; r < this.cells.length; r++)
      for (let c = 0; c < this.colX.length; c++) if (this.cells[r]![c]!.text !== (stalls.has(`${r}.${c}`) ? '' : (next.cells[r]?.[c] ?? ''))) changes++;
    const jump = changes > this.cells.length;
    const lag = jump ? 0 : (next.lag ?? 0);
    const step = jump ? 8 : timing.stagger * 2;
    let k = 0;
    next.rows.forEach((title, r) => this.rowTexts[r]?.set(title));
    for (let c = 0; c < this.colX.length; c++) {
      for (let r = 0; r < this.cells.length; r++) {
        const cell = this.cells[r]![c]!;
        const key = `${r}.${c}`;
        const stall = stalls.has(key);
        const text = stall ? '' : (next.cells[r]?.[c] ?? '');
        const kind = text === '' ? 'slot' : hot.has(key) ? 'accent' : 'tile';
        if (cell.text !== text) {
          if (animate && !this.kit.reduced) cell.flipTo(text, lag + Math.min(k++, 12) * step, kind);
          else {
            cell.set(text);
            cell.setKind(kind);
          }
        } else cell.setKind(kind);
        cell.setChanged(changed.has(key) && !hot.has(key));
        this.bubble(key, stall, r, c, !!animate, lag);
        this.mark(key, bad.has(key) ? 'bad' : next.picked === key ? 'ink' : null, r, c);
      }
    }
    const current = next.current ?? -1;
    const x = this.colX[current];
    const was = this.frame.visible;
    this.frame.visible = x !== undefined;
    if (x !== undefined) {
      if (animate && was && !this.kit.reduced && Math.abs(this.frame.position.x - x) > 1e-3) {
        const from = this.frame.position.x;
        this.kit.motion.add({ duration: timing.cause * 1.4, ease: easeOut, update: (t) => (this.frame.position.x = from + (x - from) * t), done: () => (this.frame.position.x = x) });
      } else this.frame.position.set(x, this.frameY, -0.03);
      this.frame.position.y = this.frameY;
      this.frame.position.z = -0.03;
    }
    this.drawLinks(next.links ?? [], !!animate && !!previous, lag);
  }

  private cellPoint(ref: string): Vector2 | null {
    const [r, c] = ref.split('.').map(Number);
    const x = this.colX[c ?? -1];
    const y = this.rowY[r ?? -1];
    return x === undefined || y === undefined ? null : new Vector2(x, y);
  }

  private drawLinks(links: ChartLink[], animate: boolean, lag: number): void {
    const key = JSON.stringify(links);
    if (key === this.linkKey) return;
    const before = new Set(JSON.parse(this.linkKey || '[]').map((l: ChartLink) => JSON.stringify(l)) as string[]);
    this.linkKey = key;
    for (const child of [...this.links.children]) child.removeFromParent();
    for (const link of links) {
      const a = this.cellPoint(link.from);
      const b = this.cellPoint(link.to);
      if (!a || !b) continue;
      // 从格子边上出发，落到格子边上。
      const dir = b.clone().sub(a);
      const len = dir.length();
      if (len < 1e-3) continue;
      dir.normalize();
      const shrinkA = Math.min(this.cellW / 2, ROW / 2) * 0.9;
      const start = a.clone().add(dir.clone().multiplyScalar(shrinkA));
      const end = b.clone().sub(dir.clone().multiplyScalar(shrinkA + 0.02));
      const lift = link.bend ?? 0;
      const mid = start.clone().lerp(end, 0.5).add(new Vector2(-dir.y, dir.x).multiplyScalar(lift));
      const points: Vector2[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const p = start.clone().multiplyScalar((1 - t) * (1 - t)).add(mid.clone().multiplyScalar(2 * (1 - t) * t)).add(end.clone().multiplyScalar(t * t));
        points.push(p);
      }
      const stroke = new Stroke(this.kit, points, link.style ?? 'RAW', hue(this.kit, toneHue(link.tone)), true, 0.055);
      this.links.add(stroke.group);
      if (animate && !before.has(JSON.stringify(link))) stroke.draw(lag + 200);
      else stroke.reveal(1);
    }
    this.kit.invalidate();
  }

  private mark(key: string, tone: 'bad' | 'ink' | null, r: number, c: number): void {
    let group = this.frames.get(key);
    if (!tone) {
      if (group) group.visible = false;
      return;
    }
    const material = hue(this.kit, tone === 'bad' ? 'bad' : 'ink');
    if (!group || group.userData.tone !== tone) {
      group?.removeFromParent();
      group = outline(material, this.cellW + 0.08, ROW + 0.08, 0.06);
      group.userData.tone = tone;
      group.position.set(this.colX[c]!, this.rowY[r]!, 0);
      this.face.add(group);
      this.frames.set(key, group);
    }
    group.visible = true;
  }

  private bubble(key: string, on: boolean, r: number, c: number, animate: boolean, lag: number): void {
    let mesh = this.bubbles.get(key);
    if (!on) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!mesh) {
      mesh = new Mesh(this.sphere, this.kit.mats.tile);
      mesh.castShadow = true;
      this.bubbles.set(key, mesh);
      this.face.add(mesh);
    }
    const size = Math.min(this.cellW, ROW) * 0.62;
    mesh.position.set(this.colX[c]!, this.rowY[r]!, 0.08);
    if (!mesh.visible && animate && !this.kit.reduced) {
      const target = mesh;
      target.visible = true;
      target.scale.setScalar(0.001);
      this.kit.motion.add({ delay: lag, duration: 260, ease: easeOut, update: (t) => target.scale.set(size * t, size * t, size * 0.45 * t), done: () => target.scale.set(size, size, size * 0.45) });
      return;
    }
    mesh.scale.set(size, size, size * 0.45);
    mesh.visible = true;
  }

  /** 手机上镜头只看当前列附近的几列。 */
  override focusBox(props?: ChartProps): Box3 | null {
    const p = props ?? this.props;
    const win = p?.window ?? 0;
    const current = p?.current ?? -1;
    if (!win || current < 0 || this.colX.length <= win) return this.bounds();
    const lo = Math.max(0, Math.min(this.colX.length - win, current - win + 2));
    const hi = Math.min(this.colX.length - 1, lo + win - 1);
    const left = lo === 0 ? this.labelLeft : this.colX[lo]! - this.cellW / 2 - 0.1;
    const right = this.colX[hi]! + this.cellW / 2 + 0.1;
    const box3 = new Box3();
    for (const [x, y] of [
      [left, 0],
      [right, 0],
      [left, this.faceHeight],
      [right, this.faceHeight],
    ] as const)
      box3.expandByPoint(this.faceToWorld(x, y));
    box3.min.y = 0;
    box3.max.z = Math.max(box3.max.z, this.center.z + 0.5);
    return box3;
  }

  override cellAnchor(r: number, c: number): Vector3 | null {
    const y = this.rowY[r];
    const x = this.colX[c];
    return y === undefined || x === undefined ? null : this.faceToWorld(x, y);
  }

  override dispose(): void {
    for (const line of this.cells) for (const cell of line) cell.dispose();
    for (const text of [...this.texts, ...this.rowTexts]) text.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}

// ---------- 相关连线 ----------

const D_ROW = 0.6;
const D_GAP = 0.36;

class Deps extends Part<DepsProps> {
  private readonly texts: TextPlane[] = [];
  private readonly reads: Tag[][] = [];
  private readonly writes: Tag[][] = [];
  private readonly pads: Mesh[] = [];
  private readonly rowY: number[] = [];
  private readonly readX: number[][] = [];
  private readonly writeX: number;
  private readonly strokes: { stroke: Stroke; label: Tag; holder: Group; key: string; on: boolean; tone: string }[] = [];
  private readonly chip: Card | null;
  private readonly spec: DepsProps['rows'];
  private readonly chipW: number;

  constructor(kit: Kit, id: string, position: Vec2, props: DepsProps) {
    super(kit, id, position);
    this.spec = props.rows;
    const n = props.rows.length;
    const compact = !!props.compact;
    const CHIP_W = compact ? 0.86 : 1.0;
    this.chipW = CHIP_W;
    const textSize = compact ? 0.33 : sizes.value;
    const textW = Math.max(...props.rows.map((row) => estimateWidth(row.text, textSize) + 0.12), 2.0);
    const labelW = compact ? 0.5 : 0.62;
    const maxReads = Math.max(1, ...props.rows.map((row) => row.reads.length));
    const readsW = maxReads * (CHIP_W + 0.08) - 0.08;
    const laneW = compact ? 1.0 : 1.25;
    const W = PAD + labelW + 0.14 + textW + (compact ? 0.18 : 0.3) + readsW + laneW + CHIP_W + (compact ? 0.62 : 0.9) + PAD;
    const legendH = props.legend === false ? 0 : 0.62;
    const H = HEAD + n * (D_ROW + D_GAP) - D_GAP + PAD + legendH + 0.1;
    this.footprint = { w: W + 0.2, d: 1.0 };
    this.group.add(solid(new Mesh(blockGeometry(W + 0.2, 0.26, 1.0), kit.mats.block)));
    this.face.position.set(0, 0.29, 0.25);
    const board = solid(new Mesh(cardGeometry(W, H, 0.05, 0.1), kit.mats.plinth));
    board.position.set(0, H / 2, -0.07);
    this.face.add(board);
    const x0 = -W / 2 + PAD;
    const textX = x0 + labelW + 0.14;
    const readX0 = textX + textW + (compact ? 0.18 : 0.3);
    const laneX = readX0 + readsW + laneW / 2;
    this.writeX = readX0 + readsW + laneW + CHIP_W / 2;
    this.lanes = { raw: laneX - 0.24, war: laneX + 0.24, waw: this.writeX + CHIP_W / 2 + (compact ? 0.3 : 0.4) };
    const head = (text: string, x: number, align: 'left' | 'center' = 'center') => {
      const plane = new TextPlane(kit, text, { size: HEAD_TEXT, tone: 'muted', align });
      plane.place(x, H - HEAD / 2 - 0.02);
      this.texts.push(plane);
      this.face.add(plane.mesh);
    };
    head('指令', textX, 'left');
    head('读', readX0 + readsW / 2);
    head('写', this.writeX);
    props.rows.forEach((row, r) => {
      const y = H - HEAD - D_ROW / 2 - r * (D_ROW + D_GAP);
      this.rowY.push(y);
      const pad = new Mesh(cardGeometry(W - 0.16, D_ROW + 0.16, 0.01, 0.08), kit.mats.pad);
      pad.position.set(0, y, -0.03);
      pad.visible = false;
      this.face.add(pad);
      this.pads.push(pad);
      const label = new TextPlane(kit, row.label, { size: HEAD_TEXT, tone: 'muted', mono: true, weight: 600, align: 'left' });
      label.place(x0, y);
      const text = new TextPlane(kit, row.text, { size: textSize, tone: 'text', mono: true, align: 'left' });
      text.place(textX, y);
      this.texts.push(label, text);
      this.face.add(label.mesh, text.mesh);
      const xs: number[] = [];
      const line: Tag[] = [];
      row.reads.forEach((reg, i) => {
        const tag = new Tag(kit, reg, sizes.value * 0.9, D_ROW);
        const x = readX0 + i * (CHIP_W + 0.08) + CHIP_W / 2;
        xs.push(x);
        tag.group.position.set(x, y, 0);
        this.face.add(tag.group);
        line.push(tag);
      });
      this.readX.push(xs);
      this.reads.push(line);
      const wline: Tag[] = [];
      row.writes.forEach((reg, i) => {
        const tag = new Tag(kit, reg, sizes.value * 0.9, D_ROW);
        tag.group.position.set(this.writeX, y - i * 0.0, 0);
        this.face.add(tag.group);
        wline.push(tag);
      });
      this.writes.push(wline);
    });
    // 图例：三种线形。
    if (props.legend !== false) {
      const items: [LinkKind, string][] = props.compact
        ? [
            ['RAW', 'RAW'],
            ['WAR', 'WAR'],
            ['WAW', 'WAW'],
          ]
        : [
            ['RAW', 'RAW 写后读'],
            ['WAR', 'WAR 读后写'],
            ['WAW', 'WAW 写后写'],
          ];
      const y = PAD + legendH / 2 - 0.04;
      const widths = items.map(([, text]) => 0.62 + 0.14 + estimateWidth(text, HEAD_TEXT));
      const space = compact ? 0.6 : 0.5;
      const total = widths.reduce((a, b) => a + b, 0) + space * (items.length - 1);
      let x = -total / 2;
      items.forEach(([kind, text], i) => {
        const stroke = new Stroke(kit, [new Vector2(x, y), new Vector2(x + 0.62, y)], kind, hue(kit, 'ink'), false, 0.05);
        stroke.reveal(1);
        this.face.add(stroke.group);
        const plane = new TextPlane(kit, text, { size: HEAD_TEXT, tone: 'muted', align: 'left' });
        plane.place(x + 0.76, y);
        this.texts.push(plane);
        this.face.add(plane.mesh);
        x += widths[i]! + space;
      });
    }
    // 全部可能的连线先建好，按步显示。
    props.links.forEach((link, index) => {
      const points = this.route(link, index);
      const stroke = new Stroke(kit, points, link.kind, hue(kit, 'ink'), true, 0.055);
      stroke.reveal(0);
      this.face.add(stroke.group);
      const holder = new Group();
      const label = new Tag(kit, `${link.kind} ${link.reg}`, HEAD_TEXT, 0.4);
      holder.add(label.group);
      // 小牌贴在竖着的那一段旁边：RAW 在走道左边，WAR、WAW 在右边，两根线的牌不叠在一起。
      const a = link.kind === 'WAR' ? points[2]! : points[1]!;
      const b = link.kind === 'WAR' ? points[3]! : points[2]!;
      const side = link.kind === 'RAW' ? -1 : 1;
      holder.position.set(a.x + side * (label.width / 2 + 0.08), (a.y + b.y) / 2, 0.05);
      holder.visible = false;
      this.face.add(holder);
      this.strokes.push({ stroke, label, holder, key: `${link.i}-${link.j}-${link.kind}-${link.reg}`, on: false, tone: '' });
    });
    this.chip = props.name ? new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 }) : null;
    if (this.chip) {
      this.chip.group.position.set(-W / 2 + this.chip.width / 2, H + 0.04 + sizes.chipHeight / 2, 0);
      this.face.add(this.chip.group);
    }
    this.faceHeight = H + (this.chip ? 0.04 + sizes.chipHeight : 0);
    this.faceWidth = W;
    this.update(props, false);
  }

  private readonly lanes: { raw: number; war: number; waw: number };

  /** 连线的走法：RAW 从前一条的写牌左边出来，沿中间的走道下来，从上方落进后一条的读牌；WAR 反过来；WAW 走右边。 */
  private route(link: { i: number; j: number; kind: LinkKind; reg: string }, index: number): Vector2[] {
    const yi = this.rowY[link.i - 1]!;
    const yj = this.rowY[link.j - 1]!;
    const shift = (index % 3) * 0.1;
    const row = (r: number) => this.spec[r] ?? null;
    const half = this.chipW / 2;
    const readAt = (r: number, reg: string) => {
      const list = row(r)?.reads ?? [];
      const i = Math.max(0, list.indexOf(reg));
      return this.readX[r]?.[i] ?? 0;
    };
    if (link.kind === 'RAW') {
      const lane = this.lanes.raw - shift;
      const x = readAt(link.j - 1, link.reg);
      const top = yj + D_ROW / 2 + D_GAP / 2;
      return [new Vector2(this.writeX - half, yi), new Vector2(lane, yi), new Vector2(lane, top), new Vector2(x, top), new Vector2(x, yj + D_ROW / 2 + 0.02)];
    }
    if (link.kind === 'WAR') {
      const lane = this.lanes.war + shift;
      const x = readAt(link.i - 1, link.reg);
      const low = yi - D_ROW / 2 - D_GAP / 2;
      return [new Vector2(x, yi - D_ROW / 2), new Vector2(x, low), new Vector2(lane, low), new Vector2(lane, yj), new Vector2(this.writeX - half - 0.02, yj)];
    }
    const lane = this.lanes.waw + shift;
    return [new Vector2(this.writeX + half, yi), new Vector2(lane, yi), new Vector2(lane, yj), new Vector2(this.writeX + half + 0.02, yj)];
  }

  protected apply(next: DepsProps, previous: DepsProps | null, animate: Animate): void {
    const moving = !!animate && !!previous && !this.kit.reduced;
    const current = new Set(next.current ?? []);
    next.rows.forEach((row, r) => {
      this.pads[r]!.visible = current.has(r);
      const reads = this.reads[r] ?? [];
      const writes = this.writes[r] ?? [];
      const hotReads = new Set(next.hotReads?.[r] ?? []);
      const hotWrites = new Set(next.hotWrites?.[r] ?? []);
      const badReads = new Set(next.badReads?.[r] ?? []);
      reads.forEach((tag, i) => {
        const reg = row.reads[i] ?? '';
        const was = tag.text;
        tag.set(row.shown ? reg : ' ', badReads.has(reg) ? 'bad' : hotReads.has(reg) ? 'hot' : '');
        if (moving && was === ' ' && row.shown) rebound(this.kit, tag.group, 0.05, i * 40);
      });
      writes.forEach((tag, i) => {
        const reg = row.writes[i] ?? '';
        const was = tag.text;
        tag.set(row.shown ? reg : ' ', !row.shown ? '' : hotWrites.has(reg) ? 'hot' : 'dark');
        if (moving && was === ' ' && row.shown) rebound(this.kit, tag.group, 0.05, 80);
      });
    });
    const links = new Map(next.links.map((link) => [`${link.i}-${link.j}-${link.kind}-${link.reg}`, link]));
    let order = 0;
    for (const entry of this.strokes) {
      const link = links.get(entry.key);
      const on = !!link?.on;
      const tone = link?.tone ?? '';
      entry.stroke.setMaterial(hue(this.kit, toneHue(tone as LinkTone)));
      entry.label.set(entry.label.text, tone === 'hot' ? 'hot' : tone === 'bad' ? 'bad' : '');
      // 走道紧挨着寄存器牌，贴小牌会压住牌上的字：线旁不贴字，线形看图例，类型写在「为什么」里。
      entry.holder.visible = false;
      if (on && !entry.on && moving) entry.stroke.draw(timing.cause + order++ * 160);
      else entry.stroke.reveal(on ? 1 : 0);
      entry.on = on;
      entry.tone = tone;
    }
    this.kit.invalidate();
  }

  /** 'deps.行.列'：列 0 是第一张读牌，列 1 是写牌。 */
  override cellAnchor(r: number, c: number): Vector3 | null {
    const y = this.rowY[r];
    if (y === undefined) return null;
    const x = c === 0 ? (this.readX[r]?.[0] ?? null) : this.writeX;
    return x === null ? null : this.faceToWorld(x, y);
  }

  override dispose(): void {
    for (const text of this.texts) text.dispose();
    for (const line of [...this.reads, ...this.writes]) for (const tag of line) tag.dispose();
    for (const entry of this.strokes) entry.label.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}

definePart('5-spacetime:line', (kit, id, position, props) => new Line(kit, id, position, props as unknown as LineProps));
definePart('5-spacetime:chart', (kit, id, position, props) => new Chart(kit, id, position, props as unknown as ChartProps));
definePart('5-spacetime:deps', (kit, id, position, props) => new Deps(kit, id, position, props as unknown as DepsProps));

export type { CommonProps };
