/**
 * 「弄坏它」：同一个数 6.625 存三次。第一次照规矩；第二次阶码按偏移 128 存（例 2.10 的格式），机器按 IEEE 754 读；
 * 第三次把 1.M 的 1 也塞进尾数。每一次「读回来」都交给引擎按单精度解码，场景只把解出来的状态摆出来。
 */
import { run } from '../../engines/ieee/model';
import type { IeeeParams, IeeeState } from '../../engines/ieee/model';
import { TraceBuilder } from '../../engines/trace';
import type { Ask, Trace } from '../../engines/trace';
import type { Breakage } from '../../player/Player';
import { onRuler } from './scene';

const X = '6.625';
const finalOf = (params: IeeeParams): IeeeState => {
  const trace = run(params);
  return trace.steps[trace.steps.length - 1]!.state;
};

export function breakTrace(): Trace<IeeeParams, IeeeState> {
  const right = finalOf({ format: '单精度', direction: '十进制→机器数', text: X });
  const stored128 = run({ format: '偏移128', direction: '十进制→机器数', text: X }).result['十六进制'] ?? '';
  const read128 = finalOf({ format: '单精度', direction: '机器数→十进制', text: stored128 });
  const crammed = right.sign + right.exponent + `1${right.mantissa}`.slice(0, right.mantissa.length);
  const readCrammed = finalOf({ format: '单精度', direction: '机器数→十进制', text: crammed });
  const at = (state: IeeeState) => onRuler(state.normal, false)?.binade ?? 0;
  const moved = at(read128) - at(right);
  const params: IeeeParams = { format: '单精度', direction: '机器数→十进制', text: right.hex };
  const builder = new TraceBuilder<IeeeParams, IeeeState>('ieee-break', params, { ...right, decimal: X, kind: '' }, [
    { label: '数', value: `x = ${X}` },
    { label: '读的规矩', value: 'IEEE 754 单精度：x = (−1)^S × 1.M × 2^(E − 127)' },
  ]);
  builder.step({
    title: `照规矩存：${right.hex}，读回来还是 ${right.decimal}`,
    why: `E = e + 127 = ${right.E}，尾数只存 1.M 小数点后面的 ${right.mantissa.length} 位。`,
    ref: '教材 p28',
    update: (s) => Object.assign(s, right),
  });
  const ask: Ask = {
    prompt: `改用 E = e + 128 存成 ${stored128}，机器仍按 E − 127 读。指针会往哪边挪`,
    kind: 'choice',
    options: ['往右一段', '往左一段', '不动'],
    answer: moved > 0 ? '往右一段' : moved < 0 ? '往左一段' : '不动',
    hint: '阶码多了 1，读出来的 e 也多 1，看 2^e 变成几倍。',
  };
  builder.step({
    title: `阶码按 128 存：读回来是 ${read128.decimal}`,
    why: `存的 E 比规矩多 1，按 E − 127 读出 e = ${read128.e}，比原来大 1，数变成 2 倍。偏移 128 的格式（例 2.10）只能用它自己的规矩读。`,
    ref: '教材 p28、p30 例2.10',
    ask,
    update: (s) => Object.assign(s, read128),
  });
  builder.step({
    title: `1 也塞进尾数：读回来是 ${readCrammed.decimal}`,
    why: `尾数只有 ${right.mantissa.length} 位，塞进 1 以后整段右移，最后一位被挤掉。机器读的时候照样在前面补 1，读成 1.1…，数变大了。`,
    ref: '教材 p28',
    update: (s) => Object.assign(s, readCrammed, { rounded: right.mantissa.slice(-1) || '0' }),
  });
  builder.step({
    title: '两处都改回规矩：E = e + 127，1 不存',
    why: '存和读必须用同一个偏移量；隐藏的 1 存的时候拿掉、读的时候补上。',
    ref: '教材 p28',
    update: (s) => Object.assign(s, right, { rounded: '' }),
  });
  return builder.finish(
    { 结论: '偏移量用 127，隐藏位不存' },
    {
      columns: ['存法', '机器码', '读回来'],
      rows: [
        { cells: ['照规矩', right.hex, right.decimal], step: 's1' },
        { cells: ['E = e + 128', stored128, read128.decimal], step: 's2' },
        { cells: ['1 塞进尾数', readCrammed.hex, readCrammed.decimal], step: 's3' },
      ],
    },
  );
}

/** 选错时按学生说的方向挪指针给他看。 */
export function breakWrong(_ask: Ask, value: string): Breakage | null {
  const d = value === '往左一段' ? -1 : value === '往右一段' ? 1 : 0;
  return {
    label: '',
    patch: { ruler: { shift: d, pin: d === 0 ? '不动？' : d < 0 ? '÷ 2？' : '× 2？' } },
    moves: [{ value: 'E', from: 'Edec', to: 'ruler', arc: true }],
    message: d < 0 ? '往左一段是数变成一半，那要 e 少 1。这里存进去的 E 多了 1。' : 'E 变了，按 E − 127 读出的 e 就跟着变，指针不会留在原来那一段。',
  };
}
