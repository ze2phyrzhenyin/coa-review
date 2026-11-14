import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { palettes } from '../scene/theme';

// 页面的墨色和场景的墨色必须是同一套（docs/DESIGN.md「颜色」）。改了 theme.ts 就要改 tokens.css，反过来也一样。
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const blocks = { light: css.slice(0, darkStart), dark: css.slice(darkStart, css.indexOf('@media', darkStart + 10)) };
const read = (block: string, name: string) => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]?.toLowerCase();

describe('tokens.css 与 scene/theme.ts', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const palette = palettes[scheme];
    const pairs: [string, string][] = [
      ['c-data', palette.data],
      ['c-addr', palette.addr],
      ['c-ctrl', palette.ctrl],
      ['c-change', palette.accent],
      ['c-surface', palette.paper],
      ['c-ink', palette.text],
      ['c-muted', palette.muted],
      ['c-line-strong', palette.line],
    ];
    for (const [token, expected] of pairs) {
      it(`${scheme} --${token} = ${expected}`, () => {
        expect(read(blocks[scheme], token)).toBe(expected.toLowerCase());
      });
    }
  }

  it('正确、错误两色在两种模式下都有定义', () => {
    for (const block of Object.values(blocks)) {
      expect(read(block, 'c-ok')).toMatch(/^#/);
      expect(read(block, 'c-bad')).toMatch(/^#/);
    }
  });
});
