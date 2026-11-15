/**
 * 「弄坏它」：被除数不比除数小（|x| ≥ |y|）时硬做定点小数除法。引擎不收这种数，这里用位串库的
 * rippleAdd 只演第 0 轮：|x| 加 [−|y|]补 得到的和不是负数，q_0 = 1，商的整数位放不下，崩掉。
 * 第 0 轮的做法和引擎一样（加 [−|y|]补，看符号位），所以和、进位都由同一个加法器给出。
 */
import { TraceBuilder } from '../../engines/trace';
import type { Step, Trace } from '../../engines/trace';
import type { DivParams, DivState } from '../../engines/div/model';
import { fromUnsigned, rippleAdd, toUnsigned } from '../../lib/bits';
import type { Move } from '../../scene';
import type { Breakage } from '../../player/Player';
import { subTrace } from '../2-mul/code';

const N = 5;
export const CASES = [
  { x: '0.11010', y: '0.10011' },
  { x: '0.10101', y: '0.10101' },
];

export interface BreakState extends DivState {
  overflow: string;
}

const show = (bits: string) => `${bits.charAt(0)}.${bits.slice(1)}`;

export function breakTrace(which: number): Trace<DivParams, BreakState> {
  const item = CASES[which] ?? CASES[0]!;
  const absX = item.x.replace('.', '');
  const absY = item.y.replace('.', '');
  const negY = fromUnsigned(2 ** (N + 1) - toUnsigned(absY), N + 1);
  const added = rippleAdd(absX, negY);
  const q0 = added.sum.charAt(0) === '0' ? '1' : '0';
  const params: DivParams = { n: N, notation: '小数', x: { as: '真值', text: `+${item.x}` }, y: { as: '真值', text: `+${item.y}` } };
  const blankRound = () => ({ op: '' as const, p: '' as const, left: '', addend: '', sum: '', carry: '' as const, q: '' as const });
  const initial: BreakState = {
    x: '',
    y: '',
    sign: { xf: '', yf: '', qf: '' },
    absX: '',
    absY: '',
    negY: '',
    r: '',
    q: Array.from({ length: N + 1 }, () => '' as const),
    next: '',
    rounds: Array.from({ length: N + 1 }, blankRound),
    correction: { needed: '', sum: '' },
    quotient: '',
    quotientValue: '',
    remainder: '',
    check: '',
    overflow: '',
  };
  const builder = new TraceBuilder<DivParams, BreakState>('div-break', params, initial, [
    { label: 'x', value: `+${item.x}` },
    { label: 'y', value: `+${item.y}` },
    { label: '改动', value: '不检查 |x| < |y|，照样开始除' },
  ]);
  builder.step({
    title: `写出 [|x|]原 = ${item.x}，[|y|]原 = ${item.y}，[−|y|]补 = ${show(negY)}`,
    why: `|x| ${absX === absY ? '等于' : '大于'} |y|，商不小于 1。定点小数的商只有小数位，这一步之前本该先查 |x| < |y|。`,
    ref: '教材 p49',
    update: (d) => {
      d.x = `0.${absX.slice(1)}`;
      d.y = `0.${absY.slice(1)}`;
      d.sign = { xf: '0', yf: '0', qf: '0' };
      d.absX = show(absX);
      d.absY = show(absY);
      d.negY = show(negY);
      d.r = show(absX);
      d.next = '减 y';
    },
  });
  builder.step({
    level: 'beat',
    title: `第 0 轮减 y：${show(absX)} + ${show(negY)} = ${show(added.sum)}，符号位向外的进位 ${added.carryOut}`,
    why: '和的符号位是 0：够减。天平往余数一边沉。',
    ref: '教材 p50',
    ask: { prompt: `第 0 轮的和是 ${show(added.sum)}。q_0 是几`, kind: 'choice', options: ['0', '1'], answer: q0, hint: '和 ≥ 0 上商 1，和 < 0 上商 0。' },
    update: (d) => {
      const r = d.rounds[0]!;
      r.op = '减 y';
      r.p = '1';
      r.left = show(absX);
      r.addend = show(negY);
      r.sum = show(added.sum);
      r.carry = added.carryOut;
      d.r = show(added.sum);
      d.next = '';
    },
  });
  builder.step({
    title: `上商 q_0 = ${q0}：商的整数位是 1，放不下`,
    why: '定点小数的商是 q_0.q_1…q_n，q_0 这一位只能是 0。q_0 = 1 说明商 ≥ 1，再往下算也只是错数。所以做原码小数除法之前要保证 |x| < |y|，整数题先乘比例因子也是为了这个。',
    ref: '教材 p49',
    update: (d) => {
      d.q[0] = q0 as '1';
      d.rounds[0]!.q = q0 as '1';
      d.overflow = '1';
    },
  });
  return subTrace(builder.finish({ 结论: '|x| ≥ |y| 时商的整数位是 1，定点小数放不下' }, { columns: [], rows: [] }));
}

export const breakMoves = (step: Step<BreakState>): Move[] => {
  if (step.changes.some((c) => c.at === 'overflow')) return [{ value: step.state.q[0] ?? '', from: 'cout', to: 'q-0', arc: true }];
  if (step.changes.some((c) => c.at === 'rounds.0.sum')) {
    const bits = step.state.rounds[0]!.addend.replace('.', '');
    return Array.from({ length: N + 1 }, (_, c) => ({ value: bits.charAt(c), from: 'wsub', to: `ad-${c}` }));
  }
  return [];
};

/** 答错：学生说的商位先落进 q_0，再对着和的符号位看。 */
export const breakWrong = (_ask: unknown, value: string, state: BreakState): Breakage | null => {
  const round = state.rounds[0];
  if (!round || !round.sum || !/^[01]$/.test(value)) return null;
  return {
    label: '',
    patch: { 'q-0': { bits: value }, verdict: { text: `上商 ${value}？和的符号位是 ${round.sum.charAt(0)}`, hidden: false } },
    moves: [{ value, from: 'cout', to: 'q-0', arc: true }],
    message:
      value === '0'
        ? `上商 0 是说不够减。可这一轮的和 ${round.sum} 符号位是 0，符号位向外的进位是 ${round.carry}，天平往余数一边沉：够减，q_0 是 1。`
        : `上商 1 是说够减。这一轮的和 ${round.sum} 符号位是 0，够减，q_0 确实是 1。`,
  };
};
