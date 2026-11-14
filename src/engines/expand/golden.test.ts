import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { plan, run, type Params } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: Params;
  expect: { data: string[]; decoder?: string; result: Record<string, string> };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/expand-book.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/expand-book.json', () => {
  it('三种扩展方式都有', () => {
    expect(new Set(golden.cases.map((c) => c.expect.result['扩展方式']))).toEqual(new Set(['位扩展', '字扩展', '字位扩展']));
  });

  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);
      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });
      it('result 相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });
      it('第 0 组各片的数据线、译码器相同', () => {
        const p = plan(item.params);
        expect(p.chips.filter((c) => c.group === 0).map((c) => c.data)).toEqual(item.expect.data);
        expect(p.decoder).toBe(item.expect.decoder ?? '');
      });
      it('步骤顺序：芯片数 → 位扩展 → 字扩展 → 地址线 → 各组范围', () => {
        const first = (at: string): number => trace.steps.findIndex((s) => s.changes.some((c) => c.at === at || c.at.startsWith(`${at}.`)));
        const r = item.expect.result;
        const bitStep = r['每组片数'] === '1' ? 0 : 1;
        const wordStep = r['组数'] === '1' ? 0 : bitStep + 1;
        expect(first('d')).toBe(0);
        expect(first('perGroup')).toBe(bitStep);
        expect(first('groups')).toBe(wordStep);
        expect(first('chipLines')).toBe(Math.max(bitStep, wordStep) + 1);
        if (item.expect.decoder) expect(first('ranges')).toBe(first('chipLines') + 1);
      });
    });
  }

  it('写成串的字数原样显示：2048K 不写成 2M', () => {
    const trace = run(golden.cases[1]!.params);
    expect(trace.conditions.find((c) => c.label === '目标')?.value).toBe('2048K×8 位');
    expect(trace.table.rows[0]!.cells[1]).toBe('(2048K×8) / (256K×8)');
  });
});
