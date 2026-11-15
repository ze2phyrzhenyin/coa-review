/**
 * 「弄坏它」：拿原码、反码去做加法。a 先放到三个盘上，再把 b 的机器码当作格数，三个盘的指针都顺时针转这么多格。
 * 转过的格数一样，停的格子读出来却不同：只有补码盘停在 a + b。机器码、和都由位串库算出（encode、rippleAdd、decode）。
 */
import { TraceBuilder } from '../../engines/trace';
import type { Ask, Step, Trace } from '../../engines/trace';
import { encode, formatDecimal, formatValue, rippleAdd } from '../../lib/bits';
import type { Code } from '../../lib/bits';
import { bindTable, from } from '../../scene';
import type { Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage } from '../../player/Player';
import { readOn, ringMarks } from './scene';

const N = 4;
const A = -3;
const B = 5;
const USED: Code[] = ['原码', '反码', '补码'];

interface Dial {
  pointer: number;
  from: number;
  reading: string;
}
export interface BreakState {
  rings: Record<string, Dial>;
  a: string;
  b: string;
}

const value = (units: number) => formatValue(units, N, '整数');
const decimal = (units: number) => `${units > 0 ? '+' : ''}${formatDecimal(units, N, '整数')}`;

function solved() {
  return USED.map((code) => {
    const a = encode(code, A, N);
    const b = encode(code, B, N);
    const added = rippleAdd(a, b);
    return { code, a, b, sum: added.sum, carry: added.carryOut, read: readOn(code, added.sum, N, '整数') };
  });
}

export function breakTrace(): Trace<null, BreakState> {
  const list = solved();
  const right = decimal(A + B);
  const blank: Dial = { pointer: -1, from: -1, reading: '' };
  const builder = new TraceBuilder<null, BreakState>(
    'codes-break',
    null,
    { rings: Object.fromEntries(USED.map((code) => [code, { ...blank }])), a: '', b: '' },
    [
      { label: '字长', value: `${N + 1} 位，一圈 2^${N + 1} 格` },
      { label: '算式', value: `a + b，a = ${value(A)}，b = ${value(B)}` },
      { label: '做法', value: '两个机器码直接相加，丢掉最高位送出的进位' },
    ],
  );
  builder.step({
    title: `a = ${value(A)} 放到三个盘上`,
    why: `三种码把 a 写成 ${list.map((item) => `${item.a}（${item.code}）`).join('、')}，指针各指自己的那一格。`,
    ref: '教材 p25–27',
    update: (s) => {
      s.a = value(A);
      for (const item of list) s.rings[item.code] = { pointer: parseInt(item.a, 2), from: -1, reading: `a = ${decimal(A)}` };
    },
  });
  const ask: Ask = {
    prompt: `再加 b = ${value(B)}：三个盘都顺时针转 b 的机器码那么多格。哪个盘会停在 a + b 上`,
    kind: 'choice',
    options: USED.map((code) => `${code}盘`),
    answer: '补码盘',
    hint: '看哪一种码一圈的格子和数是一一对应、按顺序排的。',
  };
  builder.step({
    title: `三个盘都转 ${parseInt(list[0]!.b, 2)} 格：只有补码盘停在 ${right}`,
    why: list.map((item) => `${item.code} ${item.a} + ${item.b} = ${item.sum}${item.carry === '1' ? '（进位丢掉）' : ''}，读成 ${item.read}`).join('；') + '。',
    ref: '教材 p25–26',
    ask,
    update: (s) => {
      s.b = value(B);
      for (const item of list) s.rings[item.code] = { pointer: parseInt(item.sum, 2), from: parseInt(item.a, 2), reading: `停在 ${item.read}` };
    },
  });
  builder.step({
    title: '原码、反码不能直接相加，补码可以',
    why: `补码盘上 ${2 ** (N + 1)} 格按数的大小顺着排，转一格就是加 1，转过一圈（进位丢掉）正好回到同一个数。原码的负数是倒着排的，反码有两个 0，转过 0 时多算一格。`,
    ref: '教材 p25–27',
    update: () => undefined,
  });
  const trace = builder.finish(
    { 结论: '只有补码可以直接相加' },
    {
      columns: ['码', 'a', 'b', '相加', '读成'],
      rows: list.map((item) => ({ cells: [item.code, item.a, item.b, item.sum, item.read], step: 's2' })),
    },
  );
  // 「变化」只列读数，指针、起点的格号不给学生看。
  return { ...trace, steps: trace.steps.map((step) => ({ ...step, changes: step.changes.filter((change) => !/\.(pointer|from)$/.test(change.at)) })) };
}

export function breakScene(trace: Trace<null, BreakState>, compact = false) {
  const list = solved();
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<BreakState>>[0] = {};
  parts.push({ id: 'ab', kind: 'register', position: [0, -2.4], props: { name: 'a + b', value: `${value(A)} + ${value(B)}`, width: 4.4 }, title: 'a + b' });
  list.forEach((item, i) => {
    const at: [number, number] = compact ? [0, i * 5.2] : [(i - 1) * 4.6, 0.6];
    parts.push({
      id: `ring-${item.code}`,
      kind: '2-codes:ring',
      position: at,
      props: { name: `${item.code}盘`, size: 2 ** (N + 1), marks: ringMarks(item.code, N, '整数'), neg: [2 ** N, 2 ** N], pointer: -1, ghost: -1, reading: '', empty: '', from: -1, dir: 1 },
      pick: true,
      title: `${item.code}盘`,
      describe: (p) => `${item.code}盘，${String(p.reading || '还没放')}`,
    });
    table[`ring-${item.code}`] = {
      pointer: from(`rings.${item.code}.pointer`, (c) => c.state.rings[item.code]?.pointer ?? -1),
      from: from(`rings.${item.code}.from`, (c) => c.state.rings[item.code]?.from ?? -1),
      reading: `rings.${item.code}.reading`,
    };
  });
  const scene: SceneSpec = { parts, wires: [], kinds: () => import('./parts') };
  const bind = bindTable<BreakState>(table);
  const moves = (step: Step<BreakState>): Move[] =>
    step.id === 's1' ? list.map((item) => ({ value: item.a, from: 'ab', to: `ring-${item.code}`, arc: true })) : [];
  const names = (path: string): string => {
    const match = /^rings\.(\S+?)\.(\w+)$/.exec(path);
    if (match) return `${match[1]}盘${match[2] === 'reading' ? '' : match[2] === 'pointer' ? '指针' : '起点'}`;
    return path === 'a' ? 'a' : path === 'b' ? 'b' : path;
  };
  /** 选错的盘先转给他看：指针转过去，读数写出它停在哪。 */
  const wrong = (_ask: Ask, picked: string): Breakage | null => {
    const item = list.find((entry) => `${entry.code}盘` === picked);
    if (!item) return null;
    return {
      label: '',
      patch: { [`ring-${item.code}`]: { pointer: parseInt(item.sum, 2), from: parseInt(item.a, 2), reading: `停在 ${item.read}` } },
      moves: [{ value: item.b, from: 'ab', to: `ring-${item.code}`, arc: true }],
      message: `${item.code}盘转过去停在 ${item.read}，a + b 应是 ${decimal(A + B)}。`,
    };
  };
  return { scene, bind, moves, names, wrong };
}
