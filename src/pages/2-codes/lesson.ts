/**
 * 一组参数 → 引擎的 Trace 和场景。参数不合格时给出引擎的报错原文。
 * 交给播放器之前只整理「变化」一栏（同一个码的 bits、text、status 只留一条）和练习的题目；答案都取自 Trace 的状态。
 */
import { generate, run } from '../../engines/codes/model';
import type { CodesParams, CodesState } from '../../engines/codes/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import { codeOf, codesScene, tag } from './scene';
import type { CodesScene } from './scene';

export type Lesson = ({ ok: true; trace: Trace<CodesParams, CodesState> } & CodesScene) | { ok: false; error: string };

/** 「变化」只留学生关心的：每种码的位串（写不下时留「写不下」）和 0 的另一种写法。 */
export function tidy(trace: Trace<CodesParams, CodesState>): Trace<CodesParams, CodesState> {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      changes: step.changes.filter((change) => {
        if (/\.(text|why)$/.test(change.at)) return false;
        if (/\.status$/.test(change.at)) return change.to === '无';
        return true;
      }),
    })),
  };
}

export function lesson(params: CodesParams, compact = false, practice = false): Lesson {
  try {
    const raw = tidy(run(params));
    const trace = practice ? withAsks(raw) : raw;
    return { ok: true, trace, ...codesScene(trace, compact) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 讲解的四组数：一个普通负数；−128（标题里那个）；0；一个定点小数。 */
export const EXAMPLES: { label: string; params: CodesParams }[] = [
  { label: 'x = −13，n = 4', params: { n: 4, notation: '整数', input: { as: '十进制', text: '-13' } } },
  { label: 'x = −128，n = 7', params: { n: 7, notation: '整数', input: { as: '十进制', text: '-128' } } },
  { label: 'x = 0，n = 4', params: { n: 4, notation: '整数', input: { as: '十进制', text: '0' } } },
  { label: 'x = −0.6875，n = 4', params: { n: 4, notation: '小数', input: { as: '十进制', text: '-0.6875' } } },
];

const HINTS: Record<string, string> = {
  原码: '符号位写正负（0 正 1 负），后面照抄 |x| 的数值位。',
  反码: '正数与原码相同；负数原码的符号位不动，数值位逐位取反。',
  补码: '正数与原码相同；负数在反码的最低位加 1。',
  移码: '把补码的符号位取反。',
};

/**
 * 练习：每一种码都由学生写。引擎原有的题保留；其余的码在写出它的那一步前加一道题，
 * 写得出的翻位片，写不出的选「写不出」。答案取自那一步之后的状态。
 */
export function withAsks(trace: Trace<CodesParams, CodesState>): Trace<CodesParams, CodesState> {
  return {
    ...trace,
    steps: trace.steps.map((step, i): Step<CodesState> => {
      if (step.ask) return step;
      const code = codeOf(step);
      if (!code) {
        if (i === 0 && trace.params.input.as === '机器数') {
          const ask: Ask = { prompt: `${trace.conditions.find((c) => c.label === '输入')?.value ?? ''}，x 的十进制值是多少`, kind: 'number', answer: step.state.value.decimal.replace('−', '-'), hint: '先看是哪一种码，再按这种码的规则读出符号和大小。' };
          return { ...step, ask };
        }
        return step;
      }
      const cell = step.state.codes[code];
      if (cell.status === '无') {
        return { ...step, ask: { prompt: `${tag(code)} 写得出吗`, kind: 'choice', options: ['写得出', '写不出'], answer: '写不出', hint: `看条件里${code}的范围。` } };
      }
      const zero = cell.zero ? '（写符号位为 0 的那一种）' : '';
      return { ...step, ask: { prompt: `写出 ${tag(code)}${zero}`, kind: 'bits', answer: cell.bits, hint: HINTS[code] ?? '' } };
    }),
  };
}

export const practiceParams = (seed: number): CodesParams => generate(seed);
