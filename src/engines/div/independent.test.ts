/**
 * 2-div 的独立检查：只按 specs/2-div.md 和 docs/textbook/ch01-02.md（2.4.1、2.4.2、例 2.25）写，没看引擎实现。
 * 参照：BigInt 求 ⌊|X|·2^n / |Y|⌋ 和余数；再按 p50 的加减交替规则在 n+1 位里逐轮模拟一遍。
 */
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { BitsError } from '../../lib/bits';
import { generate, run, type DivParams, type DivState } from './model';

/** [0, 1) 上的均匀数。fc.double 偏向 0、1 这些边界值，用整数代替。 */
const unit = fc.integer({ min: 0, max: 2 ** 30 - 1 }).map((v) => v / 2 ** 30);

const M = '−';

function dec(num: bigint, k: number): string {
  const a = num < 0n ? -num : num;
  const int = a >> BigInt(k);
  const frac = a - (int << BigInt(k));
  let s = int.toString();
  if (frac !== 0n) s += '.' + (frac * 5n ** BigInt(k)).toString().padStart(k, '0').replace(/0+$/, '');
  return (num < 0n ? M : '') + s;
}

interface RefRound { op: '减 y' | '加 y'; p: string; left: string; addend: string; sum: string; carry: string; q: string; r: bigint }
interface Ref {
  xf: string; yf: string; qf: string;
  absX: string; absY: string; negY: string;
  rounds: RefRound[];
  needed: boolean;
  corrected: string;
  Q: bigint; R: bigint;
  quotient: string; quotientValue: string; remainder: string; check: string;
}

function reference(n: number, X: bigint, Y: bigint, xneg: boolean, yneg: boolean): Ref {
  const W = BigInt(n + 1);
  const mod = 1n << W;
  const wrap = (v: bigint) => ((v % mod) + mod) % mod;
  const fmt = (v: bigint) => { const b = wrap(v).toString(2).padStart(n + 1, '0'); return `${b[0]}.${b.slice(1)}`; };
  const signed = (bits: bigint) => (bits >= mod / 2n ? bits - mod : bits);
  const negY = wrap(-Y);
  const rounds: RefRound[] = [];
  let leftBits = X;
  let op: '减 y' | '加 y' = '减 y';
  for (let i = 0; i <= n; i++) {
    const addend = op === '减 y' ? negY : Y;
    const raw = leftBits + addend;
    const sum = wrap(raw);
    const carry = raw >= mod ? '1' : '0';
    const r = signed(sum);
    const q = r >= 0n ? '1' : '0';
    rounds.push({ op, p: op === '减 y' ? '1' : '0', left: fmt(leftBits), addend: fmt(addend), sum: fmt(sum), carry, q, r });
    leftBits = wrap(sum << 1n);
    op = q === '1' ? '减 y' : '加 y';
  }
  const lastR = rounds[n]!.r;
  const needed = lastR < 0n;
  const finalR = needed ? lastR + Y : lastR;
  const qbits = rounds.slice(1).map((r) => r.q).join('');
  const xf = xneg ? '1' : '0';
  const yf = yneg ? '1' : '0';
  const qf = xf === yf ? '0' : '1';
  const Q = BigInt('0b' + qbits);
  const R = finalR;
  return {
    xf, yf, qf,
    absX: fmt(X), absY: fmt(Y), negY: fmt(negY),
    rounds, needed, corrected: needed ? fmt(finalR) : '',
    Q, R,
    quotient: `${qf}.${qbits}`,
    quotientValue: `${qf === '1' ? M : '+'}0.${qbits}`,
    remainder: `${xneg ? M : '+'}0.${'0'.repeat(n)}${R.toString(2).padStart(n, '0')}`,
    check: `${dec(X, n)} = ${dec(Q, n)} × ${dec(Y, n)} + ${dec(R, 2 * n)}`,
  };
}

interface Case { n: number; X: bigint; Y: bigint; xneg: boolean; yneg: boolean; params: DivParams }

function operand(n: number, notation: '小数' | '整数', v: bigint, negative: boolean, form: number, ascii: boolean) {
  const body = v.toString(2).padStart(n, '0');
  if (form === 0) return { as: '机器数' as const, bits: (negative ? '1' : '0') + (notation === '小数' && ascii ? '.' : '') + body };
  const sign = negative ? (ascii ? '-' : M) : ascii ? '' : '+';
  return { as: '真值' as const, text: notation === '小数' ? `${sign}0.${body}` : `${sign}${body}` };
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    n: fc.integer({ min: 2, max: 12 }),
    notation: fc.constantFrom<'小数' | '整数'>('小数', '整数'),
    a: unit,
    b: unit,
    xneg: fc.boolean(),
    yneg: fc.boolean(),
    fx: fc.integer({ min: 0, max: 1 }),
    fy: fc.integer({ min: 0, max: 1 }),
    ascii: fc.boolean(),
    edge: fc.integer({ min: 0, max: 9 }),
  })
  .map(({ n, notation, a, b, xneg, yneg, fx, fy, ascii, edge }) => {
    const top = 2 ** n;
    let Y = BigInt(1 + Math.min(top - 2, Math.floor(b * (top - 1))));
    if (edge === 0) Y = BigInt(top - 1);
    let X = BigInt(Math.min(Number(Y) - 1, Math.floor(a * Number(Y))));
    if (edge === 1) X = Y - 1n;
    if (edge === 2) X = 0n;
    const xn = xneg && X !== 0n;
    return { n, X, Y, xneg: xn, yneg, params: { n, notation, x: operand(n, notation, X, xn, fx, ascii), y: operand(n, notation, Y, yneg, fy, ascii) } };
  });

const final = (t: ReturnType<typeof run>): DivState => t.steps[t.steps.length - 1]!.state;
const refOf = (c: Case) => reference(c.n, c.X, c.Y, c.xneg, c.yneg);

describe('2-div 独立检查', () => {
  test('性质 1：Q = ⌊|X|·2^n / |Y|⌋，R = |X|·2^n − Q·|Y|，与 BigInt 相同', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const t = run(c.params);
        expect(validateTrace(t)).toEqual([]);
        const scaled = c.X << BigInt(c.n);
        const Q = scaled / c.Y;
        const R = scaled - Q * c.Y;
        const qf = c.xneg === c.yneg ? '0' : '1';
        expect(t.result['[q]原']).toBe(`${qf}.${Q.toString(2).padStart(c.n, '0')}`);
        // 0 前面带不带「+」规格没定
        const plusOpt = (v: string | undefined, zero: boolean) => (zero ? (v ?? '').replace(/^\+/, '') : v);
        const qText = `${qf === '1' ? M : '+'}0.${Q.toString(2).padStart(c.n, '0')}`;
        const rText = `${c.xneg ? M : '+'}0.${'0'.repeat(c.n)}${R.toString(2).padStart(c.n, '0')}`;
        expect(plusOpt(t.result['商的真值'], Q === 0n)).toBe(plusOpt(qText, Q === 0n));
        expect(plusOpt(t.result['余数'], R === 0n)).toBe(plusOpt(rText, R === 0n));
        // 验证式：|x| = q·|y| + r，精确
        const nums = t.result['验证']!.split('：').at(-1)!;
        expect(nums).toBe(`${dec(c.X, c.n)} = ${dec(Q, c.n)} × ${dec(c.Y, c.n)} + ${dec(R, 2 * c.n)}`);
      }),
      { numRuns: 400 },
    );
  });

  test('与逐轮参照对拍：阵列视图 rounds、纠余、最后的状态', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ref = refOf(c);
        const s = final(run(c.params));
        expect(s.sign).toEqual({ xf: ref.xf, yf: ref.yf, qf: ref.qf });
        expect(s.absX).toBe(ref.absX);
        expect(s.absY).toBe(ref.absY);
        expect(s.negY).toBe(ref.negY);
        expect(s.rounds.length).toBe(c.n + 1);
        s.rounds.forEach((r, i) => {
          const w = ref.rounds[i]!;
          expect({ op: r.op, p: r.p, left: r.left, addend: r.addend, sum: r.sum, carry: r.carry, q: r.q }, `第 ${i} 轮`).toEqual({
            op: w.op, p: w.p, left: w.left, addend: w.addend, sum: w.sum, carry: w.carry, q: w.q,
          });
        });
        expect(s.q).toEqual(ref.rounds.map((r) => r.q));
        expect(s.correction.needed).toBe(ref.needed ? '1' : '0');
        if (ref.needed) expect(s.correction.sum).toBe(ref.corrected);
        expect(s.quotient).toBe(ref.quotient);
        expect(s.remainder.replace(/^\+/, '')).toBe(ref.remainder.replace(/^\+/, ''));
        expect(s.x).toBe(`${ref.xf}.${c.X.toString(2).padStart(c.n, '0')}`);
        expect(s.y).toBe(`${ref.yf}.${c.Y.toString(2).padStart(c.n, '0')}`);
      }),
      { numRuns: 400 },
    );
  });

  test('性质 2、3、4：−|y| ≤ r < |y|；商位 = 进位 = 1 − 符号位；商 1 下一轮减；纠余当且仅当 q_n = 0；q_0 = 0', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const s = final(run(c.params));
        const W = c.n + 1;
        s.rounds.forEach((r, i) => {
          const bits = BigInt('0b' + r.sum.replace('.', ''));
          const v = bits >= 1n << BigInt(c.n) ? bits - (1n << BigInt(W)) : bits;
          expect(v >= -c.Y && v < c.Y, `第 ${i} 轮余数 ${r.sum}`).toBe(true);
          expect(r.q).toBe(r.carry);
          expect(r.q).toBe(r.sum[0] === '0' ? '1' : '0');
          const next = s.rounds[i + 1];
          if (next) {
            expect(next.op).toBe(r.q === '1' ? '减 y' : '加 y');
            expect(next.p).toBe(r.q);
          }
        });
        expect(s.rounds[0]!.p).toBe('1');
        expect(s.rounds[0]!.q).toBe('0');
        expect(s.correction.needed).toBe(s.rounds[c.n]!.q === '0' ? '1' : '0');
      }),
      { numRuns: 300 },
    );
  });

  test('小规模穷举：n = 2…5，小数，全部 0 ≤ |x| < |y|', () => {
    for (let n = 2; n <= 5; n++) {
      for (let Y = 1; Y < 2 ** n; Y++) {
        for (let X = 0; X < Y; X++) {
          const scaled = BigInt(X) << BigInt(n);
          const Q = scaled / BigInt(Y);
          const t = run({ n, notation: '小数', x: operand(n, '小数', BigInt(X), false, 1, false), y: operand(n, '小数', BigInt(Y), false, 1, false) });
          expect(t.result['[q]原'], `n=${n} ${X}/${Y}`).toBe(`0.${Q.toString(2).padStart(n, '0')}`);
        }
      }
    }
  });

  test('要求 3：步骤顺序（上商 → 左移 → 加减）和层级', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const t = run(c.params);
        const at = (path: string) => t.steps.findIndex((s) => s.changes.some((ch) => ch.at === path && ch.to !== ''));
        for (let i = 0; i <= c.n; i++) {
          const iSum = at(`rounds.${i}.sum`);
          const iQ = at(`q.${i}`);
          expect(iSum).toBeGreaterThanOrEqual(0);
          expect(iQ, `q_${i} 在加减之后另起一步上商`).toBeGreaterThan(iSum);
          if (i < c.n) {
            const iLeft = at(`rounds.${i + 1}.left`);
            const iNext = at(`rounds.${i + 1}.sum`);
            expect(iLeft, '先上商再左移').toBeGreaterThan(iQ);
            expect(iNext, '先左移再加减').toBeGreaterThan(iLeft);
          }
        }
        const lastSum = at(`rounds.${c.n}.sum`);
        const iCorr = t.steps.findIndex((s) => s.changes.some((ch) => ch.at === 'correction.sum' && ch.to !== ''));
        if (refOf(c).needed) expect(iCorr).toBeGreaterThan(lastSum);
        t.steps.forEach((s) => {
          const arith = s.changes.some((ch) => /^rounds\.\d+\.sum$/.test(ch.at) || ch.at === 'correction.sum');
          expect(s.level, `${s.id} ${s.title}`).toBe(arith ? 'beat' : 'explain');
        });
      }),
      { numRuns: 200 },
    );
  });

  test('要求 9：两道预测题，答案取自状态', () => {
    const corrAnswers = new Map<boolean, Set<string>>([[true, new Set()], [false, new Set()]]);
    fc.assert(
      fc.property(caseArb, (c) => {
        const ref = refOf(c);
        const t = run(c.params);
        const asks = t.steps.map((s, i) => ({ s, i })).filter((a) => a.s.ask);
        expect(asks.length).toBe(2);
        let target = ref.rounds.findIndex((r, i) => i >= 1 && ref.rounds[i - 1]!.q === '0');
        if (target < 0) target = 1;
        const first = asks[0]!;
        expect(first.s.ask!.answer).toBe(ref.rounds[target]!.op);
        expect(first.s.changes.some((ch) => ch.at.startsWith(`rounds.${target}.`)), `第一道题应在第 ${target} 轮的加减步`).toBe(true);
        const second = asks[1]!.s.ask!;
        expect(second.kind).toBe('choice');
        expect(second.options).toContain(second.answer);
        expect(asks[1]!.i).toBeGreaterThanOrEqual(t.steps.findIndex((s) => s.changes.some((ch) => ch.at === `rounds.${c.n}.sum`)));
        corrAnswers.get(ref.needed)!.add(second.answer);
      }),
      { numRuns: 200 },
    );
    // 要纠余和不要纠余的答案各自固定，且不同
    expect(corrAnswers.get(true)!.size).toBe(1);
    expect(corrAnswers.get(false)!.size).toBe(1);
    expect([...corrAnswers.get(true)!][0]).not.toBe([...corrAnswers.get(false)!][0]);
  });

  test('要求 10：解题表版式', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const ref = refOf(c);
        const t = run(c.params);
        expect(t.table.columns.length).toBe(c.n + 4);
        expect(t.table.rows[0]!.cells[0]).toBe('被除数 x');
        expect(t.table.rows[0]!.cells.slice(1, c.n + 2).join('')).toBe(c.X.toString(2).padStart(c.n + 1, '0'));
        expect(t.table.rows.every((r) => r.step)).toBe(true);
        expect(t.table.rows.some((r) => r.cells.at(-1) === '纠余')).toBe(ref.needed);
      }),
      { numRuns: 150 },
    );
  });

  test('性质 5：同参数同 Trace；generate 纯函数、总能 run', () => {
    fc.assert(fc.property(caseArb, (c) => { expect(JSON.stringify(run(c.params))).toBe(JSON.stringify(run(c.params))); }), { numRuns: 100 });
    for (let seed = 1; seed <= 200; seed++) {
      for (const options of [{}, { n: 5, notation: '整数' as const }, { n: 12 }]) {
        const p = generate(seed, options);
        expect(generate(seed, options)).toEqual(p);
        expect(validateTrace(run(p))).toEqual([]);
      }
    }
  });

  test('要求 8：必须拒绝的参数，抛 BitsError', () => {
    const t = (text: string) => ({ as: '真值' as const, text });
    const b = (bits: string) => ({ as: '机器数' as const, bits });
    expect(() => run({ n: 5, notation: '小数', x: t('0.10110'), y: t('0.00000') })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '小数', x: t('0.1100'), y: t('0.1010') })).toThrow(/x|≥|大于/);
    expect(() => run({ n: 4, notation: '小数', x: t('0.1100'), y: t('0.1100') })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '小数', x: b('0110'), y: b('01100') })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '小数', x: t('0.10011'), y: t('0.1100') })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '小数', x: t('1.0011'), y: t('0.1100') })).toThrow(BitsError);
    expect(() => run({ n: 4, notation: '整数', x: t('10011'), y: t('11100') })).toThrow(BitsError);
    expect(() => run({ n: 1, notation: '小数', x: t('0.0'), y: t('0.1') })).toThrow(BitsError);
    expect(() => run({ n: 13, notation: '小数', x: t('0.' + '0'.repeat(13)), y: t('0.' + '1'.repeat(13)) })).toThrow(BitsError);
  });
});

describe('2-div 教材例题（手算）', () => {
  test('例 2.25（p53–54）：0.10110 ÷ 0.11111 → 商 0.10110，第 5 轮余数为负要纠余，余数 0.0000010110', () => {
    const t = run({ n: 5, notation: '小数', x: { as: '真值', text: '0.10110' }, y: { as: '真值', text: '0.11111' } });
    expect(t.result['[q]原']).toBe('0.10110');
    expect(t.result['余数']).toMatch(/^\+?0\.0000010110$/);
    const s = final(t);
    expect(s.negY).toBe('1.00001');
    expect(s.rounds.map((r) => r.sum)).toEqual(['1.10111', '0.01101', '1.11011', '0.10101', '0.01011', '1.10111']);
    expect(s.correction).toEqual({ needed: '1', sum: '0.10110' });
  });

  test('p49 笔算的数（教材梳理 E 的走查）：0.1001 ÷ 0.1011 → 商 0.1101，余数 0.00000001，不纠余', () => {
    const t = run({ n: 4, notation: '小数', x: { as: '真值', text: '0.1001' }, y: { as: '真值', text: '0.1011' } });
    expect(t.result['[q]原']).toBe('0.1101');
    expect(t.result['余数']).toMatch(/^\+?0\.00000001$/);
    const s = final(t);
    expect(s.rounds.map((r) => r.sum)).toEqual(['1.1110', '0.0111', '0.0011', '1.1011', '0.0001']);
    expect(s.correction.needed).toBe('0');
  });

  test('习题 8(1)（p68）：整数 11000 ÷ −11111 化成 0.11000 ÷ 0.11111 → [q]原 1.11000，余数 +0.0000011000', () => {
    const t = run({ n: 5, notation: '整数', x: { as: '真值', text: '11000' }, y: { as: '真值', text: `${M}11111` } });
    expect(t.result['[q]原']).toBe('1.11000');
    expect(t.result['余数']).toMatch(/^\+?0\.0000011000$/);
  });

  test('规格场景：被除数为负，余数带负号；x = 0 时商 0、余数 0', () => {
    const t = run({ n: 5, notation: '小数', x: { as: '真值', text: `${M}0.01011` }, y: { as: '真值', text: '0.11001' } });
    expect(t.result['余数']!.startsWith(M)).toBe(true);
    const z = run({ n: 4, notation: '小数', x: { as: '真值', text: '0.0000' }, y: { as: '真值', text: '0.1011' } });
    expect(z.result['[q]原']).toBe('0.0000');
    expect(z.result['余数']).toMatch(/^\+?0\.00000000$/);
  });
});
