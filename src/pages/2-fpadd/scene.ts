/**
 * 浮点加减的场景：x、y、和三条尾数滑轨上下排开，左边是各自的阶码；滑轨右头的小盒子接住移出去的位。
 * 对阶时阶码小的那条滑轨整排右移，规格化时和的那条左移或右移。旁边有阶差、0 操作数检查、溢出、结果几块牌，
 * 「哪个数右移」「往哪边规格化」两道题点场景里的部件作答。数都取自引擎的 Trace。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import type { FpAddParams, FpAddState } from '../../engines/fpadd/model';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export interface FpScene {
  scene: SceneSpec;
  bind: Binding<FpAddState>;
  moves: (step: Step<FpAddState>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  wrong: (ask: Ask, value: string, state: FpAddState, next: Step<FpAddState> | null) => Breakage | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<FpAddState>) => string[] | null;
  mistakes: Mistake<FpAddState>[];
  convention: (step: Step<FpAddState>) => string | null;
  question: { text: string; at: string[] };
}

export const FP_CONCLUSION =
  '对阶是小阶向大阶看齐：阶码小的那个数，尾数右移、阶码加 1，移出去的位先留着，到舍入时再处理；大阶的数左移会把最高位丢掉。规格化看结果：补码尾数两个符号位是 01 或 10 就向右规格化一位、阶码加 1，00.0 或 11.1 开头就向左规格化、每移一位阶码减 1。';

const MINUS = '−';
const plainText = (text: string) => text.replace(/-/g, MINUS);

/** 一个状态里三条尾数最多有几位整数、几位小数、移出去最多几位。整个 Trace 共用一套格子。 */
function sizesOf(trace: Trace<FpAddParams, FpAddState>, compact: boolean): { int: number; frac: number; box: number } {
  let frac = 1;
  let box = 2;
  for (const step of trace.steps) {
    for (const key of ['x', 'y', 'sum'] as const) {
      const part = step.state[key];
      const fp = part.mant.split('.')[1] ?? '';
      frac = Math.max(frac, fp.length);
      box = Math.max(box, part.out.length);
    }
  }
  return { int: 2, frac, box: Math.min(box, compact ? 7 : 6) };
}

export function fpScene(trace: Trace<FpAddParams, FpAddState>, compact = false): FpScene {
  const twos = trace.params.style === '补码';
  const subtract = trace.params.op === '减';
  const { int, frac, box } = sizesOf(trace, compact);
  const W = compact;
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<FpAddState>>[0] = {};
  const rowZ = { x: 0, y: W ? 3.6 : 1.7, sum: W ? 7.2 : 3.9 };
  const expX = W ? -1.4 : -6.4;
  const trackX = W ? 0 : 0.9;
  const trackDz = W ? 1.6 : 0;
  const expName = twos ? '阶码' : '指数';
  const title: Record<string, string> = { x: 'x', y: subtract ? 'y（变符号后）' : 'y', sum: '和' };
  for (const key of ['x', 'y', 'sum'] as const) {
    const z = rowZ[key];
    parts.push({ id: `e${key}`, kind: 'register', position: [expX, z], props: { name: key === 'sum' ? `和的${expName}` : `${key} 的${expName}`, value: '', width: W ? 3.3 : 2.6 }, title: `${title[key]}的${expName}` });
    table[`e${key}`] = {
      value: from([`${key}.exp`, `${key}.expCode`], (c) => {
        const part = c.state[key];
        if (!part.exp) return '';
        return twos ? `${part.expCode}（${part.exp}）` : `2^${part.exp.replace('-', MINUS)}`;
      }),
    };
    parts.push({
      id: `m${key}`,
      kind: '2-fpadd:track',
      position: [trackX, z + trackDz],
      props: { name: key === 'sum' ? '和' : key, mant: '', out: '', int, frac, box, compact: W },
      pick: key !== 'sum',
      title: key === 'sum' ? '和的尾数' : `${key} 的尾数`,
      describe: (p) => `${key === 'sum' ? '和' : key} 的尾数 ${String(p.mant || '空')}${p.out ? `（移出 ${String(p.out)}）` : ''}`,
    });
    table[`m${key}`] = { mant: `${key}.mant`, out: `${key}.out` };
  }
  // 和上面一道横线和加号，像竖式。
  if (!W) parts.push({ id: 'plus', kind: 'label', position: [trackX - (W ? 3.6 : 4.1), rowZ.sum - (W ? 0.35 : 0.95) + trackDz], props: { text: '+', size: 0.5, weight: 600 } });

  // 规格化的三个方向贴在和的滑轨下面；再下面是 0 检查、阶差、溢出、都不移几块牌。
  const zNorm = rowZ.sum + trackDz + (W ? 2.0 : 1.8);
  const dirs: [string, string][] = [
    ['norm-l', '向左规格化'],
    ['norm-n', '不用规格化'],
    ['norm-r', '向右规格化'],
  ];
  dirs.forEach(([id, name], i) => {
    const w = W ? 3.1 : 2.9;
    // 窄屏：左、右规格化并排，「不用规格化」在下一行左边，右边接「都不移」。
    const at: [number, number] = W ? [id === 'norm-r' ? 1.65 : -1.65, zNorm + (id === 'norm-n' ? 1.45 : 0)] : [(i - 1) * (w + 0.2) + trackX - 0.4, zNorm];
    parts.push({ id, kind: 'register', position: at, props: { name, value: '', width: w }, pick: true, title: name });
    table[id] = { value: from('norm', (c) => (c.state.norm === name ? '是' : '')) };
  });
  const zBoards = zNorm + (W ? 2.9 : 1.6);
  const side = (i: number): [number, number] => (W ? (i === 2 ? [1.65, zNorm + 1.45] : [i === 1 ? 1.65 : -1.65, zBoards + (i === 3 ? 1.45 : 0)]) : [-5.4 + i * 3.45, zBoards]);
  const boards: [string, string][] = [
    ['check', '0 操作数检查'],
    ['diff', '阶差 ΔE'],
    ['stay', '都不移'],
    ['ovf', '溢出判断'],
  ];
  boards.forEach(([id, name], i) => parts.push({ id, kind: 'register', position: side(i), props: { name, value: '', width: W ? 3.1 : 3.2 }, ...(id === 'stay' ? { pick: true, title: '都不移' } : { title: name }) }));
  table.check = { value: 'check' };
  table.diff = { value: from(['diff', 'diffCode'], (c) => (c.state.diff ? (c.state.diffCode ? `${c.state.diffCode}（${plainText(c.state.diff)}）` : plainText(c.state.diff)) : '')) };
  table.ovf = { value: 'overflow' };
  table.stay = { value: from('shift', (c) => (c.state.shift === '不移' ? '两阶相等' : '')) };
  const resultZ = zBoards + (W ? 2 * 1.45 + 0.1 : 1.6);
  parts.push({ id: 'result', kind: 'register', position: [W ? 0 : trackX - 0.4, resultZ], props: { name: W ? '十进制' : '结果', value: '', width: W ? 6.3 : 7.4 }, title: W ? '结果的十进制值' : '结果' });
  // 窄屏：结果的写法单独一块牌，十进制值在它下面一块。
  if (W) {
    parts.push({ id: 'res', kind: 'register', position: [0, 0], props: { name: '结果', value: '', width: 6.3 }, title: '结果' });
    table.res = { value: 'result' };
  }
  table.result = { value: from(['result', 'decimal'], (c) => (c.state.result ? (W ? `= ${c.state.decimal}` : `${c.state.result} = ${c.state.decimal}`) : '')) };

  // 窄屏：全部部件排成一列、一样宽，镜头怎么取景左右都不会切到谁。
  // 顺序跟着做题的顺序走；「都不移」紧挨两条尾数，三个规格化方向紧挨和的滑轨。
  if (W) {
    const width = Math.max(6.3, (int + frac - 1) * 0.56 + 1.2);
    // 两个阶码、阶差在上；两条尾数和「都不移」挨着；和的滑轨下面一排三个规格化方向；再下面是和的阶码、溢出、结果。
    const order = ['check', 'ex', 'ey', 'diff', 'stay', 'mx', 'my', 'msum', 'norms', 'esum', 'ovf', 'res', 'result'];
    const third = (width - 0.3) / 3;
    let z = 0;
    for (const id of order) {
      if (id === 'norms') {
        ['norm-l', 'norm-n', 'norm-r'].forEach((name, i) => {
          const part = parts.find((item) => item.id === name)!;
          part.position = [(i - 1) * (third + 0.15), z];
          (part.props as { width?: number }).width = third;
        });
        z += 1.45;
        continue;
      }
      const part = parts.find((item) => item.id === id);
      if (!part) continue;
      const track = part.kind === '2-fpadd:track';
      if (track) z += 0.35;
      part.position = [0, z];
      if (!track) (part.props as { width?: number }).width = width;
      z += track ? 2.9 : 1.45;
    }
  }
  const scene: SceneSpec = { parts, wires: [], kinds: () => import('./parts') };
  const bind = bindTable<FpAddState>(table);
  const has = (step: Step<FpAddState>, path: string) => step.changes.some((change) => change.at === path);
  const withOut = (mant: string, out: string) => (out ? `${mant}(${out})` : mant);

  const moves = (step: Step<FpAddState>): Move[] => {
    const s = step.state;
    const out: Move[] = [];
    if (has(step, 'diff')) {
      out.push({ value: twos ? s.x.expCode : plainText(s.x.exp), from: 'ex', to: 'diff', arc: true });
      out.push({ value: twos ? s.y.expCode : plainText(s.y.exp), from: 'ey', to: 'diff', arc: true });
    }
    if (has(step, 'check')) out.push({ value: s.check, from: 'mx', to: 'check', arc: true });
    if (has(step, 'sum.mant') && !step.changes.some((c) => c.at === 'sum.mant' && c.from !== '')) {
      out.push({ value: withOut(s.x.mant, s.x.out), from: 'mx', to: 'msum', arc: true });
      out.push({ value: withOut(s.y.mant, s.y.out), from: 'my', to: 'msum', arc: true, phase: 1 });
    }
    if (has(step, 'overflow')) out.push({ value: twos ? s.sum.expCode : plainText(s.sum.exp), from: 'esum', to: 'ovf', arc: true });
    if (has(step, 'result')) out.push({ value: s.result, from: W ? 'ovf' : 'msum', to: W ? 'res' : 'result', arc: true });
    return out;
  };

  const NAMES: Record<string, string> = {
    check: '0 操作数检查',
    diff: '阶差 ΔE',
    diffCode: '阶差的补码',
    shift: '右移的尾数',
    norm: '规格化',
    overflow: '溢出',
    result: '结果',
    decimal: '十进制',
    stage: '阶段',
  };
  const names = (path: string): string => {
    const match = /^(x|y|sum)\.(\w+)$/.exec(path);
    if (match) {
      const who = match[1] === 'sum' ? '和' : `${match[1]} `;
      return `${who}的${{ exp: expName, expCode: '阶码', mant: '尾数', out: '移出的位' }[match[2] ?? ''] ?? match[2]}`;
    }
    return NAMES[path] ?? path;
  };
  const values = (_path: string, value: string) => plainText(value);

  // 手机上只看两条尾数（答错时演的就是它们）；「都不移」在题目下面另有按钮。
  const askFrame = (ask: Ask): string[] =>
    ask.options?.includes('都不移') ? (W ? ['stay', 'mx', 'my'] : ['ex', 'ey', 'mx', 'my', 'diff', 'stay']) : W ? ['msum', 'norm-l', 'norm-n', 'norm-r'] : ['msum', 'esum', 'norm-l', 'norm-n', 'norm-r'];
  /** 镜头看这一步在动的部件。宽屏只管对阶；窄屏一列排开，每一步只看挨在一起的两三行。 */
  const frame = (step: Step<FpAddState>): string[] | null => {
    const key = has(step, 'x.out') || has(step, 'x.mant') ? 'x' : has(step, 'y.out') || has(step, 'y.mant') ? 'y' : null;
    if (!W) return step.state.stage === '对阶' && key ? [`e${key}`, `m${key}`] : null;
    if (has(step, 'x.mant') && has(step, 'y.mant')) return ['mx', 'my'];
    if (has(step, 'check')) return ['check'];
    if (has(step, 'diff')) return ['ex', 'ey', 'diff'];
    if (key) return [`m${key}`];
    if (has(step, 'norm')) return ['msum', 'norm-l', 'norm-n', 'norm-r'];
    if (has(step, 'result')) return ['res', 'result'];
    if (has(step, 'overflow')) return ['esum', 'ovf'];
    if (has(step, 'sum.mant') && step.changes.some((c) => c.at === 'sum.mant' && c.from === '')) return ['my', 'msum'];
    if (has(step, 'sum.mant') || has(step, 'sum.out')) return ['msum'];
    return ['msum'];
  };

  const shiftLeft = (mant: string, k: number): { mant: string; lost: string } => {
    const sign = /^[−-]/.test(mant) ? MINUS : '';
    const body = mant.replace(/^[−-]/, '');
    const [head = '', tail = ''] = body.split('.');
    // 补码写法：符号位不动，数值位整体左移；有效位写法：小数点前的 1 也跟着移出去。
    if (twos) return { mant: `${head}.${(tail.slice(k) + '0'.repeat(k)).slice(0, tail.length)}`, lost: tail.slice(0, k) };
    const digits = head + tail;
    const moved = (digits.slice(k) + '0'.repeat(k)).slice(0, digits.length);
    return { mant: `${sign}${moved.slice(0, head.length)}.${moved.slice(head.length)}`, lost: digits.slice(0, k) };
  };

  const wrong = (ask: Ask, value: string, state: FpAddState, next: Step<FpAddState> | null): Breakage | null => {
    if (!next) return null;
    const s = next.state;
    if (ask.options?.includes('都不移')) {
      const d = Math.abs(Number(s.diff.replace(MINUS, '-')));
      if (value === '都不移') {
        return {
          label: '',
          patch: { stay: { value: '直接加？' } },
          moves: [{ value: withOut(state.x.mant, state.x.out), from: 'mx', to: 'my', arc: true }],
          message: `两个阶码差 ${d}，尾数的同一列权不同。不对阶直接加，就是把 2^${d} 倍的位当成同一位加。`,
        };
      }
      const key = value.startsWith('x') ? 'x' : 'y';
      const lost = shiftLeft(state[key].mant, d);
      return {
        label: '',
        patch: { [`m${key}`]: { mant: lost.mant, out: '' } },
        moves: [{ value: `左移 ${d} 位`, from: W ? 'stay' : `e${key}`, to: `m${key}`, arc: true }],
        message: `${key} 的阶码大。让它去对小阶，尾数要左移 ${d} 位，最高的 ${lost.lost} 挤出去了，丢的是最大的那几位。所以是小阶向大阶看齐：小阶的尾数右移，丢的只是最低位。`,
      };
    }
    if (ask.options?.includes('向左规格化')) {
      const id = value === '向左规格化' ? 'norm-l' : value === '向右规格化' ? 'norm-r' : 'norm-n';
      const why =
        s.norm === '向右规格化'
          ? twos
            ? '两个符号位不同，说明尾数加出了 1 以上，要向右规格化一位、阶码加 1。'
            : '小数点前有两位，数不小于 2，要向右规格化一位、指数加 1。'
          : s.norm === '向左规格化'
            ? twos
              ? '两个符号位相同，可符号位和最高数值位也相同，最高数值位无效，要向左规格化。'
              : '小数点前是 0，不是 1.xxx，要向左规格化。'
            : '已经是规格化数，不用移。';
      return {
        label: '',
        patch: { [id]: { value: '你选的' } },
        moves: [{ value: withOut(state.sum.mant, state.sum.out), from: 'msum', to: id, arc: true }],
        message: `看和的尾数 ${withOut(state.sum.mant, state.sum.out)}：${why}`,
      };
    }
    return null;
  };

  const iShift = trace.steps.findIndex((step) => !!step.ask?.options?.includes('都不移'));
  const iRight = trace.steps.findIndex((step, i) => i > 0 && step.state.stage === '规格化' && /右/.test(step.title) && has(step, 'sum.mant'));
  const mistakes: Mistake<FpAddState>[] = [];
  const final = trace.steps[trace.steps.length - 1]?.state ?? trace.initial;
  const bigKey = final.shift === 'x' ? 'y' : 'x';
  if (iShift >= 0 && final.shift !== '不移' && final.shift !== '') {
    mistakes.push({
      text: '容易让阶码大的数去对小阶，因为觉得移哪个都一样',
      at: iShift,
      act: (state) => {
        const d = Math.abs(Number(trace.steps[iShift]!.state.diff.replace(MINUS, '-')));
        const lost = shiftLeft(state[bigKey].mant, d);
        return {
          label: '',
          patch: { [`m${bigKey}`]: { mant: lost.mant, out: '' } },
          moves: [{ value: `左移 ${d} 位`, from: W ? 'stay' : `e${bigKey}`, to: `m${bigKey}`, arc: true }],
          message: `大阶的 ${bigKey} 左移 ${d} 位，最高的 ${lost.lost} 被挤掉，结果错得多。小阶的尾数右移，挤掉的只是最低位，还能留在盒子里舍入。`,
        };
      },
    });
  }
  const shiftStep = trace.steps.findIndex((step) => step.state.stage === '对阶' && (has(step, 'x.out') || has(step, 'y.out')));
  if (twos && shiftStep >= 0) {
    const key = final.shift === 'y' ? 'y' : 'x';
    const after = trace.steps[shiftStep]!.state[key];
    if (after.mant.startsWith('11')) {
      mistakes.push({
        text: '容易在补码右移时左边补 0，因为当成了原码',
        at: shiftStep + 1,
        act: () => ({
          label: '',
          patch: { [`m${key}`]: { mant: `00${after.mant.slice(2)}`.replace(/^00\.1/, '00.0') } },
          moves: [{ value: '0', from: `e${key}`, to: `m${key}`, arc: true }],
          message: '负数的补码右移，符号位要照抄（补 1）。左边补 0 以后两个符号位成了 00，负数变成了正数。',
        }),
      });
    }
  }
  if (iRight >= 0) {
    mistakes.push({
      text: '容易向右规格化后忘了阶码加 1，因为只盯着尾数',
      at: iRight + 1,
      act: (state) => {
        const before = trace.steps[iRight - 1]?.state.sum ?? state.sum;
        return {
          label: '',
          patch: { esum: { value: twos ? `${before.expCode}（${before.exp}）` : `2^${before.exp}` } },
          moves: [{ value: '+1', from: 'msum', to: 'esum', arc: true }],
          message: '尾数右移一位等于除以 2，阶码不加 1，整个数就只剩一半。',
        };
      },
    });
  }

  const convention = (step: Step<FpAddState>): string | null => {
    if (!twos) return null;
    if (step.state.stage === '规格化' && has(step, 'norm')) return '补码尾数的规格化条件（符号位与最高数值位不同）取自解析书，教材正文只写了原码和 IEEE 754。';
    if (step.state.stage === '舍入' && has(step, 'sum.mant')) return '补码尾数的 0 舍 1 入这里直接对补码位串做；教材只给了原码的规则（p67）。';
    return null;
  };

  const question = { text: '对阶时哪一条尾数右移，移出去的位去哪；加完以后往哪边规格化，阶码跟着加还是减', at: W ? ['mx', 'my'] : ['ex', 'ey', 'mx', 'my'] };
  return { scene, bind, moves, names, values, wrong, askFrame, frame, mistakes, convention, question };
}
