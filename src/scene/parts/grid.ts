import { Mesh, Vector3 } from 'three';
import { TextPlane, blockGeometry, cardGeometry, discGeometry } from '../kit';
import type { Kit } from '../kit';
import { easeOut } from '../motion';
import { sizes, timing } from '../theme';
import type { GridProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';
import { rebound } from './effects';
import { estimateWidth } from './memory';

const ROW = 0.54;
const GAP = 0.05;
const HEAD = 0.46;
const PAD = 0.14;
const TEXT = 0.33;

/**
 * 时空格：斜立的板上，列是时间（时钟周期、访问次序），行是流水段、页框或设备。
 * 空格是凹下去的槽，填上时翻成白牌；停顿的格子放一个空泡。当前列有一圈深色框，随步平移。
 */
export class Grid extends Part<GridProps> {
  private readonly cells: Card[][] = [];
  private readonly texts: TextPlane[] = [];
  private readonly bubbles = new Map<string, Mesh>();
  private readonly chip: Card | null;
  private readonly frame: Mesh;
  private readonly colX: number[] = [];
  private readonly rowY: number[] = [];
  private readonly cellW: number;

  constructor(kit: Kit, id: string, position: Vec2, props: GridProps) {
    super(kit, id, position);
    const all = props.cells.flat();
    this.cellW = props.cellWidth ?? Math.max(0.62, ...all.map((text) => estimateWidth(text, sizes.value) + 0.26), ...props.columns.map((text) => estimateWidth(text, TEXT) + 0.16));
    const labelWidth = Math.max(0, ...props.rows.map((text) => estimateWidth(text, TEXT))) + 0.2;
    const gridWidth = props.columns.length * (this.cellW + GAP) - GAP;
    const W = gridWidth + labelWidth + PAD * 2;
    const H = HEAD + props.rows.length * (ROW + GAP) + PAD;
    this.footprint = { w: W + 0.2, d: 1.0 };
    this.group.add(solid(new Mesh(blockGeometry(W + 0.2, 0.26, 1.0), kit.mats.block)));
    this.face.position.set(0, 0.29, 0.25);
    const board = solid(new Mesh(cardGeometry(W, H, 0.05, 0.1), kit.mats.plinth));
    board.position.set(0, H / 2, -0.07);
    this.face.add(board);
    const left = -W / 2 + PAD + labelWidth;
    props.columns.forEach((title, c) => {
      const x = left + c * (this.cellW + GAP) + this.cellW / 2;
      this.colX.push(x);
      const head = new TextPlane(kit, title, { size: TEXT, tone: 'muted', mono: true });
      head.place(x, H - HEAD / 2 - 0.02);
      this.texts.push(head);
      this.face.add(head.mesh);
    });
    props.rows.forEach((title, r) => {
      const y = H - HEAD - (r + 0.5) * (ROW + GAP);
      this.rowY.push(y);
      const label = new TextPlane(kit, title, { size: TEXT, tone: 'muted', align: 'right' });
      label.place(left - 0.1, y);
      this.texts.push(label);
      this.face.add(label.mesh);
      const line: Card[] = [];
      props.columns.forEach((_, c) => {
        const text = props.cells[r]?.[c] ?? '';
        const cell = new Card(kit, text, { kind: text === '' ? 'slot' : 'tile', width: this.cellW, height: ROW, size: sizes.value * 0.92, mono: true });
        cell.group.position.set(this.colX[c]!, y, 0);
        line.push(cell);
        this.face.add(cell.group);
      });
      this.cells.push(line);
    });
    this.frame = new Mesh(cardGeometry(this.cellW + 0.12, props.rows.length * (ROW + GAP) + 0.07, 0.02, 0.09), kit.mats.chip);
    this.frame.visible = false;
    this.face.add(this.frame);
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

  private readonly frameY: number;

  protected apply(next: GridProps, _previous: GridProps | null, animate: Animate): void {
    const changed = new Set(next.changedCells ?? []);
    const stalls = new Set(next.bubbles ?? []);
    let k = 0;
    // 一列一列填，同一列从上往下错开。
    for (let c = 0; c < this.colX.length; c++) {
      for (let r = 0; r < this.cells.length; r++) {
        const cell = this.cells[r]![c]!;
        const key = `${r}.${c}`;
        const stall = stalls.has(key);
        const text = stall ? '' : (next.cells[r]?.[c] ?? '');
        const kind = text === '' ? 'slot' : 'tile';
        if (cell.text !== text) {
          if (animate) cell.flipTo(text, k++ * timing.stagger, kind);
          else {
            cell.set(text);
            cell.setKind(kind);
          }
        }
        cell.setChanged(changed.has(key));
        const tone = next.tones?.[key];
        if (tone === 'accent' && text !== '') cell.setKind('accent');
        this.bubble(key, stall, r, c, !!animate);
      }
    }
    const current = next.current ?? -1;
    const x = this.colX[current];
    const was = this.frame.visible;
    this.frame.visible = x !== undefined;
    if (x === undefined) return;
    if (animate && was && !this.kit.reduced && Math.abs(this.frame.position.x - x) > 1e-3) {
      const from = this.frame.position.x;
      this.kit.motion.add({ duration: timing.cause * 1.4, ease: easeOut, update: (t) => (this.frame.position.x = from + (x - from) * t), done: () => (this.frame.position.x = x) });
    } else {
      this.frame.position.set(x, this.frameY, -0.03);
    }
    this.frame.position.y = this.frameY;
    this.frame.position.z = -0.03;
  }

  /** 空泡：一颗扁圆的白片，塞进停顿的格子。 */
  private bubble(key: string, on: boolean, r: number, c: number, animate: boolean): void {
    let mesh = this.bubbles.get(key);
    if (!on) {
      if (mesh) mesh.visible = false;
      return;
    }
    if (!mesh) {
      mesh = new Mesh(discGeometry(), this.kit.mats.tile);
      mesh.rotation.x = Math.PI / 2;
      mesh.castShadow = true;
      this.bubbles.set(key, mesh);
      this.face.add(mesh);
    }
    const size = Math.min(this.cellW, ROW) * 0.62;
    mesh.scale.set(size, 0.08, size);
    mesh.position.set(this.colX[c]!, this.rowY[r]!, 0.05);
    if (!mesh.visible && animate && !this.kit.reduced) {
      mesh.visible = true;
      const target = mesh;
      this.kit.motion.add({ duration: 260, ease: easeOut, update: (t) => target.scale.set(size * t, 0.08, size * t), done: () => rebound(this.kit, target, 0.04, 0, 'z') });
    }
    mesh.visible = true;
  }

  override cellAnchor(r: number, c: number): Vector3 | null {
    const y = this.rowY[r];
    const x = this.colX[c];
    return y === undefined || x === undefined ? null : this.faceToWorld(x, y);
  }

  override dispose(): void {
    for (const line of this.cells) for (const cell of line) cell.dispose();
    for (const text of this.texts) text.dispose();
    this.chip?.dispose();
    super.dispose();
  }
}
