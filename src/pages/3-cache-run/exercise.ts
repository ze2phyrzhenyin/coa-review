/**
 * 练习：按种子出一串访问，学生在答题纸上逐行填 块号 | 行号或组号 | 标记 | 结果 | 换出。
 * 题目参数由种子决定；答案和判分只看引擎给的解题表。
 */
import { run } from '../../engines/cache/model';
import type { Access, Mapping, Params, Replacement } from '../../engines/cache/model';
import type { Trace } from '../../engines/trace';
import type { State } from '../../engines/cache/model';
import { ADDRESS_BITS, BLOCK_WORDS, makeParams } from './setup';

/** 出题用的发生器（mulberry32）。同一个种子出同一道题。 */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LENGTH = 7;
const MAPPINGS: Mapping[] = ['直接', '组相联', '全相联'];
const POLICIES: Replacement[] = ['LRU', 'LFU'];

/** 解题表里有命中、有换出、缺失不少于 3 次的才要。 */
function usable(trace: Trace<Params, State>): boolean {
  const rows = trace.table.rows.map((row) => row.cells);
  const hits = rows.filter((cells) => cells[4] === '命中').length;
  const evictions = rows.filter((cells) => (cells[5] ?? '') !== '').length;
  return hits >= 1 && hits <= 3 && evictions >= 1;
}

export function makeExercise(seed: number): Params {
  const next = generator(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const mapping = pick(MAPPINGS);
  const policy = pick(POLICIES);
  const blocks = 2 ** ADDRESS_BITS / BLOCK_WORDS;
  let fallback: Params | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    // 从少数几个块里反复取，才会有命中和冲突。
    const pool = Array.from({ length: mapping === '全相联' ? 6 : 4 }, () => Math.floor(next() * blocks));
    const accesses: Access[] = [];
    for (let k = 0; k < LENGTH; k++) {
      const block = pick(pool);
      const address = block * BLOCK_WORDS + Math.floor(next() * BLOCK_WORDS);
      accesses.push({ address, op: next() < 0.2 ? '写' : '读' });
    }
    const params = makeParams(mapping, policy, accesses);
    fallback ??= params;
    if (usable(run(params))) return params;
  }
  return fallback!;
}

export interface Entry {
  block: string;
  index: string;
  tag: string;
  result: '' | '命中' | '缺失';
  /** 换出的块号，没有换出时空着。 */
  out: string;
  writeBack: boolean;
}

export const blankEntry = (): Entry => ({ block: '', index: '', tag: '', result: '', out: '', writeBack: false });

/** 答题纸上一行的显示：和解题表同样的写法。 */
export function entryCells(entry: Entry): string[] {
  const out = entry.out.trim() === '' ? (entry.writeBack ? '（写回）' : '') : `块 ${entry.out.trim()}${entry.writeBack ? '（写回）' : ''}`;
  return [entry.block.trim(), entry.index.trim(), entry.tag.trim(), entry.result, out];
}

/** 解题表的一行 → 学生要填的格式。看答案时用。 */
export function entryOf(cells: string[]): Entry {
  const out = /块 (\d+)/.exec(cells[5] ?? '');
  return {
    block: cells[1] ?? '',
    index: cells[2] ?? '',
    tag: cells[3] ?? '',
    result: cells[4] === '命中' || cells[4] === '缺失' ? cells[4] : '',
    out: out?.[1] ?? '',
    writeBack: (cells[5] ?? '').includes('写回'),
  };
}

const sameNumber = (a: string, b: string): boolean => a.trim() !== '' && /^\d+$/.test(a.trim()) && Number(a) === Number(b);
const outKey = (text: string, writeBack: boolean): string => {
  const n = /(\d+)/.exec(text)?.[1];
  return n === undefined ? (writeBack ? 'W' : '') : `${Number(n)}${writeBack ? 'W' : ''}`;
};

export interface Grade {
  /** 每行错的列（0 块号，1 行号或组号，2 标记，3 结果，4 换出）。 */
  wrong: number[][];
  /** 第一处错的行，全对为 -1。 */
  first: number;
}

/** 逐格和引擎的解题表比。 */
export function grade(trace: Trace<Params, State>, entries: Entry[]): Grade {
  const wrong = trace.table.rows.map((row, r) => {
    const cells = row.cells;
    const e = entries[r] ?? blankEntry();
    const bad: number[] = [];
    if (!sameNumber(e.block, cells[1] ?? '')) bad.push(0);
    if (!sameNumber(e.index, cells[2] ?? '')) bad.push(1);
    if (!sameNumber(e.tag, cells[3] ?? '')) bad.push(2);
    if (e.result !== cells[4]) bad.push(3);
    const expected = cells[5] ?? '';
    if (outKey(e.out, e.writeBack) !== outKey(expected, expected.includes('写回'))) bad.push(4);
    return bad;
  });
  return { wrong, first: wrong.findIndex((bad) => bad.length > 0) };
}
