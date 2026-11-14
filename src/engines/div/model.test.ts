import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { BitsError } from '../../lib/bits';
import { generate, run, type DivParams, type DivState } from './model';

// ---------- 独立的朴素参照：只用 BigInt 和规格里的定义，不调用引擎和 lib/bits ----------

interface Reference {
  /** 每轮加减之后的部分余数（真值，单位 2^-n），共 n+1 个。 */
  remainders: bigint[];
  q: string;
  corrected: bigint | null;
  Q: bigint;
  R: bigint;
}

/** 按 p50 的递推：r_0 = |x| − |y|；r ≥ 0 时 r' = 2r − |y|，否则 r' = 2r + |y|；最后为负则加 |y|。 */
function reference(X: bigint, Y: bigint, n: number): Reference {
  const remainders: bigint[] = [];
  let q = '';
  let r = X - Y;
  for (let i = 0; i <= n; i += 1) {
    if (i > 0) r = r >= 0n ? 2n * r - Y : 2n * r + Y;
    remainders.push(r);
    q += r >= 0n ? '1' : '0';
  }
  const corrected = r < 0n ? r + Y : null;
  return { remainders, q, corrected, Q: (X << BigInt(n)) / Y, R: (X << BigInt(n)) - ((X << BigInt(n)) / Y) * Y };
}

/** 0.1011 / 1.0101 这种 n+1 位补码写法 → 真值（单位 2^-n）。 */
function readFraction(text: string): bigint {
  const bits = text.replace('.', '');
  const unsigned = BigInt(`0b${bits}`);
  return bits.startsWith('1') ? unsigned - (1n << BigInt(bits.length)) : unsigned;
}

function paramsOf(n: number, x: number, y: number, xNeg = false, yNeg = false): DivParams {
  const text = (v: number, neg: boolean) => `${neg ? '-' : '+'}0.${v.toString(2).padStart(n, '0')}`;
  return { n, notation: '小数', x: { as: '真值', text: text(x, xNeg) }, y: { as: '真值', text: text(y, yNeg) } };
}

const last = (params: DivParams): DivState => run(params).steps.at(-1)!.state;

const legal = fc
  .record({ n: fc.integer({ min: 2, max: 12 }), a: fc.nat(), b: fc.nat(), xNeg: fc.boolean(), yNeg: fc.boolean() })
  .map(({ n, a, b, xNeg, yNeg }) => {
    const Y = 1 + (b % (2 ** n - 1));
    const X = a % Y;
    return { n, X, Y, xNeg, yNeg };
  });

describe('与参照对拍', () => {
  it('n = 2…5 的全部 0 ≤ X < Y，逐轮余数、商位、纠余、商和余数都相同', () => {
    for (let n = 2; n <= 5; n += 1) {
      for (let Y = 1; Y < 2 ** n; Y += 1) {
        for (let X = 0; X < Y; X += 1) {
          const s = last(paramsOf(n, X, Y));
          const want = reference(BigInt(X), BigInt(Y), n);
          expect(s.rounds.map((r) => readFraction(r.sum))).toEqual(want.remainders);
          expect(s.q.join('')).toBe(want.q);
          expect(s.correction.needed === '1' ? readFraction(s.correction.sum) : null).toBe(want.corrected);
          expect(BigInt(`0b${s.quotient.slice(2)}`)).toBe(want.Q);
          expect(BigInt(`0b${s.remainder.replace(/^[+−]/, '').replace('.', '')}`)).toBe(want.R);
        }
      }
    }
  });

  it('fast-check：商、余数、符号与参照一致（性质 1）', () => {
    fc.assert(
      fc.property(legal, ({ n, X, Y, xNeg, yNeg }) => {
        const trace = run(paramsOf(n, X, Y, xNeg, yNeg));
        const want = reference(BigInt(X), BigInt(Y), n);
        const qf = xNeg !== yNeg ? '1' : '0';
        expect(trace.result['[q]原']).toBe(`${qf}.${want.Q.toString(2).padStart(n, '0')}`);
        const r = `0.${want.R.toString(2).padStart(2 * n, '0')}`;
        expect(trace.result['余数']).toBe(want.R === 0n ? (xNeg ? `−${r}` : r) : `${xNeg ? '−' : '+'}${r}`);
      }),
      { numRuns: 300 },
    );
  });
});

describe('性质', () => {
  it('每轮余数满足 −|y| ≤ r < |y|；商位 = 进位 = 1 − 符号位；下一轮减当且仅当商 1（性质 2、3）', () => {
    fc.assert(
      fc.property(legal, ({ n, X, Y }) => {
        const s = last(paramsOf(n, X, Y));
        s.rounds.forEach((round, i) => {
          const r = readFraction(round.sum);
          expect(r >= -BigInt(Y) && r < BigInt(Y)).toBe(true);
          expect(round.q).toBe(round.carry);
          expect(round.q).toBe(round.sum.startsWith('1') ? '0' : '1');
          if (i === 0) expect([round.op, round.p]).toEqual(['减 y', '1']);
          else expect(round.p).toBe(s.rounds[i - 1]!.q);
          expect(round.op).toBe(round.p === '1' ? '减 y' : '加 y');
        });
      }),
      { numRuns: 300 },
    );
  });

  it('纠余发生当且仅当 q_n = 0（性质 4）', () => {
    fc.assert(
      fc.property(legal, ({ n, X, Y }) => {
        const s = last(paramsOf(n, X, Y));
        expect(s.correction.needed).toBe(s.q[n] === '0' ? '1' : '0');
      }),
      { numRuns: 200 },
    );
  });

  it('左移：最高位丢掉，最低位补 0', () => {
    const s = last(paramsOf(5, 22, 31));
    for (let i = 1; i <= 5; i += 1) {
      const before = s.rounds[i - 1]!.sum.replace('.', '');
      expect(s.rounds[i]!.left.replace('.', '')).toBe(`${before.slice(1)}0`);
    }
  });

  it('同样的参数得到同样的 Trace，validateTrace 为空（性质 5）', () => {
    fc.assert(
      fc.property(legal, ({ n, X, Y, xNeg, yNeg }) => {
        const p = paramsOf(n, X, Y, xNeg, yNeg);
        const frozen = JSON.stringify(p);
        const first = run(p);
        expect(validateTrace(first)).toEqual([]);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(first));
        expect(JSON.stringify(p)).toBe(frozen);
      }),
      { numRuns: 60 },
    );
  });

  it('generate：同种子同参数，总能 run', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const p = generate(seed);
      expect(generate(seed)).toEqual(p);
      expect(validateTrace(run(p))).toEqual([]);
    }
    expect(generate(3, { n: 8, notation: '整数' })).toMatchObject({ n: 8, notation: '整数' });
    expect(validateTrace(run(generate(3, { n: 8, notation: '整数' })))).toEqual([]);
  });
});

describe('Trace 的结构', () => {
  it('步骤顺序与层级：每轮 左移、加减、上商；加减是 beat', () => {
    const trace = run(paramsOf(5, 22, 31));
    const kinds = trace.steps.map((s) =>
      s.title.startsWith('左移') ? 'L' : /^(减 y|加 y)/.test(s.title) ? 'A' : s.title.startsWith('余数') ? 'Q' : s.title.startsWith('纠余') ? 'C' : '-',
    );
    expect(kinds.join('')).toBe('--AQ' + 'LAQ'.repeat(5) + 'C-');
    for (const s of trace.steps) {
      expect(s.ref).toMatch(/^教材 p/);
      expect(s.level).toBe(/^(减 y|加 y|纠余)/.test(s.title) ? 'beat' : 'explain');
    }
  });

  it('预测题：第一次在余数为负之后问加还是减；最后问要不要纠余', () => {
    const trace = run(paramsOf(5, 22, 31));
    const asks = trace.steps.filter((s) => s.ask);
    expect(asks).toHaveLength(2);
    expect(asks[0]!.ask!.answer).toBe('加 y');
    expect(asks[0]!.state.rounds[1]!.op).toBe('加 y');
    expect(asks[1]!.ask!.answer).toBe('要，再加 y');
    const noFix = run(paramsOf(4, 9, 11)).steps.filter((s) => s.ask);
    expect(noFix.at(-1)!.ask!.answer).toBe('不要');
    expect(noFix.at(-1)!.state.correction.needed).toBe('0');
  });

  it('解题表按例 2.25 的版式，每行指回一步', () => {
    const trace = run(paramsOf(5, 22, 31));
    expect(trace.table.columns).toEqual(['行', '符号位', '2^-1', '2^-2', '2^-3', '2^-4', '2^-5', '判断', '上商']);
    const labels = trace.table.rows.map((r) => r.cells[0]);
    expect(labels.slice(0, 6)).toEqual(['被除数 x', '减 y', '余数为负', '左移', '加 y', '余数为正']);
    expect(trace.table.rows.at(-2)!.cells.at(-1)).toBe('纠余');
    expect(trace.table.rows.at(-1)!.cells.slice(1, 7).join('')).toBe('010110');
    for (const row of trace.table.rows) expect(row.step).toBeDefined();
  });

  it('余数恰为 0 时写「余数为 0」', () => {
    // 0.0110 ÷ 0.1100 = 0.1000，第 1 轮余数为 0
    const trace = run(paramsOf(4, 6, 12));
    expect(trace.table.rows.some((r) => r.cells[0] === '余数为 0' && r.cells.at(-2) === '= 0')).toBe(true);
  });
});

describe('参数不合格时抛出说明原因的错误', () => {
  const v = (text: string) => ({ as: '真值' as const, text });
  const cases: [string, DivParams, RegExp][] = [
    ['除数为 0', { n: 4, notation: '小数', x: v('0.0001'), y: v('0.0000') }, /除数是 0/],
    ['|x| ≥ |y|', { n: 4, notation: '小数', x: v('0.1100'), y: v('0.1010') }, /\|x\| 不小于 \|y\|/],
    ['相等也不行', { n: 4, notation: '小数', x: v('-0.1010'), y: v('0.1010') }, /\|x\| 不小于 \|y\|/],
    ['位数不对', { n: 4, notation: '小数', x: { as: '机器数', bits: '0.101' }, y: v('0.1010') }, /应为 5 位/],
    ['小数写法不是纯小数', { n: 4, notation: '小数', x: v('1.0000'), y: v('0.1010') }, /超出范围/],
    ['整数机器码带小数点', { n: 4, notation: '整数', x: { as: '机器数', bits: '0.0101' }, y: v('1010') }, /不带小数点/],
    ['n 太大', { n: 13, notation: '小数', x: v('0.1'), y: v('0.11') }, /n 必须是 2 到 12/],
    ['写法不认识', { n: 4, notation: '分数' as '小数', x: v('0.1'), y: v('0.11') }, /写法只能是/],
  ];
  for (const [name, params, message] of cases) {
    it(name, () => {
      expect(() => run(params)).toThrow(BitsError);
      expect(() => run(params)).toThrow(message);
    });
  }
});

// ---------- evals/golden/div-cases.json ----------

interface GoldenCase {
  name: string;
  source: string;
  params: DivParams;
  expect: {
    negY: string;
    ops?: string[];
    lefts?: string[];
    sums?: string[];
    q: string;
    corrected?: string | null;
    quotient: string;
    quotientValue: string;
    remainder: string;
  };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/div-cases.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/div-cases.json 的固定用例', () => {
  it('有纠余和不纠余、小数和整数两种写法', () => {
    expect(new Set(golden.cases.map((c) => c.params.notation))).toEqual(new Set(['小数', '整数']));
    expect(new Set(golden.cases.map((c) => c.expect.q.at(-1)))).toEqual(new Set(['0', '1']));
  });
  for (const item of golden.cases) {
    it(`${item.name}（${item.source}）`, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const s = trace.steps.at(-1)!.state;
      const want = item.expect;
      expect(s.negY).toBe(want.negY);
      if (want.ops) expect(s.rounds.map((r) => r.op)).toEqual(want.ops);
      if (want.lefts) expect(s.rounds.map((r) => r.left)).toEqual(want.lefts);
      if (want.sums) expect(s.rounds.map((r) => r.sum)).toEqual(want.sums);
      expect(s.q.join('')).toBe(want.q);
      if (want.corrected !== undefined) expect(s.correction.needed === '1' ? s.correction.sum : null).toBe(want.corrected);
      expect([trace.result['[q]原'], trace.result['商的真值'], trace.result['余数']]).toEqual([want.quotient, want.quotientValue, want.remainder]);
    });
  }
});
