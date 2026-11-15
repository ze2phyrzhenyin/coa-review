/**
 * 这一页的参数：讲解的例题、试一试的写法、练习的判分。只拼参数、比对答案；变换结果都由 src/engines/vm 给出。
 */
import { generate, run, validateParams } from '../../engines/vm/model';
import type { Entry, Params } from '../../engines/vm/model';

/** 讲解的例题（本站自拟）：页长 1K，虚存 32 页，主存 16 页；三个虚地址，第二个缺页。第二题只多一张快表。 */
const TABLE: Entry[] = [
  { page: 0, valid: 1, frame: 9 },
  { page: 1, valid: 0, frame: null },
  { page: 2, valid: 1, frame: 4 },
  { page: 3, valid: 1, frame: 5 },
  { page: 4, valid: 0, frame: null },
];
const BASE: Params = { pageSize: 1024, pages: 32, frames: 16, table: TABLE, addresses: [0x0db4, 0x12a7, 0x0a1c] };
export const examples: { key: string; label: string; params: Params }[] = [
  { key: 'pt', label: '只查页表', params: BASE },
  { key: 'tlb', label: '加一层快表', params: { ...BASE, tlb: [{ page: 3, frame: 5 }, { page: 0, frame: 9 }] } },
];

export const log2 = (n: number): number => Math.round(Math.log2(n));

/** 页表、快表的写法：「0:9 1:- 2:4」，冒号后是物理页号，「-」表示有效位为 0。 */
export function parseEntries(text: string): { list: { page: number; frame: number | null }[]; problem: string } {
  const list: { page: number; frame: number | null }[] = [];
  for (const token of text.trim().split(/[\s,，、;；]+/).filter(Boolean)) {
    const m = /^(\d+)[:：](\d+|-)$/.exec(token);
    if (!m) return { list, problem: `看不懂「${token}」：每项写「页号:物理页号」，不在主存写「页号:-」` };
    list.push({ page: Number(m[1]), frame: m[2] === '-' ? null : Number(m[2]) });
  }
  return { list, problem: '' };
}
export const showEntries = (list: { page: number; frame: number | null }[]): string => list.map((e) => `${e.page}:${e.frame === null ? '-' : e.frame}`).join(' ');

/** 地址的写法：十六进制可带 H，十进制原样。 */
export function parseAddresses(text: string, radix: 'hex' | 'dec'): { list: number[]; problem: string } {
  const list: number[] = [];
  for (const token of text.trim().split(/[\s,，、;；]+/).filter(Boolean)) {
    const t = token.toUpperCase().replace(/H$/, '');
    const ok = radix === 'hex' ? /^[0-9A-F]+$/.test(t) : /^\d+$/.test(t);
    if (!ok) return { list, problem: `看不懂「${token}」：${radix === 'hex' ? '写十六进制，如 0DB4H' : '写十进制整数'}` };
    list.push(parseInt(t, radix === 'hex' ? 16 : 10));
  }
  return { list, problem: list.length === 0 ? '至少写一个虚地址' : '' };
}

export interface TryInput {
  size: string;
  pages: string;
  frames: string;
  table: string;
  tlb: string;
  addr: string;
  radix: string;
}
export const DEFAULT_TRY: TryInput = { size: '2048', pages: '16', frames: '8', table: '0:3 1:6 2:- 3:1 5:2', tlb: '', addr: '1A2FH 0C05H 2B70H', radix: 'hex' };

export function tryParams(input: TryInput): { params: Params | null; problem: string } {
  const radix = input.radix === 'dec' ? 'dec' : 'hex';
  const entries = parseEntries(input.table);
  if (entries.problem) return { params: null, problem: entries.problem };
  if (entries.list.length > 8) return { params: null, problem: '页表最多列 8 项（台面上放得下的行数）' };
  const tlb = parseEntries(input.tlb);
  if (tlb.problem) return { params: null, problem: tlb.problem };
  if (tlb.list.some((e) => e.frame === null)) return { params: null, problem: '快表里只放在主存的页，不写「-」' };
  const addresses = parseAddresses(input.addr, radix);
  if (addresses.problem) return { params: null, problem: addresses.problem };
  const params: Params = {
    pageSize: Number(input.size),
    pages: Number(input.pages),
    frames: Number(input.frames),
    table: entries.list.map((e) => (e.frame === null ? { page: e.page, valid: 0, frame: null } : { page: e.page, valid: 1, frame: e.frame })),
    addresses: addresses.list,
    radix,
  };
  if (input.tlb.trim() !== '') params.tlb = tlb.list.map((e) => ({ page: e.page, frame: e.frame ?? 0 }));
  const problems = validateParams(params);
  return problems.length ? { params: null, problem: problems[0]! } : { params, problem: '' };
}

/** 引擎参数 → 试一试的输入（练习里「看演示」用）。 */
export function inputOf(params: Params): TryInput {
  const radix = params.radix ?? 'hex';
  const bits = log2(params.pages * params.pageSize);
  const digits = Math.max(1, Math.ceil(bits / 4));
  return {
    size: String(params.pageSize),
    pages: String(params.pages),
    frames: String(params.frames),
    table: showEntries(params.table.map((e) => ({ page: e.page, frame: e.valid === 1 ? e.frame : null }))),
    tlb: params.tlb ? showEntries(params.tlb) : '',
    addr: params.addresses.map((a) => (radix === 'hex' ? `${a.toString(16).toUpperCase().padStart(digits, '0')}H` : String(a))).join(' '),
    radix,
  };
}

/** 练习：引擎按种子出题，只要至少有一个缺页、至少一个能变换成功的。 */
export function quizParams(seed: number): Params {
  let first: Params | null = null;
  for (let k = 0; k < 30; k++) {
    const params = generate(seed + 7919 * k);
    first ??= params;
    const result = run(params).result;
    const faults = Number(result['缺页次数']);
    if (faults >= 1 && faults < params.addresses.length) return params;
  }
  return first!;
}

/** 一行的数：带 H 或含 A–F 的按十六进制读，否则按十进制；asHex 时一律按十六进制读（物理地址一栏）。 */
export function readNumber(text: string, asHex = false): number | null {
  const t = text.trim().toUpperCase();
  if (t === '') return null;
  if (asHex || /H$/.test(t) || /[A-F]/.test(t)) {
    const body = t.replace(/H$/, '');
    return /^[0-9A-F]+$/.test(body) ? parseInt(body, 16) : null;
  }
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** 答题纸一行：除虚地址外每一格学生写的字。 */
export type Row = string[];

/** 逐格和引擎的解题表比。返回每行错的列下标（解题表的列，从 1 起，0 是虚地址）。 */
export function grade(params: Params, rows: Row[]): number[][] {
  const table = run(params).table;
  const hex = (params.radix ?? 'hex') === 'hex';
  return table.rows.map((row, r) => {
    const mine = rows[r] ?? [];
    const bad: number[] = [];
    row.cells.forEach((cell, c) => {
      if (c === 0) return;
      const typed = (mine[c] ?? '').trim();
      const column = table.columns[c] ?? '';
      if (cell === '缺页' || cell === '命中' || cell === '未命中' || cell === DASH) {
        // 快表命中时有效位一格引擎写一道横线，学生写横线或空着都算对。
        const want = cell === DASH ? [DASH, '-', '－', ''] : [cell];
        if (!want.includes(typed)) bad.push(c);
        return;
      }
      const isAddress = column === '物理地址';
      const a = readNumber(typed, isAddress && hex);
      const b = readNumber(cell, isAddress && hex);
      if (a === null || a !== b) bad.push(c);
    });
    return bad;
  });
}

/** 引擎解题表里「不用看」的那道横线。 */
export const DASH = '\u2014';

export const answerRows = (params: Params): Row[] => run(params).table.rows.map((row) => [...row.cells]);
