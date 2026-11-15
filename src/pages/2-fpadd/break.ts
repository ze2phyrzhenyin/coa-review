/**
 * 「弄坏它」：对阶故意反着来，让阶码大的 x 去对 y。x 的尾数左移，最高的几位挤出去；再相加，结果差得远。
 * 然后照规矩做一遍（引擎算的每一步）。反着来的那两步只是把位串整体左移、照常相加（位串库 rippleAdd），
 * 不当作标准答案；标准答案取自引擎。
 */
import { run } from '../../engines/fpadd/model';
import type { FpAddParams, FpAddState } from '../../engines/fpadd/model';
import { TraceBuilder } from '../../engines/trace';
import type { Trace } from '../../engines/trace';
import { rippleAdd } from '../../lib/bits';

export const BREAK_PARAMS: FpAddParams = { style: '补码', k: 3, m: 6, op: '加', x: { exp: '11', mant: '0.110101' }, y: { exp: '0', mant: '0.101101' }, rounding: '0舍1入' };

export function breakTrace(): Trace<FpAddParams, FpAddState> {
  const right = run(BREAK_PARAMS);
  const states = right.steps.map((step) => step.state);
  const start = states[0]!;
  const d = Math.abs(Number((states.find((s) => s.diff)?.diff ?? '0').replace('−', '-')));
  // 符号位不动，只把数值位整体左移：最高的 d 个数值位挤出去。
  const [signs = '', value = ''] = start.x.mant.split('.');
  const movedValue = value.slice(d) + '0'.repeat(d);
  const lost = value.slice(0, d);
  const xBad = `${signs}.${movedValue}`;
  const sum = rippleAdd(signs + movedValue, start.y.mant.replace('.', '')).sum;
  const sumBad = `${sum.slice(0, 2)}.${sum.slice(2)}`;
  const builder = new TraceBuilder<FpAddParams, FpAddState>('fpadd-break', BREAK_PARAMS, right.initial, right.conditions);
  builder.step({ title: right.steps[0]!.title, why: right.steps[0]!.why, ref: right.steps[0]!.ref ?? '', update: (s) => void Object.assign(s, start) });
  builder.step({
    title: `反着来：x 的阶码大，让 x 去对 y，尾数左移 ${d} 位`,
    why: `阶码减 ${d}，尾数就得左移 ${d} 位才能保持数值。可尾数只有这么几位，最高的 ${lost} 挤出了左头，回不来了。`,
    ref: '教材 p63',
    update: (s) => {
      s.stage = '对阶';
      s.x.mant = xBad;
      s.x.exp = start.y.exp;
      s.x.expCode = start.y.expCode;
      s.diff = right.steps.find((step) => step.state.diff)?.state.diff ?? '';
      s.shift = 'x';
    },
  });
  builder.step({
    title: `照样相加得 ${sumBad}`,
    why: `丢掉的是 x 最大的那几位，和差了好几倍。右边按规矩算出来是 ${right.result['结果'] ?? ''}。`,
    ref: '教材 p63–64',
    update: (s) => {
      s.stage = '尾数加减';
      s.sum = { exp: start.y.exp, expCode: start.y.expCode, mant: sumBad, out: '' };
    },
  });
  right.steps.slice(1).forEach((step, i) => {
    builder.step({
      title: i === 0 ? `照规矩重来：${step.title}` : step.title,
      why: step.why,
      ...(step.ref ? { ref: step.ref } : {}),
      update: (s) => Object.assign(s, step.state),
    });
  });
  return builder.finish(right.result, right.table);
}
