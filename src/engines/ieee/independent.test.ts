/**
 * 2-ieee 的独立检查：只按 specs/2-ieee.md 和 docs/textbook/ch01-02.md 写，没看引擎实现。
 * 参照：单精度、双精度用 DataView；偏移128 和教学格式用 BigInt 按式 (2.10)、p67 的 0 舍 1 入直接算。
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, type IeeeParams, type IeeeState, type TeachFormat } from './model';

const M = '−';
const norm = (s: string | undefined) => (s ?? '').replace(/−/g, '-');

// ---------- 精确有理数（只要二进有理数 N·2^K） ----------

interface Dy { n: bigint; k: number } // 值 = n · 2^k
const bitlen = (v: bigint): number => (v === 0n ? 0 : v.toString(2).length);

function dyDecimal(d: Dy, negZero = false): string {
  if (d.n === 0n) return negZero ? `${M}0` : '0';
  const neg = d.n < 0n;
  const a = neg ? -d.n : d.n;
  let s: string;
  if (d.k >= 0) s = (a << BigInt(d.k)).toString();
  else {
    const sh = BigInt(-d.k);
    const int = a >> sh;
    const frac = a - (int << sh);
    s = int.toString();
    if (frac !== 0n) s += '.' + (frac * 5n ** sh).toString().padStart(-d.k, '0').replace(/0+$/, '');
  }
  return (neg ? M : '') + s;
}

/** 把精确的十进制串读成有理数 num/den（den = 10^f）。 */
function parseDec(text: string): { num: bigint; den: bigint } {
  const t = text.trim();
  const neg = t.startsWith('-') || t.startsWith(M);
  const body = t.replace(/^[+\-−]/, '');
  const [i = '0', f = ''] = body.split('.');
  const num = BigInt(i + f);
  return { num: neg ? -num : num, den: 10n ** BigInt(f.length) };
}
const sameRational = (a: { num: bigint; den: bigint }, b: { num: bigint; den: bigint }) => a.num * b.den === b.num * a.den;

/** 一个 double 的精确二进有理数。 */
function dyOfDouble(x: number): Dy {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31;
  const E = (hi >>> 20) & 0x7ff;
  const frac = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  const n = E === 0 ? frac : frac | (1n << 52n);
  const k = E === 0 ? -1074 : E - 1075;
  return { n: sign ? -n : n, k };
}

/** 只用于整数和有限二进小数的十进制串。 */
function parseDy(text: string): Dy {
  const { num, den } = parseDec(text);
  let n = num;
  let k = 0;
  let d = den;
  while (d > 1n) {
    // den = 10^f，num/den 是二进有理数时 num 能被 5^f 整除
    n = n / 5n;
    d = d / 10n;
    k -= 1;
  }
  return { n, k };
}

// ---------- 单精度、双精度：DataView ----------

function hexOfFloat32(x: number): string {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, x);
  return dv.getUint32(0).toString(16).toUpperCase().padStart(8, '0');
}
function hexOfFloat64(x: number): string {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  return (dv.getUint32(0).toString(16) + dv.getUint32(4).toString(16).padStart(8, '0')).toUpperCase().padStart(16, '0');
}

interface Decoded { kind: string; e: string; decimal: string }

/** 隐藏位格式按位串解码（p28 五种情况）。specials=false 时没有特殊值（偏移128）。 */
function decodeHidden(bits: string, expBits: number, bias: number, specials: boolean): Decoded {
  const S = bits[0] === '1';
  const E = parseInt(bits.slice(1, 1 + expBits), 2);
  const F = BigInt('0b' + bits.slice(1 + expBits));
  const mb = bits.length - 1 - expBits;
  const allOnes = 2 ** expBits - 1;
  if (specials && E === allOnes) return F !== 0n ? { kind: 'NaN', e: '无', decimal: 'NaN' } : { kind: '无穷大', e: '无', decimal: S ? `${M}∞` : '+∞' };
  if (specials && E === 0 && F === 0n) return { kind: '零', e: '无', decimal: S ? `${M}0` : '0' };
  if (specials && E === 0) {
    const d: Dy = { n: S ? -F : F, k: 1 - bias - mb };
    return { kind: '非规格化数', e: String(1 - bias), decimal: dyDecimal(d) };
  }
  const sig = F | (1n << BigInt(mb));
  return { kind: '规格化数', e: String(E - bias), decimal: dyDecimal({ n: S ? -sig : sig, k: E - bias - mb }) };
}

/** 就近舍入到 p 位小数的 1.M（正好一半取偶）。返回 e 和 p+1 位的整数有效位。 */
function roundNearest(a: Dy, p: number): { e: number; q: bigint; inexact: boolean } {
  const L = bitlen(a.n);
  let e = L - 1 + a.k;
  const shift = L - (p + 1);
  if (shift <= 0) return { e, q: a.n << BigInt(-shift), inexact: false };
  const sh = BigInt(shift);
  let q = a.n >> sh;
  const rem = a.n - (q << sh);
  const half = 1n << (sh - 1n);
  if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
  if (q === 1n << BigInt(p + 1)) {
    q >>= 1n;
    e += 1;
  }
  return { e, q, inexact: rem !== 0n };
}

/** 偏移128 的编码：就近舍入，超出范围返回 null（应当抛错）。 */
function encode128(v: Dy): string | null {
  const neg = v.n < 0n;
  const r = roundNearest({ n: neg ? -v.n : v.n, k: v.k }, 23);
  const E = r.e + 128;
  if (E < 0 || E > 255) return null;
  const bits = (neg ? '1' : '0') + E.toString(2).padStart(8, '0') + (r.q - (1n << 23n)).toString(2).padStart(23, '0');
  return BigInt('0b' + bits).toString(16).toUpperCase().padStart(8, '0');
}

// ---------- 教学格式 ----------

function expCode(e: number, f: TeachFormat): string {
  const half = 2 ** (f.k - 1);
  const v = f.exp === '移码' ? e + half : (e + 2 ** f.k) % 2 ** f.k;
  return v.toString(2).padStart(f.k, '0');
}

interface TeachCode { S: string; exp: string; mant: string; rounded: boolean; /** 舍入后才变成 −1/2（要改写成 −1 × 2^(e−1)） */ halfEdge: boolean }

/** 教学格式编码：|x| 写成 0.1xxx × 2^e，0 舍 1 入（p67），补码尾数 −1/2 写成 −1 × 2^(e−1)。超出范围返回 null。 */
function encodeTeach(v: Dy, f: TeachFormat): TeachCode | null {
  const half = 2 ** (f.k - 1);
  if (v.n === 0n) return { S: '0', exp: f.exp === '移码' ? '0'.repeat(f.k) : '1' + '0'.repeat(f.k - 1), mant: '0'.repeat(f.m), rounded: false, halfEdge: false };
  const neg = v.n < 0n;
  const a = neg ? -v.n : v.n;
  const L = bitlen(a);
  let e = L + v.k; // |x| = 0.1… × 2^e
  // q = floor(f · 2^m)，f = a / 2^L
  const sh = L - f.m;
  let q: bigint;
  let rounded = false;
  if (sh <= 0) q = a << BigInt(-sh);
  else {
    q = a >> BigInt(sh);
    const rem = a - (q << BigInt(sh));
    rounded = rem !== 0n;
    if (((rem >> BigInt(sh - 1)) & 1n) === 1n) q += 1n; // 丢失的最高位是 1
    if (q === 1n << BigInt(f.m)) {
      q = 1n << BigInt(f.m - 1);
      e += 1;
    }
  }
  let S = '0';
  let halfEdge = false;
  let mant = q.toString(2).padStart(f.m, '0');
  if (neg) {
    S = '1';
    if (f.mant === '补码') {
      if (q === 1n << BigInt(f.m - 1)) {
        mant = '0'.repeat(f.m);
        halfEdge = rounded;
        e -= 1;
      } else mant = ((1n << BigInt(f.m)) - q).toString(2).padStart(f.m, '0');
    }
  }
  if (e < -half || e > half - 1) return null;
  return { S, exp: expCode(e, f), mant, rounded, halfEdge };
}

function decodeTeach(bits: string, f: TeachFormat): { kind: string; e: number; value: Dy } {
  const S = bits[0]!;
  const ecode = parseInt(bits.slice(1, 1 + f.k), 2);
  const e = f.exp === '移码' ? ecode - 2 ** (f.k - 1) : ecode >= 2 ** (f.k - 1) ? ecode - 2 ** f.k : ecode;
  const mbits = bits.slice(1 + f.k);
  const mag = BigInt('0b' + mbits);
  let n: bigint;
  if (f.mant === '原码') n = S === '1' ? -mag : mag;
  else n = S === '1' ? mag - (1n << BigInt(f.m)) : mag;
  const value: Dy = { n, k: e - f.m };
  let kind: string;
  if (n === 0n) kind = '零';
  else if (f.mant === '原码') kind = mbits[0] === '1' ? '规格化数' : '不是规格化数';
  else kind = S !== mbits[0] ? '规格化数' : '不是规格化数';
  return { kind, e, value };
}

// ---------- 共用检查 ----------

const last = (p: IeeeParams): { t: ReturnType<typeof run>; s: IeeeState } => {
  const t = run(p);
  return { t, s: t.steps[t.steps.length - 1]!.state };
};

function checkTrace(t: ReturnType<typeof run>): void {
  expect(validateTrace(t)).toEqual([]);
  for (const s of t.steps) expect(s.ref, `${s.id} 缺 ref`).toBeTruthy();
  for (const s of t.steps) {
    const a = s.ask;
    if (!a) continue;
    if (a.kind === 'choice') expect(s.state.kind).toBe(a.answer);
    if (a.kind === 'number') expect([norm(s.state.e), norm(s.state.E)]).toContain(norm(a.answer));
    if (a.kind === 'bits') expect(s.state.E).toBe(a.answer);
  }
}

/** 字段第一次非空的步号。 */
function firstSet(t: ReturnType<typeof run>, field: keyof IeeeState): number {
  return t.steps.findIndex((s) => s.state[field] !== '');
}

const finiteDouble = fc
  .record({ sig: fc.bigInt({ min: 0n, max: (1n << 53n) - 1n }), e: fc.integer({ min: -170, max: 140 }), neg: fc.boolean(), ascii: fc.boolean(), short: fc.integer({ min: 0, max: 3 }) })
  .map(({ sig, e, neg, ascii, short }) => {
    // short=0 时只留 8 位有效位，多数题不用舍入
    const s = short === 0 ? sig >> 45n : sig;
    const x = Number(s) * 2 ** (e - 52) * (neg ? -1 : 1);
    const text = dyDecimal(dyOfDouble(x), Object.is(x, -0)).replace(M, ascii ? '-' : M);
    return { x, text };
  });

// ---------- 测试 ----------

describe('2-ieee 独立检查：单精度、双精度', () => {
  test('性质 1：十进制→单精度与 DataView 的 Float32 完全相同（含舍入、非规格化、∞）', () => {
    fc.assert(
      fc.property(finiteDouble, ({ x, text }) => {
        const { t, s } = last({ format: '单精度', direction: '十进制→机器数', text });
        checkTrace(t);
        const hex = hexOfFloat32(x);
        expect(s.hex).toBe(hex + 'H');
        expect(t.result['十六进制']).toBe(hex + 'H');
        const bin = BigInt('0x' + hex).toString(2).padStart(32, '0');
        expect(t.result['符号位 S']).toBe(bin[0]);
        expect(t.result['阶码']).toBe(bin.slice(1, 9));
        expect(t.result['尾数']).toBe(bin.slice(9));
        expect(t.result['机器数']).toBe(bin.match(/.{4}/g)!.join(' '));
        const f = Math.fround(x);
        if (Number.isFinite(f) && f !== x) expect(s.rounded, '舍入了却没写被舍去的位').not.toBe('');
        if (f === x) expect(s.rounded.replace(/[0…]/g, '')).toBe('');
      }),
      { numRuns: 400 },
    );
  });

  test('性质 1：十进制→双精度与 DataView 的 Float64 完全相同', () => {
    fc.assert(
      fc.property(finiteDouble, ({ x, text }) => {
        const { t } = last({ format: '双精度', direction: '十进制→机器数', text });
        expect(t.result['十六进制']).toBe(hexOfFloat64(x) + 'H');
      }),
      { numRuns: 200 },
    );
  });

  test('就近舍入正好一半时取偶（p64）：单精度的中点', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1 << 23, max: (1 << 24) - 1 }), fc.integer({ min: -140, max: 100 }), (q, e) => {
        // q·2^e 与 (q+1)·2^e 的中点，在 float32 里正好一半
        const x = (2 * q + 1) * 2 ** (e - 1);
        const text = dyDecimal(dyOfDouble(x));
        const { t } = last({ format: '单精度', direction: '十进制→机器数', text });
        expect(t.result['十六进制']).toBe(hexOfFloat32(x) + 'H');
      }),
      { numRuns: 200 },
    );
  });

  test('性质 1：单精度机器数→十进制与 DataView 读出的值相同；五种情况', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer({ min: 0, max: 6 }), fc.boolean(), (u, pick, withH) => {
        const special = [0x00000000, 0x80000000, 0x7f800000, 0xff800000, 0x7fc00000, 0x00000001, 0x807fffff];
        const word = pick < special.length && u % 5 === 0 ? special[pick]! : u;
        const hex = word.toString(16).toUpperCase().padStart(8, '0');
        const { t, s } = last({ format: '单精度', direction: '机器数→十进制', text: withH ? hex + 'H' : hex });
        checkTrace(t);
        const bits = word.toString(2).padStart(32, '0');
        const ref = decodeHidden(bits, 8, 127, true);
        expect(t.result['情况']).toBe(ref.kind);
        expect(s.kind).toBe(ref.kind);
        expect(norm(t.result['指数 e'])).toBe(ref.e);
        // 正零、正无穷带不带「+」规格没定
        if (ref.kind === '无穷大') expect(t.result['十进制']).toMatch(word >>> 31 ? /^−∞$/ : /^\+?∞$/);
        else if (ref.kind === '零') expect(t.result['十进制']).toMatch(word >>> 31 ? /^−0$/ : /^\+?0$/);
        else expect(t.result['十进制']).toBe(ref.decimal);
        // 与 DataView 对照
        const dv = new DataView(new ArrayBuffer(4));
        dv.setUint32(0, word);
        const f = dv.getFloat32(0);
        if (Number.isFinite(f) && f !== 0) expect(t.result['十进制']).toBe(dyDecimal(dyOfDouble(f)));
      }),
      { numRuns: 400 },
    );
  });

  test('性质 1：双精度机器数→十进制与 DataView 相同', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (w) => {
        const hex = w.toString(16).toUpperCase().padStart(16, '0');
        const { t } = last({ format: '双精度', direction: '机器数→十进制', text: hex });
        const ref = decodeHidden(w.toString(2).padStart(64, '0'), 11, 1023, true);
        expect(t.result['情况']).toBe(ref.kind);
        if (ref.kind === '零') expect(t.result['十进制']).toMatch(w >> 63n ? /^−0$/ : /^\+?0$/);
        else if (ref.kind !== '无穷大') expect(t.result['十进制']).toBe(ref.decimal);
      }),
      { numRuns: 150 },
    );
  });

  test('性质 2：机器数→十进制→机器数回到原码（NaN 除外，−0 保留符号）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (word) => {
        const hex = word.toString(16).toUpperCase().padStart(8, '0');
        const dec = run({ format: '单精度', direction: '机器数→十进制', text: hex });
        if (dec.result['情况'] === 'NaN') return;
        const back = run({ format: '单精度', direction: '十进制→机器数', text: dec.result['十进制']! });
        expect(back.result['十六进制']).toBe(hex + 'H');
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (w) => {
        const hex = w.toString(16).toUpperCase().padStart(16, '0');
        const dec = run({ format: '双精度', direction: '机器数→十进制', text: hex });
        if (dec.result['情况'] === 'NaN') return;
        const back = run({ format: '双精度', direction: '十进制→机器数', text: dec.result['十进制']! });
        expect(back.result['十六进制']).toBe(hex + 'H');
      }),
      { numRuns: 100 },
    );
  });

  test('特殊值：±0、±∞、NaN 的十进制→机器数', () => {
    const hex = (text: string) => run({ format: '单精度', direction: '十进制→机器数', text }).result['十六进制'];
    expect(hex('0')).toBe('00000000H');
    expect(hex(`${M}0`)).toBe('80000000H');
    expect(hex('∞')).toBe('7F800000H');
    expect(hex(`${M}∞`)).toBe('FF800000H');
    const nan = run({ format: '单精度', direction: '十进制→机器数', text: 'NaN' }).result;
    expect(nan['阶码']).toBe('11111111');
    expect(nan['尾数']).not.toBe('0'.repeat(23));
    // 超过最大数得 ∞（p27–28，规格要求 6）
    expect(hex(dyDecimal({ n: 1n, k: 128 }))).toBe('7F800000H');
  });

  test('分数写法：非二进有理数也要按就近舍入写出（规格「参数」列了 27/64 这种写法）', () => {
    expect(run({ format: '单精度', direction: '十进制→机器数', text: '27/64' }).result['十六进制']).toBe('3ED80000H');
    expect(run({ format: '单精度', direction: '十进制→机器数', text: `${M}1/32` }).result['十六进制']).toBe('BD000000H');
    // 1/3 = 0.0101…，单精度就近舍入是 3EAAAAABH
    expect(run({ format: '单精度', direction: '十进制→机器数', text: '1/3' }).result['十六进制']).toBe('3EAAAAABH');
  });
});

describe('2-ieee 独立检查：偏移128', () => {
  test('性质 3：E 在 1–254 时读出的值是单精度读法的一半；全部位串与参照相同', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (word) => {
        const hex = word.toString(16).toUpperCase().padStart(8, '0');
        const bits = word.toString(2).padStart(32, '0');
        const t = run({ format: '偏移128', direction: '机器数→十进制', text: hex });
        checkTrace(t);
        const ref = decodeHidden(bits, 8, 128, false);
        expect(t.result['十进制']).toBe(ref.decimal);
        expect(norm(t.result['指数 e'])).toBe(ref.e);
        expect(t.steps.some((s) => s.ask), '偏移128 不问情况').toBe(false);
        const E = (word >>> 23) & 0xff;
        if (E >= 1 && E <= 254) {
          const single = run({ format: '单精度', direction: '机器数→十进制', text: hex }).result['十进制']!;
          const a = parseDec(t.result['十进制']!);
          const b = parseDec(single);
          expect(sameRational({ num: a.num * 2n, den: a.den }, b)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('十进制→偏移128：就近舍入，超出范围抛错', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: (1n << 30n) - 1n }), fc.integer({ min: -175, max: 120 }), fc.boolean(), (n, k, neg) => {
        const v: Dy = { n: neg ? -n : n, k };
        const want = encode128(v);
        const p: IeeeParams = { format: '偏移128', direction: '十进制→机器数', text: dyDecimal(v) };
        if (want === null) expect(() => run(p)).toThrow();
        else expect(run(p).result['十六进制']).toBe(want + 'H');
      }),
      { numRuns: 300 },
    );
  });
});

describe('2-ieee 独立检查：教学格式', () => {
  const formats: TeachFormat[] = [];
  for (const k of [2, 3])
    for (const m of [2, 3, 4])
      for (const exp of ['移码', '补码'] as const) for (const mant of ['原码', '补码'] as const) formats.push({ k, exp, m, mant });

  test('性质 4：小格式穷举全部位串，读法与参照相同；规格化码写回得到同一个码', () => {
    for (const f of formats) {
      const total = 1 + f.k + f.m;
      for (let w = 0; w < 2 ** total; w++) {
        const bits = w.toString(2).padStart(total, '0');
        const text = `${bits[0]} ${bits.slice(1, 1 + f.k)} ${bits.slice(1 + f.k)}`;
        const ref = decodeTeach(bits, f);
        const t = run({ format: f, direction: '机器数→十进制', text });
        const where = `${JSON.stringify(f)} ${text}`;
        expect(t.result['情况'], where).toBe(ref.kind);
        if (ref.kind === '零') continue;
        expect(t.result['十进制'], where).toBe(dyDecimal(ref.value));
        expect(norm(t.result['指数 e']), where).toBe(String(ref.e));
        if (ref.kind !== '规格化数') continue;
        const back = run({ format: f, direction: '十进制→机器数', text: t.result['十进制']! });
        expect(back.result['符号位 S']! + back.result['阶码']! + back.result['尾数']!, where).toBe(bits);
      }
    }
  });

  test('十进制→教学格式与参照对拍（0 舍 1 入、−1/2 的补码写法、超出范围抛错）', () => {
    const fmt = fc.record({
      k: fc.integer({ min: 2, max: 16 }),
      m: fc.integer({ min: 2, max: 40 }),
      exp: fc.constantFrom<'移码' | '补码'>('移码', '补码'),
      mant: fc.constantFrom<'原码' | '补码'>('原码', '补码'),
    });
    fc.assert(
      fc.property(fmt, fc.bigInt({ min: 0n, max: (1n << 44n) - 1n }), fc.integer({ min: -70, max: 40 }), fc.boolean(), fc.boolean(), (f, n0, k, neg, small) => {
        const n = small ? n0 >> 38n : n0;
        const v: Dy = { n: neg ? -n : n, k };
        const want = encodeTeach(v, f);
        const p: IeeeParams = { format: f, direction: '十进制→机器数', text: dyDecimal(v) };
        if (want === null) {
          expect(() => run(p)).toThrow();
          return;
        }
        if (want.halfEdge) return; // 这一类单独在下一个测试里查
        const t = run(p);
        checkTrace(t);
        const s = t.steps.at(-1)!.state;
        expect(t.result['符号位 S']).toBe(want.S);
        expect(t.result['阶码']).toBe(want.exp);
        expect(t.result['尾数']).toBe(want.mant);
        expect(s.hidden).toBe('');
        if (n !== 0n) expect(s.rounded !== '').toBe(want.rounded);
        const total = 1 + f.k + f.m;
        if (total % 4 === 0) expect(t.result['十六进制']).toBe(BigInt('0b' + want.S + want.exp + want.mant).toString(16).toUpperCase().padStart(total / 4, '0') + 'H');
        else expect(t.result['十六进制']).toBeUndefined();
      }),
      { numRuns: 400 },
    );
  });

  test('补码尾数：负数舍入后正好 −1/2，也要改写成 −1 × 2^(e−1)（规格要求 2 与待确认第 1 条）', () => {
    // k=2、m=2：−2 − 2^-27 的绝对值 0 舍 1 入成 0.10 × 2^2，补码尾数写成 −1 × 2^1，e = 1 在 −2…1 内，不能报上溢
    // −0.53125 = −0.10001，m=3 舍成 −0.100，1.100 不是规格化的补码尾数，应写 1.000 × 2^−1
    const cases: [TeachFormat, string][] = [
      [{ k: 4, exp: '补码', m: 3, mant: '补码' }, `${M}0.53125`],
      [{ k: 4, exp: '补码', m: 3, mant: '补码' }, `${M}0.9375`],
      [{ k: 2, exp: '移码', m: 2, mant: '补码' }, dyDecimal({ n: -((1n << 28n) + 1n), k: -27 })],
      [{ k: 3, exp: '移码', m: 2, mant: '补码' }, `${M}9`],
      [{ k: 4, exp: '补码', m: 3, mant: '补码' }, `${M}129`],
    ];
    for (const [f, text] of cases) {
      const want = encodeTeach(parseDy(text), f)!;
      expect(want.halfEdge).toBe(true);
      const r = run({ format: f, direction: '十进制→机器数', text }).result;
      expect(r['符号位 S']! + r['阶码']! + r['尾数']!, `${JSON.stringify(f)} ${text}`).toBe(want.S + want.exp + want.mant);
    }
  });
});

describe('2-ieee 独立检查：步骤、预测题、Trace', () => {
  const sample = fc.oneof(
    finiteDouble.map(({ text }): IeeeParams => ({ format: '单精度', direction: '十进制→机器数', text })),
    finiteDouble.map(({ text }): IeeeParams => ({ format: '双精度', direction: '十进制→机器数', text })),
    fc.integer({ min: 0, max: 0xffffffff }).map((w): IeeeParams => ({ format: '单精度', direction: '机器数→十进制', text: w.toString(16).padStart(8, '0') })),
  );

  test('性质 5：同参数同 Trace，validateTrace 为空，每步有 ref', () => {
    fc.assert(
      fc.property(sample, (p) => {
        const a = run(p);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(a));
        checkTrace(a);
      }),
      { numRuns: 200 },
    );
  });

  test('要求 2、8：十进制→机器数的步骤顺序，预测题问 e 和 E', () => {
    fc.assert(
      fc.property(finiteDouble, ({ x, text }) => {
        const f = Math.fround(x);
        // 只看规格化结果；舍入前比 2^−126 小、舍入后成了最小规格化数的那一类单独测
        if (f === 0 || !Number.isFinite(f) || Math.abs(f) < 2 ** -126 || Math.abs(x) < 2 ** -126) return;
        const t = run({ format: '单精度', direction: '十进制→机器数', text });
        const order = (['sign', 'binary', 'normal', 'E', 'mantissa', 'hex'] as const).map((k) => firstSet(t, k));
        for (let i = 1; i < order.length; i++) expect(order[i]!, `${text} 的步骤顺序`).toBeGreaterThanOrEqual(order[i - 1]!);
        const asks = t.steps.filter((s) => s.ask);
        expect(asks.map((s) => s.ask!.kind)).toEqual(['number', 'number']);
        expect(norm(asks[0]!.ask!.answer)).toBe(norm(asks[0]!.state.e));
        expect(asks[1]!.ask!.answer).toBe(asks[1]!.state.E);
        expect(t.steps.some((s) => s.why.includes('2^7')), '偏移量 127 = 2^7 − 1 的来历').toBe(true);
        expect(t.steps.some((s) => /不(存|保存|占)|省(去|掉|略)/.test(s.why)), '隐藏位那一步要说明 1 不存').toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  test('要求 8：舍入前比 2^−126 小、舍入后正好是最小规格化数 00800000H，结果是规格化数，也要问 e 和 E', () => {
    const x = 2 ** -126 - 2 ** -152;
    const t = run({ format: '单精度', direction: '十进制→机器数', text: dyDecimal(dyOfDouble(x)) });
    expect(t.result['十六进制']).toBe('00800000H');
    expect(t.steps.at(-1)!.state.kind).toBe('规格化数');
    expect(t.steps.filter((s) => s.ask).map((s) => s.ask!.kind)).toEqual(['number', 'number']);
  });

  test('要求 3：机器数→十进制的步骤顺序：分段→情况→e→1.M→值', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0x00800000, max: 0x7f7fffff }), (w) => {
        const t = run({ format: '单精度', direction: '机器数→十进制', text: w.toString(16).padStart(8, '0') });
        const order = (['exponent', 'kind', 'e', 'normal', 'decimal'] as const).map((k) => firstSet(t, k));
        for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
        expect(t.table.columns).toEqual(['量', '值']);
      }),
      { numRuns: 100 },
    );
  });

  test('要求 12：不合格参数抛错', () => {
    expect(() => run({ format: '单精度', direction: '机器数→十进制', text: '4136000G' })).toThrow();
    expect(() => run({ format: '单精度', direction: '机器数→十进制', text: '413600' })).toThrow();
    expect(() => run({ format: '单精度', direction: '十进制→机器数', text: '1,5' })).toThrow();
    expect(() => run({ format: { k: 1, exp: '移码', m: 7, mant: '原码' }, direction: '十进制→机器数', text: '1' })).toThrow();
    expect(() => run({ format: { k: 17, exp: '移码', m: 7, mant: '原码' }, direction: '十进制→机器数', text: '1' })).toThrow();
    expect(() => run({ format: { k: 4, exp: '移码', m: 1, mant: '原码' }, direction: '十进制→机器数', text: '1' })).toThrow();
    expect(() => run({ format: { k: 4, exp: '移码', m: 41, mant: '原码' }, direction: '十进制→机器数', text: '1' })).toThrow();
    // 教学格式超出范围：k=3 时 e 最大 3，16 = 0.1 × 2^5
    expect(() => run({ format: { k: 3, exp: '补码', m: 4, mant: '原码' }, direction: '十进制→机器数', text: '16' })).toThrow();
  });

  test('要求 11：generate 纯函数，题目总能 run', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const p = generate(seed);
      expect(generate(seed)).toEqual(p);
      expect(validateTrace(run(p))).toEqual([]);
    }
  });
});

describe('2-ieee 教材例题（手算）', () => {
  test('例 2.5（p29）：41360000H → e = 3，1.011011，11.375', () => {
    const t = run({ format: '单精度', direction: '机器数→十进制', text: '41360000H' });
    expect(t.result).toMatchObject({ 情况: '规格化数', 十进制: '11.375' });
    expect(norm(t.result['指数 e'])).toBe('3');
    expect(t.steps.at(-1)!.state.normal.replace(/\s/g, '')).toContain('1.011011');
  });

  test('例 2.6（p29）：20.59375 → 1.010010011 × 2^4，E = 131，41A4C000H', () => {
    const t = run({ format: '单精度', direction: '十进制→机器数', text: '20.59375' });
    const s = t.steps.at(-1)!.state;
    expect(s.E).toBe('131');
    expect(norm(s.e)).toBe('4');
    expect(t.result['十六进制']).toBe('41A4C000H');
  });

  test('例 2.10（p30）：偏移128 的 7FFFFFFFH = (2 − 2^-23) × 2^127', () => {
    const t = run({ format: '偏移128', direction: '机器数→十进制', text: '7FFFFFFFH' });
    expect(norm(t.result['指数 e'])).toBe('127');
    expect(t.result['十进制']).toBe(dyDecimal({ n: (1n << 24n) - 1n, k: 127 - 23 }));
  });

  test('习题 4、12（p68–69）与规格场景：−0.75、27/64、0.1、非规格化最小数、3.25 的教学格式', () => {
    expect(run({ format: '单精度', direction: '十进制→机器数', text: `${M}0.75` }).result['十六进制']).toBe('BF400000H');
    expect(run({ format: '单精度', direction: '十进制→机器数', text: '0.1' }).result['十六进制']).toBe('3DCCCCCDH');
    const den = run({ format: '单精度', direction: '机器数→十进制', text: '00000001H' });
    expect(den.result['情况']).toBe('非规格化数');
    expect(den.result['十进制']).toBe(dyDecimal({ n: 1n, k: -149 }));
    const tf = run({ format: { k: 4, exp: '移码', m: 7, mant: '原码' }, direction: '十进制→机器数', text: '3.25' });
    expect(tf.result).toMatchObject({ 阶码: '1010', 尾数: '1101000' });
  });
});
