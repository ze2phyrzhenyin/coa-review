import { TextPlane } from '../kit';
import type { Kit, TextTone } from '../kit';
import { sizes } from '../theme';
import type { LabelProps, Vec2 } from '../types';
import { Part } from './base';
import type { Animate } from './base';
import { Card } from './card';

/** 台面上立着的一行字，正对屏幕。plate 为真时画在一块小牌上（信号读数用）。 */
export class Label extends Part<LabelProps> {
  private text: TextPlane | null = null;
  private card: Card | null = null;

  constructor(kit: Kit, id: string, position: Vec2, props: LabelProps) {
    super(kit, id, position);
    const size = props.size ?? sizes.note;
    this.face.position.set(0, 0.03, 0);
    if (props.plate) {
      const height = size * 1.55;
      this.card = new Card(kit, props.text, { kind: 'tile', height, size, mono: props.mono ?? false, weight: props.weight ?? 500, minWidth: height });
      this.card.group.position.set(0, height / 2, 0);
      this.face.add(this.card.group);
      this.faceHeight = height;
    } else {
      this.text = new TextPlane(kit, props.text, { size, tone: this.tone(props), weight: props.weight ?? 500, mono: props.mono ?? false });
      this.text.place(0, size * 0.7);
      this.face.add(this.text.mesh);
      this.faceHeight = size * 1.4;
    }
    this.footprint = { w: 0.8, d: 0.3 };
    this.update(props, false);
  }

  private tone(props: LabelProps): TextTone {
    return props.changed ? 'accent' : (props.tone ?? 'text');
  }

  protected apply(next: LabelProps, previous: LabelProps | null, animate: Animate): void {
    const changedText = !previous || next.text !== previous.text;
    if (this.card) {
      if (changedText) {
        if (animate) this.card.flipTo(next.text);
        else this.card.set(next.text);
      }
      this.card.setChanged(!!next.changed);
      this.footprint = { w: this.card.width, d: 0.3 };
    } else if (this.text) {
      this.text.set(next.text, { tone: this.tone(next) });
      this.footprint = { w: Math.max(0.5, this.text.width), d: 0.3 };
    }
  }

  override dispose(): void {
    this.text?.dispose();
    this.card?.dispose();
    super.dispose();
  }
}
