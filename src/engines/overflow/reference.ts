/**
 * 测试用的参照实现和对拍函数，页面和引擎都不要引用它。
 *
 * 参照只用普通整数运算和范围检查：x ± y 算出数学结果，和 n 位数值位的上下限比较得出是否溢出，
 * 对 2^(n+2) 取余得出变形补码。不调用 model.ts 和 lib/bits.ts 里的任何计算。
 * compare 把 run、solve 的输出逐项与参照比较，返回不一致的地方；空数组表示全部一致。
 * 之所以不放在 .test.ts 里：穷举按（运算 × 写法）分成四个测试文件并行跑，都要用它。
 */
import { validateTrace, type Trace } from '../trace';
import { run, solve, type Operation, type OverflowParams, type OverflowState } from './model';

export type NotationName = '整数' | '小数';
export type OverflowName = '无溢出' | '正溢' | '负溢';

export const OPS: Operation[] = ['加', '减'];
export const NOTATIONS: NotationName[] = ['整数', '小数'];

/** 把整数（单位：最低位）写成参数里的二进制真值，用 ASCII 的正负号。 */
export function input(units: number, n: number, notation: NotationName): string {
  const sign = units < 0 ? '-' : '+';
  const m = Math.abs(units);
  if (notation === '整数') return sign + m.toString(2).padStart(n, '0');
  return `${sign}${Math.floor(m / 2 ** n).toString(2)}.${(m % 2 ** n).toString(2).padStart(n, '0')}`;
}

/** 引擎显示真值的写法：正数带 +，负数带 −（U+2212），0 不带符号。 */
export function display(units: number, n: number, notation: NotationName): string {
  const body = input(units, n, notation).slice(1);
  return (units > 0 ? '+' : units < 0 ? '−' : '') + body;
}

export interface Expected {
  exact: number;
  overflow: OverflowName;
  x: string;
  y: string;
  addend: string;
  sum: string;
  carryOut: '0' | '1';
}

export function reference(x: number, y: number, n: number, op: Operation): Expected {
  const min = -(2 ** n);
  const max = 2 ** n - 1;
  const modulus = 2 ** (n + 2);
  const residue = (v: number) => ((v % modulus) + modulus) % modulus;
  const bits = (v: number) => residue(v).toString(2).padStart(n + 2, '0');
  const exact = op === '加' ? x + y : x - y;
  const addend = op === '加' ? y : -y;
  return {
    exact,
    overflow: exact > max ? '正溢' : exact < min ? '负溢' : '无溢出',
    x: bits(x),
    y: bits(y),
    addend: bits(addend),
    sum: bits(exact),
    carryOut: residue(x) + residue(addend) >= modulus ? '1' : '0',
  };
}

export const withPoint = (bits: string, notation: NotationName): string =>
  notation === '整数' ? bits : `${bits.slice(0, 2)}.${bits.slice(2)}`;

export const paramsOf = (x: number, y: number, n: number, op: Operation, notation: NotationName): OverflowParams => ({
  x: { as: '真值', text: input(x, n, notation) },
  y: { as: '真值', text: input(y, n, notation) },
  n,
  op,
  notation,
});

/** n 位数值位的全部操作数：−2^n … 2^n − 1。 */
export const operands = (n: number): number[] => Array.from({ length: 2 ** (n + 1) }, (_, i) => i - 2 ** n);

export const lastState = (trace: Trace<OverflowParams, OverflowState>): OverflowState => {
  const step = trace.steps[trace.steps.length - 1];
  if (!step) throw new Error('Trace 没有任何一步');
  return step.state;
};

export const rowBits = (cells: string[]): string => cells.slice(1).join('');

export interface Comparison {
  problems: string[];
  /** 最高符号位向外有没有进位。 */
  carry: boolean;
  overflowed: boolean;
  trace: Trace<OverflowParams, OverflowState>;
}

/** 跑一次引擎，与参照逐项比较。validate 为 true 时再跑 validateTrace。 */
export function compare(x: number, y: number, n: number, op: Operation, notation: NotationName, validate = true): Comparison {
  const where = `${input(x, n, notation)} ${op} ${input(y, n, notation)}（n=${n}，${notation}）`;
  const want = reference(x, y, n, op);
  const params = paramsOf(x, y, n, op, notation);
  const trace = run(params);
  const solution = solve(params);
  const state = lastState(trace);
  const problems: string[] = [];
  const same = (what: string, got: unknown, expected: unknown): void => {
    const g = JSON.stringify(got);
    const e = JSON.stringify(expected);
    if (g !== e) problems.push(`${where} ${what}：得到 ${g}，应为 ${e}`);
  };
  const flip = (bits: string) => [...bits].map((b) => (b === '1' ? '0' : '1')).join('');
  const overflowed = want.overflow !== '无溢出';
  const v = overflowed ? '1' : '0';

  if (validate) same('validateTrace', validateTrace(trace), []);

  // 竖式的每一行
  same('[x]变补', rowBits(state.rows.x.cells), want.x);
  same('[y]变补', rowBits(state.rows.y.cells), want.y);
  same('和', rowBits(state.rows.sum.cells), want.sum);
  same('[−y]变补', state.rows.negY ? rowBits(state.rows.negY.cells) : null, op === '减' ? want.addend : null);
  same('各位取反', state.rows.inverted ? rowBits(state.rows.inverted.cells) : null, op === '减' ? flip(want.y) : null);
  for (const [key, row] of Object.entries(state.rows)) if (row) same(`${key} 行的格数`, row.cells.length, n + 3);
  same('操作数行和结果行的出界格', [state.rows.x.cells[0], state.rows.y.cells[0], state.rows.sum.cells[0]], ['', '', '']);

  // 进位行：逐列用整数重算。第 c 格是进入第 c 列的进位，最右一格没有进位进来。
  const a = parseInt(want.x, 2);
  const b = parseInt(want.addend, 2);
  const carryRow: string[] = [];
  for (let column = 0; column <= n + 1; column += 1) {
    const low = 2 ** (n + 2 - column);
    carryRow.push(String(Math.floor(((a % low) + (b % low)) / low)));
  }
  carryRow.push('');
  same('进位行', state.rows.carry.cells, carryRow);

  // 「进位」：最高符号位向外的进位
  same('丢掉的进位', state.dropped, want.carryOut);

  // 「溢出」：两种判法、范围检查三者一致
  same('判定', state.verdict, want.overflow);
  same('两个符号位', state.sf1 + state.sf2, want.sum.slice(0, 2));
  same('V = S_f1 ⊕ S_f2', state.vBySign, v);
  same('V = C_f ⊕ C_0', state.vByCarry, v);
  same('S_f1 ⊕ S_f2 的算法', state.vBySign, state.sf1 === state.sf2 ? '0' : '1');
  same('C_f ⊕ C_0 的算法', state.vByCarry, state.cf === state.c0 ? '0' : '1');
  if (want.overflow === '正溢') same('正溢时的符号位和进位', [state.sf1 + state.sf2, state.c0, state.cf], ['01', '1', '0']);
  if (want.overflow === '负溢') same('负溢时的符号位和进位', [state.sf1 + state.sf2, state.c0, state.cf], ['10', '0', '1']);

  // 结论和最终答案
  const shown = display(want.exact, n, notation);
  const expectedResult: Record<string, string> = { 结果的变形补码: withPoint(want.sum, notation), 是否溢出: want.overflow };
  if (!overflowed) expectedResult['真值'] = shown;
  same('result', trace.result, expectedResult);
  same('result 的键顺序', Object.keys(trace.result), Object.keys(expectedResult));
  same('状态里的真值', state.value, overflowed ? '' : shown);
  if (overflowed) {
    same('结论提到溢出种类和数学结果', [state.conclusion.includes(want.overflow), state.conclusion.includes(shown)], [true, true]);
  } else {
    same('结论', state.conclusion, `无溢出，${op === '加' ? 'x + y' : 'x − y'} = ${shown}`);
  }

  // solve 与 run 给出同一组数
  same('solve 的数学结果', solution.exactUnits, want.exact);
  same('solve 的操作数', [solution.xUnits, solution.yUnits], [x, y]);
  same('solve 的位串', [solution.xBits, solution.yBits, solution.addendBits, solution.sumBits], [want.x, want.y, want.addend, want.sum]);
  same(
    'solve 与状态',
    [solution.sf1, solution.sf2, solution.cf, solution.c0, solution.carryOut, solution.verdict],
    [state.sf1, state.sf2, state.cf, state.c0, state.dropped, state.verdict],
  );
  const special = op === '减' && y === -(2 ** n);
  same('C_f、C_0 是否取自进位行', solution.carriesFromRow, !special);
  if (!special) same('C_f、C_0 与进位行', [state.cf, state.c0], [state.rows.carry.cells[1], state.rows.carry.cells[2]]);
  same('加法器重算的行', state.adder === null, !special);
  if (special && state.adder) {
    // 加法器的做法：[x]补 + [y]补 各位取反 + 1，n+1 位，用整数重算两个进位
    const half = 2 ** n;
    const xs = ((x % (2 * half)) + 2 * half) % (2 * half);
    const notY = 2 * half - 1 - (((y % (2 * half)) + 2 * half) % (2 * half));
    same('加法器的 C_0', state.c0, String(Math.floor(((xs % half) + (notY % half) + 1) / half)));
    same('加法器的 C_f', state.cf, String(Math.floor((xs + notY + 1) / (2 * half))));
    same('加法器的和', rowBits(state.adder.sum.cells), ((xs + notY + 1) % (2 * half)).toString(2).padStart(n + 1, '0'));
    same('加法器的和是结果的低 n+1 位', rowBits(state.adder.sum.cells), want.sum.slice(1));
  }

  // 解题表与文字不许对不上：表上指明读 C_f、C_0 的那一行，S_f1、S_f2 两格就是状态里的 C_f、C_0
  const rows = trace.table.rows;
  const readRow = special ? rows.find((r) => r.cells[0] === '加法器进位（读 C_f、C_0）') : rows.find((r) => r.cells[0] === '进位');
  same('解题表里读 C_f、C_0 的那一行', readRow ? [readRow.cells[2], readRow.cells[3]] : null, [state.cf, state.c0]);
  same('解题表里只有一行可以读 C_f、C_0', rows.filter((r) => r.cells[0] === '进位' || r.cells[0] === '加法器进位（读 C_f、C_0）').length, 1);

  // 按进位判出溢出时，文字必须说清楚怎么分正溢、负溢
  const confirm = trace.steps.find((s) => s.title.startsWith('用进位再判一次'));
  if (overflowed) {
    same('进位判法分正溢、负溢的说明', [confirm?.why.includes('C_f = 0、C_0 = 1 是正溢'), confirm?.why.includes('C_f = 1、C_0 = 0 是负溢')], [true, true]);
    same('进位判法的结论', confirm?.why.includes(`这里 C_f = ${state.cf}、C_0 = ${state.c0}，是${want.overflow}`), true);
  }

  // 预测题：只有两道，答案取自引擎
  const asks = trace.steps.flatMap((s) => (s.ask ? [s.ask] : []));
  same('预测题的种类', asks.map((q) => q.kind), ['bits', 'choice']);
  same('符号位预测题的答案', asks[0]?.answer, want.sum.slice(0, 2));
  same('溢出选择题的答案', asks[1]?.answer, want.overflow);
  same('溢出选择题的选项', asks[1]?.options, ['无溢出', '正溢', '负溢']);

  return { problems, carry: want.carryOut === '1', overflowed, trace };
}

/**
 * 一个（运算，写法）下 n = 2…5 的全部 x、y。返回不一致的地方、算了多少对、
 * 以及（有无进位 × 有无溢出）四种组合各出现了多少次。
 * validateTrace 较慢：n ≤ 3 每条都跑，n ≥ 4 每 8 条跑一次。
 */
export function exhaust(op: Operation, notation: NotationName, sizes: number[] = [2, 3, 4, 5]) {
  const problems: string[] = [];
  const combos: Record<string, number> = { '有进位，溢出': 0, '有进位，无溢出': 0, '无进位，溢出': 0, '无进位，无溢出': 0 };
  let count = 0;
  for (const n of sizes) {
    for (const x of operands(n)) {
      for (const y of operands(n)) {
        const got = compare(x, y, n, op, notation, n <= 3 || count % 8 === 0);
        if (problems.length < 20) problems.push(...got.problems);
        combos[`${got.carry ? '有进位' : '无进位'}，${got.overflowed ? '溢出' : '无溢出'}`]! += 1;
        count += 1;
      }
    }
  }
  return { problems, count, combos };
}
