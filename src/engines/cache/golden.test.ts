import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateTrace } from '../trace';
import { performance, run, type Params } from './model';

interface GoldenCase {
  name: string;
  params: Params;
  expect: {
    table: string[][];
    finalRows: [number | null, number | null, number, number][];
    result: Record<string, string>;
    hitAsks: number[];
    victimAsks: { access: number; answer: string }[];
  };
}

const golden = JSON.parse(
  readFileSync(new URL('../../../evals/golden/cache-run.json', import.meta.url), 'utf8'),
) as { cases: GoldenCase[] };

describe('evals/golden/cache-run.json 的手算用例', () => {
  it('有三个用例', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(3);
  });

  for (const item of golden.cases) {
    describe(item.name, () => {
      const trace = run(item.params);

      it('Trace 合格', () => {
        expect(validateTrace(trace)).toEqual([]);
      });

      it('解题表逐行相同', () => {
        expect(trace.table.rows.map((r) => r.cells)).toEqual(item.expect.table);
      });

      it('最后各行的标记、块号、修改位、计数器相同', () => {
        const last = trace.steps[trace.steps.length - 1]!.state;
        expect(last.rows.map((r) => [r.tag, r.block, r.modified, r.count])).toEqual(item.expect.finalRows);
      });

      it('命中次数、缺失次数、h 以及给了时间时的 r、t_a、e 相同', () => {
        expect(trace.result).toEqual(item.expect.result);
      });

      it('预测题出在手算指出的那几次访问上，答案相同', () => {
        const hitAsks: number[] = [];
        const victimAsks: { access: number; answer: string }[] = [];
        for (const step of trace.steps) {
          if (!step.ask) continue;
          if (step.ask.prompt === '这次访问命中吗') {
            hitAsks.push(step.state.access.n);
            expect(step.ask.answer).toBe(item.expect.table[step.state.access.n - 1]![4]);
          } else {
            victimAsks.push({ access: step.state.access.n, answer: step.ask.answer });
          }
        }
        expect(hitAsks).toEqual(item.expect.hitAsks);
        expect(victimAsks).toEqual(item.expect.victimAsks);
      });
    });
  }

  it('同一串地址：直接映射在第 4 次访问因冲突缺失，2 路组相联命中', () => {
    const direct = golden.cases[0]!;
    const twoWay = golden.cases[1]!;
    expect(twoWay.params.accesses).toEqual(direct.params.accesses);
    const a = run(direct.params);
    const b = run(twoWay.params);
    const fourthA = a.steps.filter((s) => s.level === 'access')[3]!;
    const fourthB = b.steps.filter((s) => s.level === 'access')[3]!;
    // 块 3 在第 1 次访问时装入过，第 3 次访问被块 11 挤出行 3。
    expect(a.table.rows[0]!.cells[1]).toBe('3');
    expect(a.table.rows[3]!.cells[1]).toBe('3');
    expect(fourthA.state.access.result).toBe('缺失');
    expect(a.table.rows[2]!.cells[5]).toBe('块 3');
    expect(fourthB.state.access.result).toBe('命中');
  });
});

describe('教材例 3.4 的数值（p101–102）', () => {
  it('Nc=1900、Nm=100、tc=50ns、tm=250ns：h=0.95，r=5，e=83.3%，ta=60ns', () => {
    const p = performance(1900, 100, 50, 250);
    expect(p.h).toBeCloseTo(0.95, 12);
    expect(p.r).toBe(5);
    expect(p.ta).toBeCloseTo(60, 9);
    expect(p.e).toBeCloseTo(0.8333, 4);
    // 式(3.6)：e = 1 / [r + (1 − r)h]
    expect(p.e).toBeCloseTo(1 / (5 + (1 - 5) * 0.95), 12);
  });
});
