/**
 * 2-mul 的独立检查：只按 specs/2-mul.md 和 docs/textbook/ch01-02.md（2.3，图 2.7–2.9，式 2.26–2.27）写，没看引擎实现。
 * 参照：乘积用 BigInt 直接乘；阵列的连线按要求 3 自己写一遍，再查每个全加器和每一步的守恒。
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { BitsError } from '../../lib/bits';
import { generate, run, type MulMode, type MulParams, type MulState } from './model';

/** [0, 1) 上的均匀数。fc.double 偏向 0、1 这些边界值，用整数代替。 */
const unit = fc.integer({ min: 0, max: 2 ** 30 - 1 }).map((v) => v / 2 ** 30);

const M = '−';
const bitsOf = (v: bigint, w: number) => (((v % (1n << BigInt(w))) + (1n << BigInt(w))) % (1n << BigInt(w))).toString(2).padStart(w, '0');
const bit = (s: string, weight: number) => s.charAt(s.length - 1 - weight); // 权 2^weight 的位

interface Case { mode: MulMode; n: number; x: bigint; y: bigint; params: MulParams }

/** 机器数：无符号 n 位；原码、补码 n+1 位。 */
function machine(mode: MulMode, n: number, v: bigint): string {
  if (mode === '无符号') return bitsOf(v, n);
  if (mode === '原码') return (v < 0n ? '1' : '0') + bitsOf(v < 0n ? -v : v, n);
  return bitsOf(v, n + 1);
}
function truth(mode: MulMode, n: number, v: bigint, ascii: boolean): string {
  const a = v < 0n ? -v : v;
  if (mode === '无符号') return bitsOf(a, n);
  return (v < 0n ? (ascii ? '-' : M) : '+') + bitsOf(a, n);
}

interface Ref { product: string; decimal: string; A: string; B: string; xf: string; yf: string; pf: string; P: string; postE: string }
function reference(mode: MulMode, n: number, x: bigint, y: bigint): Ref {
  const ax = x < 0n ? -x : x;
  const ay = y < 0n ? -y : y;
  const P = bitsOf(ax * ay, 2 * n);
  const xf = x < 0n ? '1' : '0';
  const yf = y < 0n ? '1' : '0';
  const pf = xf === yf ? '0' : '1';
  const v = x * y;
  if (mode === '无符号') return { product: P, decimal: v.toString(), A: bitsOf(ax, n), B: bitsOf(ay, n), xf: '', yf: '', pf: '', P, postE: '' };
  const product = mode === '原码' ? pf + P : bitsOf(v, 2 * n + 1);
  const decimal = (v < 0n ? M : '') + (v < 0n ? -v : v).toString();
  return { product, decimal, A: bitsOf(ax, n), B: bitsOf(ay, n), xf, yf, pf, P, postE: mode === '补码' ? pf : '0' };
}

/** 图 2.8：C_{−1} = 0，C_i = a_i + C_{i−1}，a_i* = a_i ⊕ E·C_{i−1}。位串左边是高位。 */
function complementRef(input: string, e: string): { chain: string; output: string } {
  let c = '0';
  const chain: string[] = [];
  const out: string[] = [];
  for (let i = input.length - 1; i >= 0; i--) {
    const a = input[i]!;
    out.unshift(a === (e === '1' && c === '1' ? '0' : '1') ? '1' : '0');
    c = a === '1' || c === '1' ? '1' : '0';
    chain.unshift(c);
  }
  return { chain: chain.join(''), output: out.join('') };
}

/** 要求 3 的连线。返回 rows[r][k] 三个入口的来源名。 */
function wiring(n: number): { top: string; right: string; diag: string }[][] {
  const rows: { top: string; right: string; diag: string }[][] = [];
  for (let r = 0; r < n; r++) {
    const row: { top: string; right: string; diag: string }[] = [];
    for (let k = 0; k <= n - 2; k++) {
      const leftmost = k === n - 2;
      if (r < n - 1) {
        const top = leftmost ? `a${n - 1}b${r}` : r === 0 ? `a${k + 1}b0` : `rows.${r - 1}.${k + 1}.sum`;
        row.push({ top, right: `a${k}b${r + 1}`, diag: r === 0 ? '0' : `rows.${r - 1}.${k}.carry` });
      } else {
        const top = leftmost ? `a${n - 1}b${n - 1}` : `rows.${n - 2}.${k + 1}.sum`;
        row.push({ top, right: k === 0 ? '0' : `rows.${n - 1}.${k - 1}.carry`, diag: `rows.${n - 2}.${k}.carry` });
      }
    }
    rows.push(row);
  }
  return rows;
}

/** 要求 4：哪个全加器的输出直接成了积的哪一位。 */
function outputs(n: number): Map<string, number> {
  const m = new Map<string, number>([['a0b0', 0]]);
  for (let j = 1; j <= n - 1; j++) m.set(`rows.${j - 1}.0.sum`, j);
  for (let k = 0; k <= n - 2; k++) m.set(`rows.${n - 1}.${k}.sum`, n + k);
  m.set(`rows.${n - 1}.${n - 2}.carry`, 2 * n - 1);
  return m;
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    mode: fc.constantFrom<MulMode>('无符号', '原码', '补码'),
    n: fc.integer({ min: 2, max: 8 }),
    a: unit,
    b: unit,
    sx: fc.boolean(),
    sy: fc.boolean(),
    fx: fc.boolean(),
    fy: fc.boolean(),
    ascii: fc.boolean(),
    edge: fc.integer({ min: 0, max: 9 }),
  })
  .map(({ mode, n, a, b, sx, sy, fx, fy, ascii, edge }) => {
    const top = 2 ** n;
    let ax = BigInt(Math.min(top - 1, Math.floor(a * top)));
    let ay = BigInt(Math.min(top - 1, Math.floor(b * top)));
    if (edge === 0) ax = BigInt(top - 1);
    if (edge === 1) { ax = BigInt(top - 1); ay = BigInt(top - 1); }
    if (edge === 2) ay = 0n;
    const signed = mode !== '无符号';
    let x = signed && sx ? -ax : ax;
    let y = signed && sy ? -ay : ay;
    // 补码里「0 乘负数」规格要求拒绝，这里换成正数，拒绝单独测
    if (mode === '补码' && x === 0n && y < 0n) y = -y;
    if (mode === '补码' && y === 0n && x < 0n) x = -x;
    const op = (v: bigint, asMachine: boolean) => (asMachine ? { as: '机器数' as const, bits: machine(mode, n, v) } : { as: '真值' as const, text: truth(mode, n, v, ascii) });
    return { mode, n, x, y, params: { mode, n, x: op(x, fx), y: op(y, fy) } };
  });

const final = (t: ReturnType<typeof run>): MulState => t.steps[t.steps.length - 1]!.state;

describe('2-mul 独立检查', () => {
  test('与 BigInt 参照对拍：乘积、十进制、阵列入口、符号位（性质 1）', () => {
    fc.assert(
      fc.property(caseArb, ({ mode, n, x, y, params }) => {
        const ref = reference(mode, n, x, y);
        const t = run(params);
        expect(validateTrace(t)).toEqual([]);
        expect(t.result['乘积']).toBe(ref.product);
        if (ref.decimal === '0') expect(t.result['十进制']).toMatch(/^[+−]?0$/);
        else expect(t.result['十进制']).toMatch(new RegExp(`^\\+?${ref.decimal}$`));
        expect(t.result['延迟']).toContain(`${8 * n - 4}T`);
        expect(t.result['真值']!.replace(/^[+−-]/, '')).toBe(ref.P);
        const s = final(t);
        expect(s.product).toBe(ref.product);
        expect(s.a).toBe(ref.A);
        expect(s.b).toBe(ref.B);
        expect(s.p.slice().reverse().join('')).toBe(ref.P);
        if (mode === '无符号') {
          expect(s.sign).toBeNull();
          expect(s.pre).toBeNull();
          expect(s.post).toBeNull();
        } else {
          expect(s.sign).toEqual({ xf: ref.xf, yf: ref.yf, pf: ref.pf });
        }
        // 位积：products[j][i] = a_i·b_j
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) expect(s.products[j]![i]).toBe(bit(ref.A, i) === '1' && bit(ref.B, j) === '1' ? '1' : '0');
        // 乘积按原码、补码解码等于 x·y
        if (mode === '原码') {
          const mag = BigInt('0b' + s.product.slice(1));
          const xy = x * y;
          expect(mag).toBe(xy < 0n ? -xy : xy);
          if (xy !== 0n) expect(s.product[0]).toBe(xy < 0n ? '1' : '0');
        }
        if (mode === '补码') {
          const v = BigInt('0b' + s.product);
          expect(v >= 1n << BigInt(2 * n) ? v - (1n << BigInt(2 * n + 1)) : v).toBe(x * y);
        }
      }),
      { numRuns: 200 },
    );
  });

  test('小规模穷举：n = 2、3 三种模式全部操作数', () => {
    for (const mode of ['无符号', '原码', '补码'] as MulMode[]) {
      for (const n of [2, 3]) {
        const lo = mode === '无符号' ? 0 : -(2 ** n) + 1;
        for (let x = lo; x < 2 ** n; x++) {
          for (let y = lo; y < 2 ** n; y++) {
            if (mode === '补码' && ((x === 0 && y < 0) || (y === 0 && x < 0))) continue;
            const ref = reference(mode, n, BigInt(x), BigInt(y));
            const p: MulParams = { mode, n, x: { as: '机器数', bits: machine(mode, n, BigInt(x)) }, y: { as: '机器数', bits: machine(mode, n, BigInt(y)) } };
            expect(run(p).result['乘积'], `${mode} n=${n} ${x}×${y}`).toBe(ref.product);
          }
        }
      }
    }
  });

  test('要求 3、性质 2：连线照图 2.7；每个全加器 2·carry + sum = top + right + diag', () => {
    fc.assert(
      fc.property(caseArb, ({ n, params }) => {
        const s = final(run(params));
        const w = wiring(n);
        expect(s.rows.length).toBe(n);
        for (let r = 0; r < n; r++) {
          expect(s.rows[r]!.length).toBe(n - 1);
          for (let k = 0; k <= n - 2; k++) {
            const fa = s.rows[r]![k]!;
            expect(fa.weight).toBe(r + 1 + k);
            expect(fa.from).toEqual(w[r]![k]);
            const v = (c: string) => (c === '1' ? 1 : 0);
            expect(2 * v(fa.carry) + v(fa.sum)).toBe(v(fa.top) + v(fa.right) + v(fa.diag));
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  test('性质 3：每一步之后，已输出的 p 位 + 没被用掉的和、进位 + 还没进阵列的位积 = A·B', () => {
    fc.assert(
      fc.property(caseArb, ({ mode, n, x, y, params }) => {
        const ref = reference(mode, n, x, y);
        const AB = BigInt('0b' + ref.A) * BigInt('0b' + ref.B);
        const outs = outputs(n);
        const t = run(params);
        for (const step of t.steps) {
          const s = step.state;
          const consumed = new Set<string>();
          let total = 0n;
          s.p.forEach((b, k) => { if (b === '1') total += 1n << BigInt(k); });
          for (const [label, k] of outs) if (s.p[k] !== undefined && s.p[k] !== '') consumed.add(label);
          s.rows.forEach((row) => row.forEach((fa) => {
            if (fa.sum === '') return;
            consumed.add(fa.from.top).add(fa.from.right).add(fa.from.diag);
          }));
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
            if (!consumed.has(`a${i}b${j}`) && bit(ref.A, i) === '1' && bit(ref.B, j) === '1') total += 1n << BigInt(i + j);
          }
          s.rows.forEach((row, r) => row.forEach((fa, k) => {
            if (fa.sum === '') return;
            const wgt = BigInt(r + 1 + k);
            if (!consumed.has(`rows.${r}.${k}.sum`) && fa.sum === '1') total += 1n << wgt;
            if (!consumed.has(`rows.${r}.${k}.carry`) && fa.carry === '1') total += 1n << (wgt + 1n);
          }));
          expect(total, `${step.id} ${step.title}`).toBe(AB);
        }
      }),
      { numRuns: 150 },
    );
  });

  test('要求 6、7、性质 4：求补器 = 扫描规则 = 取反加 1；E 的取法', () => {
    fc.assert(
      fc.property(caseArb, ({ mode, n, x, y, params }) => {
        if (mode === '无符号') return;
        const ref = reference(mode, n, x, y);
        const s = final(run(params));
        const pre = s.pre!;
        const post = s.post!;
        const mx = machine(mode, n, x);
        const my = machine(mode, n, y);
        expect(pre.x.input).toBe(mx.slice(1));
        expect(pre.y.input).toBe(my.slice(1));
        expect(pre.x.e).toBe(mode === '补码' ? mx[0] : '0');
        expect(pre.y.e).toBe(mode === '补码' ? my[0] : '0');
        expect(post.e).toBe(ref.postE);
        expect(post.input).toBe(ref.P);
        for (const c of [pre.x, pre.y, post]) {
          const want = complementRef(c.input, c.e);
          expect(c.chain).toBe(want.chain);
          expect(c.output).toBe(want.output);
          const w = c.input.length;
          const inv = c.e === '1' ? bitsOf(-BigInt('0b' + c.input), w) : c.input;
          expect(c.output).toBe(inv);
        }
        expect(pre.x.output).toBe(ref.A);
        expect(pre.y.output).toBe(ref.B);
      }),
      { numRuns: 150 },
    );
  });

  test('要求 5：步骤顺序和层级', () => {
    fc.assert(
      fc.property(caseArb, ({ mode, n, params }) => {
        const t = run(params);
        const touches = (i: number, prefix: string) => t.steps[i]!.changes.some((c) => c.at.startsWith(prefix));
        const idx = (prefix: string) => t.steps.findIndex((_, i) => touches(i, prefix));
        const iProducts = idx('products.');
        expect(t.steps[iProducts]!.level).toBe('beat');
        // 位积一步同时产生
        expect(t.steps[iProducts]!.changes.filter((c) => c.at.startsWith('products.')).length).toBe(n * n);
        const rowStep: number[] = [];
        for (let r = 0; r < n - 1; r++) {
          const steps = t.steps.map((_, i) => i).filter((i) => touches(i, `rows.${r}.`));
          expect(steps.length, `第 ${r} 行应一步算完`).toBe(1);
          for (let k = 0; k <= n - 2; k++) expect(t.steps[steps[0]!]!.changes.some((c) => c.at === `rows.${r}.${k}.sum`)).toBe(true);
          expect(t.steps[steps[0]!]!.level).toBe('beat');
          rowStep.push(steps[0]!);
        }
        const ripple: number[] = [];
        for (let k = 0; k <= n - 2; k++) {
          const steps = t.steps.map((_, i) => i).filter((i) => t.steps[i]!.changes.some((c) => c.at.startsWith(`rows.${n - 1}.${k}.`)));
          expect(steps.length, `最后一行第 ${k} 个全加器一步`).toBe(1);
          expect(t.steps[steps[0]!]!.level).toBe('beat');
          ripple.push(steps[0]!);
        }
        const order = [iProducts, ...rowStep, ...ripple];
        for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
        if (mode !== '无符号') {
          const iSign = idx('sign.pf');
          const iPreX = idx('pre.x.output');
          const iPreY = idx('pre.y.output');
          const iPost = idx('post.output');
          expect(iSign).toBeLessThan(Math.min(iPreX, iPreY));
          expect(Math.max(iPreX, iPreY)).toBeLessThan(iProducts);
          expect(iPost).toBeGreaterThan(ripple.at(-1)!);
          for (const i of [iPreX, iPreY, iPost]) expect(t.steps[i]!.level).toBe('beat');
        }
        const iProduct = t.steps.findIndex((st) => st.changes.some((c) => c.at === 'product'));
        const iPath = idx('path.');
        expect(iProduct).toBeGreaterThan(ripple.at(-1)!);
        expect(iPath).toBe(t.steps.length - 1);
        // 不是阵列一级的步都是 explain
        t.steps.forEach((s, i) => {
          const arrayish = s.changes.some((c) => /^(products|rows|pre|post)\./.test(c.at));
          if (!arrayish) expect(s.level, `${s.id} ${s.title}`).toBe('explain');
        });
      }),
      { numRuns: 150 },
    );
  });

  test('要求 8：延迟 (8n−4)T 和最长路径', () => {
    for (let n = 2; n <= 8; n++) {
      const p: MulParams = { mode: '无符号', n, x: { as: '机器数', bits: '1'.repeat(n) }, y: { as: '机器数', bits: '1'.repeat(n) } };
      const t = run(p);
      const s = final(t);
      expect(s.delay).toContain(`${8 * n - 4}T`);
      const want = [...Array.from({ length: n - 1 }, (_, r) => `rows.${r}.${n - 2 - r}`), ...Array.from({ length: n - 1 }, (_, k) => `rows.${n - 1}.${k}`)];
      expect(s.path).toEqual(want);
    }
  });

  test('要求 9：预测题答案取自状态', () => {
    fc.assert(
      fc.property(caseArb, ({ mode, n, params }) => {
        const t = run(params);
        const s = final(t);
        const asks = t.steps.map((st, i) => ({ st, i })).filter((a) => a.st.ask);
        expect(asks.length).toBe(2);
        const ripLeft = t.steps.findIndex((st) => st.changes.some((c) => c.at === `rows.${n - 1}.${n - 2}.carry`));
        expect(t.steps[ripLeft]!.ask?.kind).toBe('bits');
        expect(t.steps[ripLeft]!.ask?.answer).toBe(s.p[2 * n - 1]);
        if (mode === '补码') {
          const iPost = t.steps.findIndex((st) => st.changes.some((c) => c.at === 'post.output'));
          const ask = t.steps[iPost]!.ask!;
          expect(ask.kind).toBe('choice');
          expect(ask.answer).toBe(s.post!.e === '1' ? '求补' : '直通');
        } else {
          const iRow0 = t.steps.findIndex((st) => st.changes.some((c) => c.at === 'rows.0.0.sum'));
          expect(t.steps[iRow0]!.ask?.kind).toBe('bits');
          expect(t.steps[iRow0]!.ask?.answer).toBe(s.p[1]);
        }
      }),
      { numRuns: 120 },
    );
  });

  test('要求 10：纸面竖式的列数和最后一行', () => {
    fc.assert(
      fc.property(caseArb, ({ mode, n, x, y, params }) => {
        const t = run(params);
        const ref = reference(mode, n, x, y);
        const signed = mode !== '无符号';
        expect(t.table.columns.length).toBe(2 * n + (signed ? 3 : 2));
        const lastRow = t.table.rows.at(-1)!.cells;
        expect(lastRow.slice(1, 1 + (signed ? 2 * n + 1 : 2 * n)).join('')).toBe(ref.product);
        expect(t.table.rows.every((r) => r.step)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  test('性质 5：同参数同 Trace；generate 纯函数且总能 run', () => {
    fc.assert(fc.property(caseArb, ({ params }) => { expect(JSON.stringify(run(params))).toBe(JSON.stringify(run(params))); }), { numRuns: 50 });
    for (let seed = 1; seed <= 60; seed++) {
      for (const options of [{}, { mode: '补码' as MulMode, n: 4 }, { mode: '无符号' as MulMode, n: 8 }]) {
        const p = generate(seed, options);
        expect(generate(seed, options)).toEqual(p);
        expect(validateTrace(run(p))).toEqual([]);
      }
    }
  });

  test('要求 12：不合格参数抛 BitsError', () => {
    const t = (text: string) => ({ as: '真值' as const, text });
    const b = (bits: string) => ({ as: '机器数' as const, bits });
    expect(() => run({ mode: '无符号', n: 1, x: b('1'), y: b('1') })).toThrow(BitsError);
    expect(() => run({ mode: '无符号', n: 9, x: b('1'.repeat(9)), y: b('1'.repeat(9)) })).toThrow(BitsError);
    expect(() => run({ mode: '定点' as MulMode, n: 4, x: b('1111'), y: b('1111') })).toThrow(BitsError);
    expect(() => run({ mode: '无符号', n: 4, x: b('111'), y: b('1111') })).toThrow(BitsError);
    expect(() => run({ mode: '原码', n: 4, x: t('+10000'), y: t('+0001') })).toThrow(BitsError);
    expect(() => run({ mode: '无符号', n: 4, x: t(`${M}0101`), y: t('0001') })).toThrow(BitsError);
    expect(() => run({ mode: '补码', n: 4, x: t(`${M}10000`), y: t('+0011') })).toThrow(BitsError);
    expect(() => run({ mode: '补码', n: 4, x: b('10000'), y: b('00011') })).toThrow(BitsError);
    expect(() => run({ mode: '补码', n: 4, x: t('+0000'), y: t(`${M}0011`) })).toThrow(BitsError);
    expect(() => run({ mode: '补码', n: 4, x: t(`${M}0011`), y: t('+0000') })).toThrow(BitsError);
  });
});

describe('2-mul 教材例题（手算）', () => {
  test('例 2.22（p46）：A = 11011，B = 10101 → P = 1000110111 = 567，位积第 1、3 行全 0', () => {
    const t = run({ mode: '无符号', n: 5, x: { as: '机器数', bits: '11011' }, y: { as: '机器数', bits: '10101' } });
    expect(t.result['乘积']).toBe('1000110111');
    expect(t.result['十进制']).toBe('567');
    const s = final(t);
    expect(s.products[1]!.join('')).toBe('00000');
    expect(s.products[3]!.join('')).toBe('00000');
    expect(s.delay).toContain('36T');
    expect(s.path.length).toBe(8);
  });

  test('例 2.23（p47）：原码 +1111 × −1101 → 符号 1，求补器直通，积 111000011 = −195', () => {
    const t = run({ mode: '原码', n: 4, x: { as: '真值', text: '+1111' }, y: { as: '真值', text: `${M}1101` } });
    expect(t.result['乘积']).toBe('111000011');
    expect(t.result['十进制']).toBe(`${M}195`);
    const s = final(t);
    expect([s.pre!.x.e, s.pre!.y.e, s.post!.e]).toEqual(['0', '0', '0']);
  });

  test('例 2.24（p48）：[x]补 = 10001，[y]补 = 10011 → |x| = 1111，|y| = 1101，算后 E = 0，积 011000011 = +195', () => {
    const t = run({ mode: '补码', n: 4, x: { as: '机器数', bits: '10001' }, y: { as: '机器数', bits: '10011' } });
    const s = final(t);
    expect(s.a).toBe('1111');
    expect(s.b).toBe('1101');
    expect(s.post!.e).toBe('0');
    expect(t.result['乘积']).toBe('011000011');
    expect(t.result['十进制']).toMatch(/^\+?195$/);
  });

  test('教材梳理 D 的走查（p47 同型）：+1011 × −0110，原码 101000010，补码 110111110', () => {
    const x = { as: '真值' as const, text: '+1011' };
    const y = { as: '真值' as const, text: `${M}0110` };
    expect(run({ mode: '原码', n: 4, x, y }).result['乘积']).toBe('101000010');
    const t = run({ mode: '补码', n: 4, x, y });
    expect(final(t).post).toMatchObject({ e: '1', input: '01000010', output: '10111110' });
    expect(t.result['乘积']).toBe('110111110');
  });
});
