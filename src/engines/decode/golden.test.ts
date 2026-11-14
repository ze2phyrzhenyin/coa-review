import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { design, locate, run, type Params } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: Params;
  expect: { enables: string[]; table: string[][]; result: Record<string, string> };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/decode-book.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/decode-book.json', () => {
  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);
      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });
      it('解题表逐行相同', () => {
        expect(trace.table.rows.map((r) => r.cells)).toEqual(item.expect.table);
      });
      it('result 相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });
      it('使能端接法相同', () => {
        expect(design(item.params).enables).toEqual(item.expect.enables);
      });
    });
  }

  it('设计题 4：F800H 选中 2K 的 RAM4，F7FFH 没有芯片但 Y7 有效', () => {
    const p = golden.cases[1]!.params;
    expect(locate(p, 0xf800)).toEqual({ chip: 'RAM4', output: 'Y7', inner: 0 });
    expect(locate(p, 0xf7ff)).toEqual({ chip: null, output: 'Y7', inner: null });
  });

  it('习题 7：6005H 落在 RAM1，片内地址 5', () => {
    expect(locate(golden.cases[0]!.params, 0x6005)).toEqual({ chip: 'RAM1', output: 'Y3', inner: 5 });
  });

  it('A15 接到 G2B 时，8000H 以上不在译码范围里', () => {
    expect(locate(golden.cases[3]!.params, 0x9000)).toEqual({ chip: null, output: null, inner: null });
  });
});
