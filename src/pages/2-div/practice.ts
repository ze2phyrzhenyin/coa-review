/**
 * 练习的出题和判分。参数由引擎的 generate(seed) 给出，标准答案取 run 的终态；页面只比对。
 * 判分指出第一处错：从上往下第一行；行内先看做什么（减 y、加 y），再从右往左看各位，最后看上商。
 */
import { generate, run } from '../../engines/div/model';
import type { DivParams, DivState } from '../../engines/div/model';

export interface Line {
  key: string;
  label: string;
  kind: 'negY' | 'shift' | 'sum' | 'corr' | 'quot';
  /** 位串（不带小数点），corr 行为空。 */
  answer: string;
  op?: string;
  q?: string;
  corr?: string;
}

export interface Problem {
  seed: number;
  params: DivParams;
  state: DivState;
  result: Record<string, string>;
  lines: Line[];
}

const bits = (text: string) => text.replace('.', '');

export function makeProblem(seed: number): Problem {
  const params = generate(seed, { n: seed % 2 === 0 ? 4 : 3 });
  const trace = run(params);
  const state = trace.steps[trace.steps.length - 1]!.state;
  const lines: Line[] = [{ key: 'negY', label: '[−|y|]补', kind: 'negY', answer: bits(state.negY) }];
  state.rounds.forEach((round, i) => {
    if (i > 0) lines.push({ key: `l${i}`, label: '左移', kind: 'shift', answer: bits(round.left) });
    lines.push({ key: `s${i}`, label: `r_${i}`, kind: 'sum', answer: bits(round.sum), op: round.op, q: round.q });
  });
  lines.push({ key: 'corr', label: '纠余', kind: 'corr', answer: '', corr: state.correction.needed === '1' ? '要' : '不要' });
  lines.push({ key: 'quot', label: '[q]原', kind: 'quot', answer: bits(state.quotient) });
  return { seed, params, state, result: trace.result, lines };
}

export interface Entry {
  bits: Record<string, string>;
  ops: Record<string, string>;
  qs: Record<string, string>;
  corr: string;
}

export const blankEntry = (): Entry => ({ bits: {}, ops: {}, qs: {}, corr: '' });

export interface Miss {
  line: number;
  /** 'op'、'q'、'corr'，或位的下标（左起）；-1 表示整行。 */
  at: 'op' | 'q' | 'corr' | number;
  message: string;
}

const ADVICE: Record<Line['kind'], string> = {
  negY: '[−|y|]补 由 [|y|]原 连同符号位各位取反、末位加 1 得到。',
  shift: '左移：上一行的和整体左移一位，最高位丢掉，最低位补 0。',
  sum: '减 y 加的是 [−|y|]补，加 y 加的是 [|y|]原，从最低位加起，符号位向外的进位丢掉。',
  corr: '最后一位商是 0（余数为负）才要再加 y 纠余；是 1 就不用。',
  quot: '[q]原 = q_f.q_1…q_n：q_f = x_f ⊕ y_f，q_0 不写进去。',
};

const column = (k: number) => (k === 0 ? '符号位' : `2^-${k} 位`);

export function grade(problem: Problem, entry: Entry): Miss[] {
  const misses: Miss[] = [];
  const width = problem.params.n + 1;
  problem.lines.forEach((line, i) => {
    if (line.kind === 'corr') {
      if (entry.corr !== line.corr) misses.push({ line: i, at: 'corr', message: entry.corr ? `不对。${ADVICE.corr}` : '还没选要不要纠余。' });
      return;
    }
    if (line.kind === 'sum' && entry.ops[line.key] !== line.op) {
      misses.push({ line: i, at: 'op', message: entry.ops[line.key] ? '这一轮做的运算不对。第 0 轮总是减 y；以后看上一位商：1 减 y，0 加 y。' : '还没选这一轮做减 y 还是加 y。' });
      return;
    }
    const raw = entry.bits[line.key] ?? '';
    const got = raw.replace(/[\s.]/g, '');
    if (got === '') misses.push({ line: i, at: -1, message: '没填。' });
    else if (/\s/.test(raw.trim()) || !/^[01]+$/.test(got)) misses.push({ line: i, at: -1, message: '只能写 0 和 1，中间不留空。' });
    else if (got.length !== width) misses.push({ line: i, at: -1, message: `这一行是 ${width} 位（1 位符号加 ${width - 1} 位小数），写了 ${got.length} 位。` });
    else {
      for (let k = width - 1; k >= 0; k--) {
        if (got[k] !== line.answer[k]) {
          misses.push({ line: i, at: k, message: `${column(k)}不对。${ADVICE[line.kind]}` });
          return;
        }
      }
      if (line.kind === 'sum' && entry.qs[line.key] !== line.q) {
        misses.push({ line: i, at: 'q', message: entry.qs[line.key] ? '上商不对：和的符号位是 0 上商 1，是 1 上商 0。' : '这一轮还没上商。' });
      }
    }
  });
  return misses;
}
