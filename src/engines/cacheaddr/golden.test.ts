import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { run, type Params, type State } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: Params;
  expect: { final?: Partial<State>; result: Record<string, string>; bits?: [string, string, string] };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/cacheaddr-book.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/cacheaddr-book.json', () => {
  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);
      const last = trace.steps[trace.steps.length - 1]!.state;
      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });
      it('result 相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });
      if (item.expect.final) {
        it('各量相同', () => {
          for (const [key, value] of Object.entries(item.expect.final!)) expect(last[key as keyof State]).toEqual(value);
        });
      }
      if (item.expect.bits) {
        it('三段二进制相同', () => {
          expect([last.address?.tagBits, last.address?.indexBits, last.address?.wordBits]).toEqual(item.expect.bits);
        });
      }
    });
  }

  it('例 3.6 求量的顺序：w → v → d → u → s → 标记 → 地址长度', () => {
    const trace = run(golden.cases[1]!.params);
    const order = trace.steps.map((s) => s.changes.map((c) => c.at).find((at) => at !== 'format'));
    expect(order).toEqual(['w', 'v', 'd', 'u', 's', 'tag', 'length']);
  });
});
