import { Box3, Group, Mesh, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { TextPlane, blockGeometry, box, cardGeometry } from '../kit';
import type { Kit } from '../kit';
import { linear } from '../motion';
import { sizes } from '../theme';
import type { TrackMarker, TrackProps, TrackSegment, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { travelTime } from './token';

/** 一条道的高度：下面是条，上面留给标记的小牌。 */
const LANE = 1.0;
const BAR = 0.42;
const BAR_Y = 0.08;
const PAD = 0.16;
const TICKS = 0.46;
/** 板上的字比台面上的小字大一号：板的上半离镜头远，手机上仍不小于 12 像素。 */
const TEXT = 0.35;
const ELEVATION = (52 * Math.PI) / 180;

interface Drawn {
  key: string;
  bar: Mesh;
  text: TextPlane | null;
  x0: number;
  x1: number;
}

/**
 * 时间轴：一块正对屏幕立着的板，横向是时间，一条道一行，道名在左，刻度在下。
 * 板是立着的，所以横平竖直：时间线不斜，「现在」是一根竖线。
 * 新出现的一段从左往右长出来；标记是一根短线加一张小牌；connect 为真时，
 * 一段结束、另一条道上的一段在同一时刻开始的地方，画一根竖线把两条道连起来（进入、返回）。
 */
export class Track extends Part<TrackProps> {
  private readonly length: number;
  private readonly span: [number, number];
  private readonly depth: number;
  private readonly laneY: number[] = [];
  private readonly texts: TextPlane[] = [];
  private segments: Drawn[] = [];
  private markers: { key: string; post: Mesh; card: Card }[] = [];
  private links: Mesh[] = [];
  private linkKey = '';
  private readonly cursor: Mesh;
  private readonly chip: Card | null = null;
  private readonly left: number;
  private readonly H: number;
  private readonly W: number;

  constructor(kit: Kit, id: string, position: Vec2, props: TrackProps) {
    super(kit, id, position);
    this.length = props.length;
    this.span = props.span;
    const n = props.lanes.length;
    // 占地沿用平放时的大小（页面按它排版）；板立在这块地的前沿。
    this.depth = n * 1.25 + 0.5;
    const names = props.lanes.map((name) => new TextPlane(kit, name, { size: TEXT, tone: 'text', align: 'right' }));
    const labelW = Math.max(0, ...names.map((text) => text.width)) + 0.1;
    this.W = props.length + labelW + PAD * 2 + 0.2;
    this.H = n * LANE + (props.ticks?.length ? TICKS : 0) + PAD * 2;
    this.left = -this.W / 2 + PAD + labelW + 0.1;
    this.footprint = { w: this.W + 0.2, d: this.depth };
    const base = solid(new Mesh(blockGeometry(this.W + 0.2, 0.26, 1.0), kit.mats.block));
    base.position.z = this.depth / 2 - 0.5;
    this.group.add(base);
    this.face.position.set(0, 0.29, this.depth / 2 - 0.25);
    const board = solid(new Mesh(cardGeometry(this.W, this.H, 0.05, 0.1), kit.mats.plinth));
    board.position.set(0, this.H / 2, -0.07);
    this.face.add(board);
    names.forEach((text, i) => {
      // 第 0 条道在最上面。
      const y = this.H - PAD - (i + 1) * LANE;
      this.laneY.push(y);
      const rule = box(kit.mats.line, props.length, 0.02, 0.004);
      rule.position.set(this.left + props.length / 2, y + BAR_Y - 0.03, 0.002);
      this.face.add(rule);
      text.place(this.left - 0.12, y + BAR_Y + BAR / 2);
      this.texts.push(text);
      this.face.add(text.mesh);
    });
    for (const tick of props.ticks ?? []) {
      const x = this.x(tick.at);
      const mark = box(kit.mats.line, 0.02, 0.1, 0.004);
      mark.position.set(x, PAD + TICKS - 0.02, 0.002);
      const text = new TextPlane(kit, tick.text, { size: TEXT, tone: 'muted', mono: true });
      text.place(x, PAD + TICKS / 2 - 0.06);
      this.texts.push(text);
      this.face.add(mark, text.mesh);
    }
    const top = this.H - PAD;
    const bottom = this.laneY[n - 1] ?? PAD;
    this.cursor = box(kit.mats.accent, 0.045, top - bottom, 0.012);
    this.cursor.position.set(this.left, (top + bottom) / 2, 0.03);
    this.cursor.visible = false;
    this.face.add(this.cursor);
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      this.chip.group.position.set(-this.W / 2 + this.chip.width / 2, this.H + 0.04 + sizes.chipHeight / 2, 0);
      this.face.add(this.chip.group);
    }
    this.faceWidth = this.W;
    this.faceHeight = this.H + (this.chip ? 0.04 + sizes.chipHeight : 0);
    this.update(props, false);
  }

  private x(t: number): number {
    const [a, b] = this.span;
    return this.left + ((t - a) / Math.max(1e-9, b - a)) * this.length;
  }

  private material(ink: TrackSegment['ink']): MeshLambertMaterial {
    if (ink === 'accent') return this.kit.mats.accent;
    if (ink === 'muted' || ink === undefined) return this.kit.mats.line;
    return this.kit.mats[ink];
  }

  /** 这一段的条在板上的中线高度：high 的抬到道的上半。 */
  private barY(segment: TrackSegment): number {
    return (this.laneY[segment.lane] ?? 0) + BAR_Y + BAR / 2 + (segment.high ? LANE - BAR - BAR_Y - 0.06 : 0);
  }

  protected apply(next: TrackProps, _previous: TrackProps | null, animate: Animate): void {
    const keyOf = (s: TrackSegment) => `${s.lane}|${s.from}|${s.to}|${s.text ?? ''}|${s.ink ?? ''}|${s.high ? 1 : 0}`;
    const wanted = next.segments.map(keyOf);
    const kept: Drawn[] = [];
    for (const drawn of this.segments) {
      if (wanted.includes(drawn.key)) kept.push(drawn);
      else this.drop(drawn);
    }
    const have = new Set(kept.map((drawn) => drawn.key));
    const moving = !!animate && !this.kit.reduced;
    let delay = 0;
    next.segments.forEach((segment, i) => {
      if (have.has(wanted[i]!)) return;
      const drawn = this.draw(segment, wanted[i]!);
      kept.push(drawn);
      if (moving) delay += this.grow(drawn, delay);
    });
    this.segments = kept;
    this.connect(next, moving ? delay : 0);
    this.placeMarkers(next.markers ?? [], moving);
    this.moveCursor(next.now, moving);
  }

  private draw(segment: TrackSegment, key: string): Drawn {
    const x0 = this.x(segment.from);
    const x1 = this.x(segment.to);
    const y = this.barY(segment);
    const bar = solid(new Mesh(cardGeometry(Math.max(0.06, x1 - x0), BAR, 0.04, 0.05), this.material(segment.ink)));
    bar.position.set((x0 + x1) / 2, y, 0.02);
    this.face.add(bar);
    let text: TextPlane | null = null;
    if (segment.text) {
      // 字写在条里；条太短装不下时写在条的上方。
      text = new TextPlane(this.kit, segment.text, { size: TEXT, tone: 'chipText', weight: 600 });
      const inside = text.width <= x1 - x0 - 0.06;
      if (!inside) text.set(segment.text, { tone: 'text' });
      text.place((x0 + x1) / 2, inside ? y : y + BAR / 2 + TEXT * 0.62, 0.03);
      this.face.add(text.mesh);
    }
    return { key, bar, text, x0, x1 };
  }

  /** 从左往右长出来：时长按长度算，和值走线一样。 */
  private grow(drawn: Drawn, delay: number): number {
    const { bar, text, x0, x1 } = drawn;
    const duration = travelTime((x1 - x0) * 1.4);
    bar.scale.x = 0.001;
    bar.position.x = x0;
    if (text) text.opacity = 0;
    this.kit.motion.add({
      delay,
      duration,
      ease: linear,
      update: (t) => {
        bar.scale.x = Math.max(0.001, t);
        bar.position.x = x0 + ((x1 - x0) * t) / 2;
      },
      done: () => {
        bar.scale.x = 1;
        bar.position.x = (x0 + x1) / 2;
        if (text) text.opacity = 1;
      },
    });
    return duration;
  }

  private drop(drawn: Drawn): void {
    drawn.bar.removeFromParent();
    drawn.text?.dispose();
  }

  /** 进入、返回的竖线：一段在 t 结束，另一条道上有一段在 t 开始。 */
  private connect(props: TrackProps, delay: number): void {
    const pairs: [number, number, number][] = [];
    if (props.connect) {
      for (const a of props.segments) {
        const b = props.segments.find((other) => other.lane !== a.lane && other.from === a.to);
        if (b) pairs.push([a.to, this.barY(a), this.barY(b)]);
      }
    }
    const key = pairs.map((pair) => pair.join(',')).join(';');
    if (key === this.linkKey) return;
    const known = new Set(this.linkKey.split(';'));
    this.linkKey = key;
    for (const link of this.links) link.removeFromParent();
    this.links = pairs.map(([t, y0, y1]) => {
      const link = box(this.kit.mats.chip, 0.04, Math.abs(y1 - y0), 0.01);
      link.position.set(this.x(t), (y0 + y1) / 2, 0.025);
      this.face.add(link);
      // 新出现的竖线等那一段画完再出现。
      if (delay > 0 && !known.has([t, y0, y1].join(','))) {
        link.visible = false;
        this.kit.motion.after(delay, () => (link.visible = true));
      }
      return link;
    });
  }

  private placeMarkers(markers: TrackMarker[], animate: boolean): void {
    const keyOf = (m: TrackMarker) => `${m.at}|${m.text}|${m.lane ?? 0}|${m.ink ?? ''}`;
    const wanted = markers.map(keyOf);
    this.markers = this.markers.filter((marker) => {
      if (wanted.includes(marker.key)) return true;
      marker.post.removeFromParent();
      marker.card.dispose();
      return false;
    });
    markers.forEach((marker, i) => {
      if (this.markers.some((m) => m.key === wanted[i])) return;
      const x = this.x(marker.at);
      const y = (this.laneY[marker.lane ?? 0] ?? 0) + BAR_Y + BAR;
      const ink = marker.ink ?? 'accent';
      // 短线从条的上沿立起来，小牌挂在线的右边，都在这条道里。
      const post = box(ink === 'accent' ? this.kit.mats.accent : this.kit.mats[ink], 0.04, LANE - BAR - BAR_Y - 0.04, 0.012);
      post.position.set(x, y + (LANE - BAR - BAR_Y - 0.04) / 2, 0.03);
      this.face.add(post);
      const card = new Card(this.kit, marker.text, { kind: 'tile', height: 0.4, size: TEXT, minWidth: 0.42 });
      const cy = y + 0.04 + 0.2;
      card.group.position.set(x + 0.05 + card.width / 2, cy, 0.03);
      this.face.add(card.group);
      this.markers.push({ key: wanted[i]!, post, card });
      if (animate) {
        card.group.position.y = cy + 0.5;
        this.kit.motion.add({ duration: 240, update: (t) => (card.group.position.y = cy + 0.5 * (1 - t)), done: () => (card.group.position.y = cy) });
      }
    });
  }

  private moveCursor(now: number | undefined, animate: boolean): void {
    const was = this.cursor.visible;
    this.cursor.visible = now !== undefined;
    if (now === undefined) return;
    const x = this.x(now);
    const from = this.cursor.position.x;
    if (!animate || !was || Math.abs(from - x) < 1e-4) {
      this.cursor.position.x = x;
      return;
    }
    this.kit.motion.add({ duration: travelTime(Math.abs(x - from)), update: (t) => (this.cursor.position.x = from + (x - from) * t), done: () => (this.cursor.position.x = x) });
  }

  override bounds(): Box3 {
    const c = this.center;
    const front = c.z + this.depth / 2;
    const half = this.W / 2 + 0.1;
    // 板立在前沿，向后上方斜着：后沿按板高投到台面上算。
    return new Box3(
      new Vector3(c.x - half, 0, front - 0.75 - this.faceHeight * Math.sin(ELEVATION)),
      new Vector3(c.x + half, 0.29 + this.faceHeight * Math.cos(ELEVATION), front),
    );
  }

  override anchor(): Vector3 {
    return this.faceToWorld(this.cursor.visible ? this.cursor.position.x : this.left, this.H / 2);
  }

  override dispose(): void {
    for (const drawn of this.segments) this.drop(drawn);
    for (const marker of this.markers) marker.card.dispose();
    for (const text of this.texts) text.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
