/**
 * 练习的出题和判分。出题只决定参数（种子在网址里），答案全部来自引擎：generate 出数，run 的终态给标准答案。
 * 续判：后面的行按学生自己前面写的数来判（|x|、|y| 写错了，位积、和按他写的算对就算对），期望值仍由引擎的
 * multiplyArray、complement 算。判分指出第一处错：从上往下第一行，行内从右往左第一位（竖式从低位算起）。
 */
import { complement, generate, multiplyArray, run } from '../../engines/mul/model';
import type { MulParams, MulState } from '../../engines/mul/model';

export interface Line {
  key: string;
  label: string;
  /** 这一行最低位的权；带符号位的行（符号位）用 -1 表示只有符号那一格。 */
  low: number;
  width: number;
  /** 标准答案，左边是高位。 */
  answer: string;
  kind: 'sign' | 'abs' | 'product' | 'sum' | 'post';
}

export interface Problem {
  seed: number;
  params: MulParams;
  state: MulState;
  result: Record<string, string>;
  given: { label: string; sign: string; bits: string }[];
  lines: Line[];
}

export function makeProblem(seed: number): Problem {
  const params = generate(seed, { n: seed % 2 === 0 ? 4 : 3 });
  const trace = run(params);
  const state = trace.steps[trace.steps.length - 1]!.state;
  const { n, mode } = params;
  const signed = mode !== '无符号';
  const code = mode === '原码' ? '原' : '补';
  const W = 2 * n;
  const given = signed
    ? [
        { label: `[x]${code}`, sign: state.x.charAt(0), bits: state.x.slice(1) },
        { label: `[y]${code}`, sign: state.y.charAt(0), bits: state.y.slice(1) },
      ]
    : [];
  const lines: Line[] = [];
  if (signed) {
    lines.push({ key: 'sign', label: '符号位', low: -1, width: 1, answer: state.sign?.pf ?? '', kind: 'sign' });
    lines.push({ key: 'a', label: '|x|', low: 0, width: n, answer: state.a, kind: 'abs' });
    lines.push({ key: 'b', label: '× |y|', low: 0, width: n, answer: state.b, kind: 'abs' });
  }
  for (let j = 0; j < n; j++) {
    lines.push({ key: `pp${j}`, label: `b_${j} 行`, low: j, width: n, answer: [...state.products[j]!].reverse().join(''), kind: 'product' });
  }
  lines.push({ key: 'sum', label: signed ? '和' : 'P', low: 0, width: W, answer: [...state.p].reverse().join(''), kind: 'sum' });
  if (signed) lines.push({ key: 'post', label: '算后求补', low: 0, width: W, answer: state.post?.output ?? '', kind: 'post' });
  return { seed, params, state, result: trace.result, given, lines };
}

export const clean = (text: string) => text.replace(/[\s_.]/g, '');
const wellFormed = (text: string, width: number) => text.length === width && /^[01]+$/.test(text);

/** 按学生前面写的数，各行应写什么。学生的数不成形时退回标准答案。 */
export function expected(problem: Problem, written: Record<string, string>): Record<string, string> {
  const { params, state, lines } = problem;
  const n = params.n;
  const out: Record<string, string> = Object.fromEntries(lines.map((line) => [line.key, line.answer]));
  const a = clean(written.a ?? '');
  const b = clean(written.b ?? '');
  const useA = params.mode !== '无符号' && wellFormed(a, n) ? a : state.a;
  const useB = params.mode !== '无符号' && wellFormed(b, n) ? b : state.b;
  const array = multiplyArray(useA, useB);
  for (let j = 0; j < n; j++) out[`pp${j}`] = [...array.products[j]!].reverse().join('');
  out.sum = [...array.p].reverse().join('');
  if (state.post) {
    const sum = clean(written.sum ?? '');
    const basis = wellFormed(sum, 2 * n) ? sum : out.sum;
    out.post = complement(basis, state.post.e === '1' ? '1' : '0').output;
  }
  return out;
}

export interface Miss {
  line: number;
  /** 错的那一位在行里的下标（左起），-1 表示整行（没填、位数不对）。 */
  at: number;
  message: string;
}

const advice = (problem: Problem, line: Line): string => {
  const { mode } = problem.params;
  switch (line.kind) {
    case 'sign':
      return '积的符号位是 x_f ⊕ y_f：两个符号位相同得 0，不同得 1。';
    case 'abs':
      return mode === '原码' ? '原码的数值位就是绝对值，照抄。' : '正数照抄数值位；负数求补：从右找到第一个 1，它和右边不变，左边各位取反。';
    case 'product':
      return `第 ${line.low} 行看乘数的 b_${line.low}：为 1 抄被乘数，为 0 全写 0，整行左移 ${line.low} 位。`;
    case 'sum':
      return '把每一列的位积加起来，从 2^0 那一列开始，进位送到左边一列。';
    case 'post':
      return mode === '原码' ? '原码的算后求补器 E = 0，照抄和。' : '算后求补器的 E = x_f ⊕ y_f：为 1 时从右找第一个 1，左边取反；为 0 照抄。';
  }
};

export function grade(problem: Problem, written: Record<string, string>): Miss[] {
  const want = expected(problem, written);
  const misses: Miss[] = [];
  problem.lines.forEach((line, i) => {
    const got = clean(written[line.key] ?? '');
    const answer = want[line.key] ?? line.answer;
    if (got === '') misses.push({ line: i, at: -1, message: '没填。' });
    else if (!/^[01]+$/.test(got)) misses.push({ line: i, at: -1, message: '只能写 0 和 1。' });
    else if (got.length !== line.width) misses.push({ line: i, at: -1, message: `这一行是 ${line.width} 位，写了 ${got.length} 位。` });
    else {
      for (let k = line.width - 1; k >= 0; k--) {
        if (got[k] !== answer[k]) {
          const weight = line.low < 0 ? -1 : line.low + line.width - 1 - k;
          const where = weight < 0 ? '' : `2^${weight} 那一位`;
          misses.push({ line: i, at: k, message: `${where}不对。${advice(problem, line)}` });
          break;
        }
      }
    }
  });
  return misses;
}

/** 这一行按学生自己前面写的数算对了，但和标准答案不同。 */
export function followed(problem: Problem, written: Record<string, string>, key: string): boolean {
  const line = problem.lines.find((item) => item.key === key);
  if (!line) return false;
  const got = clean(written[key] ?? '');
  return got === (expected(problem, written)[key] ?? '') && got !== line.answer;
}
