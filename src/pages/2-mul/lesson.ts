/** 一组参数 → 引擎的 Trace 和场景。参数不合格时给出引擎的报错原文。 */
import { run } from '../../engines/mul/model';
import type { MulMode, MulParams, MulState } from '../../engines/mul/model';
import type { Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import { mulScene } from './scene';
import type { MulScene } from './scene';

export type Lesson = ({ ok: true; trace: Trace<MulParams, MulState> } & MulScene<MulState>) | { ok: false; error: string };

/** 题面末尾的问号去掉：题目下面另有一行作答说明。 */
export function adaptTrace<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return {
    ...trace,
    steps: trace.steps.map((step) => {
      // 「变化」里每个全加器只列和与进位：三个输入在「为什么」里已经写出，场景里是飞进去的那几张牌。
      const changes = step.changes.filter((change) => !/^rows\.\d+\.\d+\.(top|right|diag)$/.test(change.at));
      const ask = step.ask ? { ...step.ask, prompt: step.ask.prompt.replace(/[？?]\s*$/, '') } : undefined;
      return { ...step, changes, ...(ask ? { ask } : {}) };
    }),
  };
}

export function lesson(params: MulParams, compact = false): Lesson {
  try {
    const trace = adaptTrace(run(params));
    return { ok: true, trace, ...mulScene(trace, compact) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * 讲解用的四组数（n = 4）：先一道异号的补码，再只把 y 改成负数（算后求补直通），
 * 再把同一对数按原码乘（三个求补器都直通），最后是不带符号的阵列本身。
 */
export const EXAMPLES: { mode: MulMode; x: string; y: string }[] = [
  { mode: '补码', x: '-0101', y: '+0111' },
  { mode: '补码', x: '-0101', y: '-0111' },
  { mode: '原码', x: '-0101', y: '+0111' },
  { mode: '无符号', x: '1101', y: '1011' },
];

export const exampleParams = (i: number): MulParams => {
  const example = EXAMPLES[i] ?? EXAMPLES[0]!;
  return { mode: example.mode, n: 4, x: { as: '真值', text: example.x }, y: { as: '真值', text: example.y } };
};

export const MUL_QUESTION = '负数的补码能不能直接送进阵列，积的负号在哪一步加回去';
export const MUL_CONCLUSION =
  '阵列只会做无符号乘法，所以补码先经算前求补器取绝对值，乘完两数异号时再由算后求补器变回补码，符号位 p_2n = x_f ⊕ y_f 单独得出。';
export const MUL_NEEDS = [
  { href: '/2-codes', text: '补码怎么写' },
  { href: '/2-overflow', text: '全加器和进位' },
];
