import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { TraceBuilder, diffStates, flatten, validateTrace } from './trace';

interface Counter {
  n: number;
  log: string[];
}

function build(increments: number[]) {
  const builder = new TraceBuilder<{ increments: number[] }, Counter>('counter', { increments }, { n: 0, log: [] });
  for (const k of increments) {
    builder.step({
      level: 'beat',
      title: `加 ${k}`,
      why: '输入序列的下一项',
      update: (s) => {
        s.n += k;
        s.log.push(String(k));
      },
    });
  }
  return builder.finish({ n: String(increments.reduce((a, b) => a + b, 0)) }, { columns: ['n'], rows: [] });
}

describe('flatten / diffStates', () => {
  it('摊平嵌套对象和数组', () => {
    expect(flatten({ a: 1, b: { c: [true, null] } })).toEqual({ a: '1', 'b.c.0': 'true', 'b.c.1': 'null' });
  });

  it('只报告变了的位置，含新增与消失', () => {
    expect(diffStates({ a: 1, b: [1, 2] }, { a: 1, b: [1], c: 'x' })).toEqual([
      { at: 'b.1', from: '2', to: '' },
      { at: 'c', from: '', to: 'x' },
    ]);
  });

  it('拒绝不能序列化的值', () => {
    expect(() => flatten({ f: () => 1 })).toThrow();
  });

  it('对任意状态：与自己比较没有变化', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(diffStates(v, v)).toEqual([]);
      }),
    );
  });
});

describe('TraceBuilder', () => {
  it('自动算出 changes，并保留每一步的完整状态', () => {
    const trace = build([2, 3]);
    expect(trace.initial).toEqual({ n: 0, log: [] });
    expect(trace.steps.map((s) => s.state.n)).toEqual([2, 5]);
    expect(trace.steps[1]!.changes).toEqual([
      { at: 'log.1', from: '', to: '3' },
      { at: 'n', from: '2', to: '5' },
    ]);
    expect(validateTrace(trace)).toEqual([]);
  });

  it('每一步的状态互不共享引用', () => {
    const trace = build([1, 1]);
    trace.steps[0]!.state.log.push('篡改');
    expect(trace.steps[1]!.state.log).toEqual(['1', '1']);
  });

  it('对任意输入序列：Trace 合格，且回放 changes 能还原每一步', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 12 }), (xs) => {
        const trace = build(xs);
        expect(validateTrace(trace)).toEqual([]);
        let flat = flatten(trace.initial);
        for (const step of trace.steps) {
          for (const c of step.changes) {
            if (c.to === '') delete flat[c.at];
            else flat = { ...flat, [c.at]: c.to };
          }
          expect(flat).toEqual(flatten(step.state));
        }
      }),
    );
  });
});

describe('validateTrace', () => {
  it('查出缺理由、changes 被改、解题表指错步、选择题答案不在选项里', () => {
    const trace = build([1]);
    trace.steps[0]!.why = ' ';
    trace.steps[0]!.changes = [];
    trace.steps[0]!.ask = { prompt: '下一步 n 是多少', kind: 'choice', options: ['1', '2'], answer: '3' };
    trace.table.rows.push({ cells: ['1'], step: 's9' });
    const problems = validateTrace(trace);
    expect(problems.some((p) => p.includes('为什么'))).toBe(true);
    expect(problems.some((p) => p.includes('changes'))).toBe(true);
    expect(problems.some((p) => p.includes('s9'))).toBe(true);
    expect(problems.some((p) => p.includes('选项'))).toBe(true);
  });
});
