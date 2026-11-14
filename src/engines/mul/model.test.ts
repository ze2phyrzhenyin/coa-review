import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { BitsError } from '../../lib/bits';
import { complement, generate, multiplyArray, run, type MulMode, type MulParams, type MulState } from './model';

// ---------- 独立的朴素参照：只用 BigInt 和规格里的定义，不调用引擎和 lib/bits ----------

/** v 写成 width 位二进制（补码按模 2^width）。 */
function bin(v: bigint, width: number): string {
  const mod = 1n << BigInt(width);
  return (((v % mod) + mod) % mod).toString(2).padStart(width, '0');
}

interface Expected {
  P: string;
  product: string;
  preE: [string, string] | null;
  postE: string | null;
}

/** 由真值算出：阵列输出的 2n 位积、最后的积、三个求补器的 E。 */
function reference(mode: MulMode, n: number, x: bigint, y: bigint): Expected {
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const P = bin(abs(x) * abs(y), 2 * n);
  if (mode === '无符号') return { P, product: P, preE: null, postE: null };
  const negative = (x < 0n) !== (y < 0n);
  if (mode === '原码') return { P, product: (negative ? '1' : '0') + P, preE: ['0', '0'], postE: '0' };
  return { P, product: bin(x * y, 2 * n + 1), preE: [x < 0n ? '1' : '0', y < 0n ? '1' : '0'], postE: negative ? '1' : '0' };
}

/** 真值写成参数（带符号时 +/-，无符号时不带符号）。 */
function paramsOf(mode: MulMode, n: number, x: number, y: number): MulParams {
  const text = (v: number) =>
    mode === '无符号' ? v.toString(2).padStart(n, '0') : (v < 0 ? '-' : '+') + Math.abs(v).toString(2).padStart(n, '0');
  return { mode, n, x: { as: '真值', text: text(x) }, y: { as: '真值', text: text(y) } };
}

const last = (params: MulParams): MulState => {
  const trace = run(params);
  return trace.steps[trace.steps.length - 1]!.state;
};

/** 合法的 (mode, n, x, y)：补码不取 −2^n，也不取「0 乘负数」。 */
const legal = fc
  .record({ mode: fc.constantFrom<MulMode>('无符号', '原码', '补码'), n: fc.integer({ min: 2, max: 8 }), sx: fc.boolean(), sy: fc.boolean(), mx: fc.nat(), my: fc.nat() })
  .map(({ mode, n, sx, sy, mx, my }) => {
    const top = 2 ** n - 1;
    let x = mx % (top + 1);
    let y = my % (top + 1);
    if (mode !== '无符号') {
      if (sx) x = -x;
      if (sy) y = -y;
    }
    if (mode === '补码' && x === 0 && y < 0) x = 1;
    if (mode === '补码' && y === 0 && x < 0) y = 1;
    return { mode, n, x, y };
  });

describe('与参照对拍', () => {
  it('n = 2、3 的全部操作数，三种模式', () => {
    for (const mode of ['无符号', '原码', '补码'] as const) {
      for (const n of [2, 3]) {
        const low = mode === '无符号' ? 0 : -(2 ** n - 1);
        for (let x = low; x < 2 ** n; x += 1) {
          for (let y = low; y < 2 ** n; y += 1) {
            if (mode === '补码' && ((x === 0 && y < 0) || (y === 0 && x < 0))) continue;
            const s = last(paramsOf(mode, n, x, y));
            const want = reference(mode, n, BigInt(x), BigInt(y));
            expect([s.p.slice().reverse().join(''), s.product]).toEqual([want.P, want.product]);
          }
        }
      }
    }
  });

  it('fast-check：积、求补器的 E 与参照一致（性质 1）', () => {
    fc.assert(
      fc.property(legal, ({ mode, n, x, y }) => {
        const s = last(paramsOf(mode, n, x, y));
        const want = reference(mode, n, BigInt(x), BigInt(y));
        expect(s.product).toBe(want.product);
        expect([...s.p].reverse().join('')).toBe(want.P);
        expect(s.pre ? [s.pre.x.e, s.pre.y.e] : null).toEqual(want.preE);
        expect(s.post ? s.post.e : null).toBe(want.postE);
        expect(s.decimal).toBe(String(mode === '无符号' ? x * y : x * y).replace('-', '−'));
      }),
      { numRuns: 300 },
    );
  });
});

describe('阵列的性质', () => {
  it('每个全加器 2·进位 + 和 = 三个输入之和，共 n(n−1) 个（性质 2）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.nat(), fc.nat(), (n, ra, rb) => {
        const a = (ra % 2 ** n).toString(2).padStart(n, '0');
        const b = (rb % 2 ** n).toString(2).padStart(n, '0');
        const array = multiplyArray(a, b);
        const all = array.rows.flat();
        expect(all.length).toBe(n * (n - 1));
        for (const fa of all) expect(2 * Number(fa.carry) + Number(fa.sum)).toBe(Number(fa.top) + Number(fa.right) + Number(fa.diag));
        array.rows.forEach((row, r) => row.forEach((fa, k) => expect(fa.weight).toBe(r + 1 + k)));
      }),
      { numRuns: 200 },
    );
  });

  it('每一步之后：已出的 p 位 + 最新一行的和与进位 + 未进阵列的位积 = A·B（性质 3）', () => {
    const bitOf = (c: string) => BigInt(c === '1' ? 1 : 0);
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 7 }), fc.nat(), fc.nat(), (n, ra, rb) => {
        const A = ra % 2 ** n;
        const B = rb % 2 ** n;
        const trace = run(paramsOf('无符号', n, A, B));
        let checked = 0;
        for (const step of trace.steps) {
          const s = step.state;
          if (s.products[0]![0] === '') continue;
          const ab = (i: number, j: number) => bitOf(s.products[j]![i]!) << BigInt(i + j);
          const R = s.rows.slice(0, n - 1).filter((row) => row[0]!.sum !== '').length; // 加完的前几行
          const K = s.rows[n - 1]!.filter((fa) => fa.sum !== '').length; // 行波已算的位数
          let total = 0n;
          for (let k = 0; k <= R; k += 1) total += bitOf(s.p[k]!) << BigInt(k);
          if (R === 0) {
            for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) if (i + j > 0) total += ab(i, j);
          } else if (K === 0) {
            const row = s.rows[R - 1]!;
            row.forEach((fa, k) => {
              if (k > 0) total += bitOf(fa.sum) << BigInt(fa.weight);
              total += bitOf(fa.carry) << BigInt(fa.weight + 1);
            });
            if (R < n) total += ab(n - 1, R);
            for (let j = R + 1; j < n; j += 1) for (let i = 0; i < n; i += 1) total += ab(i, j);
          } else {
            const above = s.rows[n - 2]!;
            const ripple = s.rows[n - 1]!;
            for (let k = 0; k < K; k += 1) total += bitOf(ripple[k]!.sum) << BigInt(ripple[k]!.weight);
            total += bitOf(ripple[K - 1]!.carry) << BigInt(n + K);
            for (let k = K; k < n - 1; k += 1) {
              const top = k === n - 2 ? s.products[n - 1]![n - 1]! : above[k + 1]!.sum;
              total += (bitOf(top) + bitOf(above[k]!.carry)) << BigInt(n + k);
            }
          }
          expect(total).toBe(BigInt(A * B));
          checked += 1;
        }
        expect(checked).toBeGreaterThanOrEqual(2 * n - 1);
      }),
      { numRuns: 150 },
    );
  });

  it('求补器：E=1 时等于取反加 1，E=0 时原样通过（性质 4）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 16 }), fc.nat(), (w, raw) => {
        const input = (raw % 2 ** w).toString(2).padStart(w, '0');
        const v = BigInt(`0b${input}`);
        expect(complement(input, '1').output).toBe(bin(-v, w));
        expect(complement(input, '0').output).toBe(input);
        // 扫描链：C_i = 1 当且仅当第 i 位或它右边有 1。
        const chain = complement(input, '1').chain;
        for (let i = 0; i < w; i += 1) expect(chain.charAt(i)).toBe(input.slice(i).includes('1') ? '1' : '0');
      }),
    );
  });

  it('图 2.7 的连线：5×5 第 2 行最左全加器的上方入口是 a4b1，最后一行最右的右方入口是 0', () => {
    const s = last({ mode: '无符号', n: 5, x: { as: '机器数', bits: '11011' }, y: { as: '机器数', bits: '10101' } });
    expect(s.rows[1]![3]!.from.top).toBe('a4b1');
    expect(s.rows[0]![0]!.from).toEqual({ top: 'a1b0', right: 'a0b1', diag: '0' });
    expect(s.rows[4]![0]!.from.right).toBe('0');
    expect(s.rows[4]![3]!.from.top).toBe('a4b4');
    expect(s.rows[2]![0]!.from.diag).toBe('rows.1.0.carry');
  });
});

describe('Trace', () => {
  it('同样的参数得到同样的 Trace，validateTrace 为空，不改动参数（性质 5）', () => {
    fc.assert(
      fc.property(legal, ({ mode, n, x, y }) => {
        const p = paramsOf(mode, n, x, y);
        const frozen = JSON.stringify(p);
        const first = run(p);
        expect(validateTrace(first)).toEqual([]);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(first));
        expect(JSON.stringify(p)).toBe(frozen);
      }),
      { numRuns: 60 },
    );
  });

  it('步骤顺序与层级：位积一步、前 n−1 行各一步、最后一行逐位、最后讲延迟', () => {
    const trace = run(paramsOf('补码', 4, 11, -6));
    const titles = trace.steps.map((s) => s.title);
    expect(titles[0]).toMatch(/^写出 \[x\]补/);
    expect(titles[1]).toMatch(/^积的符号位/);
    expect(titles[2]).toMatch(/^x 的算前求补器/);
    expect(titles[3]).toMatch(/^y 的算前求补器/);
    expect(titles[4]).toMatch(/与门/);
    expect(titles.filter((t) => /^第 \d 行/.test(t))).toHaveLength(3);
    expect(titles.filter((t) => t.startsWith('最后一行'))).toHaveLength(3);
    expect(titles.at(-3)).toMatch(/^算后求补器/);
    expect(titles.at(-1)).toMatch(/^乘法时间/);
    for (const step of trace.steps) {
      expect(step.ref).toMatch(/^教材 p/);
      if (/求补器|与门|行/.test(step.title) && !/^写出|^拼上/.test(step.title)) expect(step.level).toBe('beat');
    }
    const last = trace.steps.at(-1)!;
    expect(last.state.path).toEqual(['rows.0.2', 'rows.1.1', 'rows.2.0', 'rows.3.0', 'rows.3.1', 'rows.3.2']);
  });

  it('预测题：答案取自状态', () => {
    const t1 = run(paramsOf('补码', 4, 11, -6));
    const asks = t1.steps.filter((s) => s.ask);
    expect(asks).toHaveLength(2);
    expect(asks[0]!.ask!.answer).toBe(asks[0]!.state.p[7]);
    expect(asks[1]!.ask!.answer).toBe(asks[1]!.state.post!.e === '1' ? '求补' : '直通');
    const t2 = run(paramsOf('原码', 4, 11, -6));
    const asks2 = t2.steps.filter((s) => s.ask);
    expect(asks2.map((s) => s.ask!.answer)).toEqual([asks2[0]!.state.p[1], asks2[1]!.state.p[7]]);
  });

  it('解题表：位积第 j 行占 2^{j+n−1}…2^j 列，每行指回一步', () => {
    const trace = run({ mode: '无符号', n: 5, x: { as: '机器数', bits: '11011' }, y: { as: '机器数', bits: '10101' } });
    const { columns, rows } = trace.table;
    expect(columns).toEqual(['行', ...Array.from({ length: 10 }, (_, i) => `2^${9 - i}`), '说明']);
    const products = rows.filter((r) => r.cells[11]!.startsWith('b_'));
    expect(products).toHaveLength(5);
    expect(products[2]!.cells.slice(1, 11).join('|')).toBe('|||1|1|0|1|1||');
    expect(rows.at(-1)!.cells.slice(1, 11).join('')).toBe('1000110111');
    for (const row of rows) expect(row.step).toBeDefined();
  });

  it('generate：同种子同参数，总能 run', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const p = generate(seed);
      expect(generate(seed)).toEqual(p);
      expect(validateTrace(run(p))).toEqual([]);
    }
    expect(new Set(Array.from({ length: 30 }, (_, s) => generate(s).mode)).size).toBe(3);
    expect(generate(7, { mode: '补码', n: 6 })).toMatchObject({ mode: '补码', n: 6 });
  });
});

describe('参数不合格时抛出说明原因的错误', () => {
  const cases: [string, MulParams, RegExp][] = [
    ['n 太小', { mode: '无符号', n: 1, x: { as: '真值', text: '1' }, y: { as: '真值', text: '1' } }, /n 必须是 2 到 8/],
    ['模式不认识', { mode: '反码' as MulMode, n: 4, x: { as: '真值', text: '1' }, y: { as: '真值', text: '1' } }, /模式只能是/],
    ['位数不对', { mode: '补码', n: 4, x: { as: '机器数', bits: '1001' }, y: { as: '真值', text: '1' } }, /应为 5 位/],
    ['无符号带负号', { mode: '无符号', n: 4, x: { as: '真值', text: '-11' }, y: { as: '真值', text: '1' } }, /不带负号/],
    ['超出范围', { mode: '原码', n: 4, x: { as: '真值', text: '+10000' }, y: { as: '真值', text: '1' } }, /超出范围/],
    ['补码最小负数', { mode: '补码', n: 4, x: { as: '真值', text: '-10000' }, y: { as: '真值', text: '+1' } }, /最小负数/],
    ['补码 0 乘负数', { mode: '补码', n: 4, x: { as: '真值', text: '0' }, y: { as: '真值', text: '-11' } }, /0 乘负数/],
    ['带小数点', { mode: '原码', n: 4, x: { as: '机器数', bits: '0.1011' }, y: { as: '真值', text: '1' } }, /不带小数点/],
  ];
  for (const [name, params, message] of cases) {
    it(name, () => {
      expect(() => run(params)).toThrow(BitsError);
      expect(() => run(params)).toThrow(message);
    });
  }
});

// ---------- evals/golden/mul-cases.json ----------

interface GoldenCase {
  name: string;
  source: string;
  params: MulParams;
  expect: {
    a: string;
    b: string;
    preE: [string, string] | null;
    postE: string | null;
    P: string;
    product: string;
    value: string;
    decimal: string;
    delay: string;
    zeroProductRows?: number[];
  };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/mul-cases.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/mul-cases.json 的固定用例', () => {
  it('覆盖三种模式', () => {
    expect(new Set(golden.cases.map((c) => c.params.mode))).toEqual(new Set(['无符号', '原码', '补码']));
  });
  for (const item of golden.cases) {
    it(`${item.name}（${item.source}）`, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const s = trace.steps.at(-1)!.state;
      const want = item.expect;
      expect([s.a, s.b]).toEqual([want.a, want.b]);
      expect(s.pre ? [s.pre.x.e, s.pre.y.e] : null).toEqual(want.preE);
      expect(s.post ? s.post.e : null).toBe(want.postE);
      expect([...s.p].reverse().join('')).toBe(want.P);
      expect(trace.result).toEqual({ 乘积: want.product, 真值: want.value, 十进制: want.decimal, 延迟: want.delay });
      for (const j of want.zeroProductRows ?? []) expect(s.products[j]!.every((c) => c === '0')).toBe(true);
    });
  }
});
