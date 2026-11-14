/** 一组参数 → 引擎的 Trace、答案和场景。参数不合格时给出引擎的报错原文。 */
import { run, solve } from '../../engines/overflow/model';
import type { OverflowParams, OverflowSolution, OverflowState } from '../../engines/overflow/model';
import type { Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import { adaptTrace } from './adapt';
import { overflowScene } from './scene';
import type { OverflowScene } from './scene';

export type Lesson =
  | ({ ok: true; trace: Trace<OverflowParams, OverflowState>; solution: OverflowSolution } & OverflowScene)
  | { ok: false; error: string };

export function lesson(params: OverflowParams): Lesson {
  try {
    const trace = adaptTrace(run(params));
    const solution = solve(params);
    return { ok: true, trace, solution, ...overflowScene(trace, solution) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 讲解用的三组数：正溢且没有进位丢掉；丢掉进位但没有溢出；丢掉进位又负溢。 */
export const EXAMPLES: { x: string; y: string }[] = [
  { x: '+1001', y: '+0111' },
  { x: '-0011', y: '+0101' },
  { x: '-1001', y: '-1000' },
];

export const exampleParams = (i: number): OverflowParams => {
  const example = EXAMPLES[i] ?? EXAMPLES[0]!;
  return { x: { as: '真值', text: example.x }, y: { as: '真值', text: example.y }, n: 4, op: '加', notation: '整数' };
};
