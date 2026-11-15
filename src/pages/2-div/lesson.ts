/** 一组参数 → 引擎的 Trace 和场景。参数不合格时给出引擎的报错原文。 */
import { run } from '../../engines/div/model';
import type { DivParams, DivState } from '../../engines/div/model';
import type { Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import type { Notation } from '../../lib/bits';
import { subScene, subTrace } from '../2-mul/code';
import { divScene } from './scene';
import type { DivScene } from './scene';

export type Lesson = ({ ok: true; trace: Trace<DivParams, DivState> } & DivScene<DivState>) | { ok: false; error: string };

/** 题面末尾的问号去掉：题目下面另有一行作答说明。 */
export function adaptTrace<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return {
    ...trace,
    steps: trace.steps.map((step) => (step.ask ? { ...step, ask: { ...step.ask, prompt: step.ask.prompt.replace(/[？?]\s*$/, '') } } : step)),
  };
}

export function lesson(params: DivParams, compact = false): Lesson {
  try {
    const trace = subTrace(adaptTrace(run(params)));
    return { ok: true, trace, ...subScene<DivState, DivScene<DivState>>(divScene(trace, compact)) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * 讲解用的三组数：先一道要纠余的（中间有余数为负的轮次）；再只把 y 换掉，最后一位商是 1，不用纠余；
 * 最后一道整数题，先乘比例因子化成小数，被除数为负，余数带负号。
 */
export const EXAMPLES: { x: string; y: string; n: number; notation: Notation }[] = [
  { x: '+0.10011', y: '-0.10101', n: 5, notation: '小数' },
  { x: '+0.10011', y: '-0.11010', n: 5, notation: '小数' },
  { x: '-1011', y: '+1101', n: 4, notation: '整数' },
];

export const exampleParams = (i: number): DivParams => {
  const example = EXAMPLES[i] ?? EXAMPLES[0]!;
  return { n: example.n, notation: example.notation, x: { as: '真值', text: example.x }, y: { as: '真值', text: example.y } };
};

export const DIV_QUESTION = { text: '余数为负时为什么不先加回 y，而是左移以后直接加 y', at: ['wsub', 'wadd', 'bal'] };
/** 窄屏上天平在竖式下面，和两块砝码装不进同一屏：第 0 步只标砝码。 */
export const DIV_QUESTION_NARROW = { ...DIV_QUESTION, at: ['wsub', 'wadd'] };
export const DIV_CONCLUSION = '余数为负时，恢复后再左移减 y 等于 2(r + |y|) − |y| = 2r + |y|，所以直接左移加 y；只有最后一位商是 0 时才加 y 纠余一次。';
export const DIV_NEEDS = [
  { href: '/2-codes', text: '原码和补码' },
  { href: '/2-overflow', text: '补码加法' },
];
