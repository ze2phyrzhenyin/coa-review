import { describe, expect, it } from 'vitest';
import type { Ask } from '../engines/trace';
import { breakFrame, sameAnswer } from './answers';

const ask = (kind: Ask['kind'], answer: string): Ask => ({ prompt: '题', kind, answer });

describe('答案比对', () => {
  it('十六进制不分大小写，结尾的 H 可写可不写', () => {
    for (const said of ['16BH', '16bh', '16Bh', '16B', '16b', ' 16 bh ', '１６ＢＨ', '16BＨ']) expect(sameAnswer(ask('text', '16BH'), said), said).toBe(true);
    expect(sameAnswer(ask('text', '16BH'), '16CH')).toBe(false);
    expect(sameAnswer(ask('text', '16BH'), '16')).toBe(false);
    // 答案没写 H 时，学生多写一个 H 也算对；不是十六进制的字不去掉结尾的 h。
    expect(sameAnswer(ask('text', '3F'), '3fh')).toBe(true);
    expect(sameAnswer(ask('text', 'LDPCH'), 'LDPC')).toBe(false);
  });

  it('文字题忽略大小写、全角半角和空格', () => {
    expect(sameAnswer(ask('text', 'FIFO+LRU'), 'fifo + lru')).toBe(true);
    expect(sameAnswer(ask('text', 'T3'), 'ｔ３')).toBe(true);
    expect(sameAnswer(ask('text', '(R1)+D'), '（r1）＋d')).toBe(true);
    expect(sameAnswer(ask('text', '正溢'), '负溢')).toBe(false);
  });

  it('数、位串、选择题照旧', () => {
    expect(sameAnswer(ask('number', '3'), '3.0')).toBe(true);
    expect(sameAnswer(ask('number', '3'), '３')).toBe(true);
    expect(sameAnswer(ask('number', '3'), '4')).toBe(false);
    expect(sameAnswer(ask('bits', '0101 1100'), '0101_1100')).toBe(true);
    expect(sameAnswer(ask('bits', '0101'), '０１０１')).toBe(true);
    expect(sameAnswer(ask('choice', 'R0'), 'R0')).toBe(true);
    expect(sameAnswer(ask('choice', 'R0'), 'r0')).toBe(false);
  });
});

describe('演后果时的镜头', () => {
  it('没有移动也没有改画面时不指定要看的部件', () => {
    expect(breakFrame([], {})).toBeUndefined();
    expect(breakFrame([])).toBeUndefined();
  });

  it('看各个移动的两头，不重复；格子引用原样留着', () => {
    expect(breakFrame([{ value: '1', from: 'A', to: 'BUS' }, { value: '2', from: 'B', to: 'BUS' }])).toEqual(['A', 'B', 'BUS']);
    expect(breakFrame([{ value: '块 3', from: 'mem.0.3', to: 'r1' }])).toEqual(['mem.0.3', 'r1']);
  });

  it('只改画面、没有移动的重演：看被改的部件', () => {
    expect(breakFrame([], { mx: { mant: '00.0110' }, stay: { value: '直接加？' } })).toEqual(['mx', 'stay']);
  });

  it('改了的部件和移动的两头都要看，最后一个是值落下的地方', () => {
    const frame = breakFrame([{ value: '11', from: 'mx', to: 'lost' }], { my: { mant: '00.1' }, lost: { value: '11' } });
    expect(new Set(frame)).toEqual(new Set(['my', 'mx', 'lost']));
    expect(frame?.[frame.length - 1]).toBe('lost');
  });
});
