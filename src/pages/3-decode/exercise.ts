/**
 * 练习：按种子出一道 ROM、RAM 地址译码题（引擎的 generate）。答题纸上填芯片总数、译码器、译码输入、
 * 每个 Y 的地址范围和去向，再查一个地址。答案都取自引擎的结果、解题表和查地址那一步的状态。
 */
import { design, generate, hex, run } from '../../engines/decode/model';
import type { Params } from '../../engines/decode/model';
import type { Field } from '../3-expand/grade';
import { polish } from './scene';

export interface DecodeRow {
  label: string;
  fields: Field[];
  hint: string;
  step: number;
}

export function makeExercise(seed: number): Params {
  return generate(seed);
}

export function exerciseTask(params: Params): string {
  const d = design(params);
  const regions = d.regions
    .map((r) => (params.regions[r.index]?.chip ? `${r.kind} ${hex(r.start, d.n)}–${hex(r.end, d.n)} 用 ${r.chip} 的芯片` : `已有一块 ROM 占 ${hex(r.start, d.n)}–${hex(r.end, d.n)}`))
    .join('，');
  const probe = params.probe === undefined ? '' : `最后说出地址 ${hex(params.probe, d.n)} 选中哪一组。`;
  return `CPU 有 16 根地址线、${params.dataBits} 根数据线，按字编址。${regions}。逐行填出芯片总数、译码器和它的输入，每个输出管的地址和接到哪里。${probe}`;
}

export function exerciseRows(params: Params): DecodeRow[] {
  const trace = polish(run(params));
  const d = design(params);
  const names = [...new Set(d.groups.map((g) => g.name))];
  const stepOf = (id: string | undefined) => Math.max(0, trace.steps.findIndex((step) => step.id === id) + 1);
  const firstStep = (test: (at: string) => boolean) => Math.max(0, trace.steps.findIndex((step) => step.changes.some((change) => test(change.at))) + 1);
  const rows: DecodeRow[] = [
    {
      label: '芯片总数',
      fields: [{ key: 'v', title: '芯片总数（ROM 算 1 块）', kind: 'num', expected: trace.result['芯片总数'] ?? '', show: trace.result['芯片总数'] ?? '', placeholder: '整数' }],
      hint: '每个 RAM 区：区域长度 ÷ 芯片字数 = 组数，字长 ÷ 芯片位数 = 每组片数，两者相乘。',
      step: firstStep((at) => /^regions\.\d+\.chips$/.test(at)),
    },
    {
      label: '译码器',
      fields: [{ key: 'v', title: '用哪个译码器', kind: 'choice', options: ['74138', '74139'], expected: d.decoder, show: d.decoder }],
      hint: '先定每组地址数（最大的芯片字数），去掉组内地址剩下几位要区分；不少于 3 位用 74138。',
      step: firstStep((at) => at === 'decoder.type'),
    },
    {
      label: '译码输入',
      fields: [{ key: 'v', title: '进译码器的地址线', kind: 'lines', expected: trace.result['译码输入'] ?? '', show: trace.result['译码输入'] ?? '', placeholder: '例如 A15–A13' }],
      hint: '紧挨着组内地址的那几位，高位接 C（74139 接 B）。',
      step: firstStep((at) => at === 'decoder.type'),
    },
  ];
  for (const row of trace.table.rows) {
    const [y = '', range = '', target = ''] = row.cells;
    const raw = y.replace('_', '');
    rows.push({
      label: y,
      fields: [
        { key: 'range', title: `${raw} 管的地址`, kind: 'range', expected: range, show: range, placeholder: '例如 0000H–1FFFH' },
        { key: 'to', title: '接到', kind: 'choice', options: [...names, '空'], expected: target, show: target },
      ],
      hint: '这一段的首地址 = 基址 + i × 每组地址数；看它落在地址空间的哪一段，没有芯片就空着。',
      step: stepOf(row.step),
    });
  }
  const probe = trace.steps[trace.steps.length - 1]?.state.probe;
  if (probe) {
    const step = trace.steps.length;
    rows.push({
      label: `${probe.address} 选中`,
      fields: [{ key: 'v', title: '选中哪一组', kind: 'choice', options: [...names, '没有芯片'], expected: probe.chip, show: probe.chip }],
      hint: '把地址写成二进制，看进译码器的那几位让哪个 Y 有效；小芯片还要看组内高位。',
      step,
    });
  }
  return rows;
}
