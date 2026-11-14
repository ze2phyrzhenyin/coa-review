/**
 * 把引擎的 Trace 交给播放器之前做的一处改动：预测两个符号位的题（bits）改成点选场景里的四个候选。
 * 答案、提示原样保留，只换作答方式。题面末尾的问号去掉，播放器会在后面接「点场景里的部件作答」。
 */
import type { Trace } from '../../engines/trace';

export const SIGN_OPTIONS = ['00', '01', '10', '11'] as const;

export function adaptTrace<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return {
    ...trace,
    steps: trace.steps.map((step) => {
      const ask = step.ask;
      if (!ask) return step;
      const prompt = ask.prompt.replace(/[？?]\s*$/, '');
      if (ask.kind === 'bits' && ask.answer.length === 2) return { ...step, ask: { ...ask, kind: 'choice', options: [...SIGN_OPTIONS], prompt } };
      if (ask.kind === 'choice') return { ...step, ask: { ...ask, prompt } };
      return step;
    }),
  };
}

/** 出符号位预测题的那一屏（第 n 屏出 steps[n] 的题）。没有时返回 -1。 */
export function signAskIndex<P, S>(trace: Trace<P, S>): number {
  return trace.steps.findIndex((step) => (step.ask?.kind === 'choice' && step.ask.options?.includes('01') === true) || step.ask?.kind === 'bits');
}
