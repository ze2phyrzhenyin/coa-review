import { Mesh } from 'three';
import { TextPlane, blockGeometry, box, cardGeometry } from '../kit';
import type { Kit } from '../kit';
import { linear } from '../motion';
import { timing } from '../theme';
import type { SheetProps, Vec2 } from '../types';
import { Part, solid } from './base';
import type { Animate } from './base';
import { estimateWidth } from './memory';

const ROW = 0.44;
const TEXT = 0.31;
const PAD = 0.22;

/**
 * 答题纸：斜立在台面上的一张纸，按考试版式一行一行填。只有新填的一行淡入，没有别的动画。
 * 当前步对应的行左边有一道强调色。
 */
export class Sheet extends Part<SheetProps> {
  private readonly rows: TextPlane[][] = [];
  private readonly all: TextPlane[] = [];
  private readonly marker: Mesh;
  private readonly rowY: number[] = [];
  private shown = 0;

  constructor(kit: Kit, id: string, position: Vec2, props: SheetProps) {
    super(kit, id, position);
    const widths = props.columns.map((title, c) => Math.max(estimateWidth(title, TEXT), ...props.rows.map((row) => estimateWidth(row[c] ?? '', TEXT))) + 0.32);
    const W = widths.reduce((sum, w) => sum + w, 0) + PAD * 2;
    const titleHeight = props.title ? 0.5 : 0;
    const H = titleHeight + (props.rows.length + 1) * ROW + PAD * 2;
    this.footprint = { w: W + 0.3, d: 0.7 };
    this.group.add(solid(new Mesh(blockGeometry(W + 0.3, 0.16, 0.7), kit.mats.block)));
    this.face.position.set(0, 0.19, 0.15);
    const board = solid(new Mesh(cardGeometry(W + 0.24, H + 0.24, 0.05, 0.1), kit.mats.plinth));
    board.position.set(0, H / 2, -0.08);
    const paper = solid(new Mesh(cardGeometry(W, H, 0.03, 0.03), kit.mats.tile));
    paper.position.set(0, H / 2, 0);
    this.face.add(board, paper);

    const left = -W / 2 + PAD;
    const xs: number[] = [];
    let x = left;
    for (const w of widths) {
      xs.push(x);
      x += w;
    }
    const top = H - PAD - titleHeight;
    if (props.title) {
      const title = new TextPlane(kit, props.title, { size: 0.33, tone: 'tileText', weight: 600, align: 'left' });
      title.place(left, H - PAD - 0.16);
      this.all.push(title);
      this.face.add(title.mesh);
    }
    const rule = (y: number, strong: boolean) => {
      const line = box(kit.mats.line, W - PAD * 1.2, strong ? 0.02 : 0.01, 0.004);
      line.position.set(0, y, 0.003);
      this.face.add(line);
    };
    props.columns.forEach((title, c) => {
      const head = new TextPlane(kit, title, { size: TEXT, tone: 'tileText', weight: 600, align: 'left' });
      head.place(xs[c]!, top - ROW / 2);
      this.all.push(head);
      this.face.add(head.mesh);
    });
    rule(top - ROW, true);
    props.rows.forEach((row, r) => {
      const y = top - ROW * (r + 1.5);
      this.rowY.push(y);
      const cells = props.columns.map((_, c) => {
        const cell = new TextPlane(kit, row[c] ?? '', { size: TEXT, tone: 'tileText', align: 'left', mono: /^[\d\s.+\-=A-Fa-fHhXx]+$/.test(row[c] ?? '') });
        cell.place(xs[c]!, y);
        cell.opacity = 0;
        this.all.push(cell);
        this.face.add(cell.mesh);
        return cell;
      });
      this.rows.push(cells);
      rule(y - ROW / 2, false);
    });
    this.marker = box(kit.mats.accent, 0.06, ROW - 0.16, 0.008);
    this.marker.visible = false;
    this.marker.position.set(left - 0.11, 0, 0.004);
    this.face.add(this.marker);
    this.faceHeight = H + 0.12;
    this.faceWidth = W + 0.24;
    this.update(props, false);
  }

  protected apply(next: SheetProps, _previous: SheetProps | null, animate: Animate): void {
    const shown = Math.max(0, Math.min(this.rows.length, next.shown));
    this.rows.forEach((cells, r) => {
      const visible = r < shown;
      const fresh = visible && r >= this.shown;
      for (const cell of cells) {
        if (fresh && animate && !this.kit.reduced) {
          cell.opacity = 0.001;
          this.kit.motion.add({ duration: timing.fade, ease: linear, update: (t) => (cell.opacity = t), done: () => (cell.opacity = 1) });
        } else {
          cell.opacity = visible ? 1 : 0;
        }
      }
    });
    this.shown = shown;
    const y = this.rowY[next.current ?? -1];
    this.marker.visible = y !== undefined;
    if (y !== undefined) this.marker.position.y = y;
  }

  override dispose(): void {
    for (const text of this.all) text.dispose();
    super.dispose();
  }
}
