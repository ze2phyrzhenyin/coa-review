/**
 * 「弄坏它」：只留一个符号位，用「有进位丢掉就算溢出」去判。四个例子覆盖丢不丢进位、溢不溢出的四种组合，
 * 判错的两个演出来；最后换成 V = C_f ⊕ C_0，四个都判对。
 * 每个例子的位串、进位、判定都由引擎 solve() 算出，这里只把它们排成步骤和场景。
 */
import { solve } from '../../engines/overflow/model';
import type { OverflowParams, OverflowSolution } from '../../engines/overflow/model';
import { TraceBuilder } from '../../engines/trace';
import type { Step, Trace } from '../../engines/trace';
import { formatValue } from '../../lib/bits';
import { bindTable, from } from '../../scene';
import type { Move, PartSpec, SceneSpec } from '../../scene';

const N = 4;
/** 顺序：没丢也没溢；丢了没溢；没丢却溢；丢了也溢。 */
const CASES: { x: string; y: string }[] = [
  { x: '+0011', y: '+0100' },
  { x: '-0011', y: '+0101' },
  { x: '+1001', y: '+0111' },
  { x: '-1001', y: '-1000' },
];

export interface BreakCase {
  sum: string;
  carry: string;
  rule: string;
  truth: string;
  fix: string;
}

export interface BreakState {
  cases: BreakCase[];
}

const params = (x: string, y: string): OverflowParams => ({ x: { as: '真值', text: x }, y: { as: '真值', text: y }, n: N, op: '加', notation: '整数' });

interface Solved {
  x: string;
  y: string;
  s: OverflowSolution;
  single: string;
  rule: '溢出' | '无溢出';
  right: boolean;
}

function solved(): Solved[] {
  return CASES.map(({ x, y }) => {
    const s = solve(params(x, y));
    const rule = s.cf === '1' ? '溢出' : '无溢出';
    const truthOverflow = s.verdict !== '无溢出';
    // 单符号位加法器只有低 n+1 位：去掉最高符号位那一列，剩下的就是它的和（C_f 是它向外的进位）。
    return { x, y, s, single: s.sumBits.slice(1), rule, right: (rule === '溢出') === truthOverflow };
  });
}

const blank = (): BreakCase => ({ sum: '', carry: '', rule: '', truth: '', fix: '' });

export function breakTrace(): Trace<null, BreakState> {
  const list = solved();
  const value = (units: number) => formatValue(units, N, '整数');
  const builder = new TraceBuilder<null, BreakState>('overflow-break', null, { cases: list.map(blank) }, [
    { label: '符号位', value: `只留一个，${N + 1} 位补码` },
    { label: '判法', value: '有进位丢掉就算溢出' },
    { label: '表示范围', value: `${value(-(2 ** N))} 到 ${value(2 ** N - 1)}` },
  ]);
  list.forEach((item, i) => {
    const { s } = item;
    const truthText = s.verdict === '无溢出' ? `${value(s.exactUnits)}，在范围内` : `${value(s.exactUnits)}，${s.verdict}`;
    const carryText = s.cf === '1' ? '符号位向外进 1，丢掉' : '符号位没有向外进位';
    const verdictWord = item.right ? '这次碰巧判对' : '判错了';
    const step = {
      level: 'explain' as const,
      title: `(${item.x}) + (${item.y})：${carryText}，只看进位判${item.rule}，${verdictWord}`,
      why: `单符号位相加得 ${item.single}，${carryText}。按这条判法算${item.rule}；按真值算 x + y = ${truthText}。`,
      ref: '教材 p38',
      update: (draft: BreakState) => {
        const c = draft.cases[i]!;
        c.sum = item.single;
        c.carry = s.cf;
        c.rule = `判${item.rule}`;
        c.truth = s.verdict;
      },
    };
    if (i === 1 || i === 2) {
      builder.step({
        ...step,
        ask: {
          prompt: `(${item.x}) + (${item.y})，${carryText}。只看进位会判${item.rule}，实际属于哪一种`,
          kind: 'choice',
          options: ['无溢出', '正溢', '负溢'],
          answer: s.verdict,
          hint: `把真值直接加一下，看结果在不在 ${value(-(2 ** N))} 到 ${value(2 ** N - 1)} 之间。`,
        },
      });
    } else builder.step(step);
  });
  builder.step({
    title: '改用两个进位：V = C_f ⊕ C_0，四个都判对',
    why: 'C_0 是最高数值位送进符号位的进位，C_f 是符号位送出去的进位。只看 C_f 的那条判法漏了 C_0：两个进位相同时，符号位的进位只是按模丢掉的那一位，不是溢出。',
    ref: '教材 p38',
    update: (draft) => {
      list.forEach((item, i) => {
        draft.cases[i]!.fix = `${item.s.cf} ⊕ ${item.s.c0} = ${item.s.vByCarry}`;
      });
    },
  });
  return builder.finish(
    { 结论: '只看丢掉的进位判不了溢出' },
    {
      columns: ['x + y', '和（单符号位）', '向外的进位', '只看进位', '实际', 'C_f ⊕ C_0'],
      rows: list.map((item, i) => ({
        cells: [`(${item.x}) + (${item.y})`, item.single, item.s.cf, `判${item.rule}`, item.s.verdict, `${item.s.cf} ⊕ ${item.s.c0} = ${item.s.vByCarry}`],
        step: `s${i + 1}`,
      })),
    },
  );
}

const ROW = 2.05;

export function breakScene(trace: Trace<null, BreakState>) {
  const list = solved();
  const final = trace.steps[trace.steps.length - 1]?.state ?? trace.initial;
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<BreakState>>[0] = {};
  list.forEach((item, i) => {
    const z = i * ROW;
    const sumPath = `cases.${i}.sum`;
    const placeholder = [...(final.cases[i]?.sum ?? '')].map((b) => (b === '1' ? '0' : '1')).join('');
    // 算式写在这一行位片的上方；和的位片在下面翻出来，丢掉的进位落在它的左边。
    parts.push({ id: `expr-${i}`, kind: 'label', position: [-3.0, z - 0.95], props: { text: `(${item.x}) + (${item.y})`, size: 0.26, mono: true, tone: 'muted' } });
    parts.push({ id: `sum-${i}`, kind: 'bits', position: [-3.0, z], props: { bits: placeholder, group: N }, title: `例 ${i + 1} 的和` });
    table[`sum-${i}`] = {
      bits: from(sumPath, (c) => c.state.cases[i]?.sum || placeholder),
      hidden: from(sumPath, (c) => !c.state.cases[i]?.sum),
      carry: from(`cases.${i}.carry`, (c) => (c.state.cases[i]?.carry === '1' ? 0 : null)),
    };
    parts.push({ id: `rule-${i}`, kind: 'register', position: [0.05, z], props: { name: '只看进位', value: '', width: 2.2 } });
    table[`rule-${i}`] = { value: `cases.${i}.rule` };
    parts.push({ id: `truth-${i}`, kind: 'register', position: [2.45, z], props: { name: '实际', value: '', width: 2.2 } });
    table[`truth-${i}`] = { value: `cases.${i}.truth` };
    parts.push({ id: `fix-${i}`, kind: 'register', position: [5.05, z], props: { name: 'C_f ⊕ C_0', value: '', width: 2.6 } });
    table[`fix-${i}`] = { value: `cases.${i}.fix` };
  });
  const scene: SceneSpec = { parts, wires: [] };
  const bind = bindTable<BreakState>(table);
  const moves = (_step: Step<BreakState>): Move[] => [];
  const names = (path: string): string => {
    const match = /^cases\.(\d+)\.(\w+)$/.exec(path);
    if (!match) return path;
    const label = { sum: '和', carry: '向外的进位', rule: '只看进位', truth: '实际', fix: 'C_f ⊕ C_0' }[match[2] ?? ''] ?? match[2];
    return `例 ${Number(match[1]) + 1} ${label}`;
  };
  return { scene, bind, moves, names };
}
