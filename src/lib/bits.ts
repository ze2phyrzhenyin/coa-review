/**
 * 定宽位串和定点数的机器码（教材 2.1.1、2.1.2、2.2.2、2.2.3）。纯函数，没有状态。
 *
 * 约定：
 * - 位串是只含 0 和 1 的字符串，左边是高位。下标 0 是最左边一位。
 * - n 是数值位的位数。原码、反码、补码、移码宽 n+1 位（1 个符号位），变形补码宽 n+2 位（2 个符号位）。
 * - 真值一律用「以最低位为单位的整数」units 表示：定点整数的真值就是 units，
 *   定点小数的真值是 units × 2^-n。两种写法的位串完全相同，只是小数点的位置不同，
 *   所以编码、解码不分写法，只有 format / parse 这一组函数才要 notation。
 * - 这里的移码是 2.1.2 的定义 [e]移 = 2^n + e。IEEE 754 的偏移 127 不在这个文件里。
 */

export type Bits = string;
export type Bit = '0' | '1';

/** 定点整数（小数点在最低位右边）或定点小数（小数点在符号位右边）。 */
export type Notation = '整数' | '小数';

export type Code = '原码' | '反码' | '补码' | '移码';

export const CODES: readonly Code[] = ['原码', '反码', '补码', '移码'];

/** 教材里的全称。 */
export const NOTATION_NAME: Record<Notation, string> = {
  整数: '定点整数',
  小数: '定点小数',
};

/** 数值位最多 48 位：n+2 位的无符号值仍能用 number 精确表示。 */
export const MAX_VALUE_BITS = 48;

/** 位串格式不对，或真值超出表示范围。message 是可以直接给人看的中文。 */
export class BitsError extends Error {
  readonly kind: 'format' | 'range';

  constructor(kind: 'format' | 'range', message: string) {
    super(message);
    this.name = 'BitsError';
    this.kind = kind;
  }
}

const BIT_PATTERN = /^[01]+$/;
const MINUS = '−';

export function isBits(text: string): boolean {
  return BIT_PATTERN.test(text);
}

/** 不是位串，或宽度不等于 width，就抛 BitsError。 */
export function assertBits(bits: string, width?: number): void {
  if (!isBits(bits)) throw new BitsError('format', `位串只能由 0 和 1 组成，收到「${bits}」`);
  if (bits.length > MAX_VALUE_BITS + 2) {
    throw new BitsError('format', `位串最多 ${MAX_VALUE_BITS + 2} 位，收到 ${bits.length} 位`);
  }
  if (width !== undefined && bits.length !== width) {
    throw new BitsError('format', `位串应为 ${width} 位，收到 ${bits.length} 位「${bits}」`);
  }
}

export function assertValueBits(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > MAX_VALUE_BITS) {
    throw new BitsError('format', `数值位数 n 必须是 1 到 ${MAX_VALUE_BITS} 的整数，收到 ${String(n)}`);
  }
}

function assertUnits(units: number): void {
  if (!Number.isSafeInteger(units)) {
    throw new BitsError('format', `真值必须是最低位的整数倍，收到 ${String(units)}`);
  }
}

/** 第 index 位（左起，0 是最高位）。 */
export function bitAt(bits: Bits, index: number): Bit {
  const ch = bits.charAt(index);
  if (ch !== '0' && ch !== '1') throw new BitsError('format', `位串「${bits}」没有第 ${index} 位`);
  return ch;
}

/** 把位串当作无符号二进制数。 */
export function toUnsigned(bits: Bits): number {
  assertBits(bits);
  let value = 0;
  for (const ch of bits) value = value * 2 + (ch === '1' ? 1 : 0);
  return value;
}

/** 无符号数写成 width 位的位串；写不下就报错，不悄悄截断。 */
export function fromUnsigned(value: number, width: number): Bits {
  if (!Number.isInteger(width) || width < 1 || width > MAX_VALUE_BITS + 2) {
    throw new BitsError('format', `位宽必须是 1 到 ${MAX_VALUE_BITS + 2} 的整数，收到 ${String(width)}`);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** width) {
    throw new BitsError('range', `${String(value)} 不能写成 ${width} 位无符号二进制数`);
  }
  return value.toString(2).padStart(width, '0');
}

/** 各位取反。 */
export function invert(bits: Bits): Bits {
  assertBits(bits);
  let out = '';
  for (const ch of bits) out += ch === '1' ? '0' : '1';
  return out;
}

/** 一位全加器（教材 p39 式 2.19）：本位和与向高位的进位。 */
export function fullAdd(a: Bit, b: Bit, carryIn: Bit): { sum: Bit; carry: Bit } {
  const total = Number(a) + Number(b) + Number(carryIn);
  return { sum: total % 2 === 1 ? '1' : '0', carry: total >= 2 ? '1' : '0' };
}

export interface RippleSum {
  /** 和，与加数等宽。最高位向外的进位不在里面（按模 2^位宽 相加）。 */
  sum: Bits;
  /** 每一位产生的进位，下标与位串相同：carries[i] 是第 i 位向左边一位送出的进位。 */
  carries: Bits;
  /** 最高位向外的进位，等于 carries[0]。 */
  carryOut: Bit;
  /** 进入最低位的进位。 */
  carryIn: Bit;
}

/** 从最低位起逐位相加，进位向左传（行波进位）。两个加数必须等宽。 */
export function rippleAdd(a: Bits, b: Bits, carryIn: Bit = '0'): RippleSum {
  assertBits(a);
  assertBits(b, a.length);
  const sum: Bit[] = [];
  const carries: Bit[] = [];
  let carry: Bit = carryIn;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const column = fullAdd(bitAt(a, i), bitAt(b, i), carry);
    sum[i] = column.sum;
    carries[i] = column.carry;
    carry = column.carry;
  }
  return { sum: sum.join(''), carries: carries.join(''), carryOut: carry, carryIn };
}

/** 进入第 index 位的进位：最低位取 carryIn，其余取右边一位产生的进位。 */
export function carryInto(result: RippleSum, index: number): Bit {
  return index === result.sum.length - 1 ? result.carryIn : bitAt(result.carries, index + 1);
}

/**
 * n 位数值位时各种码能表示的真值范围（单位：最低位）。
 * 原码、反码：−(2^n − 1) 到 2^n − 1；补码、移码：−2^n 到 2^n − 1。
 */
export function codeRange(code: Code, n: number): { min: number; max: number } {
  assertValueBits(n);
  const top = 2 ** n;
  return code === '原码' || code === '反码' ? { min: -(top - 1), max: top - 1 } : { min: -top, max: top - 1 };
}

export interface EncodeOptions {
  /** 原码、反码的 0 有两种形式。true 时把 0 编成负零（1000…0 或 1111…1）。 */
  negativeZero?: boolean;
}

function rangeMessage(code: Code, units: number, n: number): string {
  const { min, max } = codeRange(code, n);
  return `真值超出范围：${n} 位数值位的${code}只能表示 ${min} 到 ${max} 个最低位单位，收到 ${units}`.replace(/-/g, MINUS);
}

/** 真值 → 机器码，宽 n+1 位。超出范围抛 BitsError('range')。 */
export function encode(code: Code, units: number, n: number, options: EncodeOptions = {}): Bits {
  assertValueBits(n);
  assertUnits(units);
  const { min, max } = codeRange(code, n);
  if (units < min || units > max) throw new BitsError('range', rangeMessage(code, units, n));
  const wantsNegativeZero = units === 0 && options.negativeZero === true;
  const top = 2 ** n;
  switch (code) {
    case '原码': {
      const negative = units < 0 || wantsNegativeZero;
      return (negative ? '1' : '0') + fromUnsigned(Math.abs(units), n);
    }
    case '反码': {
      const magnitude = fromUnsigned(Math.abs(units), n);
      return units < 0 || wantsNegativeZero ? `1${invert(magnitude)}` : `0${magnitude}`;
    }
    case '补码':
      if (wantsNegativeZero) throw new BitsError('range', '补码的 0 只有一种形式，没有负零');
      return fromUnsigned(units < 0 ? 2 * top + units : units, n + 1);
    case '移码':
      if (wantsNegativeZero) throw new BitsError('range', '移码的 0 只有一种形式，没有负零');
      return fromUnsigned(top + units, n + 1);
  }
}

/** 机器码 → 真值。数值位数取位串长度减 1。原码、反码的负零解码为 0。 */
export function decode(code: Code, bits: Bits): number {
  assertBits(bits);
  if (bits.length < 2) throw new BitsError('format', `机器码至少要有 1 个符号位和 1 个数值位，收到「${bits}」`);
  const n = bits.length - 1;
  assertValueBits(n);
  const signIsOne = bits.charAt(0) === '1';
  const rest = bits.slice(1);
  switch (code) {
    case '原码': {
      const magnitude = toUnsigned(rest);
      return signIsOne && magnitude !== 0 ? -magnitude : magnitude;
    }
    case '反码': {
      const magnitude = toUnsigned(signIsOne ? invert(rest) : rest);
      return signIsOne && magnitude !== 0 ? -magnitude : magnitude;
    }
    case '补码':
      return toUnsigned(bits) - (signIsOne ? 2 ** (n + 1) : 0);
    case '移码':
      return toUnsigned(bits) - 2 ** n;
  }
}

/** 是不是原码或反码的负零（1000…0、1111…1）。补码、移码恒为 false。 */
export function isNegativeZero(code: Code, bits: Bits): boolean {
  assertBits(bits);
  if (bits.length < 2 || bits.charAt(0) !== '1') return false;
  const rest = bits.slice(1);
  if (code === '原码') return !rest.includes('1');
  if (code === '反码') return !rest.includes('0');
  return false;
}

/** 真值 → 变形补码（n+2 位，模 2^(n+2)，两个符号位相同）。范围与补码相同。 */
export function encodeModified(units: number, n: number): Bits {
  assertValueBits(n);
  assertUnits(units);
  const { min, max } = codeRange('补码', n);
  if (units < min || units > max) {
    throw new BitsError(
      'range',
      `真值超出范围：${n} 位数值位的变形补码操作数只能是 ${min} 到 ${max} 个最低位单位，收到 ${units}`.replace(/-/g, MINUS),
    );
  }
  return fromUnsigned(units < 0 ? 2 ** (n + 2) + units : units, n + 2);
}

/**
 * 变形补码 → 真值，按模 2^(n+2) 的补码解释整个位串。
 * 符号位是 01 或 10（溢出）时，得到的是数学上的结果，它不在 n 位数值位的范围内。
 */
export function decodeModified(bits: Bits): number {
  assertBits(bits);
  if (bits.length < 3) throw new BitsError('format', `变形补码至少要有 2 个符号位和 1 个数值位，收到「${bits}」`);
  assertValueBits(bits.length - 2);
  return toUnsigned(bits) - (bits.charAt(0) === '1' ? 2 ** bits.length : 0);
}

export type OverflowKind = '无溢出' | '正溢' | '负溢';

/** 按两个符号位判溢出（教材 p38）：00、11 无溢出，01 正溢，10 负溢。 */
export function modifiedOverflow(bits: Bits): OverflowKind {
  assertBits(bits);
  if (bits.length < 3) throw new BitsError('format', `变形补码至少要有 2 个符号位和 1 个数值位，收到「${bits}」`);
  const sign = bits.slice(0, 2);
  if (sign === '01') return '正溢';
  if (sign === '10') return '负溢';
  return '无溢出';
}

/** 补码（n+1 位）→ 变形补码（n+2 位）：把符号位再写一遍。 */
export function toModified(twos: Bits): Bits {
  assertBits(twos);
  if (twos.length < 2) throw new BitsError('format', `补码至少要有 1 个符号位和 1 个数值位，收到「${twos}」`);
  return twos.charAt(0) + twos;
}

/** 变形补码 → 补码：去掉一个符号位。两个符号位不同（已溢出）时没有对应的补码，报错。 */
export function fromModified(modified: Bits): Bits {
  if (modifiedOverflow(modified) !== '无溢出') {
    throw new BitsError('range', `「${modified}」的两个符号位不同，结果已溢出，没有对应的 ${modified.length - 1} 位补码`);
  }
  return modified.slice(1);
}

export interface NegationByAdding {
  /** 连同符号位各位取反之后的位串。 */
  inverted: Bits;
  /** 末位加 1 之后的结果，即 [−y]补。 */
  result: Bits;
  /** 加 1 时最高位向外的进位（只有全 0 的位串才是 1），按模丢掉。 */
  carryOut: Bit;
}

/** 由 [y]补 求 [−y]补：连同符号位各位取反，末位加 1（教材 p36 式 2.16）。补码、变形补码通用。 */
export function negateByInvertAddOne(bits: Bits): NegationByAdding {
  const inverted = invert(bits);
  const one = '0'.repeat(bits.length - 1) + '1';
  const added = rippleAdd(inverted, one);
  return { inverted, result: added.sum, carryOut: added.carryOut };
}

export interface NegationByScan {
  result: Bits;
  /** 从右往左遇到的第一个 1 的下标；全 0 时是 −1。 */
  pivot: number;
}

/**
 * 由 [y]补 求 [−y]补 的另一种做法（教材 p46 对 2 求补器）：
 * 从右往左找到第一个 1，这一位和它右边的位不变，左边各位取反。
 */
export function negateByScan(bits: Bits): NegationByScan {
  assertBits(bits);
  const pivot = bits.lastIndexOf('1');
  // 第一个 1 在最左边（或根本没有 1）时，左边没有要取反的位。
  if (pivot <= 0) return { result: bits, pivot };
  return { result: invert(bits.slice(0, pivot)) + bits.slice(pivot), pivot };
}

/**
 * 按写法排版机器码。定点整数原样输出（01001、001010）；
 * 定点小数在符号位后面加小数点（0.1001；变形补码 signBits = 2：11.10001）。
 */
export function formatBits(bits: Bits, notation: Notation, signBits = 1): string {
  assertBits(bits);
  if (!Number.isInteger(signBits) || signBits < 1 || signBits >= bits.length) {
    throw new BitsError('format', `符号位数必须在 1 和 ${bits.length - 1} 之间，收到 ${String(signBits)}`);
  }
  return notation === '整数' ? bits : `${bits.slice(0, signBits)}.${bits.slice(signBits)}`;
}

/** 移码的教材写法：符号位后加逗号（1,10101）。逗号只起分隔作用。 */
export function formatExcess(bits: Bits): string {
  assertBits(bits);
  if (bits.length < 2) throw new BitsError('format', `移码至少要有 1 个符号位和 1 个数值位，收到「${bits}」`);
  return `${bits.charAt(0)},${bits.slice(1)}`;
}

export interface ParsedBits {
  bits: Bits;
  /** 小数点（或移码的逗号）左边有几位；没写分隔符时是 null。 */
  point: number | null;
}

/** 读入手写的机器码：允许空格，允许一个小数点或逗号（0.1001、11.10001、1,10101）。 */
export function parseBits(text: string): ParsedBits {
  const compact = text.replace(/\s+/g, '');
  const match = /^([01]+)(?:[.,]([01]+))?$/.exec(compact);
  if (!match) throw new BitsError('format', `「${text}」不是机器码：只能有 0、1 和一个小数点`);
  const head = match[1] ?? '';
  const tail = match[2];
  const bits = tail === undefined ? head : head + tail;
  assertBits(bits);
  return { bits, point: tail === undefined ? null : head.length };
}

function binaryOf(magnitude: number, minDigits: number): string {
  return magnitude.toString(2).padStart(minDigits, '0');
}

/**
 * 真值的教材写法（带符号的二进制数）。
 * 定点整数：+1010、−0011；定点小数：+0.1010、−0.0011、−1.0000。0 不带符号。
 * units 不限于 n 位的范围，溢出时的数学结果也能写出来（+10001、−1.0100）。
 */
export function formatValue(units: number, n: number, notation: Notation): string {
  assertValueBits(n);
  assertUnits(units);
  const magnitude = Math.abs(units);
  const sign = units > 0 ? '+' : units < 0 ? MINUS : '';
  if (notation === '整数') return sign + binaryOf(magnitude, n);
  const whole = Math.floor(magnitude / 2 ** n);
  const part = magnitude - whole * 2 ** n;
  return `${sign}${whole.toString(2)}.${binaryOf(part, n)}`;
}

/**
 * 读入二进制真值，返回以最低位为单位的整数。不检查是否在某种码的范围内，交给 encode。
 * 定点整数：+1010、-11、1010（不足 n 位在左边补 0）。
 * 定点小数：0.101、-0.0111、-1（小数部分不足 n 位在右边补 0，多于 n 位的非 0 位报错）。
 * 负号接受 -、−、–。
 */
export function parseValue(text: string, n: number, notation: Notation): number {
  assertValueBits(n);
  const compact = text.replace(/\s+/g, '');
  const match = /^([+\-−–]?)([01]*)(?:\.([01]*))?$/.exec(compact);
  const whole = match?.[2] ?? '';
  const part = match?.[3];
  if (!match || (whole === '' && (part === undefined || part === ''))) {
    throw new BitsError('format', `「${text}」不是二进制真值，应写成 +1010 或 −0.0111 这样的形式`);
  }
  const negative = match[1] !== '' && match[1] !== '+';
  const wholeDigits = whole.replace(/^0+/, '');
  if (wholeDigits.length > MAX_VALUE_BITS + 2) throw new BitsError('range', `「${text}」的位数太多`);
  const wholeValue = wholeDigits === '' ? 0 : toUnsigned(wholeDigits);
  let magnitude: number;
  if (notation === '整数') {
    if (part !== undefined) throw new BitsError('format', `定点整数的真值不带小数点，收到「${text}」`);
    magnitude = wholeValue;
  } else {
    const partDigits = (part ?? '').replace(/0+$/, '');
    if (partDigits.length > n) {
      throw new BitsError('range', `「${text}」的小数部分有 ${partDigits.length} 位，${n} 位数值位写不下`);
    }
    const partValue = partDigits === '' ? 0 : toUnsigned(partDigits.padEnd(n, '0'));
    magnitude = wholeValue * 2 ** n + partValue;
  }
  if (!Number.isSafeInteger(magnitude)) throw new BitsError('range', `「${text}」的位数太多`);
  return negative && magnitude !== 0 ? -magnitude : magnitude;
}

/** 真值的十进制写法，精确，不四舍五入：−3、17、0.3125、−0.46875。 */
export function formatDecimal(units: number, n: number, notation: Notation): string {
  assertValueBits(n);
  assertUnits(units);
  const sign = units < 0 ? MINUS : '';
  const magnitude = Math.abs(units);
  if (notation === '整数') return sign + String(magnitude);
  // magnitude / 2^n = magnitude × 5^n / 10^n
  const digits = (BigInt(magnitude) * 5n ** BigInt(n)).toString().padStart(n + 1, '0');
  const whole = digits.slice(0, digits.length - n);
  const part = digits.slice(digits.length - n).replace(/0+$/, '');
  return sign + (part === '' ? whole : `${whole}.${part}`);
}
