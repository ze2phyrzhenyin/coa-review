import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, type IeeeParams, type IeeeState, type TeachFormat } from './model';

// ---- 参照：单精度、双精度用 DataView，教学格式用普通 number 按定义算。不调用 model 和 rational ----

function f32Bits(value: number): string {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getUint32(0).toString(2).padStart(32, '0');
}

function f32Value(bits: string): number {
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, parseInt(bits, 2));
  return view.getFloat32(0);
}

function f64Value(bits: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setUint32(0, parseInt(bits.slice(0, 32), 2));
  view.setUint32(4, parseInt(bits.slice(32), 2));
  return view.getFloat64(0);
}

function f64Bits(value: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getUint32(0).toString(2).padStart(32, '0') + view.getUint32(4).toString(2).padStart(32, '0');
}

/** sig × 2^shift 的精确十进制写法（参照自己写，不用 rational.ts）。 */
function exactDecimal(sig: bigint, shift: number): string {
  const negative = sig < 0n;
  const a = negative ? -sig : sig;
  let text: string;
  if (shift >= 0) text = (a << BigInt(shift)).toString();
  else {
    const digits = (a * 5n ** BigInt(-shift)).toString().padStart(-shift + 1, '0');
    const whole = digits.slice(0, digits.length + shift);
    const part = digits.slice(digits.length + shift).replace(/0+$/, '');
    text = part ? `${whole}.${part}` : whole;
  }
  return (negative ? '-' : '') + text;
}

function engineNumber(decimal: string): number {
  if (decimal.endsWith('∞')) return decimal.startsWith('−') ? -Infinity : Infinity;
  if (decimal === 'NaN') return NaN;
  return Number(decimal.replace('−', '-'));
}

function teachValue(f: TeachFormat, bits: string): number {
  const S = bits[0]!;
  const E = bits.slice(1, 1 + f.k);
  const M = bits.slice(1 + f.k);
  const e = f.exp === '移码' ? parseInt(E, 2) - 2 ** (f.k - 1) : parseInt(E, 2) - (E[0] === '1' ? 2 ** f.k : 0);
  const mant = f.mant === '原码' ? (S === '1' ? -1 : 1) * (parseInt(M, 2) / 2 ** f.m) : parseInt(S + M, 2) / 2 ** f.m - (S === '1' ? 2 : 0);
  return mant * 2 ** e;
}

function teachNormalized(f: TeachFormat, bits: string): boolean {
  const S = bits[0]!;
  const M = bits.slice(1 + f.k);
  return f.mant === '原码' ? M[0] === '1' : S !== M[0];
}

const final = (params: IeeeParams): { state: IeeeState; result: Record<string, string> } => {
  const trace = run(params);
  expect(validateTrace(trace)).toEqual([]);
  return { state: trace.steps[trace.steps.length - 1]!.state, result: trace.result };
};

// ---- 固定用例 ----

interface GoldenCase {
  name: string;
  source: string;
  params: IeeeParams;
  expect: { kind?: string; e?: string; E?: string; decimal?: string; value?: string; hex?: string; bits?: string; roundedNonEmpty?: boolean };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/ieee-cases.json', import.meta.url), 'utf8')) as {
  cases: GoldenCase[];
};

describe('evals/golden/ieee-cases.json', () => {
  for (const item of golden.cases) {
    it(`${item.name}（${item.source}）`, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const want = item.expect;
      const state = trace.steps[trace.steps.length - 1]!.state;
      if (item.params.direction === '机器数→十进制') {
        expect(trace.result.情况).toBe(want.kind);
        expect(trace.result['指数 e']).toBe(want.e);
        expect(trace.result.十进制).toBe(want.decimal);
        if (want.value) expect(trace.result.真值).toBe(want.value);
      } else {
        if (want.hex) expect(trace.result.十六进制).toBe(want.hex);
        if (want.bits) expect(trace.result.机器数!.replace(/\s/g, '')).toBe(want.bits);
        if (want.e) expect(state.e).toBe(want.e);
        if (want.E) expect(state.E).toBe(want.E);
        if (want.roundedNonEmpty) expect(state.rounded).not.toBe('');
      }
    });
  }
});

// ---- 单精度、双精度与 DataView 对拍 ----

const dyadic = fc.record({
  sig: fc.bigInt({ min: -(2n ** 40n), max: 2n ** 40n }).filter((v) => v !== 0n),
  shift: fc.integer({ min: -190, max: 100 }),
});

describe('单精度、双精度与 DataView 对拍', () => {
  it('十进制→单精度：含舍入、非规格化数、上溢成 ∞', () => {
    fc.assert(
      fc.property(dyadic, ({ sig, shift }) => {
        const value = Number(sig) * 2 ** shift;
        const { result } = final({ format: '单精度', direction: '十进制→机器数', text: exactDecimal(sig, shift) });
        expect(result.机器数!.replace(/\s/g, '')).toBe(f32Bits(value));
      }),
      { numRuns: 400 },
    );
  });

  it('十进制→单精度：正好一半时舍到偶数', () => {
    // 1 + 2^-24 正好在 1 和 1 + 2^-23 中间，最低位为 0，截掉；1 + 3·2^-24 在中间，最低位为 1，进位。
    for (const [text, value] of [
      [exactDecimal(2n ** 24n + 1n, -24), 1 + 2 ** -24],
      [exactDecimal(2n ** 24n + 3n, -24), 1 + 3 * 2 ** -24],
      [exactDecimal(2n ** 25n - 1n, 104), (2 ** 25 - 1) * 2 ** 104],
    ] as const) {
      const { result } = final({ format: '单精度', direction: '十进制→机器数', text });
      expect(result.机器数!.replace(/\s/g, '')).toBe(f32Bits(value));
    }
  });

  it('十进制→双精度', () => {
    fc.assert(
      fc.property(dyadic, fc.double({ noNaN: true, noDefaultInfinity: true }), ({ sig, shift }, raw) => {
        const value = Number(sig) * 2 ** shift;
        const { result } = final({ format: '双精度', direction: '十进制→机器数', text: exactDecimal(sig, shift) });
        expect(result.机器数!.replace(/\s/g, '')).toBe(f64Bits(value));
        // 任意 double 的最短十进制写法，JavaScript 读回同一个 double
        if (raw !== 0 && !String(raw).includes('e')) {
          const r = final({ format: '双精度', direction: '十进制→机器数', text: String(raw) }).result;
          expect(r.机器数!.replace(/\s/g, '')).toBe(f64Bits(raw));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('任意 32 位位串读回的值与 Float32 相同，再写回得到原码（NaN 除外）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (word) => {
        const bits = word.toString(2).padStart(32, '0');
        const { result } = final({ format: '单精度', direction: '机器数→十进制', text: bits });
        const expected = f32Value(bits);
        if (Number.isNaN(expected)) {
          expect(result.情况).toBe('NaN');
          return;
        }
        expect(Object.is(engineNumber(result.十进制!), expected)).toBe(true);
        const back = final({ format: '单精度', direction: '十进制→机器数', text: result.十进制! });
        expect(back.result.机器数!.replace(/\s/g, '')).toBe(bits);
      }),
      { numRuns: 400 },
    );
  });

  it('任意 64 位位串读回的值与 Float64 相同', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), (word) => {
        const bits = word.toString(2).padStart(64, '0');
        const { result } = final({ format: '双精度', direction: '机器数→十进制', text: bits });
        const expected = f64Value(bits);
        if (Number.isNaN(expected)) expect(result.情况).toBe('NaN');
        else expect(Object.is(engineNumber(result.十进制!), expected)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('偏移 128 的格式读出的值是同一位串按单精度读出的一半（E 在 1–254）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 32 - 1 }), (word) => {
        const bits = word.toString(2).padStart(32, '0');
        const E = parseInt(bits.slice(1, 9), 2);
        fc.pre(E >= 1 && E <= 254);
        const { result } = final({ format: '偏移128', direction: '机器数→十进制', text: bits });
        expect(engineNumber(result.十进制!)).toBe(f32Value(bits) / 2);
        expect(result['指数 e']).toBe(String(E - 128));
      }),
      { numRuns: 200 },
    );
  });
});

// ---- 教学格式穷举 ----

describe('教学格式：小格式穷举全部码', () => {
  const formats: TeachFormat[] = [];
  for (const k of [2, 3]) for (const m of [2, 3, 4]) for (const exp of ['移码', '补码'] as const) for (const mant of ['原码', '补码'] as const) formats.push({ k, exp, m, mant });

  it('读出的值与按定义算的相同；规格化码写回得到同一个码', () => {
    for (const f of formats) {
      const total = 1 + f.k + f.m;
      for (let word = 0; word < 2 ** total; word += 1) {
        const bits = word.toString(2).padStart(total, '0');
        const where = `${JSON.stringify(f)} ${bits}`;
        const { result } = final({ format: f, direction: '机器数→十进制', text: bits });
        const value = teachValue(f, bits);
        expect(engineNumber(result.十进制!), where).toBe(value === 0 ? 0 : value);
        const normalized = value !== 0 && teachNormalized(f, bits);
        expect(result.情况, where).toBe(value === 0 ? '零' : normalized ? '规格化数' : '不是规格化数');
        if (normalized) {
          const back = final({ format: f, direction: '十进制→机器数', text: result.十进制! });
          expect(back.result.机器数!.replace(/\s/g, ''), where).toBe(bits);
        }
      }
    }
  });
});

// ---- 结构、预测题 ----

describe('Trace 的结构', () => {
  it('十进制→单精度：六步，预测题问 e 和 E，答案取自状态', () => {
    const trace = run({ format: '单精度', direction: '十进制→机器数', text: '20.59375' });
    expect(trace.steps).toHaveLength(6);
    const asks = trace.steps.filter((s) => s.ask);
    expect(asks.map((s) => s.ask!.kind)).toEqual(['number', 'number']);
    expect(asks[0]!.ask!.answer).toBe(asks[0]!.state.e);
    expect(asks[1]!.ask!.answer).toBe(asks[1]!.state.E);
    expect(trace.steps[3]!.why).toContain('127');
    expect(trace.steps[4]!.why).toContain('不存');
    for (const step of trace.steps) expect(step.ref).toBeTruthy();
    expect(trace.table.rows.every((r) => r.cells.length === 2)).toBe(true);
  });

  it('偏移 128 的阶码那一步讲 128 的来历', () => {
    const trace = run({ format: '偏移128', direction: '十进制→机器数', text: '3' });
    expect(trace.steps[3]!.why).toContain('128');
    expect(trace.result.十六进制).toBe('40C00000H');
  });

  it('机器数→十进制：分类预测题答案取自状态', () => {
    for (const text of ['41360000H', '00000001H', '7F800000H', '7FC00000H', '00000000H']) {
      const trace = run({ format: '单精度', direction: '机器数→十进制', text });
      const ask = trace.steps.find((s) => s.ask)!;
      expect(ask.ask!.answer).toBe(ask.state.kind);
      expect(ask.ask!.options).toContain(ask.ask!.answer);
    }
  });

  it('同样的参数得到同样的 Trace', () => {
    const p: IeeeParams = { format: { k: 4, exp: '移码', m: 7, mant: '原码' }, direction: '十进制→机器数', text: '0.3' };
    expect(JSON.stringify(run(p))).toBe(JSON.stringify(run(p)));
  });

  it('参数不合格时抛错', () => {
    expect(() => run({ format: '单精度', direction: '机器数→十进制', text: '4136000' })).toThrow(/32 位二进制或 8 位十六进制/);
    expect(() => run({ format: '单精度', direction: '十进制→机器数', text: '1,5' })).toThrow(/不是十进制数/);
    expect(() => run({ format: '偏移128', direction: '十进制→机器数', text: '0' })).toThrow(/没有零/);
    expect(() => run({ format: '偏移128', direction: '十进制→机器数', text: exactDecimal(1n, 128) })).toThrow(/上溢/);
    expect(() => run({ format: { k: 3, exp: '移码', m: 4, mant: '原码' }, direction: '十进制→机器数', text: '100' })).toThrow(/上溢/);
    expect(() => run({ format: { k: 1, exp: '移码', m: 4, mant: '原码' }, direction: '十进制→机器数', text: '1' })).toThrow(/k 必须/);
  });
});

describe('generate', () => {
  it('200 个种子：同种子同参数，题目都能解，两个方向、几种格式都出现', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const params = generate(seed);
      expect(generate(seed)).toEqual(params);
      const trace = run(params);
      expect(validateTrace(trace)).toEqual([]);
      seen.add(params.direction);
      seen.add(typeof params.format === 'string' ? params.format : '教学');
    }
    expect(seen).toEqual(new Set(['十进制→机器数', '机器数→十进制', '单精度', '双精度', '偏移128', '教学']));
  });
});
