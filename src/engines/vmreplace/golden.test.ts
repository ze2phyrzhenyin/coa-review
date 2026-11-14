import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { run, simulate, type Params, type Policy } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: Params;
  expect: { columns?: (number | null)[][]; hits?: number[]; result: Record<string, string> };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/vm-replace.json', import.meta.url), 'utf8')) as {
  cases: GoldenCase[];
  sweeps: { name: string; policy: Policy; pages: number[]; hits: number[] }[];
};

describe('evals/golden/vm-replace.json', () => {
  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);
      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });
      it('result 相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });
      if (item.expect.columns) {
        it('每列各格相同，命中的列相同', () => {
          const cols = simulate(item.params);
          expect(cols.map((c) => c.frames)).toEqual(item.expect.columns);
          expect(cols.flatMap((c, i) => (c.hit ? [i + 1] : []))).toEqual(item.expect.hits);
          const access = trace.steps.filter((s) => s.level === 'access');
          expect(access.map((s) => s.state.frames)).toEqual(item.expect.columns);
        });
      }
    });
  }

  it('例 3.11 FIFO+LRU 的表：命中页加圈，最后一行写命中，命中率在 a 行末尾', () => {
    const trace = run(golden.cases[1]!.params);
    expect(trace.table.columns).toEqual(['页面访问序列', '0', '1', '2', '4', '②', '3', '0', '②', '1', '3', '②', '命中率']);
    expect(trace.table.rows.map((r) => r.cells)).toEqual([
      ['a', '0', '1', '2', '4', '②', '3', '0', '②', '1', '3', '②', '3/11=27.3%'],
      ['b', '', '0', '1', '2', '4', '2', '3', '0', '2', '1', '3', ''],
      ['c', '', '', '0', '1', '1', '4', '2', '3', '0', '2', '1', ''],
      ['', '', '', '', '', '命中', '', '', '命中', '', '', '命中', ''],
    ]);
  });

  for (const sweep of golden.sweeps) {
    it(sweep.name, () => {
      const hits = sweep.hits.map((_, i) => simulate({ frames: i + 1, policy: sweep.policy, pages: sweep.pages }).filter((c) => c.hit).length);
      expect(hits).toEqual(sweep.hits);
    });
  }
});
