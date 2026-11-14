/**
 * 练习的出题和判分。出题只决定参数（种子在网址里），答案全部来自引擎 solve()。
 * 判分逐行比对，指出从右数第一处错的列：竖式是从右往左算的，第一处错往往就是错误的起点。
 */
import { solve } from '../../engines/overflow/model';
import type { Operation, OverflowParams, OverflowSolution } from '../../engines/overflow/model';
import { BitsError, codeRange, formatBits, formatValue, parseValue } from '../../lib/bits';
import type { Notation, OverflowKind } from '../../lib/bits';

/** mulberry32：同一个种子出同一道题。 */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Problem {
  params: OverflowParams;
  solution: OverflowSolution;
}

const KINDS: OverflowKind[] = ['无溢出', '正溢', '负溢'];

export function makeProblem(seed: number): Problem {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const n = pick([4, 4, 5, 5, 6]);
  const notation: Notation = next() < 0.7 ? '整数' : '小数';
  const op: Operation = pick(['加', '减'] as const);
  const want = pick(KINDS);
  const { min, max } = codeRange('补码', n);
  const value = () => {
    let units = 0;
    while (units === 0) units = min + 1 + Math.floor(next() * (max - min));
    return units;
  };
  let fallback: Problem | null = null;
  for (let tries = 0; tries < 400; tries++) {
    const params: OverflowParams = {
      x: { as: '真值', text: formatValue(value(), n, notation) },
      y: { as: '真值', text: formatValue(value(), n, notation) },
      n,
      op,
      notation,
    };
    const solution = solve(params);
    fallback ??= { params, solution };
    if (solution.verdict === want) return { params, solution };
  }
  return fallback!;
}

export interface RowCheck {
  ok: boolean;
  /** 错的那一位在位串里的下标（左起）；位数不对或没填时为 -1。 */
  wrongAt: number;
  message: string;
}

/** 列名：S_f1、S_f2、各数值位的权。 */
export function columnName(i: number, n: number, notation: Notation): string {
  if (i === 0) return 'S_f1';
  if (i === 1) return 'S_f2';
  const k = i - 2;
  return notation === '整数' ? `2^${n - 1 - k}` : `2^-${k + 1}`;
}

export function compact(text: string): string {
  return text.replace(/[\s_.]/g, '');
}

export type RowKind = 'operand' | 'negate' | 'sum';

const advice = (expected: string, i: number, kind: RowKind): string => {
  if (kind === 'sum') return i === expected.length - 1 ? '最低位右边没有进位，只把这一列的两个数相加。' : '从这一列重新加，别漏了右边一列送来的进位。';
  if (kind === 'negate') return '[−y]变补 由 [y]变补 连同符号位各位取反、末位加 1 得到。';
  if (i < 2) return '变形补码的两个符号位相同：正数 00，负数 11。';
  return expected[0] === '0' ? '正数的数值位就是真值的数值位，位数不够左边补 0。' : '负数的数值位是绝对值各位取反、末位加 1。';
};

export function checkRow(expected: string, written: string, n: number, notation: Notation, kind: RowKind): RowCheck {
  const got = compact(written);
  const width = expected.length;
  if (got === '') return { ok: false, wrongAt: -1, message: '没填' };
  if (!/^[01]+$/.test(got)) return { ok: false, wrongAt: -1, message: '只能写 0 和 1' };
  if (got.length !== width) return { ok: false, wrongAt: -1, message: `应写 ${width} 位：2 个符号位加 ${n} 个数值位，写了 ${got.length} 位` };
  for (let i = width - 1; i >= 0; i--) {
    if (got[i] !== expected[i]) {
      return { ok: false, wrongAt: i, message: `从右数第 ${width - i} 位（${columnName(i, n, notation)}）不对。${advice(expected, i, kind)}` };
    }
  }
  return { ok: true, wrongAt: -1, message: '对' };
}

export function checkValue(solution: OverflowSolution, written: string): RowCheck {
  const text = written.trim();
  if (solution.verdict !== '无溢出') {
    return text === '' ? { ok: true, wrongAt: -1, message: '溢出时不填，对' } : { ok: false, wrongAt: -1, message: '溢出了，这几位里的数不是结果，不用填真值。' };
  }
  if (text === '') return { ok: false, wrongAt: -1, message: '没填' };
  try {
    const units = parseValue(text, solution.n, solution.notation);
    return units === solution.exactUnits ? { ok: true, wrongAt: -1, message: '对' } : { ok: false, wrongAt: -1, message: '真值不对。符号位 11 时，数值位要取反加 1 才是绝对值。' };
  } catch (error) {
    if (error instanceof BitsError) return { ok: false, wrongAt: -1, message: error.message };
    throw error;
  }
}

export const show = (bits: string, notation: Notation): string => formatBits(bits, notation, 2);

/**
 * 续判：学生前面几行写错了，后面的行按他自己写的数来判（方法对就算对）。
 * 期望值仍由引擎算：把学生写的位串当作机器数交给 solve()。学生的位串引擎不收时（位数不对、两个符号位不同），退回标准答案。
 */
export function followThrough(problem: Problem, written: Record<string, string>): { negY: string | null; sum: string; basedOnStudent: boolean } {
  const { params, solution } = problem;
  const width = solution.width;
  const ok = (key: string) => {
    const text = compact(written[key] ?? '');
    return text.length === width && /^[01]+$/.test(text) ? text : null;
  };
  const x = ok('x');
  const y = ok('y');
  let negY = solution.negYBits;
  let sum = solution.sumBits;
  let based = false;
  try {
    if (solution.op === '减' && y) {
      negY = solve({ ...params, x: params.x, y: { as: '机器数', bits: y } }).negYBits;
      based = based || y !== solution.yBits;
    }
    const addend = solution.op === '减' ? ok('negY') : y;
    if (x && addend) {
      sum = solve({ ...params, op: '加', x: { as: '机器数', bits: x }, y: { as: '机器数', bits: addend } }).sumBits;
      based = based || x !== solution.xBits || addend !== solution.addendBits;
    }
  } catch {
    return { negY: solution.negYBits, sum: solution.sumBits, basedOnStudent: false };
  }
  return { negY, sum, basedOnStudent: based };
}
