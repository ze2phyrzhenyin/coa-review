/**
 * 练习：按种子出一道扩充题（引擎的 generate），答题纸上逐行填 芯片数、每组片数、组数、地址线、各组地址范围、查地址。
 * 答案都取自引擎的解题表和查地址那一步的状态。
 */
import { generate, hex, plan, run, sizeText } from '../../engines/expand/model';
import type { Params } from '../../engines/expand/model';
import type { Field } from './grade';
import { polish } from './scene';

export interface ExpandRow {
  label: string;
  fields: Field[];
  hint: string;
  /** 演示停在讲解的第几步（试一试里同一组参数）。 */
  step: number;
}

/** 台面放得下（至多 8 组、每组 4 片）的题。引擎的 generate 本来就在这个范围里。 */
export function makeExercise(seed: number): Params {
  return generate(seed);
}

const words = (w: number | string): string => (typeof w === 'number' ? sizeText(w) : w);

export function exerciseTask(params: Params): string {
  const address = params.probe === undefined ? '' : `，再说出地址 ${hex(params.probe, plan(params).n)} 选中哪一组、片内地址是多少`;
  return `用 ${words(params.chip.words)}×${params.chip.bits} 位的芯片组成 ${words(params.target.words)}×${params.target.bits} 位的存储器，按字编址。逐行填出芯片数、分组、地址线怎么接、每组的地址范围${address}。`;
}

export function exerciseRows(params: Params): ExpandRow[] {
  const trace = polish(run(params));
  const p = plan(params);
  const stepOf = (id: string | undefined) => Math.max(0, trace.steps.findIndex((step) => step.id === id) + 1);
  const rows: ExpandRow[] = [];
  for (const row of trace.table.rows) {
    const [label = '', , result = ''] = row.cells;
    const step = stepOf(row.step);
    const num = (hint: string, show: string): ExpandRow => ({ label, fields: [{ key: 'v', title: label, kind: 'num', expected: result, show, placeholder: '整数' }], hint, step });
    if (label === '芯片数 d') rows.push(num('d = (目标字数 × 目标位数) / (芯片字数 × 芯片位数)，两边都写成字数×位数，K = 2^10。', String(p.d)));
    else if (label === '每组片数') rows.push(num('每组片数 = 目标位数 ÷ 芯片位数。', String(p.perGroup)));
    else if (label === '组数') rows.push(num('组数 = 目标字数 ÷ 芯片字数。', String(p.groups)));
    else if (label === '片内地址线')
      rows.push({ label, fields: [{ key: 'v', title: '接每一片的地址线', kind: 'lines', expected: result, show: p.chipLines, placeholder: '例如 A9–A0' }], hint: '一片有 2^k 个字，就要从 A0 数起的 k 根地址线。', step });
    else if (label === '片选')
      rows.push({ label: '译码地址线', fields: [{ key: 'v', title: '进译码器的地址线', kind: 'lines', expected: result, show: p.decoderLines, placeholder: '例如 A11–A10' }], hint: '片内地址用剩下的高位进译码器，位数 = log_2 组数。', step });
    else if (/^第 \d+ 组$/.test(label)) {
      const g = Number(/\d+/.exec(label)?.[0]);
      const r = p.ranges[g];
      rows.push({
        label: `${label}范围`,
        fields: [{ key: 'v', title: '首地址–尾地址', kind: 'range', expected: result, show: r ? `${r.from}–${r.to}` : '', placeholder: '例如 0000H–03FFH' }],
        hint: `第 i 组从 i × 芯片字数开始，长度是芯片字数，写成十六进制，带 H。`,
        step,
      });
    }
  }
  const last = trace.steps[trace.steps.length - 1];
  const probe = last?.state.probe;
  if (probe && probe.group !== null) {
    const step = trace.steps.length;
    rows.push({
      label: '选中第几组',
      fields: [{ key: 'v', title: '组号', kind: 'num', expected: String(probe.group), show: String(probe.group), placeholder: '整数' }],
      hint: '把地址写成二进制，看进译码器的那几位高位。',
      step,
    });
    rows.push({
      label: '片内地址',
      fields: [{ key: 'v', title: '片内地址', kind: 'hex', expected: probe.inner, show: probe.inner, placeholder: '十六进制，例如 01A3H' }],
      hint: '去掉进译码器的高位，剩下的低位就是片内地址。',
      step,
    });
  }
  return rows;
}
