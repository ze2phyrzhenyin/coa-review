import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { compute, run, type Params } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: Params;
  expect: { order: string[]; result: Record<string, string>; values: Record<string, number> };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/cacheperf-book.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/cacheperf-book.json', () => {
  it('四种问法都有', () => {
    expect(new Set(golden.cases.map((c) => c.params.kind))).toEqual(new Set(['正向', '由ta求h', '由e求h', '二级cache']));
  });

  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);
      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });
      it('result 的写法相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });
      it('数值相同', () => {
        const got = compute(item.params);
        for (const [key, value] of Object.entries(item.expect.values)) expect(got[key]).toBeCloseTo(value, 6);
      });
      it('求的顺序跟教材', () => {
        expect(trace.steps.map((s) => s.changes[0]?.at)).toEqual(item.expect.order);
        expect(trace.table.rows.map((r) => r.cells[3])).toEqual(item.expect.order.map((k) => item.expect.result[k]));
      });
    });
  }
});
