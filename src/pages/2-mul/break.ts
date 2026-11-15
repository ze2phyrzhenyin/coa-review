/**
 * 「弄坏它」：把三个求补器的 E 都接 0（等于拆掉），补码直接送进阵列，看乘出来的积错在哪；最后装回求补器。
 * 拆掉求补器的阵列就是引擎的原码模式（三个求补器都直通），所以每一步的状态都由引擎 run 给出，页面只排步骤。
 */
import { run } from '../../engines/mul/model';
import type { MulParams, MulState } from '../../engines/mul/model';
import { TraceBuilder } from '../../engines/trace';
import type { Step, Trace } from '../../engines/trace';
import { decode } from '../../lib/bits';
import type { Binding, Move } from '../../scene';
import type { Ask } from '../../engines/trace';
import type { Breakage } from '../../player/Player';
import { subScene, subTrace } from './code';
import { mulScene } from './scene';

export interface BreakState extends MulState {
  check: { left: string; right: string; result: string };
  /** 1：求补器的 E 都接 0。 */
  broken: string;
}

const N = 4;
export const CASES = [
  { x: '-0110', y: '+0101' },
  { x: '-0110', y: '-0101' },
];

const finalOf = (params: MulParams): MulState => {
  const trace = run(params);
  return trace.steps[trace.steps.length - 1]!.state;
};
const signed = (units: number) => String(units).replace('-', '−');

export function breakTrace(which: number): Trace<MulParams, BreakState> {
  const item = CASES[which] ?? CASES[0]!;
  const truthParams: MulParams = { mode: '补码', n: N, x: { as: '真值', text: item.x }, y: { as: '真值', text: item.y } };
  const truthTrace = run(truthParams);
  const truth = truthTrace.steps[truthTrace.steps.length - 1]!.state;
  // 同一对机器数按原码送进阵列：三个求补器的 E 都是 0，原样通过。
  const altParams: MulParams = { mode: '原码', n: N, x: { as: '机器数', bits: truth.x }, y: { as: '机器数', bits: truth.y } };
  const altTrace = run(altParams);
  const states = altTrace.steps.map((step) => step.state);
  const at = (pred: (step: Step<MulState>) => boolean) => states[altTrace.steps.findIndex(pred)]!;
  const fed = at((step) => step.changes.some((c) => c.at === 'pre.y.e'));
  const summed = at((step) => step.changes.some((c) => c.at === `rows.${N - 1}.${N - 2}.sum`));
  const alt = finalOf(altParams);
  const read = signed(decode('补码', alt.product));
  const want = truthTrace.result['十进制'] ?? '';
  const blank = { left: '', right: '', result: '' };
  const initial: BreakState = { ...altTrace.initial, check: blank, broken: '1' };
  const builder = new TraceBuilder<MulParams, BreakState>('mul-break', truthParams, initial, [
    { label: 'x', value: `${item.x.replace('-', '−')}，[x]补 = ${truth.x}` },
    { label: 'y', value: `${item.y.replace('-', '−')}，[y]补 = ${truth.y}` },
    { label: '改动', value: '三个求补器的 E 都接 0，补码原样进出阵列' },
  ]);
  // 只演到拼出积为止：十进制、乘法时间不写（拆掉求补器后按原码读出的十进制没有意义）。
  const put = (state: MulState, check = blank, broken = '1') => (draft: BreakState) => {
    Object.assign(draft, JSON.parse(JSON.stringify(state)) as MulState, { value: '', decimal: '', delay: '', path: [], check, broken });
  };
  builder.step({
    title: `E 都接 0：[x]补、[y]补 的数值位 ${fed.a}、${fed.b} 原样进阵列`,
    why: `求补器不动作。负数补码的数值位按无符号读是 2^${N} − |x|，阵列拿到的不是绝对值。`,
    ref: '教材 p47 图 2.9',
    update: put(fed),
  });
  builder.step({
    level: 'beat',
    title: `阵列照样相乘：和 ${[...summed.p].reverse().join('')}`,
    why: '阵列只认无符号数，给它什么就乘什么。',
    ref: '教材 p45 图 2.7',
    update: put(summed),
  });
  const same = read === want;
  builder.step({
    title: `拼上符号位：${alt.product}，按补码读是 ${read}`,
    why: same ? `碰巧等于 x·y = ${want}。` : `x·y 应为 ${want}。符号位 x_f ⊕ y_f 没有错，错在数值部分：阵列乘的不是绝对值，出来的也没有变回补码。`,
    ref: '教材 p47',
    ask: { prompt: `去掉求补器乘出的 ${alt.product}，按补码读等于 x·y 吗`, kind: 'choice', options: ['等于', '不等于'], answer: same ? '等于' : '不等于', hint: `按补码读出它的真值，再和 ${want} 比。` },
    update: put(alt, { left: read, right: want, result: same ? 'match' : 'mismatch' }),
  });
  builder.step({
    title: `装回求补器：|x| = ${truth.a}，|y| = ${truth.b}，积 ${truth.product} = ${want}`,
    why: truth.sign?.pf === '1' ? '算前求补器先取绝对值，两数异号，算后求补器再把积变回补码。' : '算前求补器先取绝对值；两数同号，算后求补器直通。',
    ref: '教材 p47–48',
    update: put(truth, { left: want, right: want, result: 'match' }, '0'),
  });
  return subTrace(builder.finish({ 结论: '补码不经求补器直接进阵列，积是错的' }, { columns: [], rows: [] }));
}

export function breakScene(trace: Trace<MulParams, BreakState>, compact: boolean) {
  const base = mulScene(trace as unknown as Trace<MulParams, MulState>, compact);
  const res = base.scene.parts.find((part) => part.id === 'res')!;
  const scene = {
    ...base.scene,
    parts: [
      ...base.scene.parts,
      { id: 'cmp', kind: 'compare' as const, position: [compact ? 0 : res.position[0] + 0.6, res.position[1] + (compact ? 3.5 : 1.9)] as const, props: { left: '−100', right: '−100', leftName: '按补码读', rightName: 'x·y', result: '' } },
    ],
  };
  const bind: Binding<BreakState> = {
    props: (context) => {
      const out = base.bind.props(context as never);
      const { check, broken } = context.state;
      out.cmp = { left: check.left, right: check.right, result: check.result, hidden: !check.result };
      if (broken === '1') {
        out['l-a'] = { text: '[x]补' };
        out['l-b'] = { text: '× [y]补' };
        for (const id of ['cx', 'cy', 'cp']) out[id] = { text: '求补器 E 接 0' };
        out['sw-0'] = { hidden: true };
        out['sw-1'] = { hidden: true };
      }
      return out;
    },
    partsFor: (path) => (path.startsWith('check') ? ['cmp'] : path === 'broken' ? ['cx', 'cy', 'cp'] : base.bind.partsFor(path)),
  };
  const moves = (step: Step<BreakState>): Move[] => {
    if (step.changes.some((c) => c.at === 'check.result')) return [{ value: step.state.product, from: `p-${N}`, to: 'res', arc: true }, { value: step.state.check.left, from: 'res', to: 'cmp', arc: true, phase: 1 }];
    return [];
  };
  const own: Record<string, string> = { 'check.left': '按补码读', 'check.right': 'x·y', 'check.result': '比较', broken: 'E 接 0' };
  const names = (path: string) => own[path] ?? base.names(path);
  const values = (path: string, value: string) => (path === 'check.result' ? (value === 'match' ? '相等' : value === 'mismatch' ? '不等' : value) : path === 'broken' ? (value === '1' ? '是' : '否') : base.values(path, value));
  // 答错：把学生的判断演出来。两个数真的放到比较牌上，靠拢或者弹开。
  const wrong = (_ask: Ask, value: string, _state: BreakState, next: Step<BreakState> | null): Breakage | null => {
    if (!next) return null;
    const { check, product } = next.state;
    const patch = { cmp: { left: check.left, right: check.right, result: check.result, hidden: false }, res: { value: product } };
    return {
      label: '',
      patch,
      moves: [{ value: product, from: `p-${N}`, to: 'res', arc: true }, { value: check.left, from: 'res', to: 'cmp', arc: true, phase: 1 }],
      message: value === '等于' ? `说它等于 x·y，就把两个数放到一起比：按补码读是 ${check.left}，x·y 是 ${check.right}，对不上，两张牌弹开。` : `把两个数放到一起比：按补码读是 ${check.left}，x·y 也是 ${check.right}，这一组碰巧相等。`,
    };
  };
  return subScene<BreakState, { scene: typeof scene; bind: typeof bind; names: typeof names; wrong: typeof wrong; moves: typeof moves; values: typeof values }>({ scene, bind, moves, names, values, wrong });
}
