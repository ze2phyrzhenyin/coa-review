/**
 * 浮点数的机器码：十进制 ↔ 机器码（教材 2.1.1–2.1.2，p24、p27–30）。规格见 specs/2-ieee.md。
 *
 * 两类格式：
 * - 隐藏位格式：IEEE754 单精度（偏移 127）、双精度（偏移 1023），和例 2.10 的 1+8+23、偏移 128（没有特殊值）。
 *   x = (−1)^S × 1.M × 2^(E − 偏移)，最高位的 1 不存。
 * - 教学格式（习题 3、解析计算 29、30）：数符 S | 阶码 k 位（含阶符，移码或补码）| 尾数 m 位，
 *   S 和尾数合起来是定点小数尾数（原码或补码），x = 尾数 × 2^阶码。
 * 真值一律用 rational.ts 的精确有理数算，不经过 JavaScript 的浮点数。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';
import { BitsError, codeRange, decode, encode, formatBits, fromUnsigned } from '../../lib/bits';
import { makeRandom } from '../codes/random';
import {
  MINUS,
  type Rational,
  abs,
  cmp,
  floor,
  hasMinus,
  log2Floor,
  mul,
  neg,
  parseDecimal,
  pow2,
  rational,
  sub,
  toBinary,
  toDecimal,
} from './rational';

export const ENGINE = 'ieee';

export type HiddenName = '单精度' | '双精度' | '偏移128';

/** 教学格式：阶码 k 位（含阶符），尾数 m 位（不含数符）。 */
export interface TeachFormat {
  k: number;
  exp: '移码' | '补码';
  m: number;
  mant: '原码' | '补码';
}

export type IeeeFormat = HiddenName | TeachFormat;
export type Direction = '十进制→机器数' | '机器数→十进制';

export interface IeeeParams {
  format: IeeeFormat;
  direction: Direction;
  /** 十进制（20.59375、−0.75、27/64、∞、NaN）或机器码（十六进制，或二进制）。 */
  text: string;
}

export type FloatKind = '' | '规格化数' | '非规格化数' | '零' | '无穷大' | 'NaN' | '不是规格化数';

export interface IeeeState {
  /** 三段位串，没写时是空串。 */
  sign: string;
  exponent: string;
  mantissa: string;
  hex: string;
  /** |x| 的二进制。 */
  binary: string;
  /** 规格化写法，如 1.010010011 × 2^4。 */
  normal: string;
  /** 指数真值。 */
  e: string;
  /** 阶码的十进制值（隐藏位格式）或阶码位串（教学格式）。 */
  E: string;
  hidden: string;
  kind: FloatKind;
  /** 被舍去的位。 */
  rounded: string;
  /** 二进制真值（带符号）。 */
  value: string;
  decimal: string;
}

interface HiddenLayout {
  teach: false;
  name: string;
  expBits: number;
  mantBits: number;
  bias: number;
  specials: boolean;
}

interface TeachLayout extends TeachFormat {
  teach: true;
  name: string;
}

type Layout = HiddenLayout | TeachLayout;

const HIDDEN: Record<HiddenName, HiddenLayout> = {
  单精度: { teach: false, name: 'IEEE754 单精度', expBits: 8, mantBits: 23, bias: 127, specials: true },
  双精度: { teach: false, name: 'IEEE754 双精度', expBits: 11, mantBits: 52, bias: 1023, specials: true },
  偏移128: { teach: false, name: '1+8+23 位、偏移 128 的格式（例 2.10，不是 IEEE754）', expBits: 8, mantBits: 23, bias: 128, specials: false },
};

function layoutOf(format: IeeeFormat): Layout {
  if (typeof format === 'string') {
    const found = HIDDEN[format];
    if (!found) throw new BitsError('format', `格式只能是 单精度、双精度、偏移128 或教学格式，收到「${String(format)}」`);
    return found;
  }
  const { k, m } = format;
  if (!Number.isInteger(k) || k < 2 || k > 16) throw new BitsError('format', `阶码位数 k 必须是 2 到 16 的整数，收到 ${String(k)}`);
  if (!Number.isInteger(m) || m < 2 || m > 40) throw new BitsError('format', `尾数位数 m 必须是 2 到 40 的整数，收到 ${String(m)}`);
  if (format.exp !== '移码' && format.exp !== '补码') throw new BitsError('format', `阶码只能用移码或补码，收到「${String(format.exp)}」`);
  if (format.mant !== '原码' && format.mant !== '补码') throw new BitsError('format', `尾数只能用原码或补码，收到「${String(format.mant)}」`);
  return { teach: true, ...format, name: `阶码 ${k} 位${format.exp}、尾数 ${m} 位${format.mant}（数符另占 1 位）` };
}

function totalBits(L: Layout): number {
  return L.teach ? 1 + L.k + L.m : 1 + L.expBits + L.mantBits;
}

/** 4 位一组，从左起。 */
export function group(bits: string): string {
  return bits.replace(/(.{4})(?=.)/g, '$1 ');
}

function hexOf(bits: string): string {
  if (bits.length % 4 !== 0) return '';
  let out = '';
  for (let i = 0; i < bits.length; i += 4) out += parseInt(bits.slice(i, i + 4), 2).toString(16).toUpperCase();
  return `${out}H`;
}

/** 读机器码：二进制（可有空格、逗号）或十六进制（可带 H、0x）。 */
export function parseMachine(text: string, total: number): string {
  let compact = text.replace(/[\s,_]/g, '');
  const binaryForm = /^[01]+$/.test(compact) && compact.length === total;
  if (binaryForm) return compact;
  compact = compact.replace(/^0x/i, '').replace(/^\((.*)\)16$/, '$1').replace(/[Hh]$/, '');
  if (/^[0-9A-Fa-f]+$/.test(compact) && compact.length * 4 === total) {
    return [...compact].map((ch) => parseInt(ch, 16).toString(2).padStart(4, '0')).join('');
  }
  const hexHint = total % 4 === 0 ? `或 ${total / 4} 位十六进制` : '';
  throw new BitsError('format', `「${text}」不是这种格式的机器码：应为 ${total} 位二进制${hexHint}`);
}

type DecimalInput = { special: 'NaN' } | { special: '∞'; negative: boolean } | { special: null; negative: boolean; mag: Rational };

function parseDecimalInput(text: string): DecimalInput {
  const compact = text.replace(/\s+/g, '');
  if (/^[+]?nan$/i.test(compact)) return { special: 'NaN' };
  const inf = /^([+\-−–]?)(∞|inf|infinity)$/i.exec(compact);
  if (inf) return { special: '∞', negative: inf[1] !== '' && inf[1] !== '+' };
  const value = parseDecimal(compact);
  if (!value) throw new BitsError('format', `「${text}」不是十进制数，可以写 20.59375、−0.75、27/64、∞ 或 NaN`);
  return { special: null, negative: hasMinus(compact), mag: abs(value) };
}

/** |x| 的二进制写法，写不完时多写几位再加「…」。 */
function binaryText(mag: Rational, fracBits: number): string {
  return toBinary(mag, Math.max(8, fracBits)).text;
}

/** 输入的绝对值：十进制写得完就写十进制，否则写成分数（如 1/3）。 */
function inputText(mag: Rational): string {
  try {
    return toDecimal(mag);
  } catch {
    return `${mag.num}/${mag.den}`;
  }
}

function trimZeros(bits: string): string {
  const t = bits.replace(/0+$/, '');
  return t === '' ? '0' : t;
}

function signed(negative: boolean, body: string): string {
  return (negative ? MINUS : '') + body;
}

function expText(e: number): string {
  return e < 0 ? `${MINUS}${-e}` : String(e);
}

/** 数值的位置写法太长时改写成 1.M × 2^e。 */
function valueText(negative: boolean, mag: Rational, fallback: string): string {
  const text = toBinary(mag, 80);
  if (text.exact && text.text.length <= 72) return signed(negative, text.text);
  return signed(negative, fallback);
}

function decimalOf(negative: boolean, mag: Rational): string {
  return toDecimal(negative ? neg(mag) : mag);
}

/** 二进制写法：先把位串当无符号数，用于「10000010 − 01111111 = 00000011」这样的算式。 */
function unsignedBits(value: number, width: number): string {
  return fromUnsigned(value, width);
}

// ---------- 隐藏位格式的编码 ----------

interface HiddenEncoding {
  E: number;
  /** 尾数域，p 位。 */
  M: string;
  kind: FloatKind;
  /** 规格化（或非规格化）后、舍入前的指数。 */
  e0: number;
  /** 最终的指数（规格化数）；∞ 时为 null。 */
  e: number | null;
  subnormalBefore: boolean;
  /** 舍入前，第 p 位之后的位（可能写不完）。 */
  dropped: string;
  roundedUp: boolean;
  carry: boolean;
  overflow: boolean;
  /** 舍入前的 1.xxx（或 0.xxx）有效位，不含被舍去的位。 */
  kept: string;
  /** 被舍去的部分与最低位一半的比较：1 超过，0 正好，−1 不到。 */
  half: number;
  lowOdd: boolean;
}

function emaxOf(L: HiddenLayout): number {
  return L.specials ? 2 ** L.expBits - 2 - L.bias : 2 ** L.expBits - 1 - L.bias;
}

function eminOf(L: HiddenLayout): number {
  return L.specials ? 1 - L.bias : -L.bias;
}

function encodeHidden(L: HiddenLayout, mag: Rational): HiddenEncoding {
  const p = L.mantBits;
  const emin = eminOf(L);
  const emax = emaxOf(L);
  const e0 = log2Floor(mag);
  const subnormal = L.specials && e0 < emin;
  if (!L.specials && e0 < emin) {
    throw new BitsError('range', `|x| 小于 2^${expText(emin)}，这种格式能表示的最小正数是 1.0 × 2^${expText(emin)}，阶码下溢`);
  }
  const shift = subnormal ? p - emin : p - e0;
  const scaled = mul(mag, pow2(shift));
  let q = floor(scaled);
  const rest = sub(scaled, rational(q));
  const kept = q.toString(2).padStart(subnormal ? p + 1 : p + 1, '0');
  const twice = cmp(mul(rest, rational(2n)), rational(1n));
  const lowOdd = (q & 1n) === 1n;
  const roundedUp = twice > 0 || (twice === 0 && lowOdd);
  const dropped = rest.num === 0n ? '' : toBinary(rest, 24).text.replace(/^0\./, '');
  if (roundedUp) q += 1n;
  const one = 1n << BigInt(p);
  let carry = false;
  let e = subnormal ? emin : e0;
  let E: number;
  let kind: FloatKind;
  if (subnormal) {
    if (q === one) {
      carry = true;
      E = 1;
      kind = '规格化数';
      q = 0n;
    } else {
      E = 0;
      kind = q === 0n ? '零' : '非规格化数';
    }
  } else {
    if (q === one << 1n) {
      carry = true;
      q = one;
      e += 1;
    }
    q -= one;
    E = e + L.bias;
    kind = '规格化数';
  }
  let overflow = false;
  if (!subnormal && e > emax) {
    if (!L.specials) {
      throw new BitsError('range', `指数 e = ${expText(e)} 超过 ${expText(emax)}，这种格式能表示的最大数是 (2 − 2^-${p}) × 2^${expText(emax)}，阶码上溢`);
    }
    overflow = true;
    E = 2 ** L.expBits - 1;
    q = 0n;
    kind = '无穷大';
  }
  return {
    E,
    M: q.toString(2).padStart(p, '0'),
    kind,
    e0,
    e: overflow ? null : e,
    subnormalBefore: subnormal,
    dropped,
    roundedUp,
    carry,
    overflow,
    kept,
    half: twice,
    lowOdd,
  };
}

interface HiddenDecoding {
  kind: FloatKind;
  negative: boolean;
  E: number;
  e: number | null;
  hidden: string;
  mag: Rational | null;
}

function decodeHidden(L: HiddenLayout, bits: string): HiddenDecoding {
  const negative = bits.charAt(0) === '1';
  const E = parseInt(bits.slice(1, 1 + L.expBits), 2);
  const M = bits.slice(1 + L.expBits);
  const mInt = BigInt(`0b${M}`);
  const top = 2 ** L.expBits - 1;
  const frac = rational(mInt, 1n << BigInt(L.mantBits));
  if (L.specials && E === top) return { kind: mInt === 0n ? '无穷大' : 'NaN', negative, E, e: null, hidden: '', mag: null };
  if (L.specials && E === 0) {
    if (mInt === 0n) return { kind: '零', negative, E, e: null, hidden: '', mag: rational(0n) };
    const e = eminOf(L);
    return { kind: '非规格化数', negative, E, e, hidden: '0', mag: mul(frac, pow2(e)) };
  }
  const e = E - L.bias;
  return { kind: '规格化数', negative, E, e, hidden: '1', mag: mul(add1(frac), pow2(e)) };
}

function add1(a: Rational): Rational {
  return rational(a.num + a.den, a.den);
}

// ---------- 教学格式 ----------

function expRange(L: TeachLayout): { min: number; max: number } {
  return codeRange(L.exp, L.k - 1);
}

interface TeachEncoding {
  zero: boolean;
  e: number;
  /** 尾数的绝对值，以 2^-m 为单位。 */
  q: number;
  expBits: string;
  /** 数符加尾数，m+1 位。 */
  mantCode: string;
  dropped: string;
  roundedUp: boolean;
  carry: boolean;
  /** 负的补码尾数舍入后正好是 −1/2，改写成 −1 × 2^(e−1)。 */
  rewritten: boolean;
}

function teachExponent(L: TeachLayout, negative: boolean, mag: Rational): number {
  const f = log2Floor(mag);
  // 补码负尾数规格化后在 [−1, −1/2)：|x| 恰为 2 的幂时尾数取 −1。
  if (negative && L.mant === '补码' && cmp(mag, pow2(f)) === 0) return f;
  return f + 1;
}

function encodeTeach(L: TeachLayout, negative: boolean, mag: Rational): TeachEncoding {
  const range = expRange(L);
  if (mag.num === 0n) {
    return {
      zero: true,
      e: range.min,
      q: 0,
      expBits: encode(L.exp, range.min, L.k - 1),
      mantCode: '0'.repeat(L.m + 1),
      dropped: '',
      roundedUp: false,
      carry: false,
      rewritten: false,
    };
  }
  let e = teachExponent(L, negative, mag);
  const scaled = mul(mag, pow2(L.m - e));
  let q = floor(scaled);
  const rest = sub(scaled, rational(q));
  const dropped = rest.num === 0n ? '' : toBinary(rest, 24).text.replace(/^0\./, '');
  const roundedUp = dropped.charAt(0) === '1';
  if (roundedUp) q += 1n;
  let carry = false;
  const full = 1n << BigInt(L.m);
  if (q === full && !(negative && L.mant === '补码')) {
    q = full >> 1n;
    e += 1;
    carry = true;
  }
  let rewritten = false;
  if (negative && L.mant === '补码' && q === full >> 1n) {
    // 补码尾数 1.100…0（−1/2）的符号位与最高数值位相同，不是规格化数，改写成 −1 × 2^(e−1)。
    q = full;
    e -= 1;
    rewritten = true;
  }
  if (e < range.min || e > range.max) {
    throw new BitsError(
      'range',
      `规格化后指数 e = ${expText(e)}，${L.k} 位${L.exp}的阶码只能是 ${expText(range.min)} 到 ${expText(range.max)}，${e > range.max ? '上溢' : '下溢'}`.replace(/-/g, MINUS),
    );
  }
  const units = Number(q);
  return {
    zero: false,
    e,
    q: units,
    expBits: encode(L.exp, e, L.k - 1),
    mantCode: encode(L.mant, negative ? -units : units, L.m),
    dropped,
    roundedUp,
    carry,
    rewritten,
  };
}

function isNormalized(L: TeachLayout, mantCode: string): boolean {
  if (!mantCode.slice(1).includes('1') && L.mant === '原码') return false;
  if (L.mant === '原码') return mantCode.charAt(1) === '1';
  return mantCode.charAt(0) !== mantCode.charAt(1);
}

function mantValueText(units: number, m: number): string {
  const sign = units < 0 ? MINUS : '';
  const a = Math.abs(units);
  const whole = Math.floor(a / 2 ** m);
  return `${sign}${whole}.${(a - whole * 2 ** m).toString(2).padStart(m, '0')}`;
}

// ---------- run ----------

const KIND_OPTIONS = ['规格化数', '非规格化数', '零', '无穷大', 'NaN'];

function emptyState(): IeeeState {
  return {
    sign: '',
    exponent: '',
    mantissa: '',
    hex: '',
    binary: '',
    normal: '',
    e: '',
    E: '',
    hidden: '',
    kind: '',
    rounded: '',
    value: '',
    decimal: '',
  };
}

function checkParams(params: IeeeParams): Layout {
  const L = layoutOf(params.format);
  if (params.direction !== '十进制→机器数' && params.direction !== '机器数→十进制') {
    throw new BitsError('format', `方向只能是「十进制→机器数」或「机器数→十进制」，收到「${String(params.direction)}」`);
  }
  if (typeof params.text !== 'string' || params.text.trim() === '') throw new BitsError('format', '没有给出要转换的数');
  return L;
}

type Push = (input: Parameters<TraceBuilder<IeeeParams, IeeeState>['step']>[0]) => string;

export function run(params: IeeeParams): Trace<IeeeParams, IeeeState> {
  const L = checkParams(params);
  const total = totalBits(L);
  const conditions: Condition[] = [
    { label: '格式', value: L.name },
    {
      label: '位数',
      value: L.teach
        ? `共 ${total} 位：数符 1 位，阶码 ${L.k} 位，尾数 ${L.m} 位`
        : `共 ${total} 位：S 1 位，阶码 E ${L.expBits} 位，尾数 M ${L.mantBits} 位`,
    },
    L.teach
      ? { label: '真值', value: 'x = 尾数 × 2^阶码，尾数是定点小数' }
      : { label: '真值', value: `x = (−1)^S × 1.M × 2^(E − ${L.bias})` },
    { label: params.direction === '十进制→机器数' ? '十进制' : '机器码', value: params.text.trim() },
  ];
  const builder = new TraceBuilder<IeeeParams, IeeeState>(ENGINE, params, emptyState(), conditions);
  let count = 0;
  const push: Push = (input) => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };
  if (params.direction === '十进制→机器数') {
    return L.teach ? teachToBits(builder, push, L, params.text) : hiddenToBits(builder, push, L, params.text);
  }
  const bits = parseMachine(params.text, total);
  return L.teach ? teachFromBits(builder, push, L, bits) : hiddenFromBits(builder, push, L, bits);
}

function biasWhy(L: HiddenLayout): string {
  if (!L.specials) {
    return `这种格式不是 IEEE754：偏移量取 2^7 = 128，和 2.1.2 的移码一样；E 从 0 到 255 都表示规格化数，没有特殊值（例 2.10）。`;
  }
  const k = L.expBits - 1;
  return `${L.name}的偏移量是 2^${k} − 1 = ${L.bias}，不是 2^${k}：E 全 0 和全 1 留给零、非规格化数、无穷大和 NaN，规格化数的 E 只用 1 到 ${2 ** L.expBits - 2}，e 就在 ${expText(eminOf(L))} 到 +${emaxOf(L)}（p28）。`;
}

function hiddenToBits(
  builder: TraceBuilder<IeeeParams, IeeeState>,
  push: Push,
  L: HiddenLayout,
  text: string,
): Trace<IeeeParams, IeeeState> {
  const input = parseDecimalInput(text);
  const p = L.mantBits;
  const ew = L.expBits;
  const negative = input.special === 'NaN' ? false : input.negative;
  const S = negative ? '1' : '0';

  const stepSign = push({
    title: `x ${input.special === 'NaN' ? '是 NaN，符号位取' : negative ? '是负数，符号位' : '是正数，符号位'} S = ${S}`,
    why: 'S = 0 表示正，S = 1 表示负。尾数域只存绝对值，符号位和尾数合起来看，相当于尾数的原码（p28）。',
    ref: '教材 p27–28',
    focus: ['sign'],
    update: (s) => {
      s.sign = S;
    },
  });

  const special = input.special !== null || input.mag.num === 0n;
  if (special) {
    if (!L.specials) throw new BitsError('range', `${L.name}没有零、无穷大和 NaN 的写法，它只表示非零规格化数`);
    const isNaN = input.special === 'NaN';
    const isInf = input.special === '∞';
    const E = isNaN || isInf ? '1'.repeat(ew) : '0'.repeat(ew);
    const M = isNaN ? `1${'0'.repeat(p - 1)}` : '0'.repeat(p);
    const kind: FloatKind = isNaN ? 'NaN' : isInf ? '无穷大' : '零';
    const name = isNaN ? 'NaN' : isInf ? `${negative ? MINUS : '+'}∞` : `${negative ? MINUS : '+'}0`;
    const stepSpecial = push({
      title: `${name} 是特殊值：阶码 ${E}，尾数 ${group(M)}`,
      why: isNaN
        ? '阶码全 1 且尾数不为 0 表示 NaN（不是一个数）。尾数取最高位为 1，其余为 0。'
        : isInf
          ? '阶码全 1 且尾数全 0 表示无穷大，符号位区分 +∞ 和 −∞（p28）。'
          : '阶码全 0 且尾数全 0 表示 0，叫机器零；符号位区分 +0 和 −0（p28）。',
      ref: '教材 p28',
      focus: ['exponent', 'mantissa', 'kind'],
      update: (s) => {
        s.exponent = E;
        s.mantissa = M;
        s.kind = kind;
        s.E = String(parseInt(E, 2));
        s.hidden = '';
      },
    });
    const bits = S + E + M;
    const hex = hexOf(bits);
    const stepHex = push({
      title: `拼成 S | E | M：${group(bits)}，即 ${hex}`,
      why: '三段按顺序排好，从左起 4 位一组换成一位十六进制。',
      ref: '教材 p29 例2.6',
      focus: ['hex'],
      update: (s) => {
        s.hex = hex;
        s.value = name;
        s.decimal = name;
      },
    });
    return builder.finish(
      { '符号位 S': S, 阶码: E, 尾数: M, 机器数: group(bits), 十六进制: hex },
      {
        columns: ['量', '值'],
        rows: [
          { cells: ['S', S], step: stepSign },
          { cells: ['阶码', E], step: stepSpecial },
          { cells: ['尾数', group(M)], step: stepSpecial },
          { cells: ['十六进制', hex], step: stepHex },
        ],
      },
    );
  }

  const mag = input.mag;
  const enc = encodeHidden(L, mag);
  const emin = eminOf(L);
  const binary = binaryText(mag, Math.max(0, p - enc.e0) + 4);
  const stepBinary = push({
    title: `|x| = ${inputText(mag)} = (${binary})₂`,
    why: binary.endsWith('…')
      ? '整数部分除 2 取余、小数部分乘 2 取整。这个小数乘 2 永远乘不尽，写到尾数用得着的位数再多几位就够了。'
      : '整数部分反复除 2 取余，小数部分反复乘 2 取整，两部分分开转换再拼起来。',
    ref: '教材 p29 例2.6',
    focus: ['binary'],
    update: (s) => {
      s.binary = binary;
    },
  });

  const keptMant = enc.kept.slice(1);
  const normalBefore = enc.subnormalBefore
    ? `0.${trimZeros(keptMant)}${enc.dropped ? '…' : ''} × 2^${expText(emin)}`
    : `1.${trimZeros(keptMant)}${enc.dropped ? '…' : ''} × 2^${expText(enc.e0)}`;
  const shownE0 = enc.subnormalBefore ? emin : enc.e0;
  const stepNormal = push({
    title: enc.subnormalBefore
      ? `|x| 比最小的规格化数 2^${expText(emin)} 还小，写成 ${normalBefore}`
      : `移动小数点：(${binary})₂ = ${normalBefore}`,
    why: enc.subnormalBefore
      ? `规格化数的指数最小是 ${expText(emin)}。更小的数用非规格化数：指数固定按 ${expText(emin)} 算，小数点前是 0（p28 第 5 种情况）。`
      : '小数点移到第一个 1 的后面，最高位就是 1，这是规格化的写法（p28）。小数点左移几位，指数加几。',
    ref: '教材 p28',
    focus: ['normal', 'e'],
    ask: enc.subnormalBefore
      ? {
          prompt: `|x| 比 2^${expText(emin)} 还小，写成 0.xxx × 2^e 时 e 取多少？`,
          kind: 'number',
          answer: String(emin),
          hint: '非规格化数的指数是固定的，等于最小规格化数的指数。',
        }
      : {
          prompt: `把 (${binary})₂ 的小数点移到第一个 1 后面，指数 e 是多少？`,
          kind: 'number',
          answer: String(enc.e0),
          hint: '小数点往左移几位，指数就加几；往右移几位，指数就减几。',
        },
    update: (s) => {
      s.normal = normalBefore;
      s.e = String(shownE0);
    },
  });

  // 舍入（有被舍去的位时单独一步，p64 就近舍入）
  const emax = emaxOf(L);
  const preOverflow = !enc.subnormalBefore && enc.e0 > emax;
  const finalE = unsignedBits(enc.E, ew);
  const finalM = enc.M;
  const finalNormal = enc.overflow ? '' : `${enc.kind === '规格化数' ? '1' : '0'}.${trimZeros(finalM)} × 2^${expText(enc.e ?? emin)}`;
  let stepRound = '';
  if (enc.dropped !== '' && !preOverflow) {
    const tail = enc.dropped.length > 12 ? `${enc.dropped.slice(0, 12)}…` : enc.dropped;
    const how =
      enc.half > 0
        ? '超过最低位的一半，最低位加 1'
        : enc.half < 0
          ? '不到最低位的一半，直接截掉'
          : enc.lowOdd
            ? '正好是最低位的一半，最低位是 1，加 1 使它变成 0'
            : '正好是最低位的一半，最低位是 0，直接截掉';
    const parts = [`小数点后只能留 ${p} 位，第 ${p} 位后面还有 ${tail}。按就近舍入：多出的部分${how}（p64）。`];
    if (enc.carry && !enc.overflow) {
      parts.push(enc.subnormalBefore ? '加 1 后进位成 1.000…0，正好是最小的规格化数 1.0 × 2^' + expText(emin) + '。' : '加 1 后进位成 10.000…0，右移 1 位，指数加 1。');
    }
    if (enc.overflow) parts.push(`舍入后指数变成 ${expText(enc.e0 + 1)}，超过 ${expText(emax)}，阶码上溢，结果是无穷大（p64）。`);
    stepRound = push({
      title: enc.overflow ? `舍入：进位后指数超过 ${expText(emax)}，上溢` : `舍入：${normalBefore} ≈ ${finalNormal}`,
      why: parts.join(''),
      ref: '教材 p64',
      focus: ['normal', 'rounded', 'e'],
      update: (s) => {
        s.rounded = enc.dropped;
        if (!enc.overflow) s.normal = finalNormal;
        if (enc.e !== null) s.e = String(enc.e);
      },
    });
  }

  // 阶码（舍入之后的指数）
  const finalKindNormal = enc.kind === '规格化数';
  const shownE = enc.E;
  const shownEBits = finalE;
  const stepExp = push({
    title: enc.overflow
      ? `e = ${expText(enc.overflow && preOverflow ? enc.e0 : enc.e0 + 1)} 超过 ${expText(emax)}，阶码上溢，按无穷大写：E 全 1`
      : finalKindNormal
        ? `阶码 E = e + ${L.bias} = ${shownE} = ${shownEBits}`
        : `${enc.kind === '零' ? '舍入成 0，' : '非规格化数的'}阶码 E = 0：${shownEBits}`,
    why: enc.overflow
      ? `规格化数的 E 最大是 ${2 ** ew - 2}。超出就是阶码上溢，IEEE754 把它当作无穷大（p64）。`
      : finalKindNormal
        ? biasWhy(L)
        : `E = 0 表示非规格化数或 0，指数按 ${expText(emin)} 算，不是 0 − ${L.bias}。`,
    ref: enc.overflow || !finalKindNormal ? '教材 p28、p64' : L.specials ? '教材 p28 式(2.10)' : '教材 p30 例2.10',
    focus: ['exponent', 'E'],
    ...(enc.overflow
      ? {}
      : {
          ask: {
            prompt: finalKindNormal ? `e = ${expText(enc.e ?? enc.e0)}，阶码 E 的十进制值是多少？` : '非规格化数的阶码 E 的十进制值是多少？',
            kind: 'number' as const,
            answer: String(shownE),
            hint: finalKindNormal ? 'E = e + 偏移量，偏移量按这种格式的规定取。' : '看 p28 第 5 种情况：非规格化数的阶码全 0。',
          },
        }),
    update: (s) => {
      s.exponent = shownEBits;
      s.E = String(shownE);
    },
  });

  // 尾数
  const stepMant = push({
    title: enc.overflow
      ? `尾数 M = ${group(finalM)}`
      : !finalKindNormal
        ? `尾数 M 取 0.M 的 ${p} 位：${group(finalM)}`
        : `去掉最高位的 1，尾数 M 取 ${p} 位：${group(finalM)}`,
    why: enc.overflow
      ? '无穷大的尾数全 0。'
      : !finalKindNormal
        ? `非规格化数没有隐藏的 1，尾数直接取 0. 后面的 ${p} 位。`
        : `1.M 的那个 1 永远是 1，不存，只存小数点后面的 ${p} 位，等于多出 1 位精度（p28）。`,
    ref: '教材 p28',
    focus: ['mantissa', 'hidden'],
    update: (s) => {
      s.mantissa = finalM;
      s.hidden = enc.overflow ? '' : finalKindNormal ? '1' : '0';
    },
  });

  // 拼接
  const bits = S + finalE + finalM;
  const hex = hexOf(bits);
  const dec = decodeHidden(L, bits);
  const storedMag = dec.mag;
  const valueBits = storedMag ? valueText(negative, storedMag, normalStored(dec, finalM)) : `${negative ? MINUS : '+'}∞`;
  const storedDecimal = storedMag ? decimalOf(negative, storedMag) : valueBits;
  const exact = storedMag !== null && cmp(storedMag, mag) === 0;
  const stepHex = push({
    title: `拼成 S | E | M：${group(bits)}，即 ${hex}`,
    why: `三段按顺序排好，从左起 4 位一组换成一位十六进制。${exact ? '' : `舍入后存下的值是 ${storedDecimal}，与原数有误差。`}`,
    ref: '教材 p29 例2.6',
    focus: ['hex', 'kind', 'decimal'],
    update: (s) => {
      s.hex = hex;
      s.kind = dec.kind;
      s.value = valueBits;
      s.decimal = storedDecimal;
      if (dec.kind === '规格化数' || dec.kind === '非规格化数') s.normal = normalStored(dec, finalM);
    },
  });

  return builder.finish(
    { '符号位 S': S, 阶码: finalE, 尾数: finalM, 机器数: group(bits), 十六进制: hex },
    {
      columns: ['量', '值'],
      rows: [
        { cells: ['S', S], step: stepSign },
        { cells: ['|x| 的二进制', binary], step: stepBinary },
        { cells: ['规格化', normalBefore], step: stepNormal },
        ...(stepRound ? [{ cells: ['舍入', finalNormal || '上溢'], step: stepRound }] : []),
        { cells: ['阶码 E', `${shownE} = ${shownEBits}`], step: stepExp },
        { cells: ['尾数 M', group(finalM)], step: stepMant },
        { cells: ['十六进制', hex], step: stepHex },
      ],
    },
  );
}

function normalStored(dec: HiddenDecoding, M: string): string {
  if (dec.e === null) return '';
  const sign = dec.negative ? MINUS : '';
  return `${sign}${dec.hidden}.${trimZeros(M)} × 2^${expText(dec.e)}`;
}

function hiddenFromBits(
  builder: TraceBuilder<IeeeParams, IeeeState>,
  push: Push,
  L: HiddenLayout,
  bits: string,
): Trace<IeeeParams, IeeeState> {
  const ew = L.expBits;
  const S = bits.charAt(0);
  const E = bits.slice(1, 1 + ew);
  const M = bits.slice(1 + ew);
  const hex = hexOf(bits);
  const dec = decodeHidden(L, bits);
  const stepSplit = push({
    title: `展开成二进制 ${group(bits)}，分成 S = ${S}，阶码 ${E}，尾数 ${group(M)}`,
    why: `最高 1 位是符号位 S，接着 ${ew} 位是阶码 E，最后 ${L.mantBits} 位是尾数 M（p27）。`,
    ref: '教材 p27、p29 例2.5',
    focus: ['sign', 'exponent', 'mantissa'],
    update: (s) => {
      s.sign = S;
      s.exponent = E;
      s.mantissa = M;
      s.hex = hex;
    },
  });

  const allOnes = !E.includes('0');
  const allZeros = !E.includes('1');
  const mZero = !M.includes('1');
  const kindWhy = !L.specials
    ? '这种格式没有特殊值，任何位串都按规格化数读（例 2.10）。'
    : allOnes
      ? `阶码全 1，尾数${mZero ? '全 0，是无穷大' : '不为 0，是 NaN'}（p28）。`
      : allZeros
        ? `阶码全 0，尾数${mZero ? '全 0，是 0' : '不为 0，是非规格化数'}（p28）。`
        : `阶码不是全 0 也不是全 1，是规格化数（p28）。`;
  const stepKind = push({
    title: `阶码 ${E}，尾数${mZero ? '全 0' : '不全为 0'}：${dec.kind}`,
    why: kindWhy,
    ref: L.specials ? '教材 p28' : '教材 p30 例2.10',
    focus: ['exponent', 'mantissa', 'kind'],
    ...(L.specials
      ? {
          ask: {
            prompt: `阶码 ${E}、尾数${mZero ? '全 0' : '不全为 0'}，这个位串表示哪一种？`,
            kind: 'choice' as const,
            options: KIND_OPTIONS,
            answer: dec.kind,
            hint: '先看阶码是不是全 0 或全 1，再看尾数是不是全 0。',
          },
        }
      : {}),
    update: (s) => {
      s.kind = dec.kind;
    },
  });

  const rows: SolutionTable['rows'] = [
    { cells: ['S', S], step: stepSplit },
    { cells: ['阶码', E], step: stepSplit },
    { cells: ['尾数', group(M)], step: stepSplit },
  ];

  if (dec.mag === null || dec.kind === '零') {
    const name = dec.kind === 'NaN' ? 'NaN' : dec.kind === '无穷大' ? `${dec.negative ? MINUS : '+'}∞` : `${dec.negative ? MINUS : '+'}0`;
    const stepValue = push({
      title: `x = ${name}`,
      why: dec.kind === 'NaN' ? 'NaN 不表示任何数，符号位不起作用。' : '符号位决定正负，其余由特殊值的规定直接得出。',
      ref: '教材 p28',
      focus: ['value', 'decimal'],
      update: (s) => {
        s.value = name;
        s.decimal = name;
      },
    });
    rows.push({ cells: ['x', name], step: stepValue });
    return builder.finish({ 情况: dec.kind, '指数 e': '无', 真值: name, 十进制: name }, { columns: ['量', '值'], rows });
  }

  const e = dec.e ?? 0;
  const biasBits = unsignedBits(L.bias, ew);
  const eBits = e >= 0 ? unsignedBits(e, ew) : '';
  const stepE = push({
    title:
      dec.kind === '非规格化数'
        ? `非规格化数的指数 e = 1 − ${L.bias} = ${expText(e)}`
        : `指数 e = 阶码 − ${L.bias} = ${E} − ${biasBits} = ${e >= 0 ? `${eBits} = ` : ''}${expText(e)}`,
    why:
      dec.kind === '非规格化数'
        ? `E = 0 时指数按 1 − ${L.bias} 算，而不是 0 − ${L.bias}，这样最大的非规格化数和最小的规格化数正好接上。`
        : `阶码是指数加上偏移量存的，减回偏移量就是指数（式 ${L.specials ? (L.expBits === 8 ? '2.10' : '2.11') : '见例 2.10'}）。${biasWhy(L)}`,
    ref: dec.kind === '非规格化数' ? '教材 p28' : L.specials ? '教材 p28–29' : '教材 p30 例2.10',
    focus: ['e', 'E'],
    update: (s) => {
      s.e = String(e);
      s.E = String(dec.E);
    },
  });
  rows.push({ cells: ['指数 e', String(e)], step: stepE });

  const sig = `${dec.hidden}.${trimZeros(M)}`;
  const stepHidden = push({
    title: dec.kind === '非规格化数' ? `非规格化数没有隐藏位：0.M = ${sig}` : `补上隐藏的 1：1.M = ${sig}`,
    why:
      dec.kind === '非规格化数'
        ? '非规格化数小数点前是 0，所以不补 1。'
        : '规格化数小数点前的 1 存的时候省掉了，读的时候要补回来（p28）。',
    ref: '教材 p28',
    focus: ['hidden', 'normal'],
    update: (s) => {
      s.hidden = dec.hidden;
      s.normal = `${dec.negative ? MINUS : ''}${sig} × 2^${expText(e)}`;
    },
  });
  rows.push({ cells: [dec.kind === '非规格化数' ? '0.M' : '1.M', sig], step: stepHidden });

  const value = valueText(dec.negative, dec.mag, `${sig} × 2^${expText(e)}`);
  const decimal = decimalOf(dec.negative, dec.mag);
  const stepValue = push({
    title: `x = (−1)^${S} × ${sig} × 2^${expText(e)} = ${value} = ${decimal}`,
    why: `指数 ${expText(e)} 表示小数点${e >= 0 ? `右移 ${expText(e)}` : `左移 ${-e}`} 位，再按位权换成十进制。`,
    ref: '教材 p29 例2.5',
    focus: ['value', 'decimal'],
    update: (s) => {
      s.value = value;
      s.decimal = decimal;
    },
  });
  rows.push({ cells: ['x', `${value} = ${decimal}`], step: stepValue });
  return builder.finish({ 情况: dec.kind, '指数 e': String(e), 真值: value, 十进制: decimal }, { columns: ['量', '值'], rows });
}

function teachToBits(
  builder: TraceBuilder<IeeeParams, IeeeState>,
  push: Push,
  L: TeachLayout,
  text: string,
): Trace<IeeeParams, IeeeState> {
  const input = parseDecimalInput(text);
  if (input.special !== null) throw new BitsError('range', `${L.name}没有无穷大和 NaN 的写法`);
  const negative = input.negative && input.mag.num !== 0n;
  const enc = encodeTeach(L, negative, input.mag);
  const S = enc.mantCode.charAt(0);
  const stepSign = push({
    title: `x ${enc.zero ? '是 0' : negative ? '是负数' : '是正数'}，数符 S = ${S}`,
    why: `数符和尾数合起来是定点小数尾数的${L.mant}，正数写 0、负数写 1。`,
    ref: '教材 p24',
    focus: ['sign'],
    update: (s) => {
      s.sign = S;
    },
  });
  const range = expRange(L);
  if (enc.zero) {
    const stepZero = push({
      title: `0 写成尾数全 0，阶码取最小的码 ${enc.expBits}`,
      why: `尾数为 0 时数就是 0，阶码是多少都一样；取最小的阶码 ${expText(range.min)}，这样 0 比任何正数的码都小。`,
      ref: '教材 p24',
      focus: ['exponent', 'mantissa', 'kind'],
      update: (s) => {
        s.exponent = enc.expBits;
        s.mantissa = enc.mantCode.slice(1);
        s.kind = '零';
        s.E = enc.expBits;
        s.e = String(range.min);
      },
    });
    const bits = enc.mantCode.charAt(0) + enc.expBits + enc.mantCode.slice(1);
    const hex = hexOf(bits);
    const stepHex = push({
      title: `拼成 S | 阶码 | 尾数：${group(bits)}${hex ? `，即 ${hex}` : ''}`,
      why: '数符、阶码、尾数按顺序排好。',
      ref: '教材 p68 习题3',
      focus: ['hex'],
      update: (s) => {
        s.hex = hex;
        s.value = '0';
        s.decimal = '0';
      },
    });
    return builder.finish(teachResult(S, enc.expBits, enc.mantCode.slice(1), bits, hex), {
      columns: ['量', '值'],
      rows: [
        { cells: ['S', S], step: stepSign },
        { cells: ['阶码', enc.expBits], step: stepZero },
        { cells: ['尾数', enc.mantCode.slice(1)], step: stepZero },
        { cells: ['机器数', group(bits)], step: stepHex },
      ],
    });
  }

  const mag = input.mag;
  const fracNeeded = Math.max(0, L.m - enc.e) + 4;
  const binary = binaryText(mag, fracNeeded);
  const stepBinary = push({
    title: `|x| = ${inputText(mag)} = (${binary})₂`,
    why: '整数部分反复除 2 取余，小数部分反复乘 2 取整。',
    ref: '教材 p29 例2.6',
    focus: ['binary'],
    update: (s) => {
      s.binary = binary;
    },
  });

  // 规格化（舍入前）
  const e0 = teachExponent(L, negative, mag);
  const before = mul(mag, pow2(-e0));
  const beforeText = toBinary(before, L.m + 4).text;
  const normalBefore = `${negative ? MINUS : ''}${beforeText} × 2^${expText(e0)}`;
  const stepNormal = push({
    title: `规格化：x = ${normalBefore}`,
    why:
      L.mant === '原码' || !negative
        ? '尾数写成纯小数，小数点后第一位是 1，尾数的绝对值在 1/2 和 1 之间，这是规格化的写法。'
        : '补码尾数规格化要求符号位和最高数值位不同，负尾数落在 −1 到 −1/2 之间（不含 −1/2）；|x| 恰好是 2 的幂时尾数取 −1。',
    ref: L.mant === '原码' || !negative ? '教材 p28' : '解析 p21 计算30',
    focus: ['normal', 'e'],
    ask: {
      prompt: `把 x 写成规格化的纯小数尾数 × 2^e，e 是多少？`,
      kind: 'number',
      answer: String(e0),
      hint: L.mant === '补码' && negative ? '负尾数用补码时，规格化的尾数在 −1 和 −1/2 之间。' : '尾数的绝对值要在 1/2 和 1 之间。',
    },
    update: (s) => {
      s.normal = normalBefore;
      s.e = String(e0);
    },
  });

  const finalExp = enc.expBits;
  const mantCode = enc.mantCode;
  const units = (negative ? -1 : 1) * enc.q;
  const mantShown = formatBits(mantCode, '小数');
  const finalNormal = `${mantValueText(units, L.m)} × 2^${expText(enc.e)}`;

  // 舍入：0 舍 1 入（p67），对绝对值做
  let stepRound = '';
  if (enc.dropped !== '' || enc.rewritten) {
    const tail = enc.dropped.length > 12 ? `${enc.dropped.slice(0, 12)}…` : enc.dropped;
    const parts = [
      `尾数只能留 ${L.m} 位，第 ${L.m} 位后面还有 ${tail}。按 0 舍 1 入：被舍去的最高位是 ${enc.dropped.charAt(0)}，${enc.roundedUp ? '在最低位加 1' : '直接舍去'}（p67）。`,
    ];
    if (enc.carry) parts.push('加 1 后尾数的绝对值变成 1，右移 1 位、指数加 1。');
    if (enc.rewritten) parts.push('舍入后负尾数正好是 −1/2，补码 1.100…0 的符号位与最高数值位相同，不是规格化数，改写成 −1 × 2^(e−1)。');
    stepRound = push({
      title: `舍入：${normalBefore} ≈ ${finalNormal}`,
      why: parts.join(''),
      ref: enc.rewritten ? '教材 p67；解析 p21 计算30' : '教材 p67',
      focus: ['normal', 'rounded', 'e'],
      update: (s) => {
        s.rounded = enc.dropped;
        s.normal = finalNormal;
        s.e = String(enc.e);
      },
    });
  }

  const expWhy =
    L.exp === '移码'
      ? `${L.k} 位移码的偏移量是 2^${L.k - 1}：[e]移 = 2^${L.k - 1} + e（式 2.9），阶码只能是 ${expText(range.min)} 到 ${expText(range.max)}。`
      : `${L.k} 位补码，最高位是阶符；负数按 2^${L.k} + e 写，阶码只能是 ${expText(range.min)} 到 ${expText(range.max)}。`;
  const stepExp = push({
    title: `阶码 e = ${expText(enc.e)} 写成 ${L.k} 位${L.exp}：${finalExp}`,
    why: expWhy,
    ref: L.exp === '移码' ? '教材 p27 式(2.9)' : '教材 p25 式(2.6)',
    focus: ['exponent', 'E'],
    ask: {
      prompt: `e = ${expText(enc.e)}，${L.k} 位${L.exp}的阶码位串是什么？`,
      kind: 'bits',
      answer: finalExp,
      hint: L.exp === '移码' ? `在 e 上加 2^${L.k - 1}，写成 ${L.k} 位。` : '正数直接写，负数取反加 1，共写满 k 位。',
    },
    update: (s) => {
      s.exponent = finalExp;
      s.E = finalExp;
    },
  });

  const stepMant = push({
    title: `尾数 = ${mantShown}，存 S = ${mantCode.charAt(0)}，尾数 ${mantCode.slice(1)}`,
    why: `尾数 ${mantValueText(units, L.m)} 写成 ${L.m + 1} 位${L.mant}，数符在最前，其余 ${L.m} 位放进尾数域。`,
    ref: '教材 p24–26',
    focus: ['mantissa'],
    update: (s) => {
      s.mantissa = mantCode.slice(1);
    },
  });

  const bits = S + finalExp + mantCode.slice(1);
  const hex = hexOf(bits);
  const stored = mul(rational(BigInt(enc.q), 1n << BigInt(L.m)), pow2(enc.e));
  const value = valueText(negative, stored, `${mantValueText(units, L.m)} × 2^${expText(enc.e)}`);
  const decimal = decimalOf(negative, stored);
  const exact = cmp(stored, mag) === 0;
  const stepHex = push({
    title: `拼成 S | 阶码 | 尾数：${group(bits)}${hex ? `，即 ${hex}` : ''}`,
    why: `数符、阶码、尾数按顺序排好${hex ? '，4 位一组换成十六进制' : ''}。${exact ? '' : `舍入后存下的值是 ${decimal}。`}`,
    ref: '教材 p68 习题3',
    focus: ['hex', 'kind', 'decimal'],
    update: (s) => {
      s.hex = hex;
      s.kind = '规格化数';
      s.value = value;
      s.decimal = decimal;
      s.normal = `${mantValueText(units, L.m)} × 2^${expText(enc.e)}`;
    },
  });
  return builder.finish(teachResult(S, finalExp, mantCode.slice(1), bits, hex), {
    columns: ['量', '值'],
    rows: [
      { cells: ['S', S], step: stepSign },
      { cells: ['|x| 的二进制', binary], step: stepBinary },
      { cells: ['规格化', normalBefore], step: stepNormal },
      ...(stepRound ? [{ cells: ['舍入', finalNormal], step: stepRound }] : []),
      { cells: ['阶码', finalExp], step: stepExp },
      { cells: ['尾数', mantShown], step: stepMant },
      { cells: ['机器数', hex ? `${group(bits)} = ${hex}` : group(bits)], step: stepHex },
    ],
  });
}

function teachResult(S: string, E: string, M: string, bits: string, hex: string): Record<string, string> {
  const result: Record<string, string> = { '符号位 S': S, 阶码: E, 尾数: M, 机器数: group(bits) };
  if (hex) result.十六进制 = hex;
  return result;
}

function teachFromBits(
  builder: TraceBuilder<IeeeParams, IeeeState>,
  push: Push,
  L: TeachLayout,
  bits: string,
): Trace<IeeeParams, IeeeState> {
  const S = bits.charAt(0);
  const E = bits.slice(1, 1 + L.k);
  const M = bits.slice(1 + L.k);
  const hex = hexOf(bits);
  const stepSplit = push({
    title: `分成 S = ${S}，阶码 ${E}，尾数 ${M}`,
    why: `最高 1 位是数符，接着 ${L.k} 位是阶码（含阶符），最后 ${L.m} 位是尾数。`,
    ref: '教材 p68 习题3',
    focus: ['sign', 'exponent', 'mantissa'],
    update: (s) => {
      s.sign = S;
      s.exponent = E;
      s.mantissa = M;
      s.hex = hex;
    },
  });
  const e = decode(L.exp, E);
  const stepE = push({
    title: `阶码 ${E} 是${L.exp}，e = ${expText(e)}`,
    why: L.exp === '移码' ? `移码减去偏移量 2^${L.k - 1} 就是指数（式 2.9）。` : `补码的最高位权是 −2^${L.k - 1}，其余位权为正，逐位相加（式 2.8）。`,
    ref: L.exp === '移码' ? '教材 p27 式(2.9)' : '教材 p26 式(2.8)',
    focus: ['e', 'E'],
    update: (s) => {
      s.e = String(e);
      s.E = E;
    },
  });
  const mantCode = S + M;
  const units = decode(L.mant, mantCode);
  const kind: FloatKind = units === 0 ? '零' : isNormalized(L, mantCode) ? '规格化数' : '不是规格化数';
  const mText = mantValueText(units, L.m);
  const stepMant = push({
    title: `尾数 ${formatBits(mantCode, '小数')} 是${L.mant}，真值 ${mText}：${kind}`,
    why:
      units === 0
        ? '尾数为 0，整个数就是 0。'
        : L.mant === '原码'
          ? `原码尾数规格化要求最高数值位是 1，这里是 ${mantCode.charAt(1)}。`
          : `补码尾数规格化要求符号位与最高数值位不同，这里是 ${mantCode.charAt(0)} 和 ${mantCode.charAt(1)}。`,
    ref: L.mant === '原码' ? '教材 p28' : '解析 p21 计算30',
    focus: ['normal', 'kind'],
    ask: {
      prompt: `尾数 ${formatBits(mantCode, '小数')}（${L.mant}），这个数是不是规格化数？`,
      kind: 'choice',
      options: ['规格化数', '不是规格化数', '零'],
      answer: kind,
      hint: L.mant === '原码' ? '看最高数值位。' : '比较符号位和最高数值位。',
    },
    update: (s) => {
      s.kind = kind;
      s.normal = `${mText} × 2^${expText(e)}`;
    },
  });
  const negative = units < 0;
  const mag = mul(rational(BigInt(Math.abs(units)), 1n << BigInt(L.m)), pow2(e));
  const value = units === 0 ? '0' : valueText(negative, mag, `${mText} × 2^${expText(e)}`);
  const decimal = units === 0 ? '0' : decimalOf(negative, mag);
  const stepValue = push({
    title: `x = ${mText} × 2^${expText(e)} = ${value} = ${decimal}`,
    why: `指数 ${expText(e)} 表示小数点${e >= 0 ? `右移 ${expText(e)}` : `左移 ${-e}`} 位，再按位权换成十进制。`,
    ref: '教材 p24 式(2.4)',
    focus: ['value', 'decimal'],
    update: (s) => {
      s.value = value;
      s.decimal = decimal;
    },
  });
  return builder.finish(
    { 情况: kind, '指数 e': String(e), 真值: value, 十进制: decimal },
    {
      columns: ['量', '值'],
      rows: [
        { cells: ['S', S], step: stepSplit },
        { cells: ['阶码', `${E}，e = ${expText(e)}`], step: stepE },
        { cells: ['尾数', `${formatBits(mantCode, '小数')} = ${mText}`], step: stepMant },
        { cells: ['x', `${value} = ${decimal}`], step: stepValue },
      ],
    },
  );
}

// ---------- 出题 ----------

const TEACH_PRESETS: TeachFormat[] = [
  { k: 4, exp: '移码', m: 7, mant: '原码' },
  { k: 5, exp: '补码', m: 8, mant: '补码' },
  { k: 8, exp: '移码', m: 23, mant: '补码' },
  { k: 4, exp: '补码', m: 6, mant: '原码' },
];

/** 出题：同一个种子同一组参数。数取 a × 2^b，多数不用舍入；写不下的组合换一组再来。 */
export function generate(seed: number): IeeeParams {
  const rng = makeRandom(seed);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const params = candidate(rng);
      run(params);
      return params;
    } catch (error) {
      if (attempt > 50) throw error;
    }
  }
}

function candidate(rng: ReturnType<typeof makeRandom>): IeeeParams {
  const roll = rng.next();
  const format: IeeeFormat = roll < 0.55 ? '单精度' : roll < 0.65 ? '双精度' : roll < 0.75 ? '偏移128' : rng.pick(TEACH_PRESETS);
  const direction: Direction = rng.chance(0.5) ? '十进制→机器数' : '机器数→十进制';
  const L = layoutOf(format);
  const sigBits = L.teach ? Math.min(L.m, 6) : rng.int(2, 9);
  let sig = rng.int(1, 2 ** sigBits - 1);
  if (sig % 2 === 0) sig += 1;
  const shift = L.teach ? rng.int(-sigBits - 3, 2) : rng.int(-sigBits - 6, 6);
  const negative = rng.chance(0.45);
  const value = mul(rational(BigInt(negative ? -sig : sig)), pow2(shift));
  if (direction === '十进制→机器数') {
    if (!L.teach && rng.chance(0.25)) {
      const den = 2 ** Math.max(0, -shift);
      if (den > 1 && den <= 1024) return { format, direction, text: `${negative ? '-' : ''}${sig * 2 ** Math.max(0, shift)}/${den}` };
    }
    return { format, direction, text: toDecimal(value).replace(MINUS, '-') };
  }
  // 机器数→十进制：先按格式写出机器码，单精度偶尔给特殊值。
  if (format === '单精度' && rng.chance(0.15)) {
    return { format, direction, text: rng.pick(['00000000H', '80000000H', '7F800000H', 'FF800000H', '7FC00000H', '00000001H', '80400000H']) };
  }
  const trace = run({ format, direction: '十进制→机器数', text: toDecimal(value) });
  const bits = trace.result.机器数?.replace(/\s/g, '') ?? '';
  const hex = hexOf(bits);
  return { format, direction, text: hex || bits };
}

export { totalBits, layoutOf };
