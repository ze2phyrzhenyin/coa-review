/**
 * 一组参数 → 引擎的 Trace 和场景；讲解的例题；练习加的题。答案都取自 Trace 的状态。
 */
import { generate, run } from '../../engines/fpadd/model';
import type { FpAddParams, FpAddState } from '../../engines/fpadd/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import { fpScene } from './scene';
import type { FpScene } from './scene';

export type Lesson = ({ ok: true; trace: Trace<FpAddParams, FpAddState> } & FpScene) | { ok: false; error: string };

export function lesson(params: FpAddParams, compact = false, practice = false): Lesson {
  try {
    const raw = tidy(run(params));
    const trace = practice ? withAsks(raw) : raw;
    return { ok: true, trace, ...fpScene(trace, compact) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 「变化」不列阶段名；补码写法的阶码只列码（真值写在牌上的括号里）。 */
export function tidy<P>(trace: Trace<P, FpAddState>): Trace<P, FpAddState> {
  return {
    ...trace,
    steps: trace.steps.map((step) => {
      const codes = new Set(step.changes.filter((c) => c.at.endsWith('.expCode') && c.to !== '').map((c) => c.at.replace('.expCode', '')));
      return { ...step, changes: step.changes.filter((c) => c.at !== 'stage' && c.at !== 'diffCode' && !(c.at.endsWith('.exp') && codes.has(c.at.replace('.exp', '')))) };
    }),
  };
}

const twos = (op: '加' | '减', x: [string, string], y: [string, string]): FpAddParams => ({ style: '补码', k: 3, m: 6, op, x: { exp: x[0], mant: x[1] }, y: { exp: y[0], mant: y[1] }, rounding: '0舍1入' });

/** 一道完整的加法；只把加改成减（多一次向右规格化）；一道要向左规格化的；最后换成例 2.30 的有效位写法。 */
export const EXAMPLES: { label: string; params: FpAddParams }[] = [
  { label: '阶差 2，相加', params: twos('加', ['10', '0.110101'], ['0', '-0.101101']) },
  { label: '同一组数，相减', params: twos('减', ['10', '0.110101'], ['0', '-0.101101']) },
  { label: '向左规格化', params: twos('加', ['1', '0.110101'], ['0', '-0.110011']) },
  { label: '有效位写法', params: { style: '有效位', digits: 4, op: '加', x: '0.875', y: '0.40625', rounding: '0舍1入' } },
];

const has = (step: Step<FpAddState>, path: string) => step.changes.some((change) => change.at === path);
const withOut = (mant: string, out: string) => (out ? `${mant}(${out})` : mant);

/** 练习：引擎的两道题之外，再问尾数相加的结果和溢出判断。 */
export function withAsks(trace: Trace<FpAddParams, FpAddState>): Trace<FpAddParams, FpAddState> {
  return {
    ...trace,
    steps: trace.steps.map((step): Step<FpAddState> => {
      if (step.ask) return step;
      const s = step.state;
      let ask: Ask | null = null;
      if (s.stage === '尾数加减' && has(step, 'sum.mant')) {
        ask = { prompt: '尾数相加的结果是什么（括号里的位照写）', kind: 'text', answer: withOut(s.sum.mant, s.sum.out).replace(/−/g, '-'), hint: '两条尾数对齐小数点，括号里的位一起加，最高符号位送出的进位丢掉。' };
      } else if (has(step, 'overflow')) {
        ask = { prompt: '结果有没有溢出', kind: 'choice', options: ['无溢出', '上溢', '下溢'], answer: s.overflow, hint: trace.params.style === '补码' ? '看阶码的两个符号位：01 上溢，10 下溢。' : '看指数在不在 −126 到 127 之间。' };
      }
      return ask ? { ...step, ask } : step;
    }),
  };
}

export const practiceParams = (seed: number): FpAddParams => generate(seed);
