import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace, type Trace } from '../trace';
import { generate, run, type FpAddParams, type FpAddState, type SigParams, type TwosParams } from './model';

// ---- 参照实现：直接用精确值算 x ± y，再按「规格化 → 舍入 → 再规格化 → 查范围」得出结果。
//      不经过对阶、竖式和位串，不调用 model、lib/bits、rational。----

type Verdict = '无溢出' | '上溢' | '下溢';

/** 有理数 n / 2^s，s ≥ 0。 */
interface Dy {
  n: bigint;
  s: number;
}

const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a < 0n && q * b !== a ? q - 1n : q;
};

const bitLen = (v: bigint) => (v === 0n ? 0 : (v < 0n ? -v : v).toString(2).length);

function twosText(e: number, k: number): string {
  return (e < 0 ? '-' : '+') + Math.abs(e).toString(2).padStart(k, '0');
}

function fracText(units: number, m: number): string {
  const a = Math.abs(units);
  return `${units < 0 ? '-' : '+'}${Math.floor(a / 2 ** m)}.${(a % 2 ** m).toString(2).padStart(m, '0')}`;
}

interface RefOut {
  verdict: Verdict;
  /** 结果的指数和尾数（补码格式：尾数以 2^-m 为单位；有效位格式：带符号的有效位整数，以 2^-(digits−1) 为单位）。 */
  e: number;
  q: bigint;
  /** 直接取另一个数（0 操作数或对阶移光）。 */
  passthrough: boolean;
}

function refTwos(k: number, m: number, op: '加' | '减', x: [number, number], y: [number, number], rounding: '0舍1入' | '截断'): RefOut {
  const [ex, mx] = x;
  const [ey, my0] = y;
  const my = op === '减' ? -my0 : my0;
  if (mx === 0) return { verdict: '无溢出', e: ey, q: BigInt(my), passthrough: true };
  if (my === 0) return { verdict: '无溢出', e: ex, q: BigInt(mx), passthrough: true };
  const E = Math.max(ex, ey);
  const dx = E - ex;
  const dy = E - ey;
  // 对阶时正尾数移成全 0：直接取另一个数（图 2.17）
  if (dx > 0 && mx > 0 && mx < 2 ** dx) return { verdict: '无溢出', e: ey, q: BigInt(my), passthrough: true };
  if (dy > 0 && my > 0 && my < 2 ** dy) return { verdict: '无溢出', e: ex, q: BigInt(mx), passthrough: true };
  const s = Math.max(dx, dy);
  // 和 = S / 2^(m+s)，以阶码 E 为准
  const S = (BigInt(mx) << BigInt(s - dx)) + (BigInt(my) << BigInt(s - dy));
  if (S === 0n) return { verdict: '无溢出', e: 0, q: 0n, passthrough: false };
  const scale = m + s;
  // 规格化：正数 1/2 ≤ M < 1，负数 −1 ≤ M < −1/2
  let j: number; // M = S / 2^(scale + j)
  if (S > 0n) j = bitLen(S) - scale;
  else {
    const a = -S;
    j = bitLen(a) - scale - ((a & (a - 1n)) === 0n ? 1 : 0);
  }
  let e = E + j;
  const emax = 2 ** k - 1;
  const emin = -(2 ** k);
  if (e > emax) return { verdict: '上溢', e, q: 0n, passthrough: false };
  if (e < emin) return { verdict: '下溢', e, q: 0n, passthrough: false };
  // 舍入：V = M × 2^m = S / 2^(scale + j − m)
  const shift = scale + j - m;
  let q: bigint;
  if (shift <= 0) q = S << BigInt(-shift);
  else {
    const den = 1n << BigInt(shift);
    q = rounding === '截断' ? floorDiv(S, den) : floorDiv(2n * S + den, 2n * den);
  }
  const full = 1n << BigInt(m);
  if (q === full) {
    q = full >> 1n;
    e += 1;
  } else if (q === -(full >> 1n)) {
    q = -full;
    e -= 1;
  }
  return { verdict: e > emax ? '上溢' : e < emin ? '下溢' : '无溢出', e, q, passthrough: false };
}

function refSig(digits: number, op: '加' | '减', x: [number, number, number], y: [number, number, number], rounding: SigParams['rounding']): RefOut {
  // 操作数：[符号 ±1/0, 有效位整数 sig（digits 位）, 指数 e]，值 = 符号 × sig × 2^(e − digits + 1)
  const [sx, gx, ex] = x;
  const [sy0, gy, ey] = y;
  const sy = op === '减' ? -sy0 : sy0;
  const d = digits - 1;
  if (sx === 0) return { verdict: '无溢出', e: ey, q: BigInt(sy * gy), passthrough: true };
  if (sy === 0) return { verdict: '无溢出', e: ex, q: BigInt(sx * gx), passthrough: true };
  const E = Math.max(ex, ey);
  if (E - ex >= digits) return { verdict: '无溢出', e: ey, q: BigInt(sy * gy), passthrough: true };
  if (E - ey >= digits) return { verdict: '无溢出', e: ex, q: BigInt(sx * gx), passthrough: true };
  const s = Math.max(E - ex, E - ey);
  const S = BigInt(sx * gx) * (1n << BigInt(s - (E - ex))) + BigInt(sy * gy) * (1n << BigInt(s - (E - ey)));
  if (S === 0n) return { verdict: '无溢出', e: 0, q: 0n, passthrough: false };
  const a = S < 0n ? -S : S;
  const scale = d + s; // 值 = S / 2^scale × 2^E
  let e = E + bitLen(a) - 1 - scale;
  if (e > 127) return { verdict: '上溢', e, q: 0n, passthrough: false };
  if (e < -126) return { verdict: '下溢', e, q: 0n, passthrough: false };
  // |值| / 2^e × 2^d = a / 2^(bitLen(a) − 1 − d)
  const shift = bitLen(a) - 1 - d;
  let q: bigint;
  if (shift <= 0) q = a << BigInt(-shift);
  else {
    const den = 1n << BigInt(shift);
    const base = a / den;
    const rest = a - base * den;
    const half = den / 2n;
    const up = rounding === '0舍1入' ? rest >= half : rounding === '就近舍入' ? rest > half || (rest === half && (base & 1n) === 1n) : false;
    q = base + (up ? 1n : 0n);
  }
  if (q === 1n << BigInt(digits)) {
    q >>= 1n;
    e += 1;
  }
  return { verdict: e > 127 ? '上溢' : '无溢出', e, q: S < 0n ? -q : q, passthrough: false };
}

// ---- 读引擎的结果 ----

function lastState(trace: Trace<FpAddParams, FpAddState>): FpAddState {
  return trace.steps[trace.steps.length - 1]!.state;
}

function engineTwos(state: FpAddState, k: number, m: number): { e: number; q: bigint } {
  const code = state.sum.expCode;
  const e = parseInt(code, 2) - (code[0] === '1' ? 2 ** (k + 2) : 0);
  const bits = state.sum.mant.replace('.', '');
  const q = BigInt(`0b${bits}`) - (bits[0] === '1' ? 1n << BigInt(m + 2) : 0n);
  return { e, q };
}

function engineSig(state: FpAddState): { e: number; q: bigint } {
  const e = Number(state.sum.exp.replace('−', '-'));
  const text = state.sum.mant;
  const neg = text.startsWith('−');
  const q = BigInt(`0b${text.replace('−', '').replace('.', '')}`);
  return { e, q: neg ? -q : q };
}

// ---- 固定用例 ----

interface GoldenCase {
  name: string;
  source: string;
  params: FpAddParams;
  expect: {
    diffCode?: string;
    shift?: string;
    aligned?: string;
    sum?: string;
    norm?: string;
    result: string;
    阶码: string;
    尾数?: string;
    overflow: string;
    decimal: string;
  };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/fpadd-cases.json', import.meta.url), 'utf8')) as {
  cases: GoldenCase[];
};

const withOut = (o: { mant: string; out: string }) => (o.out ? `${o.mant}(${o.out})` : o.mant);

describe('evals/golden/fpadd-cases.json', () => {
  for (const item of golden.cases) {
    it(`${item.name}（${item.source}）`, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const want = item.expect;
      expect(trace.result.结果).toBe(want.result);
      expect(trace.result.阶码).toBe(want.阶码);
      if (want.尾数) expect(trace.result.尾数).toBe(want.尾数);
      expect(trace.result.溢出).toBe(want.overflow);
      expect(trace.result.十进制).toBe(want.decimal);
      const asks = trace.steps.filter((s) => s.ask).map((s) => s.ask!);
      if (want.shift) expect(asks[0]!.answer).toBe(want.shift);
      if (want.norm) expect(asks[1]!.answer).toBe(want.norm);
      if (want.diffCode) expect(trace.steps.find((s) => s.state.diffCode)!.state.diffCode).toBe(want.diffCode);
      if (want.aligned) {
        const diffStep = trace.steps.find((s) => s.ask)!;
        const who = diffStep.state.shift as 'x' | 'y';
        const added = trace.steps.find((s) => s.state.stage === '尾数加减')!;
        expect(withOut(added.state[who])).toBe(want.aligned);
      }
      if (want.sum) {
        const added = trace.steps.find((s) => s.state.stage === '尾数加减')!;
        expect(withOut(added.state.sum)).toBe(want.sum);
      }
    });
  }
});

// ---- 与参照对拍（含性质 1：不舍入时结果精确，舍入误差在规定范围内） ----

const twosArb = fc
  .record({ k: fc.integer({ min: 2, max: 4 }), m: fc.integer({ min: 3, max: 8 }) })
  .chain(({ k, m }) =>
    fc.record({
      k: fc.constant(k),
      m: fc.constant(m),
      op: fc.constantFrom<'加' | '减'>('加', '减'),
      x: fc.tuple(fc.integer({ min: -(2 ** k), max: 2 ** k - 1 }), fc.integer({ min: -(2 ** m), max: 2 ** m - 1 })),
      y: fc.tuple(fc.integer({ min: -(2 ** k), max: 2 ** k - 1 }), fc.integer({ min: -(2 ** m), max: 2 ** m - 1 })),
      rounding: fc.constantFrom<'0舍1入' | '截断'>('0舍1入', '截断'),
    }),
  );

const twosParams = (c: { k: number; m: number; op: '加' | '减'; x: [number, number]; y: [number, number]; rounding: '0舍1入' | '截断' }): TwosParams => ({
  style: '补码',
  k: c.k,
  m: c.m,
  op: c.op,
  x: { exp: twosText(c.x[0], c.k), mant: fracText(c.x[1], c.m) },
  y: { exp: twosText(c.y[0], c.k), mant: fracText(c.y[1], c.m) },
  rounding: c.rounding,
});

const sigOperand = (digits: number) =>
  fc.oneof(
    { weight: 1, arbitrary: fc.constant<[number, number, number]>([0, 0, 0]) },
    {
      weight: 12,
      arbitrary: fc.tuple(
        fc.constantFrom(1, -1),
        fc.integer({ min: 2 ** (digits - 1), max: 2 ** digits - 1 }),
        fc.oneof(fc.integer({ min: -8, max: 8 }), fc.integer({ min: -126, max: 127 })),
      ),
    },
  );

const sigArb = fc.integer({ min: 2, max: 8 }).chain((digits) =>
  fc.record({
    digits: fc.constant(digits),
    op: fc.constantFrom<'加' | '减'>('加', '减'),
    x: sigOperand(digits),
    y: sigOperand(digits),
    rounding: fc.constantFrom<SigParams['rounding']>('0舍1入', '截断', '就近舍入'),
  }),
);

function sigDecimal([sign, sig, e]: [number, number, number], digits: number): string {
  if (sign === 0) return '0';
  const shift = e - (digits - 1);
  const a = BigInt(sig);
  let text: string;
  if (shift >= 0) text = (a << BigInt(shift)).toString();
  else {
    const digitsText = (a * 5n ** BigInt(-shift)).toString().padStart(-shift + 1, '0');
    const whole = digitsText.slice(0, digitsText.length + shift);
    const part = digitsText.slice(digitsText.length + shift).replace(/0+$/, '');
    text = part ? `${whole}.${part}` : whole;
  }
  return (sign < 0 ? '-' : '') + text;
}

const sigParams = (c: { digits: number; op: '加' | '减'; x: [number, number, number]; y: [number, number, number]; rounding: SigParams['rounding'] }): SigParams => ({
  style: '有效位',
  digits: c.digits,
  op: c.op,
  x: sigDecimal(c.x, c.digits),
  y: sigDecimal(c.y, c.digits),
  rounding: c.rounding,
});

describe('与参照对拍', () => {
  it('补码格式：任意阶码、任意尾数（含 0、−1、非规格化数）', () => {
    fc.assert(
      fc.property(twosArb, (c) => {
        const trace = run(twosParams(c));
        expect(validateTrace(trace)).toEqual([]);
        const ref = refTwos(c.k, c.m, c.op, c.x, c.y, c.rounding);
        expect(trace.result.溢出).toBe(ref.verdict);
        if (ref.verdict !== '无溢出') return;
        const got = engineTwos(lastState(trace), c.k, c.m);
        expect(got.q).toBe(ref.q);
        if (ref.q !== 0n) expect(got.e).toBe(ref.e);
      }),
      { numRuns: 1500 },
    );
  });

  it('有效位格式：三种舍入、0 操作数、大阶差', () => {
    fc.assert(
      fc.property(sigArb, (c) => {
        const trace = run(sigParams(c));
        expect(validateTrace(trace)).toEqual([]);
        const ref = refSig(c.digits, c.op, c.x, c.y, c.rounding);
        expect(trace.result.溢出).toBe(ref.verdict);
        if (ref.verdict !== '无溢出') return;
        const got = engineSig(lastState(trace));
        expect(got.q).toBe(ref.q);
        if (ref.q !== 0n) expect(got.e).toBe(ref.e);
      }),
      { numRuns: 1500 },
    );
  });
});

// ---- 其余性质 ----

const normalizedTwos = (main: string) => main[0] === main[1] && main[1] !== main[2];

describe('性质', () => {
  it('2. 走完规格化的结果总是规格化的；3. 对阶右移次数等于 |ΔE|，移的是小阶', () => {
    fc.assert(
      fc.property(twosArb, (c) => {
        const trace = run(twosParams(c));
        const final = lastState(trace);
        if (final.stage === '溢出判断' && final.overflow === '无溢出') {
          expect(normalizedTwos(final.sum.mant.replace('.', ''))).toBe(true);
        }
        const diff = trace.steps.find((s) => s.state.diff !== '');
        if (!diff) return;
        const dE = c.x[0] - c.y[0];
        const who = diff.state.shift;
        expect(who).toBe(dE < 0 ? 'x' : dE > 0 ? 'y' : '不移');
        const shifts = trace.steps.filter((s) => s.state.stage === '对阶' && s.changes.some((ch) => ch.at === `${who}.exp`)).length;
        const passthrough = final.stage === '结束';
        if (!passthrough) expect(shifts).toBe(Math.abs(dE));
        else expect(shifts).toBeLessThanOrEqual(Math.abs(dE));
      }),
      { numRuns: 600 },
    );
  });

  it('4. x + y 与 y + x 相同；x − y 与 x + (−y) 相同', () => {
    fc.assert(
      fc.property(twosArb, (c) => {
        const a = run(twosParams({ ...c, op: '加' })).result;
        const b = run(twosParams({ ...c, op: '加', x: c.y, y: c.x })).result;
        expect(a.十进制).toBe(b.十进制);
        expect(a.溢出).toBe(b.溢出);
        fc.pre(c.y[1] !== -(2 ** c.m));
        const minus = run(twosParams({ ...c, op: '减' })).result;
        const plusNeg = run(twosParams({ ...c, op: '加', y: [c.y[0], -c.y[1]] })).result;
        expect(minus).toEqual(plusNeg);
      }),
      { numRuns: 400 },
    );
    fc.assert(
      fc.property(sigArb, (c) => {
        const a = run(sigParams({ ...c, op: '加' })).result;
        const b = run(sigParams({ ...c, op: '加', x: c.y, y: c.x })).result;
        expect(a).toEqual(b);
      }),
      { numRuns: 400 },
    );
  });

  it('5. 同样的参数得到同样的 Trace', () => {
    fc.assert(
      fc.property(twosArb, (c) => {
        const p = twosParams(c);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(run(p)));
      }),
      { numRuns: 100 },
    );
  });
});

// ---- 结构 ----

describe('Trace 的结构', () => {
  const book: SigParams = { style: '有效位', digits: 4, op: '加', x: '0.5', y: '-0.4375', rounding: '0舍1入' };
  const twos: TwosParams = { style: '补码', k: 3, m: 6, op: '减', x: { exp: '-011', mant: '0.100101' }, y: { exp: '-010', mant: '-0.011110' }, rounding: '0舍1入' };

  it('阶段顺序与教材一致，层级都是 explain，每步有 ref', () => {
    const order = (t: Trace<FpAddParams, FpAddState>) => [...new Set(t.steps.map((s) => s.state.stage))];
    expect(order(run(twos))).toEqual(['写出操作数', '0 操作数检查', '对阶', '尾数加减', '规格化', '舍入', '溢出判断']);
    expect(order(run(book))).toEqual(['写出操作数', '0 操作数检查', '对阶', '尾数加减', '规格化', '溢出判断', '舍入', '结束']);
    for (const t of [run(twos), run(book)]) {
      for (const step of t.steps) {
        expect(step.level).toBe('explain');
        expect(step.ref).toBeTruthy();
      }
    }
  });

  it('两道预测题，答案取自状态', () => {
    for (const p of [twos, book]) {
      const asks = run(p).steps.filter((s) => s.ask);
      expect(asks).toHaveLength(2);
      const [shift, norm] = asks;
      const who = shift!.state.shift;
      expect(shift!.ask!.answer).toBe(who === 'x' ? 'x 的尾数' : who === 'y' ? 'y 的尾数' : '都不移');
      expect(norm!.ask!.answer).toBe(norm!.state.norm);
    }
  });

  it('表的列和行', () => {
    const t = run(twos);
    expect(t.table.columns).toEqual(['步骤', '阶码', '尾数', '说明']);
    expect(t.table.rows.map((r) => r.cells[0])).toEqual(['[x]浮', '[y]浮', '[−y]浮', '阶差', '对阶后 [x]浮', '', '+', '=', '舍入后', '结果']);
    expect(t.table.rows.find((r) => r.cells[0] === '=')!.cells[2]).toBe('00.110000(1)');
  });

  it('参数不合格时抛错', () => {
    expect(() => run({ ...twos, k: 5 })).toThrow(/k 必须/);
    expect(() => run({ ...twos, x: { exp: '-1001', mant: '0.1' } })).toThrow(/超出/);
    expect(() => run({ ...book, x: '0.1' })).toThrow(/写不出来/);
    expect(() => run({ ...book, digits: 1 })).toThrow(/有效位数/);
    expect(() => run({ ...book, rounding: '截断', op: '乘' as never })).toThrow(/运算只能/);
  });
});

describe('generate', () => {
  it('200 个种子：同种子同参数，题目可解，两种格式和三种规格化方向都出现', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const params = generate(seed);
      expect(generate(seed)).toEqual(params);
      const trace = run(params);
      expect(validateTrace(trace)).toEqual([]);
      seen.add(params.style);
      const norm = trace.steps.find((s) => s.state.norm !== '');
      if (norm) seen.add(norm.state.norm);
      const diff = trace.steps.find((s) => s.state.diff !== '');
      if (diff && diff.state.diff !== '0') seen.add('有阶差');
    }
    expect(seen).toEqual(new Set(['补码', '有效位', '向左规格化', '向右规格化', '不用规格化', '有阶差']));
  });
});
