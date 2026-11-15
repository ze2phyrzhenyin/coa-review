/**
 * 一组参数 → 引擎的 Trace 和场景；讲解的例题；练习加的题。答案都取自 Trace 的状态。
 */
import { generate, layoutOf, run } from '../../engines/ieee/model';
import type { IeeeParams, IeeeState } from '../../engines/ieee/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import { BitsError } from '../../lib/bits';
import { subTrace } from '../2-codes/sub';
import { ieeeScene } from './scene';
import type { IeeeScene } from './scene';

export type Lesson = ({ ok: true; trace: Trace<IeeeParams, IeeeState> } & IeeeScene) | { ok: false; error: string };

export function lesson(params: IeeeParams, compact = false, practice = false): Lesson {
  try {
    const raw = tidy(run(params));
    const trace = practice ? withAsks(raw) : raw;
    return { ok: true, trace, ...ieeeScene(trace, compact) };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, error: error.message };
    throw error;
  }
}

/** 很长的十进制小数只留前 12 位；0.M、1.M 后面的二进制小数标上进制；负指数用 −。 */
export const neat = (text: string): string =>
  text
    .replace(/(\d\.\d{12})\d{9,}/g, '$1…')
    .replace(/(\.M = )([01]\.[01]+…?)/g, '$1($2)₂')
    .replace(/(?<![\d.(])([01]\.[01]+)( × 2\^[−-]?\d+)(?![\d.])/g, '($1)₂$2');

export function tidy(raw: Trace<IeeeParams, IeeeState>): Trace<IeeeParams, IeeeState> {
  const trace = subTrace(raw, neat);
  return {
    ...trace,
    table: { ...trace.table, rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map((cell, i) => (i > 0 ? cell.replace(/^-/, '−') : cell)) })) },
  };
}

/** 先讲一道完整的，再只改一个条件（偏移量），再反过来读，最后是舍入和非规格化数。 */
export const EXAMPLES: { label: string; params: IeeeParams }[] = [
  { label: '−6.625 写成单精度', params: { format: '单精度', direction: '十进制→机器数', text: '-6.625' } },
  { label: '−6.625 写成偏移 128', params: { format: '偏移128', direction: '十进制→机器数', text: '-6.625' } },
  { label: 'C1340000H 读出来', params: { format: '单精度', direction: '机器数→十进制', text: 'C1340000H' } },
  { label: '0.1 写成单精度', params: { format: '单精度', direction: '十进制→机器数', text: '0.1' } },
  { label: '00400000H 读出来', params: { format: '单精度', direction: '机器数→十进制', text: '00400000H' } },
];

const changed = (step: Step<IeeeState>, path: string) => step.changes.some((change) => change.at === path);
const ascii = (text: string) => text.replace(/−/g, '-');

/**
 * 练习：引擎原有的题保留；十进制→机器数再问符号位、尾数、十六进制，机器数→十进制再问指数和十进制值。
 */
export function withAsks(trace: Trace<IeeeParams, IeeeState>): Trace<IeeeParams, IeeeState> {
  const L = layoutOf(trace.params.format);
  const mant = L.teach ? L.m : L.mantBits;
  const encode = trace.params.direction === '十进制→机器数';
  return {
    ...trace,
    steps: trace.steps.map((step): Step<IeeeState> => {
      if (step.ask) return step;
      const s = step.state;
      let ask: Ask | null = null;
      if (encode) {
        if (changed(step, 'sign')) ask = { prompt: '符号位 S 是什么', kind: 'bits', answer: s.sign, hint: 'S = 0 表示正，S = 1 表示负。' };
        else if (changed(step, 'mantissa')) ask = { prompt: `尾数 M 的 ${mant} 位是什么`, kind: 'bits', answer: s.mantissa, hint: L.teach ? '尾数写成纯小数，小数点后的位依次放进尾数域，不够的在右边补 0。' : '去掉小数点前的 1，小数点后的位依次放进去，不够的在右边补 0。' };
        else if (changed(step, 'hex') && s.hex) ask = { prompt: '整个机器码写成十六进制（带 H）', kind: 'text', answer: s.hex, hint: '从左起 4 位一组，每组换成一位十六进制。' };
      } else {
        if (changed(step, 'e') && s.e && !changed(step, 'kind')) ask = { prompt: '指数 e 是多少', kind: 'number', answer: ascii(s.e), hint: L.teach ? '按阶码的码制读出它的真值。' : '规格化数 e = E − 偏移量；非规格化数 e = 1 − 偏移量。' };
        else if (changed(step, 'decimal') && /^[−-]?\d+(\.\d{1,10})?$/.test(s.decimal)) ask = { prompt: 'x 的十进制值是多少', kind: 'number', answer: ascii(s.decimal), hint: '1.M 的小数点按 e 移，再按位权换成十进制，别忘了符号。' };
      }
      return ask ? { ...step, ask } : step;
    }),
  };
}

export const practiceParams = (seed: number): IeeeParams => generate(seed);
