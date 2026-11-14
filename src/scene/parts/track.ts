import { Box3, Group, Mesh, Vector3 } from 'three';
import type { MeshLambertMaterial } from 'three';
import { TextPlane, blockGeometry, box } from '../kit';
import type { Kit } from '../kit';
import { linear } from '../motion';
import { sizes } from '../theme';
import type { TrackMarker, TrackProps, TrackSegment, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { travelTime } from './token';

const LANE = 1.25;
const BAR = 0.26;

interface Drawn {
  key: string;
  bar: Mesh;
  label: Group | null;
  text: TextPlane | null;
}

/**
 * 时间轴：左边是道名，每条道上按时间画一段段的条（程序在运行、信号有效），刻度在前沿。
 * 新出现的一段从起点往右长出来，像笔画出来一样；标记是一根细杆加一张小牌；「现在」是一根竖线，随步平移。
 */
export class Track extends Part<TrackProps> {
  private readonly length: number;
  private readonly span: [number, number];
  private readonly laneZ: number[] = [];
  private laneWidth = 0;
  private readonly texts: TextPlane[] = [];
  private readonly facing: Group[] = [];
  private segments: Drawn[] = [];
  private markers: { key: string; post: Mesh; label: Group; card: Card }[] = [];
  private readonly cursor: Mesh;
  private readonly chip: Card | null = null;

  constructor(kit: Kit, id: string, position: Vec2, props: TrackProps) {
    super(kit, id, position);
    this.length = props.length;
    this.span = props.span;
    const D = props.lanes.length * LANE + 0.5;
    this.footprint = { w: props.length + 0.4, d: D };
    this.group.add(solid(new Mesh(blockGeometry(props.length + 0.4, 0.08, D, 0.05), kit.mats.plinth)));
    props.lanes.forEach((name, i) => {
      const z = -D / 2 + 0.3 + (i + 0.5) * LANE - 0.05;
      this.laneZ.push(z);
      const rule = box(kit.mats.line, props.length, 0.012, 0.025);
      rule.position.set(0, 0.09, z);
      this.group.add(rule);
      this.laneWidth = Math.max(this.laneWidth, this.label(name, -props.length / 2 - 0.14, z, 'right', 'text'));
    });
    for (const tick of props.ticks ?? []) {
      const x = this.x(tick.at);
      const mark = box(kit.mats.line, 0.025, 0.012, 0.22);
      mark.position.set(x, 0.09, D / 2 - 0.12);
      this.group.add(mark);
      this.label(tick.text, x, D / 2 + 0.22, 'center', 'muted', true);
    }
    this.cursor = box(kit.mats.accent, 0.05, 0.05, D - 0.2);
    this.cursor.position.y = 0.11;
    this.cursor.visible = false;
    this.group.add(this.cursor);
    if (props.name) {
      this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
      this.chip.group.position.set(this.chip.width / 2, sizes.chipHeight / 2, 0);
      const holder = this.holder(-props.length / 2 - 0.2, -D / 2 - 0.05);
      holder.add(this.chip.group);
    }
    this.update(props, false);
  }

  private x(t: number): number {
    const [a, b] = this.span;
    return -this.length / 2 + ((t - a) / Math.max(1e-9, b - a)) * this.length;
  }

  private holder(x: number, z: number, y = 0.1): Group {
    const group = new Group();
    group.position.set(x, y, z);
    this.group.add(group);
    this.kit.facing.add(group);
    this.facing.push(group);
    return group;
  }

  private label(text: string, x: number, z: number, align: 'left' | 'center' | 'right', tone: 'text' | 'muted', mono = false): number {
    const plane = new TextPlane(this.kit, text, { size: sizes.note, tone, align, mono });
    plane.place(0, sizes.note * 0.7);
    this.holder(x, z).add(plane.mesh);
    this.texts.push(plane);
    return plane.width;
  }

  private material(ink: TrackSegment['ink']): MeshLambertMaterial {
    if (ink === 'accent') return this.kit.mats.accent;
    if (ink === 'muted' || ink === undefined) return this.kit.mats.line;
    return this.kit.mats[ink];
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
    let delay = 0;
    next.segments.forEach((segment, i) => {
      if (have.has(wanted[i]!)) return;
      const drawn = this.draw(segment, wanted[i]!);
      kept.push(drawn);
      if (animate && !this.kit.reduced) delay += this.grow(drawn, segment, delay);
    });
    this.segments = kept;
    this.placeMarkers(next.markers ?? [], !!animate);
    this.moveCursor(next.now, !!animate);
  }

  private draw(segment: TrackSegment, key: string): Drawn {
    const x0 = this.x(segment.from);
    const x1 = this.x(segment.to);
    const z = this.laneZ[segment.lane] ?? 0;
    const height = segment.high ? 0.3 : 0.1;
    const bar = solid(new Mesh(blockGeometry(Math.max(0.05, x1 - x0), height, BAR, 0.03), this.material(segment.ink)));
    bar.position.set((x0 + x1) / 2, 0.08, z);
    this.group.add(bar);
    let label: Group | null = null;
    let text: TextPlane | null = null;
    if (segment.text) {
      text = new TextPlane(this.kit, segment.text, { size: sizes.note, tone: 'text', weight: 600 });
      text.place(0, sizes.note * 0.7);
      // 段上的字写在条的前面（台面上），标记的小牌在条的后面，两者不打架。
      label = this.holder((x0 + x1) / 2, z + BAR / 2 + 0.16, 0.02);
      label.add(text.mesh);
    }
    return { key, bar, label, text };
  }

  /** 从左往右长出来：时长按长度算，和值走线一样。 */
  private grow(drawn: Drawn, segment: TrackSegment, delay: number): number {
    const x0 = this.x(segment.from);
    const x1 = this.x(segment.to);
    const duration = travelTime((x1 - x0) * 1.4);
    const { bar, label } = drawn;
    bar.scale.x = 0.001;
    bar.position.x = x0;
    if (label) label.visible = false;
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
        if (label) label.visible = true;
      },
    });
    return duration;
  }

  private drop(drawn: Drawn): void {
    drawn.bar.removeFromParent();
    if (drawn.label) {
      this.kit.facing.delete(drawn.label);
      drawn.label.removeFromParent();
    }
    drawn.text?.dispose();
  }

  private placeMarkers(markers: TrackMarker[], animate: boolean): void {
    const keyOf = (m: TrackMarker) => `${m.at}|${m.text}|${m.lane ?? 0}|${m.ink ?? ''}`;
    const wanted = markers.map(keyOf);
    this.markers = this.markers.filter((marker) => {
      if (wanted.includes(marker.key)) return true;
      marker.post.removeFromParent();
      this.kit.facing.delete(marker.label);
      marker.label.removeFromParent();
      marker.card.dispose();
      return false;
    });
    markers.forEach((marker, i) => {
      if (this.markers.some((m) => m.key === wanted[i])) return;
      const x = this.x(marker.at);
      // 细杆立在这条道的条后面，小牌挂在杆顶右边，不压到段上的字，也够不到上一条道。
      const z = (this.laneZ[marker.lane ?? 0] ?? 0) - BAR / 2 - 0.08;
      const ink = marker.ink ?? 'accent';
      const post = solid(new Mesh(blockGeometry(0.05, 0.42, 0.05, 0.02), ink === 'accent' ? this.kit.mats.accent : this.kit.mats[ink]));
      post.position.set(x, 0.08, z);
      this.group.add(post);
      const card = new Card(this.kit, marker.text, { kind: 'tile', height: 0.42, size: sizes.note, minWidth: 0.42 });
      card.group.position.set(card.width / 2 + 0.06, 0.21, 0);
      const label = this.holder(x, z, 0.3);
      label.add(card.group);
      this.markers.push({ key: wanted[i]!, post, label, card });
      if (animate && !this.kit.reduced) {
        label.position.y = 1.1;
        this.kit.motion.add({ duration: 260, update: (t) => (label.position.y = 1.1 - 0.8 * t), done: () => (label.position.y = 0.3) });
      }
    });
  }

  private moveCursor(now: number | undefined, animate: boolean): void {
    this.cursor.visible = now !== undefined;
    if (now === undefined) return;
    const x = this.x(now);
    const from = this.cursor.position.x;
    if (!animate || this.kit.reduced || Math.abs(from - x) < 1e-4) {
      this.cursor.position.x = x;
      return;
    }
    this.kit.motion.add({ duration: travelTime(Math.abs(x - from)), update: (t) => (this.cursor.position.x = from + (x - from) * t), done: () => (this.cursor.position.x = x) });
  }

  override bounds(): Box3 {
    const box = super.bounds();
    const left = this.laneWidth + 0.3;
    box.min.x = this.center.x - this.length / 2 - left;
    box.max.z += 0.45;
    box.max.y = Math.max(box.max.y, 1.1);
    return box;
  }

  override dispose(): void {
    for (const drawn of this.segments) this.drop(drawn);
    for (const marker of this.markers) marker.card.dispose();
    for (const group of this.facing) this.kit.facing.delete(group);
    for (const text of this.texts) text.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
