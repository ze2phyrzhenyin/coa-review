import { describe, expect, it } from 'vitest';
import { findTerm, glossary } from '../content/glossary';
import { pages } from '../content/pages';
import { parseLast } from './last-visit';

describe('术语表', () => {
  it('术语和别名不重名', () => {
    const keys = glossary.flatMap((entry) => [entry.term, ...(entry.aka ?? [])]);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('每条一句定义、有教材页码、页面编号存在', () => {
    for (const entry of glossary) {
      expect(entry.def.length, entry.term).toBeLessThanOrEqual(70);
      expect(entry.def.endsWith('。'), entry.term).toBe(true);
      expect(entry.ref, entry.term).toMatch(/^p\d+(–\d+)?(、p\d+(–\d+)?)*$/);
      if (entry.page) expect(pages.some((page) => page.id === entry.page), entry.term).toBe(true);
      // 不写感叹号、破折号，不用「注意」这类提醒（docs/STYLE.md）。
      expect(entry.def, entry.term).not.toMatch(/[!！—]|注意|非常/);
    }
  });

  it('按术语和别名都查得到', () => {
    expect(findTerm('变形补码')?.ref).toBe('p37–38');
    expect(findTerm('[x]变补')?.term).toBe('变形补码');
    expect(findTerm('未命中')?.term).toBe('缺失');
    expect(findTerm(' 数存 ')?.term).toBe('指存、数存');
    expect(findTerm('没有这个词')).toBeUndefined();
  });
});

describe('上次学到', () => {
  it('只认清单里的页面，坏数据当作没有记录', () => {
    expect(parseLast(null)).toBeNull();
    expect(parseLast('{')).toBeNull();
    expect(parseLast(JSON.stringify({ id: 'no-such-page', search: '' }))).toBeNull();
    expect(parseLast(JSON.stringify({ id: '2-overflow', search: '?s=3', tab: '讲解', step: 3 }))).toEqual({ id: '2-overflow', search: '?s=3', tab: '讲解', step: 3 });
    expect(parseLast(JSON.stringify({ id: '2-overflow', search: 'javascript:1', step: -1 }))).toEqual({ id: '2-overflow', search: '', tab: undefined, step: undefined });
  });
});
