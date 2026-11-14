import type { ComponentChildren } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { findTerm } from '../content/glossary';
import { pages } from '../content/pages';
import { Rich } from '../player/Rich';
import { currentPath } from './router';

/**
 * 术语卡：正文里的术语带虚下划线，点一下（或 Tab 到它按 Enter）弹出一句定义和教材页码。
 * 再点、按 Esc、点别处、焦点移走、滚动都会关上；同一时刻只开一张。卡片紧跟在按钮后面（Tab 的下一站），
 * 用 position: fixed 浮在上层，不被滚动容器裁掉。用法见 docs/DESIGN.md「术语卡」。
 *
 *   <Term k="变形补码" />                 显示术语本身
 *   <Term k="S_f1">最高符号位</Term>      显示自己的字，卡片按 k 查
 */
let closeOpen: (() => void) | null = null;

export function Term({ k, children }: { k: string; children?: ComponentChildren }) {
  const entry = findTerm(k);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const id = useId();

  // 量出字的宽度：点的范围往两边扩到至少 44 px，字的位置不变（见 components.css .term）。
  useLayoutEffect(() => {
    const text = button.current?.querySelector('.term-text');
    if (text) button.current!.style.setProperty('--term-w', `${text.getBoundingClientRect().width}px`);
  });

  const close = (refocus = false) => {
    setOpen(false);
    setPlace(null);
    if (refocus) button.current?.focus();
  };

  // 打开时算位置：优先在术语下方，放不下就放上方；左右不出屏幕，留 16 px。
  useLayoutEffect(() => {
    if (!open || !button.current || !card.current) return;
    const at = button.current.querySelector('.term-text')?.getBoundingClientRect() ?? button.current.getBoundingClientRect();
    const box = card.current.getBoundingClientRect();
    const gap = 8;
    const edge = 16;
    const left = Math.min(Math.max(edge, at.left + at.width / 2 - box.width / 2), innerWidth - edge - box.width);
    const below = at.bottom + gap;
    const top = below + box.height <= innerHeight - edge || at.top - gap - box.height < edge ? below : at.top - gap - box.height;
    setPlace({ left: Math.max(edge, left), top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeOpen?.();
    const mine = () => close();
    closeOpen = mine;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
      }
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || card.current?.contains(target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (card.current?.contains(event.target as Node)) return;
      close();
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as Node;
      if (button.current?.contains(target) || card.current?.contains(target)) return;
      close();
    };
    addEventListener('keydown', onKey, true);
    addEventListener('focusin', onFocus, true);
    addEventListener('pointerdown', onDown, true);
    addEventListener('scroll', onScroll, true);
    addEventListener('resize', mine);
    return () => {
      if (closeOpen === mine) closeOpen = null;
      removeEventListener('keydown', onKey, true);
      removeEventListener('focusin', onFocus, true);
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('scroll', onScroll, true);
      removeEventListener('resize', mine);
    };
  }, [open]);

  const shown = children ?? <Rich text={k} />;
  if (!entry) return <>{shown}</>;

  const home = entry.page ? pages.find((page) => page.id === entry.page && page.live) : undefined;
  const elsewhere = home && currentPath() !== `/${home.id}` ? home : undefined;

  return (
    <>
      <button
        ref={button}
        type="button"
        class="term"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          // 页面上的键盘快捷键（播放器的空格、方向键）不该因为点了术语而触发。
          event.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span class="term-text">{shown}</span>
      </button>
      {open && (
        <span
          ref={card}
          id={id}
          class="term-card"
          role="dialog"
          aria-label={entry.term.replace(/_/g, '')}
          style={place ? { left: `${place.left}px`, top: `${place.top}px` } : { left: '0px', top: '0px', visibility: 'hidden' }}
        >
          <span class="term-card-name">
            <Rich text={entry.term} />
          </span>
          <span class="term-card-def">
            <Rich text={entry.def} />
          </span>
          <span class="term-card-ref">
            <span>教材 {entry.ref}</span>
            {elsewhere && <a href={`/${elsewhere.id}`}>{elsewhere.nav}</a>}
          </span>
        </span>
      )}
    </>
  );
}
