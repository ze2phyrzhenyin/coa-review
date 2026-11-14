import { describe, expect, it } from 'vitest';
import { validateTrace } from '../engines/trace';
import { demoTrace } from './demo-trace';

describe('演示 Trace', () => {
  it('满足 Trace 的通用不变量', () => {
    expect(validateTrace(demoTrace())).toEqual([]);
  });
  it('R0 最后等于 R1 的初值', () => {
    const trace = demoTrace({ r1: '0101 1010', dr: '0000 1111' });
    expect(trace.result.R0).toBe('0101 1010');
    expect(trace.steps.at(-1)!.state.reg.R1).toBe('0101 1010');
  });
});
