/**
 * 答题控件。先写题面和提示，再放操作。
 * 点选题和窄屏上的题目放在舞台正下方，不盖住部件；宽屏上的填数题贴在焦点部件的旁边，也不盖住它。
 */
import { useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import type { Ask } from '../engines/trace';
import type { Rect } from '../scene';

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

export function Answer({ ask, picking, wrong, anchor, size, offStage, onAnswer, onPick, onReveal }: AnswerProps) {
  const [value, setValue] = useState('');
  const hint = wrong ? (
    <p class="pl-hint" role="status">
      不对。{ask.hint ?? '再看一遍这一步之前的状态。'}
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
        <p class="pl-prompt">{ask.prompt}</p>
        {hint ?? <p class="pl-note">点场景里的部件作答。</p>}
        <div class="pl-actions">
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

  const style = anchor && size.width > 0 ? beside(anchor, size) : null;
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() !== '') onAnswer(value);
  };

  return (
    <div class={`pl-ask ${style ? 'is-anchored' : 'is-dock'}`} style={style ?? undefined} data-no-orbit>
      <p class="pl-prompt">{ask.prompt}</p>
      {hint}
      {ask.kind === 'choice' ? (
        <div class="pl-actions">
          {(ask.options ?? []).map((option) => (
            <button key={option} type="button" class={`pl-btn${wrong?.value === option ? ' is-wrong' : ''}`} onClick={() => onAnswer(option)}>
              {option}
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
