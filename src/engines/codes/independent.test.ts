/**
 * 2-codes 的独立检查：只按 specs/2-codes.md 和 docs/textbook/ch01-02.md 写，没看引擎实现。
 * 参照实现直接用 BigInt 套式 (2.5)–(2.9) 和 p27 的两步规则，不用 src/lib/bits.ts。
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { BitsError } from '../../lib/bits';
import { generate, run, type CodesParams } from './model';

/** [0, 1) 上的均匀数。fc.double 偏向 0、1 这些边界值，用整数代替。 */
const unit = fc.integer({ min: 0, max: 2 ** 30 - 1 }).map((v) => v / 2 ** 30);

type CodeName = '原码' | '反码' | '补码' | '移码';
const NAMES: CodeName[] = ['原码', '反码', '补码', '移码'];
const M = '−';

// ---------- 朴素参照 ----------

const pow2 = (k: number): bigint => 1n << BigInt(k);
const toBits = (v: bigint, w: number): string => v.toString(2).padStart(w, '0');

/** num / 2^k 的精确十进制。 */
function exactDecimal(num: bigint, k: number): string {
  const neg = num < 0n;
  const a = neg ? -num : num;
  const int = a >> BigInt(k);
  const frac = a - (int << BigInt(k));
  let s = int.toString();
  if (frac !== 0n) {
    const digits = (frac * 5n ** BigInt(k)).toString().padStart(k, '0').replace(/0+$/, '');
    s += '.' + digits;
  }
  return (neg ? M : '') + s;
}

interface RefCode { bits: string; zero: string }
interface Ref {
  units: bigint;
  binary: string;
  decimal: string;
  codes: Record<CodeName, RefCode | null>;
  result: Record<string, string>;
}

/** 按定义写四种码。u 是以最低位为单位的整数（小数时 x = u / 2^n）。 */
function reference(n: number, notation: '整数' | '小数', u: bigint): Ref {
  const W = n + 1;
  const big = pow2(n);
  const abs = u < 0n ? -u : u;
  const codes: Record<CodeName, RefCode | null> = { 原码: null, 反码: null, 补码: null, 移码: null };
  const smOk = abs <= big - 1n;
  if (smOk) {
    // 式 (2.5)：符号位 + |x|
    codes.原码 = { bits: toBits(u < 0n ? big + abs : u, W), zero: u === 0n ? toBits(big, W) : '' };
    // p27：负数数值位逐位取反
    codes.反码 = { bits: toBits(u < 0n ? big + (big - 1n - abs) : u, W), zero: u === 0n ? toBits(pow2(W) - 1n, W) : '' };
  }
  // 式 (2.6)(2.7)：2^(n+1) + x
  codes.补码 = { bits: toBits(u < 0n ? pow2(W) + u : u, W), zero: '' };
  // 式 (2.9)：2^n + x
  codes.移码 = { bits: toBits(big + u, W), zero: '' };

  let binary: string;
  if (notation === '整数') {
    const digits = abs === big ? toBits(abs, n + 1) : toBits(abs, n);
    binary = (u < 0n ? M : u > 0n ? '+' : '') + digits;
  } else {
    const body = abs === big ? '1.' + '0'.repeat(n) : '0.' + toBits(abs, n);
    binary = (u < 0n ? M : u > 0n ? '+' : '') + body;
  }
  const decimal = notation === '整数' ? exactDecimal(u, 0) : exactDecimal(u, n);
  const text = (name: CodeName, bits: string): string => {
    if (notation === '小数') return bits[0] + '.' + bits.slice(1);
    return name === '移码' ? bits[0] + ',' + bits.slice(1) : bits;
  };
  const result: Record<string, string> = { 真值: binary };
  for (const name of NAMES) {
    const c = codes[name];
    const key = name === '原码' ? '[x]原' : name === '反码' ? '[x]反' : name === '补码' ? '[x]补' : '[x]移';
    result[key] = c === null ? '无' : c.zero ? `${text(name, c.bits)} 或 ${text(name, c.zero)}` : text(name, c.bits);
  }
  return { units: u, binary, decimal, codes, result };
}

/** 各码按定义解码（负零解为 0）。 */
function decodeRef(name: CodeName, bits: string): bigint {
  const n = bits.length - 1;
  const v = BigInt('0b' + bits);
  const s = bits[0] === '1';
  const low = BigInt('0b' + (bits.slice(1) || '0'));
  switch (name) {
    case '原码': return s ? -low : low;
    case '反码': return s ? -(pow2(n) - 1n - low) : low;
    case '补码': return s ? v - pow2(n + 1) : v;
    case '移码': return v - pow2(n);
  }
}

/** 解析参数，得到 u。只覆盖规格列出的三种写法。 */
function unitsOf(p: CodesParams): bigint {
  const n = p.n;
  const inp = p.input;
  if (inp.as === '机器数') return decodeRef(inp.code, inp.bits.replace(/[.,\s]/g, ''));
  const t = inp.text.trim();
  const neg = t.startsWith('-') || t.startsWith(M);
  const body = t.replace(/^[+\-−]/, '');
  if (inp.as === '真值') {
    const [i = '0', f = ''] = body.split('.');
    const v = p.notation === '整数' ? BigInt('0b' + i) : BigInt('0b' + (i + f.padEnd(n, '0')));
    return neg ? -v : v;
  }
  const [i = '0', f = ''] = body.split('.');
  const num = BigInt(i + f);
  const den = 10n ** BigInt(f.length);
  const scaled = p.notation === '整数' ? num : num * pow2(n);
  if (scaled % den !== 0n) throw new Error('写不下');
  const v = scaled / den;
  return neg ? -v : v;
}

// ---------- 随机参数 ----------

function textOf(n: number, notation: '整数' | '小数', u: bigint, form: number, code: CodeName, ascii: boolean): CodesParams {
  const r = reference(n, notation, u);
  const minus = ascii ? '-' : M;
  if (form === 0) return { n, notation, input: { as: '十进制', text: r.decimal.replace(M, minus) } };
  if (form === 1) return { n, notation, input: { as: '真值', text: r.binary.replace(M, minus) } };
  const c = r.codes[code] ?? r.codes.补码!;
  const name = r.codes[code] ? code : '补码';
  return { n, notation, input: { as: '机器数', code: name, bits: c.bits } };
}

const caseArb = fc
  .record({
    n: fc.integer({ min: 1, max: 48 }),
    notation: fc.constantFrom<'整数' | '小数'>('整数', '小数'),
    frac: unit,
    edge: fc.integer({ min: 0, max: 9 }),
    form: fc.integer({ min: 0, max: 2 }),
    code: fc.constantFrom<CodeName>(...NAMES),
    ascii: fc.boolean(),
  })
  .map(({ n, notation, frac, edge, form, code, ascii }) => {
    const big = pow2(n);
    const edges = [-big, 0n, big - 1n, -(big - 1n), -1n, 1n];
    const span = 2n * big; // −2^n … 2^n − 1
    let u = edge < edges.length ? edges[edge]! : -big + (BigInt(Math.floor(frac * 2 ** 30)) * span) / pow2(30);
    if (u > big - 1n) u = big - 1n;
    return { n, notation, u, params: textOf(n, notation, u, form, code, ascii) };
  });

// ---------- 测试 ----------

describe('2-codes 独立检查', () => {
  test('与朴素参照对拍：result 和最后的状态', () => {
    fc.assert(
      fc.property(caseArb, ({ n, notation, u, params }) => {
        const ref = reference(n, notation, u);
        const t = run(params);
        expect(validateTrace(t)).toEqual([]);
        const last = t.steps[t.steps.length - 1]!.state;
        expect(last.value.binary).toBe(ref.binary);
        expect(last.value.decimal).toBe(ref.decimal);
        for (const name of NAMES) {
          const c = last.codes[name];
          const r = ref.codes[name];
          if (r === null) {
            expect(c.status).toBe('无');
            expect(c.bits).toBe('');
            expect(c.why.trim().length).toBeGreaterThan(0);
          } else {
            expect(c.status).toBe('有');
            expect(c.bits).toBe(r.bits);
            // zero 的写法规格没定（整数是位串，小数引擎写成 1.0000），去掉点再比
            expect(c.zero.replace(/[.,]/g, '')).toBe(r.zero);
            expect(c.why).toBe('');
          }
        }
        for (const [k, v] of Object.entries(ref.result)) expect(t.result[k]).toBe(v);
        expect(t.result['十进制'] ?? ref.decimal).toBe(ref.decimal);
      }),
      { numRuns: 400 },
    );
  });

  test('性质 1：四种码各自按定义解码回到同一个真值', () => {
    fc.assert(
      fc.property(caseArb, ({ u, params }) => {
        const last = run(params).steps.at(-1)!.state;
        for (const name of NAMES) {
          const c = last.codes[name];
          if (c.status !== '有') continue;
          expect(decodeRef(name, c.bits)).toBe(u);
          if (c.zero) expect(decodeRef(name, c.zero.replace(/[.,]/g, ''))).toBe(0n);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('性质 2、3：补码与移码只差最高位；正数三码相同；负数补 = 反 + 1，反 = 原数值位取反', () => {
    fc.assert(
      fc.property(caseArb, ({ n, u, params }) => {
        const c = run(params).steps.at(-1)!.state.codes;
        const b = c.补码.bits;
        const e = c.移码.bits;
        expect(b.slice(1)).toBe(e.slice(1));
        expect(b[0]).not.toBe(e[0]);
        if (u > 0n) {
          expect(c.原码.bits).toBe(b);
          expect(c.反码.bits).toBe(b);
        }
        if (u < 0n && u !== -pow2(n)) {
          const inv = c.原码.bits.slice(1).replace(/[01]/g, (ch) => (ch === '0' ? '1' : '0'));
          expect(c.反码.bits).toBe('1' + inv);
          expect(BigInt('0b' + b)).toBe(BigInt('0b' + c.反码.bits) + 1n);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('性质 4：码的有无与范围一致；同参数同 Trace', () => {
    fc.assert(
      fc.property(caseArb, ({ n, u, params }) => {
        const t1 = run(params);
        const t2 = run(params);
        expect(JSON.stringify(t1)).toBe(JSON.stringify(t2));
        const c = t1.steps.at(-1)!.state.codes;
        const abs = u < 0n ? -u : u;
        const sm = abs <= pow2(n) - 1n;
        expect(c.原码.status).toBe(sm ? '有' : '无');
        expect(c.反码.status).toBe(sm ? '有' : '无');
        expect(c.补码.status).toBe('有');
        expect(c.移码.status).toBe('有');
      }),
      { numRuns: 200 },
    );
  });

  test('性质 5：输入某种码的机器数，四种码与输入真值时完全相同', () => {
    fc.assert(
      fc.property(caseArb, fc.constantFrom<CodeName>(...NAMES), ({ n, notation, u }, code) => {
        const ref = reference(n, notation, u);
        const fromValue = run({ n, notation, input: { as: '十进制', text: ref.decimal } });
        const r = ref.codes[code];
        if (r === null) return;
        for (const bits of [r.bits, r.zero].filter(Boolean)) {
          const fromCode = run({ n, notation, input: { as: '机器数', code, bits } });
          expect(fromCode.steps.at(-1)!.state.codes).toEqual(fromValue.steps.at(-1)!.state.codes);
          for (const k of ['[x]原', '[x]反', '[x]补', '[x]移']) expect(fromCode.result[k]).toBe(fromValue.result[k]);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('小规模穷举：n = 1…6，两种写法，全部真值', () => {
    for (let n = 1; n <= 6; n++) {
      for (const notation of ['整数', '小数'] as const) {
        for (let v = -(2 ** n); v < 2 ** n; v++) {
          const u = BigInt(v);
          const ref = reference(n, notation, u);
          const t = run({ n, notation, input: { as: '十进制', text: ref.decimal } });
          for (const [k, val] of Object.entries(ref.result)) expect(t.result[k], `${n} ${notation} ${v} ${k}`).toBe(val);
        }
      }
    }
  });

  test('要求 2：步骤顺序 读真值→原→反→补→移→核对，全是 explain', () => {
    fc.assert(
      fc.property(caseArb, ({ params }) => {
        const t = run(params);
        expect(t.steps.length).toBe(6);
        for (const s of t.steps) expect(s.level).toBe('explain');
        const touches = (i: number, prefix: string) => t.steps[i]!.changes.some((c) => c.at.startsWith(prefix));
        expect(touches(0, 'value.')).toBe(true);
        expect(touches(1, 'codes.原码.')).toBe(true);
        expect(touches(2, 'codes.反码.')).toBe(true);
        expect(touches(3, 'codes.补码.')).toBe(true);
        expect(touches(4, 'codes.移码.')).toBe(true);
        // 每种码只在自己那一步写
        NAMES.forEach((name, k) => {
          t.steps.forEach((s, i) => {
            if (i !== k + 1) expect(s.changes.some((c) => c.at.startsWith(`codes.${name}.`)), `${name} 在第 ${i + 1} 步`).toBe(false);
          });
        });
      }),
      { numRuns: 150 },
    );
  });

  test('要求 8：预测题的位置和答案', () => {
    fc.assert(
      fc.property(caseArb, ({ n, u, params }) => {
        const t = run(params);
        const asks = t.steps.map((s, i) => ({ i, s })).filter((x) => x.s.ask);
        expect(asks.length).toBeLessThanOrEqual(3);
        const last = t.steps.at(-1)!.state.codes;
        const at = (i: number) => t.steps[i]!.ask;
        const minN = u === -pow2(n);
        if (u < 0n) {
          // 「负数时在反码、补码前各问一次位串」：反码写得出来时问反码，补码总写得出来
          if (!minN) {
            expect(at(2)?.kind).toBe('bits');
            expect(at(2)?.answer).toBe(last.反码.bits);
          }
          if (!minN) {
            expect(at(3)?.kind).toBe('bits');
            expect(at(3)?.answer).toBe(last.补码.bits);
          }
        }
        if (minN) {
          expect(at(1)?.kind).toBe('choice');
          expect(at(1)?.answer).toBe('不能');
        }
        if (u === 0n) {
          expect(at(3)?.kind).toBe('choice');
          expect(at(3)?.options).toContain(at(3)?.answer);
        }
        if (u > 0n) {
          expect(asks.length).toBe(1);
          expect(at(4)?.kind).toBe('bits');
          expect(at(4)?.answer).toBe(last.移码.bits);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('要求 8：x = −2^n 也是负数，补码那一步也要问位串（规格原文）', () => {
    for (let n = 1; n <= 12; n++) {
      for (const notation of ['整数', '小数'] as const) {
        const ref = reference(n, notation, -pow2(n));
        const t = run({ n, notation, input: { as: '十进制', text: ref.decimal } });
        const ask = t.steps[3]!.ask;
        expect(ask?.kind, `n=${n} ${notation}：负数在补码那一步要问位串`).toBe('bits');
        expect(ask?.answer).toBe(ref.codes.补码!.bits);
      }
    }
  });

  test('要求 9：解题表一行一个量，0 用「或」，写不下写「无」，行指回步', () => {
    fc.assert(
      fc.property(caseArb, ({ n, notation, u, params }) => {
        const ref = reference(n, notation, u);
        const t = run(params);
        expect(t.table.columns.length).toBe(3);
        expect(t.table.rows.length).toBe(5);
        const machine = t.table.rows.map((r) => r.cells[1]);
        expect(machine.slice(1)).toEqual([ref.result['[x]原'], ref.result['[x]反'], ref.result['[x]补'], ref.result['[x]移']]);
        for (const r of t.table.rows) expect(r.step).toBeTruthy();
      }),
      { numRuns: 150 },
    );
  });

  test('要求 7、12：越界和不合格参数抛错', () => {
    expect(() => run({ n: 7, notation: '整数', input: { as: '十进制', text: '200' } })).toThrow(/128[\s\S]*127|127[\s\S]*128/);
    expect(() => run({ n: 7, notation: '整数', input: { as: '十进制', text: '128' } })).toThrow();
    expect(() => run({ n: 7, notation: '整数', input: { as: '十进制', text: '-129' } })).toThrow();
    expect(() => run({ n: 0, notation: '整数', input: { as: '十进制', text: '0' } })).toThrow(BitsError);
    expect(() => run({ n: 49, notation: '整数', input: { as: '十进制', text: '0' } })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '小数', input: { as: '真值', text: '-0.01111' } })).toThrow(BitsError);
    expect(() => run({ n: 7, notation: '整数', input: { as: '机器数', code: '补码', bits: '1010' } })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '小数', input: { as: '十进制', text: '0.1' } })).toThrow(BitsError);
  });

  test('要求 11：generate 纯函数、总能 run、约一成落在特殊值上', () => {
    let special = 0;
    const N = 600;
    for (let seed = 1; seed <= N; seed++) {
      const p = generate(seed);
      expect(generate(seed)).toEqual(p);
      const t = run(p);
      expect(validateTrace(t)).toEqual([]);
      const u = unitsOf(p);
      const big = pow2(p.n);
      if ([-big, 0n, big - 1n, -(big - 1n), -1n].includes(u)) special++;
    }
    expect(special / N).toBeGreaterThan(0.04);
    expect(special / N).toBeLessThan(0.3);
  });
});

describe('2-codes 教材例题（手算）', () => {
  const res = (p: CodesParams) => run(p).result;

  test('例 2.3、2.4（p27）：x = ±1111010，n = 7', () => {
    expect(res({ n: 7, notation: '整数', input: { as: '真值', text: '+1111010' } })).toMatchObject({
      '[x]原': '01111010', '[x]反': '01111010', '[x]补': '01111010',
    });
    expect(res({ n: 7, notation: '整数', input: { as: '真值', text: `${M}1111010` } })).toMatchObject({
      '[x]原': '11111010', '[x]反': '10000101', '[x]补': '10000110', '[x]移': '0,0000110',
    });
  });

  test('例 2.1、2.2（p26）：9 位补码按式 2.8 求真值', () => {
    const a = run({ n: 8, notation: '整数', input: { as: '机器数', code: '补码', bits: '010011011' } });
    expect(a.steps.at(-1)!.state.value.decimal).toBe('155');
    const b = run({ n: 8, notation: '整数', input: { as: '机器数', code: '补码', bits: '110011011' } });
    expect(b.steps.at(-1)!.state.value.decimal).toBe(`${M}101`);
    expect(b.result['[x]原']).toBe('101100101');
  });

  test('例 2.8 表（p29–30）与 p27 移码：−127、0、+127、±10101', () => {
    expect(res({ n: 7, notation: '整数', input: { as: '十进制', text: '-127' } })['[x]移']).toBe('0,0000001');
    expect(res({ n: 7, notation: '整数', input: { as: '十进制', text: '0' } })).toMatchObject({
      '[x]原': '00000000 或 10000000', '[x]反': '00000000 或 11111111', '[x]补': '00000000', '[x]移': '1,0000000',
    });
    expect(res({ n: 7, notation: '整数', input: { as: '十进制', text: '127' } })['[x]移']).toBe('1,1111111');
    expect(res({ n: 5, notation: '整数', input: { as: '真值', text: '+10101' } })['[x]移']).toBe('1,10101');
    expect(res({ n: 5, notation: '整数', input: { as: '真值', text: `${M}10101` } })['[x]移']).toBe('0,01011');
  });

  test('习题 1（p68）−35、−128 与规格场景：小数 −0.0111', () => {
    expect(res({ n: 7, notation: '整数', input: { as: '十进制', text: `${M}35` } })).toMatchObject({
      '[x]原': '10100011', '[x]反': '11011100', '[x]补': '11011101', '[x]移': '0,1011101',
    });
    const t = run({ n: 7, notation: '整数', input: { as: '十进制', text: `${M}128` } });
    expect(t.result).toMatchObject({ '[x]原': '无', '[x]反': '无', '[x]补': '10000000', '[x]移': '0,0000000' });
    expect(t.steps.some((s) => s.ask?.kind === 'choice' && s.ask.answer === '不能')).toBe(true);
    expect(res({ n: 4, notation: '小数', input: { as: '真值', text: `${M}0.0111` } })).toMatchObject({
      '[x]原': '1.0111', '[x]反': '1.1000', '[x]补': '1.1001',
    });
  });
});
