/**
 * 答题控件。先写题面和提示，再放操作。
 * 点选题和窄屏上的题目放在舞台正下方，不盖住部件；宽屏上的填数题贴在焦点部件的旁边，也不盖住它。
 */
import { useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import type { Ask } from '../engines/trace';
import type { Rect } from '../scene';
import { Rich } from './Rich';

export interface AnswerProps {
  ask: Ask;
  /** 用点部件来答。 */
  picking: boolean;
  wrong: { count: number; value: string } | null;
  /** 贴着的部件在舞台里的位置。null 表示放在舞台下方。 */
  anchor: Rect | null;
  size: { width: number; height: number };
  /** 点选题里不在画面上的选项：给出按钮，学生不用找。 */
  offStage: string[];
  onAnswer: (value: string) => void;
  onPick: (option: string) => void;
  onReveal: () => void;
  /** 点选题的候选不全在画面里时，让镜头去看其余的。 */
  onLook?: (() => void) | undefined;
  /** 页面按学生的答案演出的后果，一句话。 */
  consequence?: string | undefined;
  /** 点了不是候选的部件时的说明。 */
  note?: string | undefined;
  /** 翻位片作答：当前翻出的位串（空格是没翻的位）、翻第 i 位。 */
  flip?: { bits: string; toggle: (i: number) => void } | undefined;
}

const placeholders: Record<Ask['kind'], string> = { choice: '', bits: '例如 0101', number: '填一个数', text: '' };
const PANEL = 280;

/** 放在部件左边或右边，竖直方向对齐部件；两边都放不下时返回 null。 */
function beside(anchor: Rect, size: { width: number; height: number }): CSSProperties | null {
  const gap = 12;
  const right = anchor.x + anchor.w + gap;
  const left = anchor.x - gap - PANEL;
  const x = right + PANEL <= size.width - 8 ? right : left >= 8 ? left : null;
  if (x === null) return null;
  const top = Math.round(Math.max(8, Math.min(size.height - 170, anchor.y + anchor.h / 2 - 60)));
  return { left: `${Math.round(x)}px`, top: `${top}px`, width: `${PANEL}px` };
}

export function Answer({ ask, picking, wrong, anchor, size, offStage, onAnswer, onPick, onReveal, onLook, flip, note, consequence }: AnswerProps) {
  const [value, setValue] = useState('');
  const hint = wrong ? (
    <p class="pl-hint" role="status">
      {consequence ? (
        <>
          <Rich text={consequence} />{' '}
        </>
      ) : null}
      不对。<Rich text={ask.hint ?? '再看一遍这一步之前的状态。'} />
    </p>
  ) : null;
  const reveal = (
    <button type="button" class="pl-btn is-quiet" onClick={onReveal}>
      看答案
    </button>
  );

  if (picking) {
    return (
      <div class="pl-ask is-dock" data-no-orbit>
        <p class="pl-prompt">
          <Rich text={ask.prompt} />
        </p>
        {hint ?? <p class="pl-note">点场景里的部件作答。</p>}
        {note ? (
          <p class="pl-hint" role="status">
            <Rich text={note} />
          </p>
        ) : null}
        <div class="pl-actions">
          {onLook ? (
            <button type="button" class="pl-btn" onClick={onLook}>
              看其余部件
            </button>
          ) : null}
          {offStage.map((option) => (
            <button key={option} type="button" class={`pl-btn${wrong?.value === option ? ' is-wrong' : ''}`} onClick={() => onPick(option)}>
              {option}
            </button>
          ))}
          {reveal}
        </div>
      </div>
    );
  }

  if (flip) {
    const complete = !flip.bits.includes(' ');
    return (
      <div class="pl-ask is-dock" data-no-orbit>
        <p class="pl-prompt">
          <Rich text={ask.prompt} />
        </p>
        {hint ?? <p class="pl-note">点场景里的位片翻面，翻好后按确定。</p>}
        <div class="pl-actions">
          {[...flip.bits].map((bit, i) => (
            <button key={i} type="button" class="pl-btn pl-bit" data-bit={i} aria-label={`第 ${i + 1} 位，${bit === ' ' ? '还没翻' : bit}`} onClick={() => flip.toggle(i)}>
              {bit === ' ' ? '?' : bit}
            </button>
          ))}
          <button type="button" class="pl-btn is-primary" disabled={!complete} onClick={() => onAnswer(flip.bits)}>
            确定
          </button>
          {reveal}
        </div>
      </div>
    );
  }

  const style = anchor && size.width > 0 ? beside(anchor, size) : null;
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() !== '') onAnswer(value);
  };

  return (
    <div class={`pl-ask ${style ? 'is-anchored' : 'is-dock'}`} style={style ?? undefined} data-no-orbit>
      <p class="pl-prompt">
        <Rich text={ask.prompt} />
      </p>
      {hint}
      {ask.kind === 'choice' ? (
        <div class="pl-actions">
          {(ask.options ?? []).map((option) => (
            <button key={option} type="button" class={`pl-btn${wrong?.value === option ? ' is-wrong' : ''}`} onClick={() => onAnswer(option)}>
              <Rich text={option} />
            </button>
          ))}
          {reveal}
        </div>
      ) : (
        <>
          <form class="pl-fill" onSubmit={submit}>
            <input
              class="pl-input"
              type="text"
              inputMode={ask.kind === 'text' ? 'text' : ask.kind === 'bits' ? 'numeric' : 'decimal'}
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              aria-label={ask.prompt}
              placeholder={placeholders[ask.kind]}
              value={value}
              onInput={(event) => setValue(event.currentTarget.value)}
            />
            <button type="submit" class="pl-btn is-primary">
              确定
            </button>
          </form>
          <div class="pl-actions">{reveal}</div>
        </>
      )}
    </div>
  );
}
