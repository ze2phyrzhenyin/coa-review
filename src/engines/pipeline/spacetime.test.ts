import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generateSpacetime, runSpacetime, spacetimeFigures, stageNamesOf, type SpacetimeParams } from './spacetime';

// ---------- 朴素参照：一个周期一个周期地挪指令，数到全部完成 ----------

function naive(p: SpacetimeParams): { cycles: number; columns: (number | null)[][]; speedup: number; mips: number } {
  const slots: (number | null)[] = Array.from({ length: p.k }, () => null);
  let next = 1;
  let finished = 0;
  let cycles = 0;
  const columns: (number | null)[][] = [];
  while (finished < p.n) {
    for (let s = p.k - 1; s > 0; s -= 1) slots[s] = slots[s - 1]!;
    slots[0] = next <= p.n ? next++ : null;
    cycles += 1;
    columns.push([...slots]);
    if (slots[p.k - 1] !== null) finished += 1;
  }
  const clock = p.dt ?? Math.max(...p.stageTimes!) + (p.latch ?? 0);
  const one = p.stageTimes ? p.stageTimes.reduce((a, b) => a + b, 0) : p.k * clock;
  return { cycles, columns, speedup: (p.n * one) / (cycles * clock), mips: (p.n / (cycles * clock)) * 1000 };
}

const params = fc.oneof(
  fc.record({ k: fc.integer({ min: 2, max: 8 }), n: fc.integer({ min: 1, max: 24 }), dt: fc.integer({ min: 1, max: 500 }) }),
  fc
    .integer({ min: 2, max: 8 })
    .chain((k) =>
      fc.record({
        k: fc.constant(k),
        n: fc.integer({ min: 1, max: 24 }),
        stageTimes: fc.array(fc.integer({ min: 1, max: 300 }), { minLength: k, maxLength: k }),
        latch: fc.integer({ min: 0, max: 30 }),
      }),
    ),
) as fc.Arbitrary<SpacetimeParams>;

describe('时空图：性质', () => {
  it('Trace 合格，同样的参数得到同样的 Trace', () => {
    fc.assert(
      fc.property(params, (p) => {
        const a = runSpacetime(p);
        expect(validateTrace(a)).toEqual([]);
        expect(JSON.stringify(runSpacetime(p))).toBe(JSON.stringify(a));
      }),
      { numRuns: 150 },
    );
  });

  it('Tk = k + n − 1，与一个周期一个周期挪的参照相同；每一列逐格相同', () => {
    fc.assert(
      fc.property(params, (p) => {
        const f = spacetimeFigures(p);
        const ref = naive(p);
        expect(f.Tk).toBe(p.k + p.n - 1);
        expect(f.Tk).toBe(ref.cycles);
        expect(f.speedup).toBeCloseTo(ref.speedup, 9);
        expect(f.throughputMips).toBeCloseTo(ref.mips, 9);
        const last = runSpacetime(p).steps.at(-1)!.state;
        for (let t = 0; t < f.Tk; t += 1) {
          for (let s = 0; s < p.k; s += 1) expect(last.grid[s]![t]).toBe(ref.columns[t]![s]);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('每条指令在每一段恰好出现一次，每列至多 k 条，完成数等于 n', () => {
    fc.assert(
      fc.property(params, (p) => {
        const last = runSpacetime(p).steps.at(-1)!.state;
        expect(last.done).toBe(p.n);
        for (let s = 0; s < p.k; s += 1) {
          const seen = last.grid[s]!.filter((x) => x !== null);
          expect(seen).toEqual(Array.from({ length: p.n }, (_, i) => i + 1));
        }
      }),
      { numRuns: 100 },
    );
  });

  it('等长各段时加速比小于 k，n 越大越接近 k', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 1, max: 23 }), (k, n) => {
        const a = spacetimeFigures({ k, n, dt: 10 }).speedup;
        const b = spacetimeFigures({ k, n: n + 1, dt: 10 }).speedup;
        expect(a).toBeLessThanOrEqual(k);
        expect(b).toBeGreaterThan(a);
      }),
    );
  });

  it('出题器给出的参数都能跑通', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const p = generateSpacetime(seed);
      expect(validateTrace(runSpacetime(p))).toEqual([]);
      expect(generateSpacetime(seed)).toEqual(p);
    }
  });
});

describe('时空图：细节', () => {
  it('段为行时从上往下是 WB…IF，指令为行时每行一条', () => {
    const a = runSpacetime({ k: 4, n: 3, dt: 10 });
    expect(a.table.rows.map((r) => r.cells[0])).toEqual(['WB', 'EX', 'ID', 'IF']);
    expect(a.table.rows[3]!.cells.slice(1)).toEqual(['I1', 'I2', 'I3', '', '', '']);
    const b = runSpacetime({ k: 4, n: 3, dt: 10, layout: '指令为行' });
    expect(b.table.rows[1]!.cells).toEqual(['I2', '', 'IF', 'ID', 'EX', 'WB', '']);
  });

  it('段名缺省：五段 IF ID EX MEM WB，其余 S1…', () => {
    expect(stageNamesOf({ k: 5 })).toEqual(['IF', 'ID', 'EX', 'MEM', 'WB']);
    expect(stageNamesOf({ k: 3 })).toEqual(['S1', 'S2', 'S3']);
  });

  it('填充、稳定、排空三个阶段', () => {
    const t = runSpacetime({ k: 3, n: 5, dt: 10 });
    const phases = t.steps.filter((s) => s.level === 'cycle').map((s) => s.state.phase);
    expect(phases).toEqual(['填充', '填充', '稳定', '稳定', '稳定', '排空', '排空']);
  });

  it('非法参数抛出错误', () => {
    expect(() => runSpacetime({ k: 1, n: 3, dt: 10 })).toThrow(/段数/);
    expect(() => runSpacetime({ k: 4, n: 3 })).toThrow(/二选|给且只给/);
    expect(() => runSpacetime({ k: 4, n: 3, dt: 10, stageTimes: [1, 2, 3, 4] })).toThrow(/给且只给/);
    expect(() => runSpacetime({ k: 3, n: 3, stageTimes: [1, 2] })).toThrow(/个数/);
    expect(() => runSpacetime({ k: 3, n: 3, dt: 10, latch: 5 })).toThrow(/缓冲/);
  });
});

// ---------- 固定用例 ----------

interface Golden {
  cases: {
    name: string;
    params: SpacetimeParams;
    expect: Partial<{ Tk: number; Ck: string; Tp: string; maxMips: string; speedup: number; throughputMips: number; clock: number; steadySpeedup: number }>;
  }[];
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/pipeline-spacetime.json', import.meta.url), 'utf8')) as Golden;

describe('evals/golden/pipeline-spacetime.json', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const t = runSpacetime(c.params);
      const f = spacetimeFigures(c.params);
      expect(validateTrace(t)).toEqual([]);
      const e = c.expect;
      if (e.Tk !== undefined) expect(f.Tk).toBe(e.Tk);
      if (e.Ck !== undefined) expect(t.result['加速比Ck']).toBe(e.Ck);
      if (e.Tp !== undefined) expect(t.result['吞吐率Tp']).toBe(e.Tp);
      if (e.maxMips !== undefined) expect(t.result['最大吞吐率']).toBe(e.maxMips);
      if (e.speedup !== undefined) expect(f.speedup).toBeCloseTo(e.speedup, 3);
      if (e.throughputMips !== undefined) expect(f.throughputMips).toBeCloseTo(e.throughputMips, 3);
      if (e.clock !== undefined) expect(f.clock).toBe(e.clock);
      if (e.steadySpeedup !== undefined) expect(f.steadySpeedup).toBeCloseTo(e.steadySpeedup, 3);
    });
  }
});
