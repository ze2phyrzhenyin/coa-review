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

export function lesson(params: OverflowParams, compact = false): Lesson {
  try {
    const trace = withNotes(adaptTrace(run(params)));
    const solution = solve(params);
    return { ok: true, trace, solution, ...overflowScene(trace, solution, compact) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 讲解用的四组数：正溢且没有进位丢掉；丢掉进位但没有溢出；丢掉进位又负溢；一道减法（先求 [−y]变补）。 */
export const EXAMPLES: { x: string; y: string; op: '加' | '减' }[] = [
  { x: '+1001', y: '+0111', op: '加' },
  { x: '-0011', y: '+0101', op: '加' },
  { x: '-1001', y: '-1000', op: '加' },
  { x: '+0110', y: '-1011', op: '减' },
];

export const exampleParams = (i: number): OverflowParams => {
  const example = EXAMPLES[i] ?? EXAMPLES[0]!;
  return { x: { as: '真值', text: example.x }, y: { as: '真值', text: example.y }, n: 4, op: example.op, notation: '整数' };
};

/** 页面补充的说明：记号和进位判法怎么分正负。依据教材 p37–38。 */
const NOTES = [
  { label: '记号', value: 'V 是溢出标志，V = 1 表示溢出；⊕ 是异或，两位不同得 1，相同得 0。S_f1、S_f2 是结果的两个符号位；模 2^(n+2) 是说超出这么多位的部分丢掉不管' },
  { label: '读两个符号位', value: '两个符号位相同（00 或 11）没有溢出。不同时有溢出，最高符号位 S_f1 才是真实结果的符号：01 是正溢（真实结果为正，超过上限），10 是负溢（低于下限）' },
  { label: '进位判法分正负', value: 'C_0 是最高数值位送进第二符号位的进位，写在 S_f2 上方；C_f 是第二符号位再送进最高符号位的进位，写在 S_f1 上方。它不是「出界」那一格（那是 S_f1 向外丢掉的进位）。V = 1 时，C_0 = 1、C_f = 0 是正溢；C_f = 1、C_0 = 0 是负溢' },
];

function withNotes<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return { ...trace, conditions: [...trace.conditions, ...NOTES] };
}
