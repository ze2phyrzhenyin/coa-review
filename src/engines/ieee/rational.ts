/**
 * 精确的有理数运算（BigInt），浮点引擎用它算真值、舍入和十进制展开，避免 JavaScript 浮点数自己的舍入。
 * 符号放在分子上，分母恒为正且与分子互素。纯函数。
 */

export interface Rational {
  num: bigint;
  den: bigint;
}

export const MINUS = '−';

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function rational(num: bigint, den: bigint = 1n): Rational {
  if (den === 0n) throw new Error('分母不能为 0');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return g > 1n ? { num: num / g, den: den / g } : { num, den };
}

export const ZERO: Rational = { num: 0n, den: 1n };

export function add(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}

export function neg(a: Rational): Rational {
  return { num: -a.num, den: a.den };
}

export function abs(a: Rational): Rational {
  return a.num < 0n ? neg(a) : a;
}

export function cmp(a: Rational, b: Rational): number {
  const d = a.num * b.den - b.num * a.den;
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}

export function sign(a: Rational): number {
  return a.num > 0n ? 1 : a.num < 0n ? -1 : 0;
}

/** 2^e，e 可以为负。 */
export function pow2(e: number): Rational {
  return e >= 0 ? { num: 1n << BigInt(e), den: 1n } : { num: 1n, den: 1n << BigInt(-e) };
}

/** 向下取整。 */
export function floor(a: Rational): bigint {
  const q = a.num / a.den;
  return a.num < 0n && q * a.den !== a.num ? q - 1n : q;
}

export function bitLength(value: bigint): number {
  let v = value < 0n ? -value : value;
  let n = 0;
  while (v > 0n) {
    v >>= 1n;
    n += 1;
  }
  return n;
}

/** 正数 a 的 ⌊log2 a⌋：2^e ≤ a < 2^(e+1)。 */
export function log2Floor(a: Rational): number {
  if (a.num <= 0n) throw new Error('log2 只对正数有定义');
  let e = bitLength(a.num) - bitLength(a.den);
  if (cmp(a, pow2(e)) < 0) e -= 1;
  return e;
}

/** 分母是不是 2 的幂（二进制能写完）。 */
export function isDyadic(a: Rational): boolean {
  return (a.den & (a.den - 1n)) === 0n;
}

/**
 * 读入十进制：20.59375、−0.75、+3、27/64、−1/32。负号接受 -、−、–。
 * 不认识的写法返回 null，由调用方报错。
 */
export function parseDecimal(text: string): Rational | null {
  const compact = text.replace(/\s+/g, '').replace(/[−–]/g, '-');
  const fraction = /^([+-]?)(\d+)\/(\d+)$/.exec(compact);
  if (fraction) {
    const den = BigInt(fraction[3] ?? '1');
    if (den === 0n) return null;
    const num = BigInt(fraction[2] ?? '0');
    return rational(fraction[1] === '-' ? -num : num, den);
  }
  const decimal = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(compact);
  if (!decimal) return null;
  const whole = decimal[2] ?? '';
  const part = decimal[3] ?? '';
  if (whole === '' && part === '') return null;
  const num = BigInt((whole || '0') + part);
  const value = rational(num, 10n ** BigInt(part.length));
  return decimal[1] === '-' ? neg(value) : value;
}

/** 输入里写的是不是负号开头（用来区分 −0 和 +0）。 */
export function hasMinus(text: string): boolean {
  return /^\s*[-−–]/.test(text);
}

/** 精确的十进制写法。分母只含 2 和 5 时一定写得完；否则抛错。 */
export function toDecimal(a: Rational): string {
  let den = a.den;
  let twos = 0;
  let fives = 0;
  while (den % 2n === 0n) {
    den /= 2n;
    twos += 1;
  }
  while (den % 5n === 0n) {
    den /= 5n;
    fives += 1;
  }
  if (den !== 1n) throw new Error('这个数的十进制写不完');
  const digits = Math.max(twos, fives);
  const scaled = (a.num < 0n ? -a.num : a.num) * 2n ** BigInt(digits - twos) * 5n ** BigInt(digits - fives);
  const text = scaled.toString().padStart(digits + 1, '0');
  const whole = text.slice(0, text.length - digits);
  const part = text.slice(text.length - digits).replace(/0+$/, '');
  const body = part === '' ? whole : `${whole}.${part}`;
  return (a.num < 0n ? MINUS : '') + body;
}

/**
 * 非负数的二进制位置写法：10100.10011。小数部分最多写 maxFrac 位，写不完时 exact 为 false，
 * text 末尾加「…」。
 */
export function toBinary(a: Rational, maxFrac = 64): { text: string; exact: boolean } {
  if (a.num < 0n) throw new Error('toBinary 只写非负数');
  const whole = floor(a);
  let rest = sub(a, rational(whole));
  let part = '';
  while (rest.num !== 0n && part.length < maxFrac) {
    rest = mul(rest, rational(2n));
    const bit = floor(rest);
    part += bit.toString();
    rest = sub(rest, rational(bit));
  }
  const exact = rest.num === 0n;
  const head = whole.toString(2);
  return { text: (part === '' ? head : `${head}.${part}`) + (exact ? '' : '…'), exact };
}
