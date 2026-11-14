import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { run, type OverflowParams } from './model';

interface GoldenCase {
  name: string;
  source: string;
  params: OverflowParams;
  expect: {
    x: string;
    y: string;
    negY?: string;
    /** 下标与变形补码位串相同：第 i 位向左送出的进位。 */
    carries: string;
    sum: string;
    carryOut: string;
    signBits: string;
    cf: string;
    c0: string;
    overflow: '无溢出' | '正溢' | '负溢';
    value: string | null;
    exact: string;
  };
}

const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/overflow-cases.json', import.meta.url), 'utf8')) as {
  cases: GoldenCase[];
};

const plain = (text: string) => text.replace('.', '');

describe('evals/golden/overflow-cases.json 的固定用例', () => {
  it('用例覆盖：两种运算、两种写法、三种结论、进位与溢出的四种组合', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(golden.cases.map((c) => c.name)).size).toBe(golden.cases.length);
    const seen = new Set(golden.cases.map((c) => `${c.expect.carryOut === '1' ? '有进位' : '无进位'}/${c.expect.overflow === '无溢出' ? '无溢出' : '溢出'}`));
    expect([...seen].sort()).toEqual(['无进位/无溢出', '无进位/溢出', '有进位/无溢出', '有进位/溢出']);
    expect(new Set(golden.cases.map((c) => c.params.op))).toEqual(new Set(['加', '减']));
    expect(new Set(golden.cases.map((c) => c.params.notation))).toEqual(new Set(['整数', '小数']));
    expect(new Set(golden.cases.map((c) => c.expect.overflow))).toEqual(new Set(['无溢出', '正溢', '负溢']));
  });

  for (const item of golden.cases) {
    it(`${item.name}（${item.source}）`, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const state = trace.steps[trace.steps.length - 1]!.state;
      const want = item.expect;
      const format = (cells: string[]) => {
        const bits = cells.slice(1).join('');
        return item.params.notation === '整数' ? bits : `${bits.slice(0, 2)}.${bits.slice(2)}`;
      };

      expect(format(state.rows.x.cells)).toBe(want.x);
      expect(format(state.rows.y.cells)).toBe(want.y);
      if (want.negY === undefined) expect(state.rows.negY).toBeNull();
      else expect(format(state.rows.negY!.cells)).toBe(want.negY);
      expect(format(state.rows.sum.cells)).toBe(want.sum);
      expect(state.rows.carry.cells).toEqual([...want.carries, '']);
      expect(state.dropped).toBe(want.carryOut);
      expect(state.sf1 + state.sf2).toBe(want.signBits);
      expect([state.cf, state.c0]).toEqual([want.cf, want.c0]);
      expect(state.vBySign).toBe(want.overflow === '无溢出' ? '0' : '1');
      expect(state.vByCarry).toBe(state.vBySign);
      expect(state.verdict).toBe(want.overflow);
      expect(state.value).toBe(want.value ?? '');
      expect(state.conclusion).toContain(want.exact);
      expect(state.conclusion).toContain(want.overflow);

      expect(trace.result['结果的变形补码']).toBe(want.sum);
      expect(trace.result['是否溢出']).toBe(want.overflow);
      expect(trace.result['真值']).toBe(want.value ?? undefined);

      const asks = trace.steps.flatMap((s) => (s.ask ? [s.ask] : []));
      expect(asks.map((q) => q.answer)).toEqual([want.signBits, want.overflow]);

      // 解题表最后一行是和，加数行与状态一致
      const rows = trace.table.rows;
      const dataOf = (label: string) => plain(rows.find((r) => r.cells[0] === label)!.cells.slice(2).join(''));
      expect(dataOf('[x]变补')).toBe(plain(want.x));
      expect(dataOf(want.negY === undefined ? '+ [y]变补' : '+ [−y]变补')).toBe(plain(want.negY ?? want.y));
      expect(dataOf(item.params.op === '加' ? '[x+y]变补' : '[x−y]变补')).toBe(plain(want.sum));
      // 表上读 C_f、C_0 的那一行（减去最小负数时是加法器进位行）与文字一致
      const carryRow = rows.find((r) => r.cells[0] === '加法器进位（读 C_f、C_0）') ?? rows.find((r) => r.cells[0] === '进位')!;
      expect([carryRow.cells[2], carryRow.cells[3]]).toEqual([want.cf, want.c0]);
    });
  }
});

interface AdderCase {
  name: string;
  params: OverflowParams;
  expect: { adderCarry: string[]; x: string; notY: string; sum: string; cf: string; c0: string; overflow: '无溢出' | '正溢' | '负溢' };
}

const adderGolden = JSON.parse(readFileSync(new URL('../../../evals/golden/overflow-adder-cases.json', import.meta.url), 'utf8')) as {
  cases: AdderCase[];
};

describe('evals/golden/overflow-adder-cases.json：减去最小负数，C_f、C_0 从加法器进位行读', () => {
  for (const item of adderGolden.cases) {
    it(item.name, () => {
      const trace = run(item.params);
      expect(validateTrace(trace)).toEqual([]);
      const state = trace.steps[trace.steps.length - 1]!.state;
      const want = item.expect;
      const adder = state.adder!;
      expect(adder.carry.cells).toEqual(want.adderCarry);
      expect(adder.x.cells.slice(2).join('')).toBe(want.x);
      expect(adder.notY.cells.slice(2).join('')).toBe(want.notY);
      expect(adder.sum.cells.slice(2).join('')).toBe(want.sum);
      expect([state.cf, state.c0]).toEqual([want.cf, want.c0]);
      expect(state.verdict).toBe(want.overflow);
      // 解题表上那一行与状态一致（定点小数在 S_f2 后多一列空的小数点格）
      const row = trace.table.rows.find((r) => r.cells[0] === '加法器进位（读 C_f、C_0）')!;
      const cells = row.cells.slice(1).filter((_, i) => !(item.params.notation === '小数' && i === 3));
      expect(cells).toEqual(want.adderCarry);
      expect(trace.table.rows.filter((r) => r.cells[0] === '进位')).toEqual([]);
    });
  }
});
