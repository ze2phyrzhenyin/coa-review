import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BitsError,
  MAX_VALUE_BITS,
  type Bit,
  type Code,
  type Notation,
  assertBits,
  bitAt,
  carryInto,
  codeRange,
  decode,
  decodeModified,
  encode,
  encodeModified,
  formatBits,
  formatDecimal,
  formatExcess,
  formatValue,
  fromModified,
  fromUnsigned,
  fullAdd,
  invert,
  isBits,
  isNegativeZero,
  modifiedOverflow,
  negateByInvertAddOne,
  negateByScan,
  parseBits,
  parseValue,
  rippleAdd,
  toModified,
  toUnsigned,
} from './bits';

// ---------- 参照实现：只用 BigInt 和教材的定义式，不用被测文件里的任何函数 ----------

const pad = (value: bigint, width: number) => value.toString(2).padStart(width, '0');
const allBits = (width: number) => Array.from({ length: 2 ** width }, (_, i) => i.toString(2).padStart(width, '0'));
const span = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const flip = (bits: string) => [...bits].map((ch) => (ch === '1' ? '0' : '1')).join('');

/** 式 (2.5)、(2.6)、(2.9) 和反码的文字定义。x 是整数，n 是数值位数，结果宽 n+1 位。 */
function refEncode(code: Code, x: number, n: number): string {
  const X = BigInt(x);
  const top = 1n << BigInt(n);
  switch (code) {
    case '原码':
      return pad(X >= 0n ? X : top - X, n + 1);
    case '反码':
      return X >= 0n ? pad(X, n + 1) : pad(2n * top - 1n + X, n + 1);
    case '补码':
      return pad(BigInt.asUintN(n + 1, X), n + 1);
    case '移码':
      return pad(top + X, n + 1);
  }
}

function refDecode(code: Code, bits: string): number {
  const n = bits.length - 1;
  const U = BigInt(`0b${bits}`);
  const top = 1n << BigInt(n);
  switch (code) {
    case '原码':
      return Number(U >= top ? -(U - top) : U) + 0;
    case '反码':
      return Number(U >= top ? U - (2n * top - 1n) : U) + 0;
    case '补码':
      return Number(BigInt.asIntN(n + 1, U));
    case '移码':
      return Number(U - top);
  }
}

const refRange = (code: Code, n: number) =>
  code === '原码' || code === '反码' ? { min: -(2 ** n - 1), max: 2 ** n - 1 } : { min: -(2 ** n), max: 2 ** n - 1 };

const CODES: Code[] = ['原码', '反码', '补码', '移码'];
const NOTATIONS: Notation[] = ['整数', '小数'];
const SIZES = [1, 2, 3, 4, 5, 6];

describe('位串基本操作', () => {
  it('isBits / assertBits 只接受 0 和 1，宽度不符报错', () => {
    expect(isBits('0101')).toBe(true);
    expect(isBits('')).toBe(false);
    expect(isBits('01 1')).toBe(false);
    expect(isBits('012')).toBe(false);
    expect(() => assertBits('0101', 4)).not.toThrow();
    expect(() => assertBits('0101', 5)).toThrow(BitsError);
    expect(() => assertBits('01x1')).toThrow(/只能由 0 和 1 组成/);
    expect(() => assertBits('0'.repeat(MAX_VALUE_BITS + 3))).toThrow(BitsError);
  });

  it('toUnsigned / fromUnsigned 互逆，写不下时报错而不是截断', () => {
    for (const width of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const bits of allBits(width)) {
        expect(toUnsigned(bits)).toBe(Number(BigInt(`0b${bits}`)));
        expect(fromUnsigned(toUnsigned(bits), width)).toBe(bits);
      }
      expect(() => fromUnsigned(2 ** width, width)).toThrow(BitsError);
      expect(() => fromUnsigned(-1, width)).toThrow(BitsError);
    }
    expect(() => fromUnsigned(1.5, 4)).toThrow(BitsError);
    expect(() => fromUnsigned(1, 0)).toThrow(BitsError);
  });

  it('invert 逐位取反，做两次还原', () => {
    for (const bits of allBits(6)) {
      expect(invert(bits)).toBe(flip(bits));
      expect(invert(invert(bits))).toBe(bits);
    }
  });

  it('bitAt 越界报错', () => {
    expect(bitAt('10', 0)).toBe('1');
    expect(() => bitAt('10', 2)).toThrow(BitsError);
  });

  it('fullAdd 与真值表一致（8 行）', () => {
    const bit: Bit[] = ['0', '1'];
    for (const a of bit) {
      for (const b of bit) {
        for (const c of bit) {
          const total = Number(a) + Number(b) + Number(c);
          expect(fullAdd(a, b, c)).toEqual({ sum: String(total % 2), carry: String(Math.floor(total / 2)) });
        }
      }
    }
  });
});

describe('原码、反码、补码、移码：n = 1…6 穷举', () => {
  it('范围：原码、反码 ±(2^n − 1)；补码、移码 −2^n … 2^n − 1', () => {
    for (const n of SIZES) for (const code of CODES) expect(codeRange(code, n)).toEqual(refRange(code, n));
  });

  it('范围内每个真值：编码与定义式一致，解码还原', () => {
    let count = 0;
    for (const n of SIZES) {
      for (const code of CODES) {
        const { min, max } = refRange(code, n);
        for (const x of span(min, max)) {
          const bits = encode(code, x, n);
          expect(bits, `${code} n=${n} x=${x}`).toBe(refEncode(code, x, n));
          expect(bits).toHaveLength(n + 1);
          expect(decode(code, bits)).toBe(x);
          count += 1;
        }
      }
    }
    expect(count).toBeGreaterThan(900);
  });

  it('每个 n+1 位位串：解码与参照一致；除负零外再编码得回原串', () => {
    for (const n of SIZES) {
      for (const code of CODES) {
        for (const bits of allBits(n + 1)) {
          const x = decode(code, bits);
          expect(x, `${code} ${bits}`).toBe(refDecode(code, bits));
          expect(Object.is(x, -0)).toBe(false);
          if (isNegativeZero(code, bits)) {
            expect(x).toBe(0);
            expect(encode(code, 0, n, { negativeZero: true })).toBe(bits);
          } else {
            expect(encode(code, x, n)).toBe(bits);
          }
        }
      }
    }
  });

  it('0 的形式：原码、反码各两种，补码、移码只有一种', () => {
    for (const n of SIZES) {
      expect(encode('原码', 0, n)).toBe('0'.repeat(n + 1));
      expect(encode('原码', 0, n, { negativeZero: true })).toBe(`1${'0'.repeat(n)}`);
      expect(encode('反码', 0, n)).toBe('0'.repeat(n + 1));
      expect(encode('反码', 0, n, { negativeZero: true })).toBe('1'.repeat(n + 1));
      expect(encode('补码', 0, n)).toBe('0'.repeat(n + 1));
      expect(encode('移码', 0, n)).toBe(`1${'0'.repeat(n)}`);
      expect(() => encode('补码', 0, n, { negativeZero: true })).toThrow(/没有负零/);
      expect(() => encode('移码', 0, n, { negativeZero: true })).toThrow(/没有负零/);
      for (const code of CODES) {
        const zeros = allBits(n + 1).filter((bits) => refDecode(code, bits) === 0);
        expect(zeros).toHaveLength(code === '原码' || code === '反码' ? 2 : 1);
        expect(allBits(n + 1).filter((bits) => isNegativeZero(code, bits))).toHaveLength(zeros.length - 1);
      }
    }
  });

  it('超出范围的真值报 range 错误，说明能表示的范围', () => {
    for (const n of SIZES) {
      for (const code of CODES) {
        const { min, max } = refRange(code, n);
        for (const x of [min - 1, max + 1, min - 7, max + 7]) {
          let caught: unknown;
          try {
            encode(code, x, n);
          } catch (error) {
            caught = error;
          }
          expect(caught, `${code} n=${n} x=${x}`).toBeInstanceOf(BitsError);
          expect((caught as BitsError).kind).toBe('range');
          expect((caught as BitsError).message).toContain('超出范围');
        }
      }
    }
    expect(() => encode('补码', 0.5, 4)).toThrow(BitsError);
    expect(() => encode('补码', Number.NaN, 4)).toThrow(BitsError);
    expect(() => encode('补码', 1, 0)).toThrow(/数值位数/);
    expect(() => encode('补码', 1, MAX_VALUE_BITS + 1)).toThrow(/数值位数/);
    expect(() => decode('补码', '1')).toThrow(BitsError);
    expect(() => decode('补码', '12')).toThrow(BitsError);
  });

  it('最小负数 −2^n 只有补码和移码能表示', () => {
    for (const n of SIZES) {
      const least = -(2 ** n);
      expect(encode('补码', least, n)).toBe(`1${'0'.repeat(n)}`);
      expect(encode('移码', least, n)).toBe('0'.repeat(n + 1));
      expect(() => encode('原码', least, n)).toThrow(BitsError);
      expect(() => encode('反码', least, n)).toThrow(BitsError);
    }
  });

  it('码之间的关系：正数三码相同；负数 反码 = 原码数值位取反，补码 = 反码末位加 1；移码与补码只差符号位', () => {
    for (const n of SIZES) {
      for (const x of span(-(2 ** n - 1), 2 ** n - 1)) {
        const s = encode('原码', x, n);
        const o = encode('反码', x, n);
        const t = encode('补码', x, n);
        if (x >= 0) {
          expect(o).toBe(s);
          expect(t).toBe(s);
        } else {
          expect(o).toBe(`1${flip(s.slice(1))}`);
          expect(BigInt(`0b${t}`)).toBe(BigInt(`0b${o}`) + 1n);
        }
      }
      for (const x of span(-(2 ** n), 2 ** n - 1)) {
        const t = encode('补码', x, n);
        const e = encode('移码', x, n);
        expect(e).toBe(flip(t.charAt(0)) + t.slice(1));
      }
    }
  });

  it('移码保序：真值大的移码按无符号数也大', () => {
    for (const n of SIZES) {
      const codes = span(-(2 ** n), 2 ** n - 1).map((x) => toUnsigned(encode('移码', x, n)));
      expect(codes).toEqual(span(0, 2 ** (n + 1) - 1));
    }
  });

  it('固定值：8 位时 −127、−1、0、+1、+127 的补码和移码', () => {
    const rows: [number, string, string][] = [
      [-127, '10000001', '00000001'],
      [-1, '11111111', '01111111'],
      [0, '00000000', '10000000'],
      [1, '00000001', '10000001'],
      [127, '01111111', '11111111'],
    ];
    for (const [x, twos, excess] of rows) {
      expect(encode('补码', x, 7)).toBe(twos);
      expect(encode('移码', x, 7)).toBe(excess);
    }
    expect(encode('原码', -122, 7)).toBe('11111010');
    expect(encode('反码', -122, 7)).toBe('10000101');
    expect(encode('补码', -122, 7)).toBe('10000110');
    expect(encode('补码', -128, 7)).toBe('10000000');
  });
});

describe('变形补码：n = 1…6 穷举', () => {
  it('编码 = 模 2^(n+2) 的补码 = 补码的符号位再写一遍；解码还原', () => {
    for (const n of SIZES) {
      for (const x of span(-(2 ** n), 2 ** n - 1)) {
        const modified = encodeModified(x, n);
        expect(modified).toBe(pad(BigInt.asUintN(n + 2, BigInt(x)), n + 2));
        expect(modified).toBe(toModified(encode('补码', x, n)));
        expect(modified.charAt(0)).toBe(modified.charAt(1));
        expect(decodeModified(modified)).toBe(x);
        expect(modifiedOverflow(modified)).toBe('无溢出');
        expect(fromModified(modified)).toBe(encode('补码', x, n));
      }
      expect(() => encodeModified(2 ** n, n)).toThrow(/超出范围/);
      expect(() => encodeModified(-(2 ** n) - 1, n)).toThrow(/超出范围/);
    }
  });

  it('每个 n+2 位位串：解码按整串补码；符号位 01 正溢、10 负溢，其余无溢出', () => {
    for (const n of SIZES) {
      for (const bits of allBits(n + 2)) {
        const value = decodeModified(bits);
        expect(value).toBe(Number(BigInt.asIntN(n + 2, BigInt(`0b${bits}`))));
        const expected = value > 2 ** n - 1 ? '正溢' : value < -(2 ** n) ? '负溢' : '无溢出';
        expect(modifiedOverflow(bits), bits).toBe(expected);
        expect(modifiedOverflow(bits)).toBe(bits.startsWith('01') ? '正溢' : bits.startsWith('10') ? '负溢' : '无溢出');
        if (expected === '无溢出') expect(toModified(fromModified(bits))).toBe(bits);
        else expect(() => fromModified(bits)).toThrow(/已溢出/);
      }
    }
    expect(() => decodeModified('01')).toThrow(BitsError);
    expect(() => modifiedOverflow('01')).toThrow(BitsError);
    expect(() => toModified('1')).toThrow(BitsError);
  });
});

describe('由 [y]补 求 [−y]补', () => {
  it('取反加一与从右扫描对每个位串都得到同一结果（宽 1…9 穷举）', () => {
    let count = 0;
    for (const width of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      for (const bits of allBits(width)) {
        const byAdding = negateByInvertAddOne(bits);
        const byScan = negateByScan(bits);
        const expected = pad(BigInt.asUintN(width, -BigInt(`0b${bits}`)), width);
        expect(byAdding.inverted).toBe(flip(bits));
        expect(byAdding.result, bits).toBe(expected);
        expect(byScan.result, bits).toBe(expected);
        expect(byAdding.carryOut).toBe(bits.includes('1') ? '0' : '1');
        expect(byScan.pivot).toBe(bits.lastIndexOf('1'));
        expect(negateByScan(byScan.result).result).toBe(bits);
        count += 1;
      }
    }
    expect(count).toBe(2 ** 10 - 2);
  });

  it('补码：结果的真值是 −y；最小负数 −2^n 求补得回自己（n = 1…6）', () => {
    for (const n of SIZES) {
      for (const y of span(-(2 ** n), 2 ** n - 1)) {
        const negated = negateByInvertAddOne(encode('补码', y, n)).result;
        if (y === -(2 ** n)) expect(negated).toBe(encode('补码', y, n));
        else expect(decode('补码', negated)).toBe(-y + 0);
      }
    }
  });

  it('变形补码：结果按整串解码总是 −y，y = −2^n 时符号位是 01（n = 1…6）', () => {
    for (const n of SIZES) {
      for (const y of span(-(2 ** n), 2 ** n - 1)) {
        const negated = negateByScan(encodeModified(y, n)).result;
        expect(decodeModified(negated)).toBe(-y + 0);
        expect(modifiedOverflow(negated)).toBe(y === -(2 ** n) ? '正溢' : '无溢出');
      }
    }
  });

  it('对任意位串（宽到 50）：两种做法一致', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[01]{1,50}$/), (bits) => {
        expect(negateByScan(bits).result).toBe(negateByInvertAddOne(bits).result);
      }),
    );
  });
});

describe('行波进位加法', () => {
  const refAdd = (a: string, b: string, carryIn: number) => {
    const width = a.length;
    const total = BigInt(`0b${a}`) + BigInt(`0b${b}`) + BigInt(carryIn);
    const carries = Array.from({ length: width }, (_, i) => {
      const low = BigInt(width - i);
      const mask = (1n << low) - 1n;
      return String(((BigInt(`0b${a}`) & mask) + (BigInt(`0b${b}`) & mask) + BigInt(carryIn)) >> low);
    }).join('');
    return { sum: pad(BigInt.asUintN(width, total), width), carries, carryOut: String(total >> BigInt(width)) };
  };

  it('宽 1…5 的所有加数对、两种进位输入：和、每一位的进位都与参照一致', () => {
    let count = 0;
    for (const width of [1, 2, 3, 4, 5]) {
      for (const a of allBits(width)) {
        for (const b of allBits(width)) {
          for (const carryIn of ['0', '1'] as const) {
            const got = rippleAdd(a, b, carryIn);
            const want = refAdd(a, b, Number(carryIn));
            expect(got.sum, `${a}+${b}+${carryIn}`).toBe(want.sum);
            expect(got.carries).toBe(want.carries);
            expect(got.carryOut).toBe(want.carryOut);
            expect(got.carryOut).toBe(got.carries.charAt(0));
            expect(got.carryIn).toBe(carryIn);
            for (let i = 0; i < width; i += 1) {
              expect(carryInto(got, i)).toBe(i === width - 1 ? carryIn : want.carries.charAt(i + 1));
            }
            count += 1;
          }
        }
      }
    }
    expect(count).toBe(2 * (4 + 16 + 64 + 256 + 1024));
  });

  it('默认进位输入为 0；加数不等宽报错', () => {
    expect(rippleAdd('0101', '0011')).toEqual({ sum: '1000', carries: '0111', carryOut: '0', carryIn: '0' });
    expect(rippleAdd('1100', '0100')).toEqual({ sum: '0000', carries: '1100', carryOut: '1', carryIn: '0' });
    expect(() => rippleAdd('0101', '011')).toThrow(BitsError);
    expect(() => rippleAdd('0102', '0111')).toThrow(BitsError);
  });

  it('对任意等宽加数（宽到 50）：与 BigInt 相加一致，交换加数结果不变', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }).chain((width) => fc.tuple(fc.stringMatching(new RegExp(`^[01]{${width}}$`)), fc.stringMatching(new RegExp(`^[01]{${width}}$`)))),
        fc.constantFrom<Bit>('0', '1'),
        ([a, b], carryIn) => {
          const got = rippleAdd(a, b, carryIn);
          const want = refAdd(a, b, Number(carryIn));
          expect(got.sum).toBe(want.sum);
          expect(got.carries).toBe(want.carries);
          expect(rippleAdd(b, a, carryIn)).toEqual(got);
        },
      ),
    );
  });

  it('补码相加：模 2^(n+1) 下 [x]补 + [y]补 = [x+y]补（和在范围内时，n = 1…5）', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      for (const x of span(-(2 ** n), 2 ** n - 1)) {
        for (const y of span(-(2 ** n), 2 ** n - 1)) {
          const { sum } = rippleAdd(encode('补码', x, n), encode('补码', y, n));
          if (x + y >= -(2 ** n) && x + y <= 2 ** n - 1) expect(sum).toBe(encode('补码', x + y, n));
        }
      }
    }
  });
});

describe('两种写法的排版和读入', () => {
  it('formatBits：整数不加点，小数在符号位后加点', () => {
    expect(formatBits('01001', '整数')).toBe('01001');
    expect(formatBits('001010', '整数', 2)).toBe('001010');
    expect(formatBits('01001', '小数')).toBe('0.1001');
    expect(formatBits('1110001', '小数', 2)).toBe('11.10001');
    expect(formatExcess('110101')).toBe('1,10101');
    expect(() => formatBits('01', '小数', 2)).toThrow(BitsError);
    expect(() => formatBits('01', '小数', 0)).toThrow(BitsError);
    expect(() => formatExcess('1')).toThrow(BitsError);
  });

  it('parseBits 读回 formatBits 的输出（n = 1…6，补码和变形补码，两种写法）', () => {
    for (const n of SIZES) {
      for (const notation of NOTATIONS) {
        for (const bits of allBits(n + 1)) {
          expect(parseBits(formatBits(bits, notation, 1))).toEqual({ bits, point: notation === '小数' ? 1 : null });
        }
        for (const bits of allBits(n + 2)) {
          expect(parseBits(formatBits(bits, notation, 2))).toEqual({ bits, point: notation === '小数' ? 2 : null });
        }
      }
    }
    expect(parseBits(' 11.1000 1 ')).toEqual({ bits: '1110001', point: 2 });
    expect(parseBits('1,10101')).toEqual({ bits: '110101', point: 1 });
    for (const bad of ['', '.', '1.', '.1', '1.0.1', '102', '+101', 'abc']) expect(() => parseBits(bad), bad).toThrow(BitsError);
  });

  it('formatValue / parseValue 互逆，含溢出时的数学结果（n = 1…6，−2^(n+1) … 2^(n+1)）', () => {
    for (const n of SIZES) {
      for (const notation of NOTATIONS) {
        for (const units of span(-(2 ** (n + 1)), 2 ** (n + 1))) {
          const text = formatValue(units, n, notation);
          expect(parseValue(text, n, notation), `${text}`).toBe(units);
          // 与参照写法一致：符号、整数部分、小数部分
          const magnitude = BigInt(Math.abs(units));
          const sign = units > 0 ? '+' : units < 0 ? '−' : '';
          const want =
            notation === '整数'
              ? sign + pad(magnitude, n)
              : `${sign}${(magnitude >> BigInt(n)).toString(2)}.${pad(magnitude & ((1n << BigInt(n)) - 1n), n)}`;
          expect(text).toBe(want);
        }
      }
    }
  });

  it('formatValue 的样子', () => {
    expect(formatValue(10, 4, '整数')).toBe('+1010');
    expect(formatValue(-3, 4, '整数')).toBe('−0011');
    expect(formatValue(0, 4, '整数')).toBe('0000');
    expect(formatValue(-16, 4, '整数')).toBe('−10000');
    expect(formatValue(17, 4, '整数')).toBe('+10001');
    expect(formatValue(10, 4, '小数')).toBe('+0.1010');
    expect(formatValue(-15, 5, '小数')).toBe('−0.01111');
    expect(formatValue(0, 3, '小数')).toBe('0.000');
    expect(formatValue(-16, 4, '小数')).toBe('−1.0000');
    expect(formatValue(-20, 4, '小数')).toBe('−1.0100');
  });

  it('parseValue 接受的写法', () => {
    expect(parseValue('+1010', 4, '整数')).toBe(10);
    expect(parseValue('1010', 4, '整数')).toBe(10);
    expect(parseValue('-11', 4, '整数')).toBe(-3);
    expect(parseValue('−0011', 4, '整数')).toBe(-3);
    expect(parseValue('–0011', 4, '整数')).toBe(-3);
    expect(parseValue(' - 0011 ', 4, '整数')).toBe(-3);
    expect(parseValue('-10000', 4, '整数')).toBe(-16);
    expect(parseValue('00001010', 4, '整数')).toBe(10);
    expect(Object.is(parseValue('-0000', 4, '整数'), 0)).toBe(true);
    expect(parseValue('0.101', 4, '小数')).toBe(10);
    expect(parseValue('+0.1010', 4, '小数')).toBe(10);
    expect(parseValue('.1010', 4, '小数')).toBe(10);
    expect(parseValue('-0.01111', 5, '小数')).toBe(-15);
    expect(parseValue('0.101000', 4, '小数')).toBe(10);
    expect(parseValue('-1', 4, '小数')).toBe(-16);
    expect(parseValue('-1.0', 4, '小数')).toBe(-16);
    expect(parseValue('0', 4, '小数')).toBe(0);
    expect(parseValue('1.01', 4, '小数')).toBe(20);
  });

  it('parseValue 拒绝的写法，错误信息说得清', () => {
    expect(() => parseValue('1.01', 4, '整数')).toThrow(/不带小数点/);
    expect(() => parseValue('0.10101', 4, '小数')).toThrow(/写不下/);
    for (const bad of ['', '+', '-', '.', '12', '+-1', '1 . x', '0x11', '1,01']) {
      expect(() => parseValue(bad, 4, '整数'), bad).toThrow(BitsError);
      expect(() => parseValue(bad, 4, '小数'), bad).toThrow(BitsError);
    }
    expect(() => parseValue('1'.repeat(60), 4, '整数')).toThrow(/位数太多/);
    expect(() => parseValue('1010', 0, '整数')).toThrow(/数值位数/);
  });

  it('formatDecimal 精确：整数就是整数，小数是 units / 2^n', () => {
    expect(formatDecimal(17, 4, '整数')).toBe('17');
    expect(formatDecimal(-3, 4, '整数')).toBe('−3');
    expect(formatDecimal(0, 4, '整数')).toBe('0');
    expect(formatDecimal(5, 4, '小数')).toBe('0.3125');
    expect(formatDecimal(-15, 5, '小数')).toBe('−0.46875');
    expect(formatDecimal(-16, 4, '小数')).toBe('−1');
    expect(formatDecimal(24, 4, '小数')).toBe('1.5');
    expect(formatDecimal(0, 4, '小数')).toBe('0');
    expect(formatDecimal(1, 48, '小数')).toBe(`0.${(5n ** 48n).toString().padStart(48, '0')}`);
    for (const n of SIZES) {
      for (const units of span(-(2 ** (n + 1)), 2 ** (n + 1))) {
        const text = formatDecimal(units, n, '小数');
        expect(Number(text.replace('−', '-'))).toBe(units / 2 ** n + 0);
      }
    }
  });

  it('对任意 n ≤ 48 和范围内的真值：四种码、变形补码、两种真值写法都能往返', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_VALUE_BITS }).chain((n) => fc.tuple(fc.constant(n), fc.integer({ min: -(2 ** n - 1), max: 2 ** n - 1 }))),
        ([n, x]) => {
          for (const code of CODES) {
            const bits = encode(code, x, n);
            expect(bits).toBe(refEncode(code, x, n));
            expect(decode(code, bits)).toBe(x);
          }
          expect(decodeModified(encodeModified(x, n))).toBe(x);
          for (const notation of NOTATIONS) expect(parseValue(formatValue(x, n, notation), n, notation)).toBe(x);
        },
      ),
    );
  });
});
