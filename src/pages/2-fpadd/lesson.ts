/**
 * 一组参数 → 引擎的 Trace 和场景；讲解的例题；练习加的题。答案都取自 Trace 的状态。
 */
import { generate, run } from '../../engines/fpadd/model';
import type { FpAddParams, FpAddState } from '../../engines/fpadd/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import { subTrace } from '../2-codes/sub';
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
export function tidy<P>(raw: Trace<P, FpAddState>): Trace<P, FpAddState> {
  // 带正号、负号的指数加括号，播放器才排成上标；负的尾数加括号。
  const neat = (text: string) => text.replace(/2\^([+−-])(\d+)/g, (_m, sign: string, digits: string) => `2^(${sign === '-' ? '−' : sign}${digits})`).replace(/× -([\d.]+)/g, '× (−$1)');
  const base = subTrace(raw, neat);
  // 条件里的 x、y 照解题表的写法（阶码补足位数）。
  const said = (who: string) => base.table.rows.find((row) => row.cells[3]?.startsWith(`${who} = `))?.cells[3]?.slice(who.length + 3);
  const trace = { ...base, conditions: base.conditions.map((c) => (c.label === 'x' || c.label === 'y' ? { ...c, value: said(c.label) ?? c.value } : c)) };
  return {
    ...trace,
    steps: trace.steps.map((step, i) => {
      // 「哪个数右移」这道题出在求阶差之前：题面只给两个阶码，不提还没讲的 ΔE。
      if (step.ask?.options?.includes('都不移')) {
        const before = i > 0 ? trace.steps[i - 1]!.state : trace.initial;
        const show = (e: string) => e.replace('-', '−');
        step = { ...step, ask: { ...step.ask, prompt: `x 的阶码是 ${show(before.x.exp)}，y 的阶码是 ${show(before.y.exp)}。对阶时哪个数的尾数要右移` } };
      }
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
