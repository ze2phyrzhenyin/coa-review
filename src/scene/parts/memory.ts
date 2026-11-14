import { Mesh } from 'three';
import { TextPlane, blockGeometry, cardGeometry } from '../kit';
import type { Kit } from '../kit';
import { easeOut } from '../motion';
import { sizes, timing } from '../theme';
import type { MemoryProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { Card } from './card';

const ROW = 0.54;
const GAP = 0.05;
const HEAD = 0.46;
const PAD = 0.14;
const CELL = 0.35;

/** 估一段字的宽度（世界单位）：汉字按一个字高，其余按等宽字符。 */
export function estimateWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) width += /[⺀-鿿＀-￯]/.test(char) ? size : size * 0.62;
  return width;
}

/**
 * 存储阵列：一块斜立的板，上面按行排着格子，可以有标记、有效位等列。行左侧是行号或地址。
 * 正在访问的行有一圈深色的框，变了的格子翻面并标强调色。
 */
export class MemoryArray extends Part<MemoryProps> {
  private readonly cells: Card[][] = [];
  private readonly texts: TextPlane[] = [];
  private readonly chip: Card;
  private readonly frame: Mesh;
  private readonly rowY: number[] = [];
  private readonly colX: number[] = [];
  private readonly colW: number[] = [];
  /** 单独框出的格子。 */
  private cellFrame: Mesh | null = null;

  constructor(kit: Kit, id: string, position: Vec2, props: MemoryProps) {
    super(kit, id, position);
    const rows = props.rows.length;
    const widths = props.columns.map((column, c) =>
      Math.max(0.62, column.width ?? Math.max(estimateWidth(column.title, 0.33), ...props.rows.map((row) => estimateWidth(row[c] ?? '', CELL))) + 0.26),
    );
    const labelWidth = props.labels ? Math.max(...props.labels.map((label) => estimateWidth(label, 0.33))) + 0.16 : 0;
    const gridWidth = widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1);
    const W = gridWidth + labelWidth + PAD * 2;
    const H = HEAD + rows * (ROW + GAP) + PAD;
    this.footprint = { w: W + 0.2, d: 1.0 };
    this.group.add(solid(new Mesh(blockGeometry(W + 0.2, 0.26, 1.0), kit.mats.block)));
    this.face.position.set(0, 0.29, 0.25);
    const board = solid(new Mesh(cardGeometry(W, H, 0.05, 0.1), kit.mats.plinth));
    board.position.set(0, H / 2, -0.07);
    this.face.add(board);

    const left = -W / 2 + PAD + labelWidth;
    const xs: number[] = [];
    let x = left;
    for (const w of widths) {
      xs.push(x + w / 2);
      x += w + GAP;
    }
    this.colX.push(...xs);
    this.colW.push(...widths);
    props.columns.forEach((column, c) => {
      const head = new TextPlane(kit, column.title, { size: 0.33, tone: column.ink ?? 'muted' });
      head.place(xs[c]!, H - HEAD / 2 - 0.02);
      this.texts.push(head);
      this.face.add(head.mesh);
    });
    for (let r = 0; r < rows; r++) {
      const y = H - HEAD - (r + 0.5) * (ROW + GAP);
      this.rowY.push(y);
      if (props.labels?.[r] !== undefined) {
        const label = new TextPlane(kit, props.labels[r]!, { size: 0.33, tone: 'muted', mono: true, align: 'right' });
        label.place(left - 0.1, y);
        this.texts.push(label);
        this.face.add(label.mesh);
      }
      const line: Card[] = [];
      widths.forEach((w, c) => {
        const cell = new Card(kit, props.rows[r]?.[c] ?? '', { kind: 'tile', width: w, height: ROW, size: CELL, mono: true });
        cell.group.position.set(xs[c]!, y, 0);
        line.push(cell);
        this.face.add(cell.group);
      });
      this.cells.push(line);
    }
    this.frame = new Mesh(cardGeometry(gridWidth + 0.12, ROW + 0.12, 0.02, 0.09), kit.mats.chip);
    this.frame.position.set(left + gridWidth / 2, 0, -0.03);
    this.frame.visible = false;
    this.face.add(this.frame);

    this.chip = new Card(kit, props.name, { kind: 'chip', height: sizes.chipHeight, size: sizes.name, weight: 600, minWidth: 0.62 });
    this.chip.group.position.set(-W / 2 + this.chip.width / 2, H + 0.04 + sizes.chipHeight / 2, 0);
    this.face.add(this.chip.group);
    this.faceHeight = H + 0.04 + sizes.chipHeight;
    this.faceWidth = W;
    this.update(props, false);
  }

  protected apply(next: MemoryProps, previous: MemoryProps | null, animate: Animate): void {
    const changed = new Set(next.changedCells ?? []);
    this.cells.forEach((line, r) => {
      let k = 0;
      line.forEach((cell, c) => {
        const text = next.rows[r]?.[c] ?? '';
        if (cell.text !== text) {
          if (animate) cell.flipTo(text, k++ * timing.stagger);
          else cell.set(text);
        }
        cell.setChanged(changed.has(`${r}.${c}`));
      });
    });
    this.markCell(next.cell);
    const active = next.active ?? -1;
    const y = this.rowY[active];
    const wasVisible = this.frame.visible;
    this.frame.visible = y !== undefined;
    if (y === undefined) return;
    if (animate && wasVisible && !this.kit.reduced && Math.abs(this.frame.position.y - y) > 1e-3) {
      const from = this.frame.position.y;
      this.kit.motion.add({ duration: timing.cause, ease: easeOut, update: (t) => (this.frame.position.y = from + (y - from) * t), done: () => (this.frame.position.y = y) });
    } else {
      this.frame.position.y = y;
    }
  }

  private markCell(cell: string | undefined): void {
    const [r, c] = (cell ?? '').split('.').map(Number);
    const y = r === undefined ? undefined : this.rowY[r];
    const x = c === undefined ? undefined : this.colX[c];
    const w = c === undefined ? undefined : this.colW[c];
    if (y === undefined || x === undefined || w === undefined || !cell) {
      if (this.cellFrame) this.cellFrame.visible = false;
      return;
    }
    if (!this.cellFrame) {
      this.cellFrame = new Mesh(undefined, this.kit.mats.chip);
      this.face.add(this.cellFrame);
    }
    this.cellFrame.geometry = cardGeometry(w + 0.12, ROW + 0.12, 0.02, 0.09);
    this.cellFrame.position.set(x, y, -0.025);
    this.cellFrame.visible = true;
  }

  /** 一个格子中心的世界坐标。移动的值可以从这里出发、落到这里。 */
  cellAnchor(r: number, c: number) {
    const y = this.rowY[r];
    const x = this.colX[c];
    return y === undefined || x === undefined ? null : this.faceToWorld(x, y);
  }

  override dispose(): void {
    for (const line of this.cells) for (const cell of line) cell.dispose();
    for (const text of this.texts) text.dispose();
    this.chip.dispose();
    super.dispose();
  }
}
