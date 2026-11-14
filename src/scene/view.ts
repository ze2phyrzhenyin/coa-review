/**
 * 把 SceneSpec 变成舞台上的部件，并在两步之间做转场。
 * 画面只取决于传进来的 Pose；转场只是从上一个 Pose 走到下一个 Pose 的过程，任何时候都可以立刻到位。
 */
import { Vector3 } from 'three';
import { Box3 } from 'three';
import { hashPose } from './pose';
import { Stage } from './stage';
import type { CamPose, Rect } from './stage';
import { timing } from './theme';
import type { Scheme } from './theme';
import type { Move, PartSpec, Patch, Pose, SceneSpec } from './types';
import { Part } from './parts/base';
import type { Animate, Side } from './parts/base';
import { BitRow } from './parts/bits';
import { Bus } from './parts/bus';
import { Gate } from './parts/gate';
import { Label } from './parts/label';
import { MemoryArray } from './parts/memory';
import { Register } from './parts/register';
import { Sheet } from './parts/sheet';
import { Balance } from './parts/balance';
import { CardStack } from './parts/stack';
import { Chip } from './parts/chip';
import { Compare } from './parts/compare';
import { Conveyor } from './parts/conveyor';
import { Decoder } from './parts/decoder';
import { Dial } from './parts/dial';
import { Grid } from './parts/grid';
import { Signal } from './parts/signal';
import { Track } from './parts/track';
import { localPart } from './define';
import { Path, Token, flightPath, sendValue } from './parts/token';
import { Wire, route } from './parts/wire';
import type { Kit } from './kit';

type AnyPart = Part<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function create(kit: Kit, spec: PartSpec, props: Patch): AnyPart {
  const merged = { ...spec.props, ...props };
  switch (spec.kind) {
    case 'register':
      return new Register(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'bus':
      return new Bus(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'gate':
      return new Gate(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'memory':
      return new MemoryArray(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'bits':
      return new BitRow(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'token':
      return new Token(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'sheet':
      return new Sheet(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'label':
      return new Label(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'chip':
      return new Chip(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'decoder':
      return new Decoder(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'grid':
      return new Grid(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'track':
      return new Track(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'signal':
      return new Signal(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'dial':
      return new Dial(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'balance':
      return new Balance(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'conveyor':
      return new Conveyor(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'stack':
      return new CardStack(kit, spec.id, spec.position, merged as typeof spec.props);
    case 'compare':
      return new Compare(kit, spec.id, spec.position, merged as typeof spec.props);
    default: {
      const factory = localPart(spec.kind);
      if (!factory) throw new Error(`没有登记的部件种类 ${spec.kind}：在 SceneSpec.kinds 加载的模块里用 definePart 登记`);
      return factory(kit, spec.id, spec.position, merged as typeof spec.props);
    }
  }
}

export interface ShowOptions {
  /** 假：直接切换。 */
  animate: boolean;
  /** 真：从上一步前进到这一步，值沿连线走；假：原地翻面。 */
  forward: boolean;
  moves: Move[];
  /** 临时看住这些部件（例如「弄坏它」时的第二个驱动者），不改这一步本来的镜头。 */
  frame?: string[];
}

export class SceneView {
  readonly stage: Stage;
  /** 画面稳定后调用。 */
  onSettle: (hash: string) => void = () => {};
  /** 部件在画面上的位置变了（换步、缩放、转动、改尺寸）。 */
  onRects: (rects: Record<string, Rect>) => void = () => {};

  private readonly parts = new Map<string, AnyPart>();
  private readonly delays = new Map<string, number>();
  private readonly wires = new Map<string, Wire>();
  private frames: string[][] = [[]];
  private extras: string[][] = [];
  private picks: string[][] = [];
  private asks: string[][] = [];
  /** 页面指定了这一步看哪些部件：就看它们，不退到落点。 */
  private pinned: boolean[] = [];
  /** 正在为第几步排镜头（wholeEdges 按那一步的画面判断哪些部件看得见）。 */
  private planning = 0;
  private targets: string[][] = [];
  private poses: Pose[] = [];
  private cams: CamPose[] = [];
  private index = 0;
  private pose: Pose;
  private generation = 0;

  constructor(
    private readonly host: HTMLElement,
    canvasHost: HTMLElement,
    spec: SceneSpec,
    initial: Pose,
  ) {
    this.stage = new Stage(host, canvasHost);
    this.pose = initial;
    const { kit } = this.stage;
    for (const partSpec of spec.parts) {
      const part = create(kit, partSpec, initial.parts[partSpec.id] ?? {});
      this.parts.set(partSpec.id, part);
      if (partSpec.delay) this.delays.set(partSpec.id, partSpec.delay);
      this.stage.root.add(part.group);
      this.stage.register(partSpec.id, part, !!partSpec.pick);
    }
    for (const wire of spec.wires) {
      const a = this.end(wire.from);
      const b = this.end(wire.to);
      if (!a.part || !b.part) continue;
      const via = (wire.via ?? []).map(([x, z]) => new Vector3(x, 0, z));
      let from;
      let to;
      if (a.pin || b.pin) {
        // 接在具名引脚上：引脚的位置是定的，另一头朝它出线。
        from = a.pin ?? a.part.port(a.side, via[0] ?? b.pin!.point);
        to = b.pin ?? b.part.port(b.side, via[via.length - 1] ?? from.point);
        if (!a.pin) from = a.part.port(a.side, via[0] ?? to.point);
      } else if (via.length > 0) {
        // 有拐点时，两端各自朝最近的拐点出线。
        from = a.part.port(a.side, via[0]!);
        to = b.part.port(b.side, via[via.length - 1]!);
      } else {
        from = a.part.port(a.side, b.part.center);
        to = b.part.port(b.side, from.point);
        from = a.part.port(from.side, to.point);
      }
      const made = new Wire(kit, wire.id, route(from, to, via), wire.ink ?? 'data');
      made.setActive(!!initial.wires[wire.id]);
      this.wires.set(wire.id, made);
      this.stage.root.add(made.group);
    }
    for (const part of this.parts.values()) {
      if (part instanceof Token) {
        part.resolve = (at) => this.dock(at);
        part.pathBetween = (from, to, via) => this.pathFor(from, to, via);
        part.settle();
      }
      if (part instanceof Signal) {
        part.resolve = (props) => this.signalRoute(props.from, props.to, props.via ?? [], props.offset ?? 0);
        part.connect();
      }
    }
    this.stage.layout();
    this.stage.onResize = () => this.replan(true);
    this.stage.onView = () => this.emitRects();
    this.replan(false);
    this.settleSoon();
  }

  private end(text: string): { part: AnyPart | undefined; side: Side | null; pin: { point: Vector3; side: Side } | null } {
    const dot = text.indexOf('.');
    const id = dot < 0 ? text : text.slice(0, dot);
    const rest = dot < 0 ? '' : text.slice(dot + 1);
    const part = this.parts.get(id);
    const side = rest === 'n' || rest === 's' || rest === 'e' || rest === 'w' ? rest : null;
    const pin = part && rest !== '' && side === null ? part.pin(rest) : null;
    return { part, side, pin };
  }

  /** 信号线的路线：和连线一样按两端的边、引脚、拐点算；offset 让几根平行线错开。 */
  private signalRoute(fromText: string, toText: string, via2: readonly (readonly [number, number])[], offset: number): Vector3[] {
    const a = this.end(fromText);
    const b = this.end(toText);
    if (!a.part || !b.part) return [];
    const via = via2.map(([x, z]) => new Vector3(x, 0, z));
    let from = a.pin ?? a.part.port(a.side, via[0] ?? b.pin?.point ?? b.part.center);
    const to = b.pin ?? b.part.port(b.side, via[via.length - 1] ?? from.point);
    if (!a.pin) from = a.part.port(from.side, via[0] ?? to.point);
    const shift = (end: { point: Vector3; side: Side }) => {
      const point = end.point.clone();
      if (end.side === 'n' || end.side === 's') point.x += offset;
      else point.z += offset;
      return { point, side: end.side };
    };
    return route(shift(from), shift(to), via);
  }

  /** 'mem.3.1' → 部件 mem 和格子 (3, 1)；普通 id 没有格子。 */
  private ref(at: string): { part: AnyPart | undefined; id: string; cell: [number, number] | null } {
    const [id = '', r, c] = at.split('.');
    return { part: this.parts.get(id), id, cell: r !== undefined && c !== undefined ? [Number(r), Number(c)] : null };
  }

  /** 值牌停在某个部件（或存储阵列的一个格子）上时的位置：比部件自己的值牌略靠前。 */
  private dock(at: string): Vector3 | null {
    const { part, cell } = this.ref(at);
    if (!part) return null;
    const toward = new Vector3(0, 0, 0.07).applyQuaternion(this.stage.camera.quaternion);
    const spot = cell ? part.cellAnchor(cell[0], cell[1]) : null;
    return (spot ?? part.anchor()).add(toward);
  }

  /** 从一个部件到另一个部件、依次经过这些连线的路。相邻两条线之间走直线；进出总线时沿导轨走。arc 时不沿线，抬高再落下。 */
  private pathFor(from: string, to: string, via: string[], arc = false): Path | null {
    const source = this.ref(from).part;
    const target = this.ref(to).part;
    if (!source || !target) return null;
    const a = this.dock(from)!;
    const b = this.dock(to)!;
    if (arc && via.length === 0) {
      const mid = a.clone().lerp(b, 0.5);
      mid.y = Math.max(a.y, b.y) + Math.min(1.2, 0.35 + a.distanceTo(b) * 0.25);
      return new Path([a, mid, b], 1.2);
    }
    let cursor = source.center;
    const points: Vector3[] = [];
    for (const id of via) {
      const wire = this.wires.get(id);
      if (!wire) continue;
      const first = wire.points[0]!;
      const last = wire.points[wire.points.length - 1]!;
      const ordered = first.distanceTo(cursor) <= last.distanceTo(cursor) ? wire.points : [...wire.points].reverse();
      points.push(...ordered);
      cursor = ordered[ordered.length - 1]!;
    }
    if (points.length > 0) {
      if (source instanceof Bus) points.unshift(new Vector3(points[0]!.x, 0, source.center.z));
      if (target instanceof Bus) points.push(new Vector3(points[points.length - 1]!.x, 0, target.center.z));
    }
    return flightPath(a, points, b);
  }

  // ---------- 镜头 ----------

  /**
   * 每一步镜头要看住哪些部件。frames[i] 一定要看住；extras[i] 装得下才一起看（例如等学生作答时，下一步要动的部件）。
   * poses[i] 是那一步的目标画面，部件的范围按它算（总线上的值牌会随步换位置）。
   * frames[i] 装不下时，只看住 targets[i]（值最后落下的部件；没给时取这一步变了的部件）：镜头从出发的地方移过去，正好跟着值走。
   * 镜头位置按步数从头推出来，所以回到第 n 步时与第一次到第 n 步时相同。
   */
  plan(frames: string[][], extras: string[][] = [], poses: Pose[] = [], targets: string[][] = [], picks: string[][] = [], asks: string[][] = [], pinned: boolean[] = []): void {
    this.picks = picks;
    this.asks = asks;
    this.pinned = pinned;
    this.frames = frames;
    this.targets = targets;
    this.extras = extras;
    this.poses = poses;
    this.replan(false);
  }

  private replan(resized: boolean): void {
    const { stage } = this;
    this.planning = 0;
    const all = [stage.sceneBox()];
    const boxesAt = (i: number, ids: string[]) => stage.boxesOf(ids, true, this.poses[i]?.parts);
    // 全景：整张台面装得下、字只比最小字号小一点时，镜头一直停在这里。完整的画面比略大的字要紧。
    const whole = stage.fit(all, false);
    // 差一点点也算装得下（值牌的字约 13 像素以上）：整张图比放大的局部更好读。
    const wholeFits = stage.scaleOf(whole) >= stage.legibleScale * stage.wholeSlack && stage.sees(whole, all, 0);
    const follow = (boxes: Box3[]) => this.follow(boxes);
    let pose = whole;
    if (!wholeFits) {
      const opening = this.frames.findIndex((ids) => ids.length > 0);
      const boxes = opening >= 0 ? boxesAt(opening, this.frames[opening]!) : [];
      if (boxes.length > 0) pose = follow(boxes).pose;
    }
    this.cams = [pose];
    this.planning = 0;
    for (let i = 1; i < this.frames.length; i++) {
      this.planning = i;
      const main = boxesAt(i, this.frames[i] ?? []);
      const more = boxesAt(i, this.extras[i] ?? []);
      // 点选题：全部候选（和这一步的焦点）在字不小于 14 像素时装得下，就一起放进画面。
      const choices = boxesAt(i, this.picks[i] ?? []);
      // 页面指定了这道题要看的部件：就看它们（题目问的格子、要比的式子），装不下的候选靠「看其余部件」。
      const asked = boxesAt(i, this.asks[i] ?? []);
      if (!wholeFits && asked.length > 0) {
        if (!stage.sees(pose, asked, 0.03)) pose = follow(asked).pose;
        this.cams.push(pose);
        continue;
      }
      if (!wholeFits && choices.length > 0) {
        // 这一步变了的部件优先：候选和它们一起装得下才一起看，否则先看这一步，候选靠「看其余部件」。
        const both = [...main, ...choices];
        const all = follow(both);
        if (all.fits) {
          if (!stage.sees(pose, both, 0.03)) pose = all.pose;
          this.cams.push(pose);
          continue;
        }
      }
      if (!wholeFits && main.length > 0 && this.pinned[i]) {
        // 页面指定的部件放在画面正中，不为了台面边上的留白或切边再挪。
        // 字号不变时一起装不下，就只看最后一个（页面把收值的部件放在最后），不让两头都被切掉一半。
        if (!stage.sees(pose, main, 0.03)) {
          const both = stage.fit(main, stage.legibleScale / stage.minScale, 0, true);
          pose = main.length > 1 && !stage.sees(both, main, 0) ? stage.fit(main.slice(-1), stage.legibleScale / stage.minScale, 0, true) : both;
        }
        this.cams.push(pose);
        continue;
      }
      if (!wholeFits && main.length > 0) {
        const both = [...main, ...more];
        if (!stage.sees(pose, both, 0.03)) {
          const wide = more.length > 0 ? follow(both) : null;
          if (wide?.fits) pose = wide.pose;
          else if (!stage.sees(pose, main, 0.03)) {
            const full = follow(main);
            // 装不下时先看值落下的部件，没有移动时看变了的部件。
            const landing = this.targets[i] ?? [];
            const changed = landing.length > 0 ? landing : (this.frames[i] ?? []).filter((id) => this.poses[i]?.parts[id]?.changed);
            const core = changed.length > 0 && !full.fits ? boxesAt(i, changed) : [];
            const near = core.length > 0 ? follow(core) : null;
            // 落点还分在两处时，看第一处（例如 ADD 的 T3：DR 和 PSWR 在两头）。
            pose = near ? (near.fits || core.length === 1 ? near.pose : follow(core.slice(0, 1)).pose) : full.pose;
          }
        }
      }
      this.cams.push(pose);
    }
    stage.moveTo(this.cams[this.index] ?? pose, false);
    if (resized) this.emitRects();
  }

  /** 看住这些范围：先按正常字号；装不下时缩小，但值牌上的字不小于 14 像素。画面不滑出台面。 */
  private follow(boxes: Box3[]): { pose: CamPose; fits: boolean } {
    const { stage } = this;
    let pose = stage.fit(boxes, 1, 0, true);
    if (!stage.sees(pose, boxes, 0)) pose = stage.fit(boxes, stage.legibleScale / stage.minScale, 0, true);
    pose = this.wholeEdges(stage.keepInScene(pose), boxes);
    return { pose, fits: stage.sees(pose, boxes, 0) };
  }

  /**
   * 画面边上不切半个部件：被边切开的格子、牌，要么整个挪进来，要么整个挪出去。先左右，再上下。
   * 在几种平移里挑切开最少、要看的部件仍在画面里、移动最小的。很宽、很高的部件（总线、主存板这类）不算。
   */
  private wholeEdges(pose: CamPose, keep: Box3[]): CamPose {
    return this.edgeAxis(this.edgeAxis(pose, keep, 'x'), keep, 'y');
  }

  private edgeAxis(pose: CamPose, keep: Box3[], axis: 'x' | 'y'): CamPose {
    const { stage } = this;
    const size = axis === 'x' ? stage.width : stage.height;
    const lead = (r: Rect) => (axis === 'x' ? r.x : r.y);
    const span = (r: Rect) => (axis === 'x' ? r.w : r.h);
    // 整张台面在这个方向放得下时不用挪。
    const all = stage.project(stage.sceneBox(), pose);
    if (lead(all) >= -1 && lead(all) + span(all) <= size + 1) return pose;
    // 这一步隐藏的部件不算；很大的部件被切开是常态，也不算。
    const props = this.poses[this.planning]?.parts ?? this.pose.parts;
    const list = [...this.parts.entries()]
      .filter(([id]) => !props[id]?.hidden)
      .map(([, part]) => stage.project(part.bounds(), pose))
      .filter((r) => span(r) < size * 0.6)
      .map((r) => ({ at: lead(r), len: span(r) }));
    const cutsAfter = (d: number) => list.filter((r) => (r.at + d < 0 && r.at + r.len + d > 0) || (r.at + d < size && r.at + r.len + d > size)).length;
    if (cutsAfter(0) === 0) return pose;
    const shifts = new Set<number>([0]);
    for (const r of list) {
      if (r.at < size && r.at + r.len > size) {
        shifts.add(size - (r.at + r.len) - 4);
        shifts.add(size - r.at + 2);
      }
      if (r.at < 0 && r.at + r.len > 0) {
        shifts.add(-r.at + 4);
        shifts.add(-(r.at + r.len) - 2);
      }
    }
    const unit = 1 / stage.scaleOf(pose);
    const moved = (d: number): CamPose => {
      const target = pose.target.clone();
      if (axis === 'x') {
        target.x -= d * unit * Math.cos(pose.az);
        target.z += d * unit * Math.sin(pose.az);
      } else {
        // 画面上往下移 d 像素，镜头的目标点往远处（-z）挪 d / sin(俯角)。
        const along = (d * unit) / Math.sin(pose.el);
        target.x += along * Math.sin(pose.az);
        target.z -= along * Math.cos(pose.az);
      }
      return { ...pose, target };
    };
    let best = { d: 0, cuts: cutsAfter(0), ok: stage.sees(pose, keep, 0) };
    for (const d of shifts) {
      if (Math.abs(d) > size * 0.4) continue;
      const cuts = cutsAfter(d);
      const ok = stage.sees(moved(d), keep, 0);
      const better = (ok && !best.ok) || (ok === best.ok && (cuts < best.cuts || (cuts === best.cuts && Math.abs(d) < Math.abs(best.d))));
      if (better) best = { d, cuts, ok };
    }
    return best.d === 0 ? pose : moved(best.d);
  }

  /** 临时把这些部件放进画面（已经都在画面里就不动）。返回镜头要走多久。 */
  private peek(ids: string[], parts?: Record<string, Record<string, unknown>>): number {
    const { stage } = this;
    // 落点：值牌停靠的位置附近（空着的总线没有范围，也要能看到值落在哪）。
    const spot = this.dock(ids[ids.length - 1]!);
    const last = spot ? [new Box3(spot.clone().add(new Vector3(-1.2, -0.6, -0.9)), spot.clone().add(new Vector3(1.2, 0.6, 0.9)))] : [];
    const boxes = [...stage.boxesOf(ids.map((at) => this.ref(at).id), true, parts), ...last];
    if (boxes.length === 0 || stage.sees(stage.goal, boxes, 0.03)) return 0;
    // 两头装不下时看落点，不让值落在画面外。
    const both = this.follow(boxes);
    const pose = both.fits || last.length === 0 ? both.pose : stage.sees(stage.goal, last, 0.03) ? null : this.follow(last).pose;
    if (!pose) return 0;
    stage.moveTo(pose, true);
    this.emitRects();
    return stage.kit.reduced ? 0 : timing.camera;
  }

  /** 让学生看这些部件（例如装不下的其余候选）。下一次换步时回到那一步的镜头。 */
  lookAt(ids: string[]): void {
    this.peek(ids, this.pose.parts);
  }

  /** 这些部件在当前镜头下是否都在画面里。 */
  seesAll(ids: string[]): boolean {
    const boxes = this.stage.boxesOf(ids, true, this.pose.parts);
    return boxes.length > 0 && this.stage.sees(this.stage.goal, boxes, 0);
  }

  private cam(): CamPose {
    return this.cams[this.index] ?? this.cams[0] ?? this.stage.goal;
  }

  /** 每个部件在画面上的位置，按这一步镜头的目标位置算（不等镜头走到）。 */
  rects(): Record<string, Rect> {
    const out: Record<string, Rect> = {};
    // 按镜头正要去的位置算（临时看别处时也对得上）。
    const cam = this.stage.goal;
    for (const id of this.parts.keys()) {
      const rect = this.stage.rectOf(id, cam);
      if (rect) out[id] = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    }
    return out;
  }

  private emitRects(): void {
    this.onRects(this.rects());
  }

  get size(): { width: number; height: number } {
    return { width: this.stage.width, height: this.stage.height };
  }

  // ---------- 换步 ----------

  show(index: number, pose: Pose, options: ShowOptions): void {
    const { stage } = this;
    const { kit, motion } = stage;
    // 输入优先：上一段动画立刻到位，再开始这一段。
    motion.finishAll();
    for (const part of this.parts.values()) part.dim(false, true);
    this.applyAll(this.pose, false);
    const generation = ++this.generation;
    this.index = index;
    this.pose = pose;
    this.host.dataset.settled = 'false';

    // 摘要是目标画面的，换步一开始就写上（稳定后 data-settled 才变 true）。
    this.host.dataset.sceneHash = hashPose(pose);
    const animate = options.animate && !kit.reduced;
    stage.ensureVisible(this.cam(), stage.boxesOf(this.frames[index] ?? [], true, pose.parts));
    stage.moveTo(this.cam(), animate);
    if (options.frame) this.peek(options.frame, pose.parts);
    // 临时看别处（弄坏它）时，演完停在那里，不回到这一步本来的镜头。
    const cam = options.frame ? stage.goal : this.cam();
    this.emitRects();

    const moves = options.forward ? options.moves.filter((move) => this.ref(move.from).part && this.ref(move.to).part) : [];
    if (!animate) {
      this.applyAll(pose, false);
    } else if (moves.length === 0) {
      this.applyAll(pose, 'flip');
    } else {
      // 起因（门、信号）→ 值沿线走 → 落进接收的部件 → 其余读数更新。同一步里的几个移动一起走。
      const arriving = new Set(moves.map((move) => this.ref(move.to).id));
      const pending = new Set<string>();
      for (const [id, part] of this.parts) {
        if (!arriving.has(id) && part.cause) this.flip(id, pose);
        else {
          pending.add(id);
          // 台面上的标记（焦点、可点选）不等值走到，一开始就换成这一步的。
          part.setMarks(!!pose.parts[id]?.focus, !!pose.parts[id]?.pickable);
        }
      }
      // 先放好总线上值牌的位置，走动的值才落在牌该停的地方。
      for (const [id, part] of this.parts) part.place(pose.parts[id] ?? {});
      // 按先后分批：一批落下，下一批才出发。同一部件在后面还要接收时，先显示这一批带来的值。
      // 一批的两头不在这一步的镜头里时，镜头先移过去，值不在画面外走。
      // 同一批里落点分在两处、画面装不下两头时，按落点拆开先后走（例如 ADD 的 T3：DR 和 PSWR），镜头一处一处跟过去。
      if (!kit.reduced) {
        const byPhase = new Map<number, Move[]>();
        for (const move of moves) byPhase.set(move.phase ?? 0, [...(byPhase.get(move.phase ?? 0) ?? []), move]);
        let shift = 0;
        const respaced: Move[] = [];
        for (const phase of [...byPhase.keys()].sort((x, y) => x - y)) {
          const batch = byPhase.get(phase)!;
          const targets = [...new Set(batch.map((move) => this.ref(move.to).id))];
          const boxes = stage.boxesOf(batch.flatMap((move) => [this.ref(move.from).id, this.ref(move.to).id]), true, pose.parts);
          const split = targets.length > 1 && !this.follow(boxes).fits;
          for (const move of batch) respaced.push({ ...move, phase: phase + shift + (split ? targets.indexOf(this.ref(move.to).id) : 0) });
          if (split) shift += targets.length - 1;
        }
        moves.splice(0, moves.length, ...respaced);
      }
      const phases = [...new Set(moves.map((move) => move.phase ?? 0))].sort((x, y) => x - y);
      const lastFor = new Map<string, Move>();
      // 同一个部件既收信号又收值时，以最后落下的值为准（脉冲先到、值落下时打入）。
      for (const move of moves) {
        const id = this.ref(move.to).id;
        const card = !move.shape || move.shape === 'card';
        const known = lastFor.get(id);
        if (!known || card || (known.shape && known.shape !== 'card')) lastFor.set(id, move);
      }
      // 主角之外的部件变淡一点，走完恢复。
      const cast = new Set(moves.flatMap((move) => [this.ref(move.from).id, this.ref(move.to).id]));
      if (this.parts.size > cast.size + 2) for (const [id, part] of this.parts) if (!cast.has(id)) part.dim(true);
      // 两头装不下时看落点：镜头和值一起出发，值从上一批停下的地方飞进来，镜头跟着它走到落点。
      const views = phases.map((phase) => {
        const batch = moves.filter((move) => (move.phase ?? 0) === phase);
        const boxes = stage.boxesOf(batch.flatMap((move) => [this.ref(move.from).id, this.ref(move.to).id]), true, pose.parts);
        if (boxes.length === 0 || stage.sees(cam, boxes, 0)) return cam;
        const both = this.follow(boxes);
        if (both.fits) return both.pose;
        const landing = stage.boxesOf(batch.map((move) => this.ref(move.to).id), true, pose.parts);
        return landing.length > 0 && stage.sees(cam, landing, 0) ? cam : this.follow(landing.length ? landing : boxes).pose;
      });
      let start = timing.cause;
      let looking = cam;
      phases.forEach((phase, k) => {
        const view = views[k]!;
        if (view !== looking) {
          if (k === 0) stage.moveTo(view, true);
          else motion.after(start, () => generation === this.generation && stage.moveTo(view, true));
          looking = view;
        }
        let longest = 0;
        for (const move of moves.filter((item) => (item.phase ?? 0) === phase)) {
          const path = this.pathFor(move.from, move.to, move.via ?? [], move.arc);
          if (!path) continue;
          const at = start;
          motion.after(at, () => {
            for (const id of move.via ?? []) this.wires.get(id)?.setActive(true);
          });
          const target = this.ref(move.to).id;
          const signal = move.shape === 'pulse' || move.shape === 'level';
          const took = sendValue(kit, stage.root, move.value, move.ink ?? (signal ? 'ctrl' : 'data'), path, at, () => {
            if (generation !== this.generation) return;
            const final = lastFor.get(target) === move;
            if (signal) {
              // 信号到了：没有值要落进这个部件时，它按这一步的样子变（门打开、芯片抬起）。
              if (final) {
                pending.delete(target);
                this.parts.get(target)?.update(pose.parts[target] ?? {}, 'flip');
              }
              return;
            }
            if (final) pending.delete(target);
            const props = pose.parts[target] ?? {};
            this.parts.get(target)?.update(final || !('value' in props) ? props : { ...props, value: move.value }, 'land');
          }, move.shape ?? 'card');
          longest = Math.max(longest, took);
        }
        start += longest + 60;
      });
      if (looking !== cam) {
        motion.after(start, () => generation === this.generation && stage.moveTo(cam, true));
      }
      motion.after(start, () => {
        for (const part of this.parts.values()) part.dim(false);
        if (generation !== this.generation) return;
        for (const id of pending) this.flip(id, pose);
        for (const [id, wire] of this.wires) wire.setActive(!!pose.wires[id]);
      });
    }
    this.settleSoon();
  }

  /**
   * 学生刚按了换步：马上标成「未稳定」，不等页面重新渲染。之后的 show() 接手；
   * 如果步数又被改回原处、show() 没有来，过一会儿按当前画面重新稳定。
   */
  hold(): void {
    const generation = ++this.generation;
    this.host.dataset.settled = 'false';
    setTimeout(() => {
      if (generation === this.generation) this.settleSoon();
    }, 600);
  }

  /** 原地翻面；部件声明了 delay 时晚一点开始。 */
  private flip(id: string, pose: Pose): void {
    const delay = this.delays.get(id) ?? 0;
    const part = this.parts.get(id);
    if (!part) return;
    const generation = this.generation;
    if (delay > 0 && !this.stage.kit.reduced) {
      part.setMarks(!!pose.parts[id]?.focus, !!pose.parts[id]?.pickable);
      this.stage.motion.after(delay, () => generation === this.generation && part.update(pose.parts[id] ?? {}, 'flip'));
    } else part.update(pose.parts[id] ?? {}, 'flip');
  }

  private applyAll(pose: Pose, animate: Animate): void {
    if (animate === 'flip') {
      for (const id of this.parts.keys()) this.flip(id, pose);
      for (const [id, wire] of this.wires) wire.setActive(!!pose.wires[id]);
      return;
    }
    for (const [id, part] of this.parts) part.update(pose.parts[id] ?? {}, animate);
    for (const [id, wire] of this.wires) wire.setActive(!!pose.wires[id]);
  }

  private settleSoon(): void {
    const generation = this.generation;
    this.stage.whenIdle(() => {
      if (generation !== this.generation) return;
      this.applyAll(this.pose, false);
      const hash = hashPose(this.pose);
      this.host.dataset.sceneHash = hash;
      // 画面上最小的字号，自动检查用（手机上不应小于 12 像素）。
      const smallest = this.stage.minTextPx();
      this.host.dataset.minText = String(smallest.px);
      this.host.dataset.minTextLabel = smallest.text;
      // 互相压住的字，自动检查用。
      this.host.dataset.textOverlaps = this.stage.textOverlaps().join('；');
      this.host.dataset.settled = 'true';
      this.emitRects();
      this.onSettle(hash);
    });
  }

  /**
   * 按学生选错的答案演一遍后果：值从 from 飞到 to，落进去，部件轻摇，过一会儿退回本来的画面。
   * 只是演示，不改目标画面。
   */
  rehearse(value: string, from: string, to: string, ink: Move['ink'] = 'data'): void {
    const { stage } = this;
    const source = this.ref(from).part;
    const target = this.ref(to).part;
    if (!source || !target) {
      this.shake(this.ref(to).id);
      return;
    }
    stage.motion.finishAll();
    this.applyAll(this.pose, false);
    const generation = ++this.generation;
    this.host.dataset.settled = 'false';
    const targetId = this.ref(to).id;
    const restore = () => {
      if (generation !== this.generation) return;
      target.update(this.pose.parts[targetId] ?? {}, 'flip');
      stage.moveTo(this.cam(), true);
    };
    if (stage.kit.reduced) {
      // 减少动态效果：不飞，直接把后果的样子摆出来（值已经在学生点的部件里），过一会儿退回。
      const props = this.pose.parts[targetId] ?? {};
      target.update({ ...props, ...('value' in props ? { value } : {}), changed: true }, false);
      stage.invalidate();
      stage.motion.after(1600, restore);
      this.settleSoon();
      return;
    }
    // 学生点的部件可能不在画面里：先把两头都放进画面，演完再回到这一步的镜头。
    const wait = this.peek([from, to], this.pose.parts);
    const a = this.dock(from)!;
    const b = this.dock(to)!;
    const mid = a.clone().lerp(b, 0.5);
    mid.y = Math.max(a.y, b.y) + 1.1;
    const path = new Path([a, mid, b], 1.2);
    const took = wait + sendValue(stage.kit, stage.root, value, ink ?? 'data', path, wait + 60, () => {
      if (generation !== this.generation) return;
      const props = this.pose.parts[targetId] ?? {};
      target.update({ ...props, ...('value' in props ? { value } : {}), changed: true }, 'land');
      target.shake();
    });
    stage.motion.after(took + 60 + 1100, restore);
    this.emitRects();
    this.settleSoon();
  }

  /** 被拒绝的选择：这个部件轻摇一下。 */
  shake(id: string): void {
    this.parts.get(id)?.shake();
  }

  setScheme(scheme: Scheme): void {
    this.stage.setScheme(scheme);
  }

  dispose(): void {
    this.generation++;
    for (const part of this.parts.values()) part.dispose();
    for (const wire of this.wires.values()) wire.dispose();
    this.stage.dispose();
  }
}
