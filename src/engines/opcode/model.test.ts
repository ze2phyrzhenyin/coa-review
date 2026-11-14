import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, levelName, plan, run, type Level, type OpcodeParams } from './model';

// ---------- 朴素参照：把编码当字符串一个个列出来 ----------

function allStrings(bits: number): string[] {
  const out: string[] = [];
  for (let v = 0; v < 2 ** bits; v += 1) out.push(bits === 0 ? '' : v.toString(2).padStart(bits, '0'));
  return out;
}

interface RefLevel {
  used: string[];
  available: number;
}

/** 前缀表 prefixes 之下，从第 i 级起能不能排下。 */
function refFeasible(p: OpcodeParams, i: number, prefixes: string[], prevBits: number): boolean {
  if (i === p.levels.length) return true;
  const bits = p.wordBits - p.levels[i]!.addresses * p.addressBits;
  const cand = prefixes.flatMap((x) => allStrings(bits - prevBits).map((y) => x + y)).sort();
  const c = p.levels[i]!.count ?? 0;
  if (c > cand.length) return false;
  return refFeasible(p, i + 1, cand.slice(c), bits);
}

function reference(p: OpcodeParams): { levels: RefLevel[]; feasible: boolean; max: number | null } {
  let prefixes = [''];
  let prevBits = 0;
  const levels: RefLevel[] = [];
  let max: number | null = null;
  for (let i = 0; i < p.levels.length; i += 1) {
    const bits = p.wordBits - p.levels[i]!.addresses * p.addressBits;
    const cand = prefixes.flatMap((x) => allStrings(bits - prevBits).map((y) => x + y)).sort();
    let c = p.levels[i]!.count;
    if (c === undefined) {
      c = cand.length;
      while (c > 0 && !refFeasible(p, i + 1, cand.slice(c), bits)) c -= 1;
      max = c;
    }
    if (c > cand.length || !refFeasible(p, i + 1, cand.slice(c), bits)) return { levels, feasible: false, max: null };
    levels.push({ used: cand.slice(0, c), available: cand.length });
    prefixes = cand.slice(c);
    prevBits = bits;
  }
  return { levels, feasible: true, max };
}

const small: fc.Arbitrary<OpcodeParams> = fc
  .record({
    addressBits: fc.integer({ min: 1, max: 3 }),
    top: fc.integer({ min: 1, max: 3 }),
    extra: fc.integer({ min: 1, max: 3 }),
    keep: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
    counts: fc.array(fc.integer({ min: 0, max: 40 }), { minLength: 4, maxLength: 4 }),
    maxAt: fc.integer({ min: -1, max: 3 }),
  })
  .map(({ addressBits, top, extra, keep, counts, maxAt }) => {
    const wordBits = Math.max(addressBits * top + extra, 4);
    const addresses = Array.from({ length: top + 1 }, (_, i) => top - i).filter((_, i) => i === 0 || keep[i]);
    const levels: Level[] = addresses.map((m, i) => (i === maxAt ? { addresses: m } : { addresses: m, count: counts[i]! }));
    return { wordBits, addressBits, levels };
  });

describe('扩展操作码：性质', () => {
  it('可行与否、每级可用编码数、取到的编码、最多条数都与逐个列举的参照一致', () => {
    fc.assert(
      fc.property(small, (p) => {
        const ref = reference(p);
        const got = plan(p);
        expect(got.feasible).toBe(ref.feasible);
        if (!ref.feasible) return;
        if (ref.max !== null) expect(got.maxCount).toBe(ref.max);
        const t = run(p);
        ref.levels.forEach((lv, i) => {
          expect(got.available[i]).toBe(lv.available);
          expect(got.used[i]).toBe(lv.used.length);
          const range = t.steps.at(-1)!.state.levels[i]!.range;
          if (lv.used.length === 0) expect(range).toBeNull();
          else expect(range!.map((x) => x.replace(/,/g, ''))).toEqual([lv.used[0], lv.used.at(-1)]);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('可行时所有操作码互相不是前缀（参照列出的编码）', () => {
    fc.assert(
      fc.property(small, (p) => {
        const ref = reference(p);
        if (!ref.feasible) return;
        const codes = ref.levels.flatMap((l) => l.used);
        for (const x of codes) for (const y of codes) if (x !== y) expect(y.startsWith(x)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('Trace 合格、可重现；不可行时 result 写明卡在哪一类', () => {
    fc.assert(
      fc.property(small, (p) => {
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(t));
        expect(t.result['可行']).toBe(plan(p).feasible ? '是' : '否');
        if (t.result['可行'] === '否') expect(t.result['卡在']).toMatch(/地址$/);
      }),
      { numRuns: 200 },
    );
  });

  it('每多留一个码，下一级多 2^(多出的位数) 个编码', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), (c) => {
        const a = plan({ wordBits: 12, addressBits: 4, levels: [{ addresses: 2, count: c }, { addresses: 1, count: 0 }] });
        const b = plan({ wordBits: 12, addressBits: 4, levels: [{ addresses: 2, count: c - 1 }, { addresses: 1, count: 0 }] });
        expect(b.available[1]! - a.available[1]!).toBe(16);
      }),
    );
  });

  it('卡在：第一类自己的条数在它那一级分不出来；说明要缩减哪一类', () => {
    const p: OpcodeParams = { wordBits: 4, addressBits: 1, levels: [{ addresses: 2, count: 1 }, { addresses: 1, count: 1 }, { addresses: 0, count: 11 }] };
    const t = run(p);
    expect(validateTrace(t)).toEqual([]);
    expect(plan(p).available).toEqual([4, 6, 10]);
    expect(t.result['卡在']).toBe('零地址');
    expect(t.result['要缩减']).toBe('一地址少用 1 条，或二地址少用 1 条');
    expect(t.steps.at(-1)!.why).toMatch(/要缩减前面的分配/);
    const q = run({ wordBits: 12, addressBits: 4, levels: [{ addresses: 2, count: 15 }, { addresses: 1, count: 1 }, { addresses: 0, count: 300 }] });
    expect(q.result['卡在']).toBe('零地址');
    expect(run({ wordBits: 12, addressBits: 4, levels: [{ addresses: 2, count: 17 }] }).result['要缩减']).toMatch(/无前一类/);
  });

  it('出题器给出的参数都能跑通', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const p = generate(seed);
      expect(validateTrace(run(p))).toEqual([]);
      expect(plan(p).feasible).toBe(true);
    }
  });

  it('非法参数抛出错误', () => {
    expect(() => run({ wordBits: 16, addressBits: 4, levels: [] })).toThrow(/1 到 8/);
    expect(() => run({ wordBits: 16, addressBits: 4, levels: [{ addresses: 1, count: 1 }, { addresses: 2, count: 1 }] })).toThrow(/从多到少/);
    expect(() => run({ wordBits: 16, addressBits: 4, levels: [{ addresses: 2 }, { addresses: 1 }] })).toThrow(/至多一类/);
    expect(() => run({ wordBits: 8, addressBits: 4, levels: [{ addresses: 2, count: 1 }] })).toThrow(/占满/);
    expect(levelName(1)).toBe('一地址');
  });
});

// ---------- 固定用例 ----------

interface Golden {
  cases: { name: string; params: OpcodeParams; expect: { feasible: boolean; table?: string[][]; available?: number[]; max?: string; stuck?: string } }[];
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/opcode-cases.json', import.meta.url), 'utf8')) as Golden;

describe('evals/golden/opcode-cases.json', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const t = run(c.params);
      expect(validateTrace(t)).toEqual([]);
      expect(t.result['可行']).toBe(c.expect.feasible ? '是' : '否');
      if (c.expect.table) expect(t.table.rows.map((r) => r.cells)).toEqual(c.expect.table);
      if (c.expect.available) expect(plan(c.params).available).toEqual(c.expect.available);
      if (c.expect.max) {
        const key = Object.keys(t.result).find((k) => k.endsWith('最多'))!;
        expect(t.result[key]).toBe(c.expect.max);
      }
      if (c.expect.stuck) expect(t.result['卡在']).toBe(c.expect.stuck);
    });
  }
});
