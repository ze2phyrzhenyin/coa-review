/**
 * 2-fpadd 的独立检查：只按 specs/2-fpadd.md 和 docs/textbook/ch01-02.md（2.6.1、图 2.17、例 2.30）写，没看引擎实现。
 * 参照把每个数当精确的二进有理数 n·2^k 来算：对阶、相加、规格化都不丢位，只在舍入那一步按规则取位。
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, type FpAddParams, type FpAddState, type SigParams, type TwosParams } from './model';

/** [0, 1) 上的均匀数。fc.double 偏向 0、1 这些边界值，用整数代替。 */
const unit = fc.integer({ min: 0, max: 2 ** 30 - 1 }).map((v) => v / 2 ** 30);

const M = '−';

// ---------- 二进有理数 ----------

interface Dy { n: bigint; k: number } // n · 2^k
const ZERO: Dy = { n: 0n, k: 0 };
const align = (a: Dy, b: Dy): [bigint, bigint, number] => {
  const k = Math.min(a.k, b.k);
  return [a.n << BigInt(a.k - k), b.n << BigInt(b.k - k), k];
};
const add = (a: Dy, b: Dy): Dy => { const [x, y, k] = align(a, b); return { n: x + y, k }; };
const neg = (a: Dy): Dy => ({ n: -a.n, k: a.k });
const sub = (a: Dy, b: Dy): Dy => add(a, neg(b));
const scale = (a: Dy, s: number): Dy => ({ n: a.n, k: a.k + s });
const cmp = (a: Dy, b: Dy): number => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; };
const absDy = (a: Dy): Dy => (a.n < 0n ? neg(a) : a);
const isZero = (a: Dy) => a.n === 0n;
/** floor(a · 2^m) */
function floorUnits(a: Dy, m: number): bigint {
  const k = a.k + m;
  return k >= 0 ? a.n << BigInt(k) : a.n >> BigInt(-k);
}
const bitlen = (v: bigint): number => (v === 0n ? 0 : (v < 0n ? -v : v).toString(2).length);
/** |a| 的指数：|a| = 1.xxx × 2^e */
const log2Floor = (a: Dy): number => bitlen(a.n) - 1 + a.k;

function dyDecimal(d: Dy): string {
  if (d.n === 0n) return '0';
  const negative = d.n < 0n;
  const a = negative ? -d.n : d.n;
  let s: string;
  if (d.k >= 0) s = (a << BigInt(d.k)).toString();
  else {
    const sh = BigInt(-d.k);
    const int = a >> sh;
    const frac = a - (int << sh);
    s = int.toString();
    if (frac !== 0n) s += '.' + (frac * 5n ** sh).toString().padStart(-d.k, '0').replace(/0+$/, '');
  }
  return (negative ? M : '') + s;
}

/** 十进制、分数（分母是 2 的幂）或二进制真值。 */
function parseDec(text: string): Dy {
  const t = text.trim();
  const negative = t.startsWith('-') || t.startsWith(M);
  const body = t.replace(/^[+\-−]/, '');
  let r: Dy;
  if (body.includes('/')) {
    const [a = '0', b = '1'] = body.split('/');
    const den = BigInt(b);
    const k = bitlen(den) - 1;
    if (1n << BigInt(k) !== den) throw new Error('分母不是 2 的幂');
    r = { n: BigInt(a), k: -k };
  } else {
    const [i = '0', f = ''] = body.split('.');
    let n = BigInt(i + f);
    let k = 0;
    let d = 10n ** BigInt(f.length);
    while (d > 1n) {
      if (n % 5n !== 0n) throw new Error('不是二进有理数');
      n /= 5n;
      d /= 10n;
      k -= 1;
    }
    r = { n, k };
  }
  return negative ? neg(r) : r;
}
function parseBin(text: string): Dy {
  const t = text.trim();
  const negative = t.startsWith('-') || t.startsWith(M);
  const body = t.replace(/^[+\-−]/, '');
  const [i = '0', f = ''] = body.split('.');
  const r: Dy = { n: BigInt('0b' + (i + f || '0')), k: -f.length };
  return negative ? neg(r) : r;
}

// ---------- 参照 ----------

type Verdict = '无溢出' | '上溢' | '下溢';
interface Ref {
  early: '' | '零' | '对阶成 0';
  shift: '' | 'x' | 'y' | '不移';
  diff: number;
  dir: '' | '向左规格化' | '向右规格化' | '不用规格化';
  lefts: number;
  rights: number;
  E: number; // 结果的阶（补码格式是阶码真值，有效位格式是 e）
  mant: Dy; // 结果尾数的值
  verdict: Verdict;
  value: Dy;
  exact: Dy; // x ± y 的精确值
  roundedChanged: boolean;
  inexact: boolean; // 舍入时丢了非 0 的位
  toHalf: boolean; // 补码尾数舍入后变成 −1/2（规格没让它再规格化）
}

/** 补码格式（习题 9 / 解析 28 的写法）。 */
function refTwos(p: TwosParams): Ref {
  const { k, m } = p;
  const Emax = 2 ** k - 1;
  const Emin = -(2 ** k);
  const ex = Number(parseBin(p.x.exp).n);
  const ey = Number(parseBin(p.y.exp).n);
  const mx = parseBin(p.x.mant);
  let my = parseBin(p.y.mant);
  if (p.op === '减') my = neg(my);
  const exact = add(scale(mx, ex), scale(my, ey));
  const base = { diff: 0, dir: '' as const, lefts: 0, rights: 0, verdict: '无溢出' as Verdict, exact, roundedChanged: false, inexact: false, toHalf: false };
  if (isZero(mx)) return { ...base, early: '零', shift: '', E: ey, mant: my, value: scale(my, ey) };
  if (isZero(my)) return { ...base, early: '零', shift: '', E: ex, mant: mx, value: scale(mx, ex) };
  const diff = ex - ey;
  const shift = diff < 0 ? 'x' : diff > 0 ? 'y' : '不移';
  const small = diff < 0 ? mx : my;
  const s = Math.abs(diff);
  // 图 2.17：正的尾数右移成 m 位全 0 时直接取另一个数（补码负数右移不会变成 0）
  if (s > 0 && small.n > 0n && floorUnits(scale(small, -s), m) === 0n) {
    const other = diff < 0 ? { E: ey, mant: my } : { E: ex, mant: mx };
    return { ...base, diff, early: '对阶成 0', shift, ...other, value: scale(other.mant, other.E) };
  }
  let E = Math.max(ex, ey);
  let v = add(diff < 0 ? scale(mx, diff) : mx, diff > 0 ? scale(my, -diff) : my);
  if (isZero(v)) return { ...base, diff, early: '', shift, dir: '', E, mant: ZERO, value: ZERO };
  const one: Dy = { n: 1n, k: 0 };
  const half: Dy = { n: 1n, k: -1 };
  let dir: Ref['dir'] = '不用规格化';
  let lefts = 0;
  let rights = 0;
  let verdict: Verdict = '无溢出';
  if (cmp(v, one) >= 0 || cmp(v, neg(one)) < 0) {
    dir = '向右规格化';
    v = scale(v, -1);
    E += 1;
    rights = 1;
    if (E > Emax) verdict = '上溢';
  } else {
    const normalized = (w: Dy) => (w.n > 0n ? cmp(w, half) >= 0 : cmp(w, neg(half)) < 0);
    if (!normalized(v)) dir = '向左规格化';
    while (!normalized(v)) {
      v = scale(v, 1);
      E -= 1;
      lefts += 1;
      if (E < Emin) { verdict = '下溢'; break; }
    }
  }
  const r: Ref = { ...base, diff, early: '', shift, dir, lefts, rights, E, mant: v, verdict, value: scale(v, E) };
  if (verdict !== '无溢出') return r;
  // 舍入：对补码位串做；0 舍 1 入 = floor(v·2^m + 1/2)，截断 = floor(v·2^m)
  const units = p.rounding === '0舍1入' ? floorUnits(add(v, { n: 1n, k: -m - 1 }), m) : floorUnits(v, m);
  let mv: Dy = { n: units, k: -m };
  r.inexact = cmp({ n: floorUnits(v, m), k: -m }, v) !== 0;
  r.roundedChanged = cmp(mv, v) !== 0;
  if (cmp(mv, one) >= 0) {
    mv = scale(mv, -1);
    E += 1;
    r.rights += 1;
    if (E > Emax) r.verdict = '上溢';
  }
  // 规格只写了舍入后上溢要右规；舍入成 −1/2 时 11.100…0 不是规格化的补码尾数（性质 2），这里再左规一次
  r.toHalf = cmp(mv, neg(half)) === 0;
  if (r.toHalf) {
    mv = scale(mv, 1);
    E -= 1;
    r.lefts += 1;
    if (E < Emin) r.verdict = '下溢';
  }
  r.E = E;
  r.mant = mv;
  r.value = scale(mv, E);
  return r;
}

/** 有效位格式（例 2.30 的写法）。 */
function refSig(p: SigParams): Ref {
  const d = p.digits;
  const x = parseDec(p.x);
  let y = parseDec(p.y);
  if (p.op === '减') y = neg(y);
  const exact = add(x, y);
  const base = { diff: 0, dir: '' as const, lefts: 0, rights: 0, verdict: '无溢出' as Verdict, exact, roundedChanged: false, inexact: false, toHalf: false };
  const asE = (v: Dy) => ({ E: log2Floor(v), mant: scale(v, -log2Floor(v)), value: v });
  if (isZero(x)) return { ...base, early: '零', shift: '', ...(isZero(y) ? { E: 0, mant: ZERO, value: ZERO } : asE(y)) };
  if (isZero(y)) return { ...base, early: '零', shift: '', ...asE(x) };
  const ex = log2Floor(x);
  const ey = log2Floor(y);
  const diff = ex - ey;
  const shift = diff < 0 ? 'x' : diff > 0 ? 'y' : '不移';
  if (Math.abs(diff) >= d) return { ...base, diff, early: '对阶成 0', shift, ...asE(diff < 0 ? y : x) };
  const sum = add(x, y);
  if (isZero(sum)) return { ...base, diff, early: '', shift, dir: '', E: Math.max(ex, ey), mant: ZERO, value: ZERO };
  const E0 = Math.max(ex, ey);
  let e = log2Floor(sum);
  const dir = e > E0 ? '向右规格化' : e < E0 ? '向左规格化' : '不用规格化';
  const r: Ref = { ...base, diff, early: '', shift, dir, lefts: Math.max(0, E0 - e), rights: Math.max(0, e - E0), E: e, mant: scale(sum, -e), verdict: '无溢出', value: sum };
  // 例 2.30：先查溢出再舍入
  if (e > 127) { r.verdict = '上溢'; return r; }
  if (e < -126) { r.verdict = '下溢'; return r; }
  const a = absDy(scale(sum, -e)); // [1, 2)
  const f = d - 1;
  const lo = floorUnits(a, f);
  const rem = sub(a, { n: lo, k: -f });
  const halfUlp: Dy = { n: 1n, k: -f - 1 };
  let q = lo;
  if (p.rounding === '0舍1入' && cmp(rem, halfUlp) >= 0) q += 1n;
  if (p.rounding === '就近舍入' && (cmp(rem, halfUlp) > 0 || (cmp(rem, halfUlp) === 0 && (lo & 1n) === 1n))) q += 1n;
  r.inexact = !isZero(rem);
  if (q === 1n << BigInt(d)) { q >>= 1n; e += 1; r.rights += 1; }
  let mv: Dy = { n: q, k: -f };
  if (sum.n < 0n) mv = neg(mv);
  r.roundedChanged = cmp(mv, scale(sum, -r.E)) !== 0 || e !== r.E;
  r.E = e;
  r.mant = mv;
  r.value = scale(mv, e);
  // 规格没写：舍入进位后 e 变成 128 怎么办。按上溢算（表示不了）
  if (e > 127) r.verdict = '上溢';
  return r;
}

const reference = (p: FpAddParams): Ref => (p.style === '补码' ? refTwos(p) : refSig(p));

// ---------- 结果的写法 ----------

const bits = (v: bigint, w: number) => (((v % (1n << BigInt(w))) + (1n << BigInt(w))) % (1n << BigInt(w))).toString(2).padStart(w, '0');
const mantCode = (v: Dy, m: number) => { const b = bits(floorUnits(v, m), m + 2); return `${b.slice(0, 2)}.${b.slice(2)}`; };
const expCode = (e: number, k: number) => bits(BigInt(e), k + 2);
function sigMant(v: Dy, d: number): string {
  const a = absDy(v);
  const q = floorUnits(a, d - 1);
  const s = q.toString(2).padStart(d, '0');
  return (v.n < 0n ? M : '') + s[0] + '.' + s.slice(1);
}

// ---------- 随机参数 ----------

const sign = (b: boolean, ascii: boolean) => (b ? (ascii ? '-' : M) : '');
const twosArb: fc.Arbitrary<TwosParams> = fc
  .record({
    k: fc.integer({ min: 2, max: 4 }),
    m: fc.integer({ min: 3, max: 12 }),
    op: fc.constantFrom<'加' | '减'>('加', '减'),
    rounding: fc.constantFrom<'0舍1入' | '截断'>('0舍1入', '截断'),
    ex: unit,
    ey: unit,
    near: fc.integer({ min: 0, max: 3 }),
    mx: unit,
    my: unit,
    nx: fc.boolean(),
    ny: fc.boolean(),
    normx: fc.integer({ min: 0, max: 4 }),
    normy: fc.integer({ min: 0, max: 4 }),
    zero: fc.integer({ min: 0, max: 19 }),
    ascii: fc.boolean(),
  })
  .map((r): TwosParams => {
    const span = 2 ** (r.k + 1);
    const ex = Math.min(2 ** r.k - 1, -(2 ** r.k) + Math.floor(r.ex * span));
    // 多数时候两个阶码相近，才有对阶和规格化可看
    const ey = r.near > 0 ? Math.max(-(2 ** r.k), Math.min(2 ** r.k - 1, ex + Math.floor(r.ey * 7) - 3)) : Math.min(2 ** r.k - 1, -(2 ** r.k) + Math.floor(r.ey * span));
    const mant = (u01: number, negative: boolean, normed: number, zero: boolean) => {
      const top = 2 ** r.m;
      // normed>0：规格化的尾数（正数 ≥ 1/2，负数 < −1/2）；否则任意
      let u = normed > 0 ? top / 2 + Math.floor(u01 * (top / 2)) : Math.floor(u01 * top);
      u = Math.min(u, top - 1);
      if (zero) u = 0;
      if (negative && normed > 0 && u === top / 2) u += 1; // −1/2 不是规格化的补码尾数
      return `${sign(negative && u > 0, r.ascii)}0.${u.toString(2).padStart(r.m, '0')}`;
    };
    const expText = (e: number) => `${sign(e < 0, r.ascii)}${Math.abs(e).toString(2).padStart(r.k, '0')}`;
    return {
      style: '补码',
      k: r.k,
      m: r.m,
      op: r.op,
      rounding: r.rounding,
      x: { exp: expText(ex), mant: mant(r.mx, r.nx, r.normx, r.zero === 0) },
      y: { exp: expText(ey), mant: mant(r.my, r.ny, r.normy, r.zero === 1) },
    };
  });

const sigArb: fc.Arbitrary<SigParams> = fc
  .record({
    d: fc.integer({ min: 2, max: 12 }),
    op: fc.constantFrom<'加' | '减'>('加', '减'),
    rounding: fc.constantFrom<'0舍1入' | '截断' | '就近舍入'>('0舍1入', '截断', '就近舍入'),
    sx: unit,
    sy: unit,
    ex: fc.integer({ min: -6, max: 6 }),
    dy: fc.integer({ min: -6, max: 6 }),
    far: fc.integer({ min: 0, max: 9 }),
    nx: fc.boolean(),
    ny: fc.boolean(),
    zero: fc.integer({ min: 0, max: 19 }),
    ascii: fc.boolean(),
  })
  .map((r): SigParams => {
    // far=0：靠近上界，far=1：靠近下界（看溢出）
    const ex = r.far === 0 ? 127 - Math.abs(r.ex % 2) : r.far === 1 ? -126 + Math.abs(r.ex % 2) : r.ex;
    const ey = Math.max(-126, Math.min(127, ex + r.dy));
    const val = (u01: number, e: number, negative: boolean, zero: boolean) => {
      if (zero) return '0';
      const top = 2 ** r.d;
      const s = Math.min(top - 1, top / 2 + Math.floor(u01 * (top / 2)));
      return sign(negative, r.ascii) + dyDecimal({ n: BigInt(s), k: e - (r.d - 1) });
    };
    return { style: '有效位', digits: r.d, op: r.op, rounding: r.rounding, x: val(r.sx, ex, r.nx, r.zero === 0), y: val(r.sy, ey, r.ny, r.zero === 1) };
  });

const anyArb = fc.oneof(twosArb, sigArb);

const final = (t: ReturnType<typeof run>): FpAddState => t.steps[t.steps.length - 1]!.state;
const resultKeys = ['结果', '阶码', '尾数', '溢出', '十进制'];

function expectMatchesRef(p: FpAddParams, ref: Ref): void {
  const t = run(p);
  expect(validateTrace(t)).toEqual([]);
  for (const key of resultKeys) expect(t.result[key], `缺 result.${key}`).toBeDefined();
  expect(t.result['溢出']).toBe(ref.verdict);
  if (ref.verdict === '上溢') return;
  if (ref.verdict === '下溢') {
    expect(t.result['十进制']).toBe('0');
    return;
  }
  expect(t.result['十进制']).toBe(dyDecimal(ref.value));
  if (isZero(ref.value)) return;
  if (p.style === '补码') {
    expect(t.result['阶码']).toBe(expCode(ref.E, p.k));
    expect(t.result['尾数']).toBe(mantCode(ref.mant, p.m));
  } else {
    expect(t.result['阶码']!.replace('-', M)).toBe(dyDecimal({ n: BigInt(ref.E), k: 0 }));
    expect(t.result['尾数']).toBe(sigMant(ref.mant, p.digits));
  }
  const s = final(t);
  if (ref.early === '') {
    expect(s.shift).toBe(ref.shift);
    expect(s.norm).toBe(ref.dir);
  }
}

// ---------- 测试 ----------

describe('2-fpadd 独立检查', () => {
  test('补码格式与参照对拍', () => {
    const ex = (x: [string, string], y: [string, string], op: '加' | '减' = '加'): [TwosParams] => [
      { style: '补码', k: 3, m: 6, op, rounding: '0舍1入', x: { exp: x[0], mant: x[1] }, y: { exp: y[0], mant: y[1] } },
    ];
    const examples = [
      // 尾数的 m 位相加为 0、括号里还有 1：值不是 0，要左规（图 2.17 的「尾数=0?」按值判断）
      ex(['000', `${M}0.111111`], ['001', '0.100000']),
      // 正尾数对阶移成 0：直接取另一数（图 2.17）
      ex(['011', '0.100000'], ['000', '0.000101']),
      // 负尾数对阶不会移成 0，照常相加
      ex(['011', '0.100000'], ['000', `${M}0.000101`]),
      // 左规时阶码下溢
      ex([`${M}111`, '0.100001'], [`${M}111`, `${M}0.100000`]),
      // 右规后上溢
      ex(['111', `${M}0.110000`], ['111', `${M}0.110000`]),
      // 舍入后尾数溢出，再右规
      ex(['000', '0.111110'], [`${M}001`, '0.000011']),
    ];
    fc.assert(fc.property(twosArb, (p) => expectMatchesRef(p, refTwos(p))), { numRuns: 500, examples });
  });

  test('有效位格式与参照对拍', () => {
    fc.assert(fc.property(sigArb, (p) => expectMatchesRef(p, refSig(p))), { numRuns: 500 });
  });

  test('性质 1：不舍入不溢出时等于精确的 x ± y；舍入误差小于末位的权，0 舍 1 入不超过半个', () => {
    fc.assert(
      fc.property(anyArb, (p) => {
        const ref = reference(p);
        if (ref.verdict !== '无溢出') return;
        const t = run(p);
        const got = parseDec(t.result['十进制']!);
        const err = absDy(sub(got, ref.exact));
        const lsb = p.style === '补码' ? p.m : p.digits - 1;
        // 舍入成 −1/2 后又左规一位时，用舍入那一刻的末位权（见报告：性质 1 与要求 6 的冲突）
        const ulp: Dy = { n: 1n, k: ref.E + (ref.toHalf ? 1 : 0) - lsb };
        if (!ref.inexact && ref.early === '') expect(dyDecimal(got)).toBe(dyDecimal(ref.exact));
        expect(cmp(err, ulp), `误差 ${dyDecimal(err)} 不小于末位的权`).toBeLessThan(0);
        // 「0 舍 1 入不超过半个」只对走完舍入的路径成立；对阶成 0 直接取另一数时误差可到将近一个末位（见报告）
        if (p.rounding === '0舍1入' && ref.early === '') expect(cmp(err, scale(ulp, -1))).toBeLessThanOrEqual(0);
      }),
      { numRuns: 400 },
    );
  });

  test('性质 2：结果除 0 外是规格化的；阶码每步只变 1', () => {
    fc.assert(
      fc.property(anyArb, (p) => {
        const ref = reference(p);
        const t = run(p);
        // 先验排除规格自己冲突的一类（见报告）：0 操作数或对阶成 0 时直接取另一数，那个数可能本来就没规格化
        if (ref.verdict === '无溢出' && ref.early === '' && !isZero(ref.value)) {
          const mant = t.result['尾数']!;
          if (p.style === '补码') expect(/^(00\.1|11\.0)/.test(mant), `尾数 ${mant} 没有规格化`).toBe(true);
          else expect(/^−?1\./.test(mant), `尾数 ${mant} 没有规格化`).toBe(true);
        }
        let prev: number | null = null;
        for (const s of t.steps) {
          if (!s.state.sum.exp) continue;
          const e = p.style === '补码' ? Number(parseBin(s.state.sum.exp).n) : Number(s.state.sum.exp.replace(M, '-'));
          if (prev !== null) expect(Math.abs(e - prev)).toBeLessThanOrEqual(1);
          prev = e;
        }
      }),
      { numRuns: 300 },
    );
  });

  test('性质 3：对阶右移的次数等于 |ΔE|，被移的总是阶码小的那个', () => {
    fc.assert(
      fc.property(anyArb, (p) => {
        const ref = reference(p);
        if (ref.early !== '') return;
        const t = run(p);
        expect(final(t).shift).toBe(ref.shift);
        if (ref.shift === '不移') return;
        const key = ref.shift as 'x' | 'y';
        const other = key === 'x' ? 'y' : 'x';
        let shifts = 0;
        for (const s of t.steps) {
          if (s.changes.some((c) => c.at === `${key}.exp` && c.from !== '')) shifts++;
          expect(s.changes.some((c) => c.at === `${other}.exp` && c.from !== ''), '阶码大的数不该动').toBe(false);
        }
        expect(shifts).toBe(Math.abs(ref.diff));
      }),
      { numRuns: 300 },
    );
  });

  test('性质 4：x + y 与 y + x 相同；x − y 与 x + (−y) 相同', () => {
    const negText = (t: string) => (t.startsWith('-') || t.startsWith(M) ? t.slice(1) : M + t);
    fc.assert(
      fc.property(anyArb, (p) => {
        const a = run(p).result;
        // 结果为 0 时只比值：0 操作数检查直接取另一个 0，它的阶码各不相同（规格没定机器零）
        const keys = a['十进制'] === '0' ? ['十进制', '溢出'] : resultKeys;
        if (p.op === '加') {
          const b = run({ ...p, x: p.y, y: p.x } as FpAddParams).result;
          for (const key of keys) expect(b[key], key).toBe(a[key]);
        } else {
          const y = p.style === '补码' ? { ...p.y, mant: negText(p.y.mant) } : negText(p.y);
          if (p.style === '补码' && parseBin(p.y.mant).n === 0n) return;
          if (p.style === '有效位' && p.y === '0') return;
          const b = run({ ...p, op: '加', y } as FpAddParams).result;
          for (const key of keys) expect(b[key], key).toBe(a[key]);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('性质 5：同参数同 Trace', () => {
    fc.assert(fc.property(anyArb, (p) => { expect(JSON.stringify(run(p))).toBe(JSON.stringify(run(p))); }), { numRuns: 100 });
  });

  test('要求 2、7：步骤顺序；补码格式舍入在溢出判断前，有效位格式溢出判断在舍入前', () => {
    fc.assert(
      fc.property(anyArb, (p) => {
        const ref = reference(p);
        const t = run(p);
        const first = (f: (s: FpAddState) => string) => t.steps.findIndex((s) => f(s.state) !== '');
        const iCheck = first((s) => s.check);
        expect(first((s) => s.x.mant)).toBeLessThanOrEqual(iCheck);
        if (ref.early === '零') {
          expect(first((s) => s.diff), '0 操作数检查后没有对阶').toBe(-1);
          return;
        }
        const iDiff = first((s) => s.diff);
        const iSum = first((s) => s.sum.mant);
        expect(iCheck).toBeLessThan(iDiff);
        if (ref.early !== '') return;
        expect(iDiff).toBeLessThan(iSum);
        if (isZero(ref.value)) return;
        const iNorm = first((s) => s.norm);
        expect(iSum).toBeLessThanOrEqual(iNorm);
        const iOver = first((s) => s.overflow);
        if (ref.verdict === '无溢出' && ref.inexact) {
          // 舍入那一步至少要改 sum.out（把括号里的位处理掉）
          const lastMant = t.steps.reduce((acc, s, i) => (s.changes.some((c) => c.at === 'sum.mant' || c.at === 'sum.out') ? i : acc), -1);
          if (p.style === '补码') expect(lastMant, '补码格式先舍入再判溢出').toBeLessThan(iOver);
          else expect(iOver, '有效位格式先判溢出再舍入').toBeLessThan(lastMant);
        }
        for (const s of t.steps) expect(s.level).toBe('explain');
      }),
      { numRuns: 300 },
    );
  });

  test('要求 8：两道预测题，答案取自状态', () => {
    const shiftText: Record<string, string> = { x: 'x 的尾数', y: 'y 的尾数', 不移: '都不移' };
    fc.assert(
      fc.property(anyArb, (p) => {
        const ref = reference(p);
        if (ref.early !== '' || isZero(ref.value)) return;
        const t = run(p);
        const asks = t.steps.filter((s) => s.ask).map((s) => s.ask!);
        expect(asks.length).toBe(2);
        expect(asks[0]!.answer).toBe(shiftText[ref.shift]);
        expect(asks[1]!.answer).toBe(ref.dir);
        for (const a of asks) expect(a.options).toContain(a.answer);
      }),
      { numRuns: 300 },
    );
  });

  test('要求 9：解题表列为 步骤、阶码、尾数、说明，每行指回一步', () => {
    fc.assert(
      fc.property(anyArb, (p) => {
        const t = run(p);
        expect(t.table.columns).toEqual(['步骤', '阶码', '尾数', '说明']);
        for (const r of t.table.rows) expect(r.step, JSON.stringify(r.cells)).toBeTruthy();
      }),
      { numRuns: 100 },
    );
  });

  test('要求 11：generate 纯函数、总能 run；阶差不为 0 的占多数，三种规格化方向都出现', () => {
    let nonzero = 0;
    const dirs = new Set<string>();
    const N = 300;
    for (let seed = 1; seed <= N; seed++) {
      const p = generate(seed);
      expect(generate(seed)).toEqual(p);
      const t = run(p);
      expect(validateTrace(t)).toEqual([]);
      const ref = reference(p);
      if (ref.diff !== 0) nonzero++;
      if (ref.dir) dirs.add(ref.dir);
    }
    expect(nonzero / N).toBeGreaterThan(0.5);
    expect([...dirs].sort()).toEqual(['不用规格化', '向右规格化', '向左规格化'].sort());
  });

  test('要求 12：不合格参数抛错', () => {
    const ok: TwosParams = { style: '补码', k: 3, m: 6, op: '加', x: { exp: '-011', mant: '0.100101' }, y: { exp: '-010', mant: '-0.011110' }, rounding: '0舍1入' };
    expect(() => run(ok)).not.toThrow();
    expect(() => run({ ...ok, k: 1 })).toThrow();
    expect(() => run({ ...ok, k: 5 })).toThrow();
    expect(() => run({ ...ok, m: 2 })).toThrow();
    expect(() => run({ ...ok, m: 13 })).toThrow();
    expect(() => run({ ...ok, x: { exp: '-011', mant: '0.1001011' } })).toThrow();
    expect(() => run({ ...ok, x: { exp: '1000', mant: '0.100101' } })).toThrow();
    const sig: SigParams = { style: '有效位', digits: 4, op: '加', x: '0.5', y: '-0.4375', rounding: '0舍1入' };
    expect(() => run(sig)).not.toThrow();
    expect(() => run({ ...sig, digits: 1 })).toThrow();
    expect(() => run({ ...sig, digits: 13 })).toThrow();
    expect(() => run({ ...sig, x: '0.1' })).toThrow();
    expect(() => run({ ...sig, x: '1.0625' })).toThrow(); // 1.0001 要 5 位有效位
  });
});

describe('2-fpadd 教材例题（手算）', () => {
  test('例 2.30（p65–66）：0.5 + (−0.4375)，4 位有效位 → (1.000)₂ × 2^−4 = 0.0625', () => {
    const t = run({ style: '有效位', digits: 4, op: '加', x: '0.5', y: `${M}0.4375`, rounding: '0舍1入' });
    expect(t.result).toMatchObject({ 溢出: '无溢出', 十进制: '0.0625', 尾数: '1.000' });
    expect(t.result['阶码']!.replace('-', M)).toBe(`${M}4`);
    expect(final(t).shift).toBe('y');
    expect(final(t).norm).toBe('向左规格化');
  });

  test('教材梳理 H 的走查（p65 同型）：0.75 + (−0.3125) → (1.110)₂ × 2^−2 = 0.4375', () => {
    const t = run({ style: '有效位', digits: 4, op: '加', x: '0.75', y: `${M}0.3125`, rounding: '0舍1入' });
    expect(t.result).toMatchObject({ 十进制: '0.4375', 尾数: '1.110' });
    expect(t.result['阶码']!.replace('-', M)).toBe(`${M}2`);
  });

  test('习题 9（p69）的数：x = 2^−011 × 0.100101，y = 2^−010 × (−0.011110)', () => {
    // 减：x 右移 1 位 00.010010(1)，加 [−My]补 00.011110 得 00.110000(1)，0 舍 1 入得 00.110001
    const d = run({ style: '补码', k: 3, m: 6, op: '减', x: { exp: `${M}011`, mant: '0.100101' }, y: { exp: `${M}010`, mant: `${M}0.011110` }, rounding: '0舍1入' });
    expect(d.result).toMatchObject({ 阶码: '11110', 尾数: '00.110001', 溢出: '无溢出', 十进制: '0.19140625' });
    // 加：00.010010(1) + 11.100010 = 11.110100(1)，左规两位 11.010010，阶码 −100
    const a = run({ style: '补码', k: 3, m: 6, op: '加', x: { exp: `${M}011`, mant: '0.100101' }, y: { exp: `${M}010`, mant: `${M}0.011110` }, rounding: '0舍1入' });
    expect(a.result).toMatchObject({ 阶码: '11100', 尾数: '11.010010', 溢出: '无溢出', 十进制: `${M}0.044921875` });
  });

  test('解析计算 28 的数（解析 p20，印的符号有误）：加得 2^−110 × 0.101100，减得 2^−100 × (−0.100001)', () => {
    const x = { exp: `${M}101`, mant: `${M}0.010110` };
    const y = { exp: `${M}100`, mant: '0.010110' };
    const a = run({ style: '补码', k: 3, m: 6, op: '加', x, y, rounding: '0舍1入' });
    expect(a.result).toMatchObject({ 阶码: '11010', 尾数: '00.101100', 十进制: '0.0107421875' });
    const s = run({ style: '补码', k: 3, m: 6, op: '减', x, y, rounding: '0舍1入' });
    expect(s.result).toMatchObject({ 阶码: '11100', 尾数: '11.011111' });
    expect(final(s).norm).toBe('不用规格化');
  });

  test('图 2.17：x 为 0 直接得 y；两个最大正数相加上溢', () => {
    const z = run({ style: '补码', k: 3, m: 6, op: '加', x: { exp: '000', mant: '0.000000' }, y: { exp: '010', mant: '0.110000' }, rounding: '0舍1入' });
    expect(z.result['十进制']).toBe('3');
    expect(z.steps.every((s) => s.state.diff === '')).toBe(true);
    const o = run({ style: '补码', k: 3, m: 6, op: '加', x: { exp: '111', mant: '0.111111' }, y: { exp: '111', mant: '0.111111' }, rounding: '0舍1入' });
    expect(o.result['溢出']).toBe('上溢');
  });
});
