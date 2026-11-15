import { describe, expect, it } from 'vitest';
import { hasMarks, parseRich, plainRich } from './rich';

describe('上下标解析', () => {
  it('拉丁字母和数字作底', () => {
    expect(parseRich('S_f1')).toEqual([{ text: 'S', kind: 'base' }, { text: 'f1', kind: 'sub' }]);
    expect(parseRich('2^-1')).toEqual([{ text: '2', kind: 'base' }, { text: '−1', kind: 'sup' }]);
    expect(parseRich('x_{i+1}')[1]).toEqual({ text: 'i+1', kind: 'sub' });
  });

  it('希腊字母也能作底、作下标', () => {
    expect(parseRich('τ_l = 5 ns')).toEqual([{ text: 'τ', kind: 'base' }, { text: 'l', kind: 'sub' }, { text: ' = 5 ns', kind: 'base' }]);
    expect(parseRich('Δt_0')[1]).toEqual({ text: '0', kind: 'sub' });
    expect(parseRich('T_τ')[1]).toEqual({ text: 'τ', kind: 'sub' });
    expect(hasMarks('μA_5')).toBe(true);
    expect(plainRich('τ_l')).toBe('τl');
  });

  it('汉字后面的下划线不动', () => {
    expect(parseRich('行_1')).toEqual([{ text: '行_1', kind: 'base' }]);
  });
});

describe('码名', () => {
  it('方括号后面的码名排成下标，写不写下划线都一样', () => {
    const want = [{ text: '[x]', kind: 'base' }, { text: '变补', kind: 'sub' }, { text: ' = 001001', kind: 'base' }];
    expect(parseRich('[x]变补 = 001001')).toEqual(want);
    expect(parseRich('[x]_{变补} = 001001')).toEqual(want);
    expect(parseRich('[x]_变补 = 001001')).toEqual(want);
    for (const name of ['补', '原', '反', '移']) expect(parseRich(`[−y]${name}`)).toEqual([{ text: '[−y]', kind: 'base' }, { text: name, kind: 'sub' }]);
    expect(parseRich('[x+y]变补 和 [x]补')).toEqual([
      { text: '[x+y]', kind: 'base' },
      { text: '变补', kind: 'sub' },
      { text: ' 和 [x]', kind: 'base' },
      { text: '补', kind: 'sub' },
    ]);
    expect(hasMarks('[y]原')).toBe(true);
    expect(plainRich('[x]补')).toBe('[x]补');
  });

  it('码名是一个词的开头时不动', () => {
    expect(parseRich('[x]补码')).toEqual([{ text: '[x]补码', kind: 'base' }]);
    expect(parseRich('数组 a[3]移位')).toEqual([{ text: '数组 a[3]移位', kind: 'base' }]);
    expect(parseRich('[x]反过来')).toEqual([{ text: '[x]反过来', kind: 'base' }]);
  });
});
