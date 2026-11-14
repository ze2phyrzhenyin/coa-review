import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, type CodesParams, type CodesState } from './model';

type CodeName = '原码' | '反码' | '补码' | '移码';
const NAMES: CodeName[] = ['原码', '反码', '补码', '移码'];
type Notation = '整数' | '小数';

// ---- 参照实现：只按定义用普通整数和字符串拼，不调用 lib/bits 和 model ----

function binary(value: number, width: number): string {
  return value.toString(2).padStart(width, '0');
}

function flip(bits: string): string {
  return [...bits].map((b) => (b === '0' ? '1' : '0')).join('');
}

/** units 是以最低位为单位的整数。返回四种码（n+1 位）和负零，没有的码为 null。 */
function reference(units: number, n: number): Record<CodeName, { bits: string; zero?: string } | null> {
  const top = 2 ** n;
  const magnitude = Math.abs(units);
  const signMag = magnitude < top;
  const out: Record<CodeName, { bits: string; zero?: string } | null> = { 原码: null, 反码: null, 补码: null, 移码: null };
  if (signMag) {
    out.原码 = { bits: (units < 0 ? '1' : '0') + binary(magnitude, n) };
    out.反码 = { bits: units < 0 ? `1${flip(binary(magnitude, n))}` : `0${binary(magnitude, n)}` };
    if (units === 0) {
      out.原码.zero = `1${'0'.repeat(n)}`;
      out.反码.zero = '1'.repeat(n + 1);
    }
  }
  out.补码 = { bits: binary(units < 0 ? 2 * top + units : units, n + 1) };
  out.移码 = { bits: binary(top + units, n + 1) };
  return out;
}

function refDecimal(units: number, n: number, notation: Notation): string {
  const sign = units < 0 ? '−' : '';
  if (notation === '整数') return sign + String(Math.abs(units));
  // |units| / 2^n 写成十进制：乘 5^n 再放小数点
  const digits = (BigInt(Math.abs(units)) * 5n ** BigInt(n)).toString().padStart(n + 1, '0');
  const whole = digits.slice(0, digits.length - n);
  const part = digits.slice(digits.length - n).replace(/0+$/, '');
  return sign + (part ? `${whole}.${part}` : whole);
}

function refTrue(units: number, n: number, notation: Notation): string {
  const sign = units > 0 ? '+' : units < 0 ? '−' : '';
  const m = Math.abs(units);
  if (notation === '整数') return sign + binary(m, n);
  return `${sign}${Math.floor(m / 2 ** n)}.${binary(m % 2 ** n, n)}`;
}

function last(params: CodesParams): CodesState {
  const trace = run(params);
  return trace.steps[trace.steps.length - 1]!.state;
}

function bitsOf(state: CodesState, code: CodeName): { bits: string; zero?: string } | null {
  const cell = state.codes[code];
  if (cell.status === '无') return null;
  const strip = (t: string) => t.replace(/[.,]/g, '');
  return cell.zero === '' ? { bits: cell.bits } : { bits: cell.bits, zero: strip(cell.zero) };
}

function inputs(units: number, n: number, notation: Notation): CodesParams['input'][] {
  const list: CodesParams['input'][] = [
    { as: '十进制', text: refDecimal(units, n, notation).replace('−', '-') },
    { as: '真值', text: refTrue(units, n, notation).replace('−', '-') || '0' },
  ];
  const ref = reference(units, n);
  for (const code of NAMES) {
    const c = ref[code];
    if (!c) continue;
    const bits = notation === '小数' ? `${c.bits[0]}.${c.bits.slice(1)}` : c.bits;
    list.push({ as: '机器数', code, bits });
  }
  return list;
}

// ---- 固定用例 ----

interface GoldenCase {
  name: string;
  source: string;
  params: CodesParams;
  expect: { binary: string; decimal: string } & Record<CodeName, { bits: string; zero?: string } | null>;
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/codes-cases.json', import.meta.url), 'utf8')) as {
  cases: GoldenCase[];
};

describe('evals/golden/codes-cases.json', () => {
  it('覆盖整数、小数、三种输入、−2^n 和 0', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(15);
    expect(new Set(golden.cases.map((c) => c.params.notation))).toEqual(new Set(['整数', '小数']));
    expect(new Set(golden.cases.map((c) => c.params.input.as))).toEqual(new Set(['十进制', '真值', '机器数']));
    expect(golden.cases.some((c) => c.expect.原码 === null)).toBe(true);
    expect(golden.cases.some((c) => c.expect.原码?.zero !== undefined)).toBe(true);
  });

  for (const item of golden.cases) {
    it(`${item.name}（${item.source}）`, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const state = trace.steps[trace.steps.length - 1]!.state;
      expect(state.value.binary).toBe(item.expect.binary);
      expect(state.value.decimal).toBe(item.expect.decimal);
      for (const code of NAMES) expect(bitsOf(state, code), code).toEqual(item.expect[code]);
      expect(trace.result.真值).toBe(item.expect.binary);
    });
  }
});

// ---- 与参照穷举对拍 ----

describe('n = 1…6 的全部真值、全部输入方式，与参照一致', () => {
  for (const notation of ['整数', '小数'] as const) {
    it(notation, () => {
      for (let n = 1; n <= 6; n += 1) {
        for (let units = -(2 ** n); units < 2 ** n; units += 1) {
          const ref = reference(units, n);
          for (const input of inputs(units, n, notation)) {
            const trace = run({ n, notation, input });
            const state = trace.steps[trace.steps.length - 1]!.state;
            const where = `${notation} n=${n} x=${units} ${JSON.stringify(input)}`;
            expect(validateTrace(trace), where).toEqual([]);
            for (const code of NAMES) expect(bitsOf(state, code), `${where} ${code}`).toEqual(ref[code]);
            expect(state.value.decimal, where).toBe(refDecimal(units, n, notation));
            expect(state.value.binary, where).toBe(refTrue(units, n, notation));
          }
        }
      }
    });
  }
});

// ---- 性质 ----

const arbitraryCase = fc
  .integer({ min: 1, max: 40 })
  .chain((n) =>
    fc.record({
      n: fc.constant(n),
      units: fc.integer({ min: -(2 ** n), max: 2 ** n - 1 }),
      notation: fc.constantFrom<Notation>('整数', '小数'),
    }),
  );

describe('性质', () => {
  it('1. 四种码各自按定义解码回到同一个真值', () => {
    fc.assert(
      fc.property(arbitraryCase, ({ n, units, notation }) => {
        const state = last({ n, notation, input: { as: '十进制', text: refDecimal(units, n, notation).replace('−', '-') } });
        const read = (code: CodeName, bits: string): number => {
          const v = parseInt(bits, 2);
          const sign = bits[0] === '1';
          const rest = parseInt(bits.slice(1), 2);
          if (code === '原码') return sign ? -rest : rest;
          if (code === '反码') return sign ? -parseInt(flip(bits.slice(1)), 2) : rest;
          if (code === '补码') return sign ? v - 2 ** (n + 1) : v;
          return v - 2 ** n;
        };
        for (const code of NAMES) {
          const c = bitsOf(state, code);
          if (!c) continue;
          expect(read(code, c.bits) + 0).toBe(units);
          if (c.zero) expect(read(code, c.zero) + 0).toBe(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('2、3. 补码与移码只差最高位；正数三码相同；负数补码 = 反码 + 1，反码 = 原码数值位取反', () => {
    fc.assert(
      fc.property(arbitraryCase, ({ n, units, notation }) => {
        const state = last({ n, notation, input: { as: '十进制', text: refDecimal(units, n, notation).replace('−', '-') } });
        const bu = state.codes.补码.bits;
        const yi = state.codes.移码.bits;
        expect(bu.slice(1)).toBe(yi.slice(1));
        expect(bu[0]).not.toBe(yi[0]);
        if (units > 0) {
          expect(state.codes.原码.bits).toBe(bu);
          expect(state.codes.反码.bits).toBe(bu);
        }
        if (units < 0 && units > -(2 ** n)) {
          const yuan = state.codes.原码.bits;
          const fan = state.codes.反码.bits;
          expect(fan).toBe(`1${flip(yuan.slice(1))}`);
          expect(BigInt(`0b${bu}`)).toBe(BigInt(`0b${fan}`) + 1n);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('4. 码的有无与范围一致；同样的参数得到同样的 Trace', () => {
    fc.assert(
      fc.property(arbitraryCase, ({ n, units, notation }) => {
        const params: CodesParams = { n, notation, input: { as: '十进制', text: refDecimal(units, n, notation).replace('−', '-') } };
        const a = run(params);
        expect(JSON.stringify(run(params))).toBe(JSON.stringify(a));
        expect(validateTrace(a)).toEqual([]);
        const state = a.steps[a.steps.length - 1]!.state;
        const isMin = units === -(2 ** n);
        expect(state.codes.原码.status).toBe(isMin ? '无' : '有');
        expect(state.codes.反码.status).toBe(isMin ? '无' : '有');
        expect(state.codes.补码.status).toBe('有');
        expect(state.codes.移码.status).toBe('有');
      }),
      { numRuns: 200 },
    );
  });

  it('5. 输入任一种码的机器数，得到的四种码与输入真值时相同', () => {
    fc.assert(
      fc.property(arbitraryCase, ({ n, units, notation }) => {
        const all = inputs(units, n, notation).map((input) => {
          const s = last({ n, notation, input });
          return JSON.stringify([s.codes, s.value]);
        });
        expect(new Set(all).size).toBe(1);
      }),
      { numRuns: 150 },
    );
  });
});

// ---- 步骤、预测题、表 ----

describe('Trace 的结构', () => {
  const p = (text: string, n = 7, notation: Notation = '整数'): CodesParams => ({ n, notation, input: { as: '十进制', text } });

  it('步骤顺序：读真值、原码、反码、补码、移码、核对；层级都是 explain，每步有 ref', () => {
    const trace = run(p('-35'));
    expect(trace.steps.map((s) => s.changes.map((c) => c.at.split('.').slice(0, 2).join('.'))[0] ?? '')).toEqual([
      'value.binary',
      'codes.原码',
      'codes.反码',
      'codes.补码',
      'codes.移码',
      '',
    ]);
    for (const step of trace.steps) {
      expect(step.level).toBe('explain');
      expect(step.ref).toBeTruthy();
    }
  });

  it('预测题的答案取自状态，最多三道', () => {
    for (const text of ['-35', '-128', '0', '100', '-1']) {
      const trace = run(p(text));
      const asks = trace.steps.filter((s) => s.ask);
      expect(asks.length).toBeGreaterThanOrEqual(1);
      expect(asks.length).toBeLessThanOrEqual(3);
      for (const step of asks) {
        const ask = step.ask!;
        if (ask.kind === 'bits') {
          const code = (['反码', '补码', '移码'] as const).find((c) => step.changes.some((ch) => ch.at.startsWith(`codes.${c}`)))!;
          expect(ask.answer).toBe(step.state.codes[code].bits);
        }
      }
    }
    const min = run(p('-128')).steps.find((s) => s.ask)!;
    expect(min.ask!.answer).toBe('不能');
    expect(min.state.codes.原码.status).toBe('无');
    const zero = run(p('0')).steps.find((s) => s.ask)!;
    expect(zero.ask!.answer).toBe('一种');
    expect(zero.state.codes.补码.zero).toBe('');
  });

  it('表一行一个量，0 的两种写法写在同一格，写不下写「无」', () => {
    const t = run(p('0'));
    expect(t.table.columns).toEqual(['量', '机器数', '怎么得到']);
    expect(t.table.rows.map((r) => r.cells[0])).toEqual(['真值 x', '[x]原', '[x]反', '[x]补', '[x]移']);
    expect(t.table.rows[1]!.cells[1]).toBe('00000000 或 10000000');
    expect(t.result['[x]补']).toBe('00000000');
    const m = run(p('-128'));
    expect(m.result['[x]原']).toBe('无');
    expect(m.result['[x]移']).toBe('0,0000000');
    expect(m.table.rows[3]!.cells[2]).toBe('按定义');
  });

  it('定点小数带小数点，补码那步写 2^-n', () => {
    const t = run(p('-0.4375', 4, '小数'));
    expect(t.result['[x]补']).toBe('1.1001');
    expect(t.steps[3]!.why).toContain('2^-4');
  });
});

describe('参数不合格时抛错', () => {
  const bad = (params: CodesParams) => () => run(params);
  it('超出范围、位数不对、写法不对', () => {
    expect(bad({ n: 7, notation: '整数', input: { as: '十进制', text: '200' } })).toThrow(/−10000000 到 \+1111111/);
    expect(bad({ n: 7, notation: '整数', input: { as: '十进制', text: '1.5' } })).toThrow(/不带小数/);
    expect(bad({ n: 3, notation: '小数', input: { as: '十进制', text: '0.1' } })).toThrow(/写不下/);
    expect(bad({ n: 4, notation: '整数', input: { as: '机器数', code: '补码', bits: '1010' } })).toThrow(/应为 5 位/);
    expect(bad({ n: 0, notation: '整数', input: { as: '十进制', text: '0' } })).toThrow(/n 必须/);
    expect(bad({ n: 4, notation: '整数', input: { as: '十进制', text: 'abc' } })).toThrow(/不是十进制数/);
  });
});

describe('generate', () => {
  it('200 个种子：同种子同参数，题目都能解，边界值都出现', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed += 1) {
      const params = generate(seed);
      expect(generate(seed)).toEqual(params);
      const trace = run(params);
      expect(validateTrace(trace)).toEqual([]);
      const s = trace.steps[trace.steps.length - 1]!.state;
      if (s.codes.原码.status === '无') seen.add('min');
      if (s.codes.原码.zero) seen.add('zero');
      seen.add(params.input.as);
    }
    expect(seen).toEqual(new Set(['min', 'zero', '十进制', '真值', '机器数']));
  });
});
