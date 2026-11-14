import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { run, translate, type Params } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: Params;
  expect: { rows: string[][]; result: Record<string, string> };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/vm-addr.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/vm-addr.json', () => {
  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);
      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });
      it('解题表逐行相同', () => {
        expect(trace.table.rows.map((r) => r.cells)).toEqual(item.expect.rows);
      });
      it('result 相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });
      it('translate 与解题表一致', () => {
        item.params.addresses.forEach((a, i) => {
          const t = translate(item.params, a);
          expect(t.fault).toBe(item.expect.rows[i]!.at(-1) === '缺页');
        });
      });
    });
  }

  it('快表命中时没有查页表的步', () => {
    const trace = run(golden.cases[1]!.params);
    expect(trace.steps.map((s) => s.ref)).not.toContain('教材 p112–113');
    expect(trace.steps.length).toBe(3);
  });
});
