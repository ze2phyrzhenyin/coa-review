// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Term } from './TermCard';

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

const button = () => root.querySelector('button.term') as HTMLButtonElement;
const card = () => root.querySelector('[role="dialog"]');

describe('术语卡', () => {
  it('点开显示定义和教材页码，再点关上', () => {
    act(() => render(<p>结果用<Term k="变形补码" />表示</p>, root));
    expect(button().getAttribute('aria-expanded')).toBe('false');
    act(() => button().click());
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(card()?.textContent).toContain('两个符号位');
    expect(card()?.textContent).toContain('教材 p37–38');
    expect(button().getAttribute('aria-controls')).toBe(card()?.id);
    act(() => button().click());
    expect(card()).toBeNull();
  });

  it('Esc 关上并把焦点还给术语', () => {
    act(() => render(<Term k="命中" />, root));
    act(() => button().click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('点别处关上；同时只开一张', () => {
    act(() =>
      render(
        <div>
          <Term k="命中" />
          <Term k="缺失" />
          <span id="away">别处</span>
        </div>,
        root,
      ),
    );
    const [first, second] = [...root.querySelectorAll('button.term')] as HTMLButtonElement[];
    act(() => first!.click());
    act(() => second!.click());
    expect(root.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(card()?.textContent).toContain('不在 cache 里');
    act(() => {
      root.querySelector('#away')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(card()).toBeNull();
  });

  it('自定义文字按 k 查；查不到时只显示文字', () => {
    act(() => render(<p><Term k="S_f1">最高符号位</Term>，<Term k="没有这个词">原样</Term></p>, root));
    expect(root.querySelectorAll('button.term').length).toBe(1);
    expect(button().textContent).toBe('最高符号位');
    expect(root.textContent).toContain('原样');
  });
});
