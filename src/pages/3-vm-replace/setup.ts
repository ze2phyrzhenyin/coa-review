/**
 * 这一页的参数：讲解的例题、试一试的选项和网址写法、练习的判分。
 * 这里只拼参数、比对答案；表里的数都由 src/engines/vmreplace 给出。
 */
import { run, simulate, validateParams } from '../../engines/vmreplace/model';
import type { Params, Policy } from '../../engines/vmreplace/model';

/** 讲解的例题（本站自拟）：3 个页面，开始是空的。第 4 次访问页 3 时它在 c 格，FIFO 和 FIFO+LRU 从这里分开。 */
export const EXAMPLE_PAGES = [3, 5, 4, 3, 6, 4, 1, 2, 4];
export const examples = [
  { key: 'fifo', label: 'FIFO', params: { frames: 3, policy: 'FIFO', pages: EXAMPLE_PAGES } as Params },
  { key: 'lru', label: 'FIFO+LRU', params: { frames: 3, policy: 'FIFO+LRU', pages: EXAMPLE_PAGES } as Params },
] as const;

export const policyKeys: { key: string; policy: Policy; label: string }[] = [
  { key: 'fifo', policy: 'FIFO', label: 'FIFO' },
  { key: 'fifo-lru', policy: 'FIFO+LRU', label: 'FIFO+LRU' },
  { key: 'lru', policy: 'LRU', label: 'LRU' },
];
export const policyOf = (key: string): Policy => policyKeys.find((item) => item.key === key)?.policy ?? 'FIFO';

export const MAX_TRY = 16;

/** 学生输入或网址里的一串非负整数。认空格、逗号、顿号。 */
export function parseList(text: string): { list: number[]; problem: string } {
  const tokens = text.trim().split(/[\s,，、;；]+/).filter((token) => token !== '');
  const list: number[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) return { list, problem: `看不懂「${token}」：每项写一个非负整数，空格隔开` };
    list.push(Number(token));
  }
  return { list, problem: '' };
}

export interface TryInput {
  policy: Policy;
  frames: number;
  kind: 'page' | 'addr';
  seq: string;
  size: string;
  init: string;
}

/** 试一试的输入 → 引擎参数。有问题时给出第一条，参数为 null。 */
export function tryParams(input: TryInput): { params: Params | null; problem: string } {
  const seq = parseList(input.seq);
  if (seq.problem) return { params: null, problem: seq.problem };
  if (seq.list.length === 0) return { params: null, problem: '至少写一次访问' };
  if (seq.list.length > MAX_TRY) return { params: null, problem: `最多 ${MAX_TRY} 次访问` };
  const init = parseList(input.init);
  if (init.problem) return { params: null, problem: init.problem };
  const params: Params = { frames: input.frames, policy: input.policy };
  if (input.kind === 'addr') {
    params.addresses = seq.list;
    params.pageSize = Number(input.size);
  } else params.pages = seq.list;
  if (init.list.length > 0) params.initial = init.list;
  const problems = validateParams(params);
  return problems.length ? { params: null, problem: problems[0]! } : { params, problem: '' };
}

/** 练习一列的答案：各格的页号（空着写空串）和命中还是缺页。 */
export interface Column {
  cells: string[];
  result: '' | '命中' | '缺页';
}
export const blankColumn = (frames: number): Column => ({ cells: Array.from({ length: frames }, () => ''), result: '' });

export interface Summary {
  ratio: string;
  evicted: string;
}

export interface Grade {
  /** 每列错的格：0…frames−1 是 a、b、c…，frames 是「命中」那一格。 */
  wrong: number[][];
  first: number;
  ratioOk: boolean;
  evictedOk: boolean;
}

const same = (typed: string, page: number | null): boolean => (page === null ? typed.trim() === '' : /^\d+$/.test(typed.trim()) && Number(typed) === page);

/** 命中率接受「h/n」或百分数（一位小数，可以不写 %）。 */
function ratioOk(typed: string, hits: number, total: number): boolean {
  const text = typed.replace(/\s/g, '');
  const frac = /^(\d+)\/(\d+)/.exec(text);
  if (frac && Number(frac[2]) > 0 && Number(frac[1]) * total === hits * Number(frac[2])) return true;
  const percent = /=?(\d+(?:\.\d+)?)%?$/.exec(text);
  return !!percent && Math.abs(Number(percent[1]) - (hits / total) * 100) < 0.051;
}

/** 逐格和引擎的结果比。 */
export function grade(params: Params, columns: Column[], summary: Summary): Grade {
  const truth = simulate(params);
  const wrong = truth.map((col, k) => {
    const mine = columns[k] ?? blankColumn(params.frames);
    const bad: number[] = [];
    col.frames.forEach((page, r) => {
      if (!same(mine.cells[r] ?? '', page)) bad.push(r);
    });
    if (mine.result !== (col.hit ? '命中' : '缺页')) bad.push(params.frames);
    return bad;
  });
  const result = run(params).result;
  const hits = Number(result['命中次数']);
  const evicted = result['淘汰页号'] === '无' ? [] : (result['淘汰页号'] ?? '').split('、').map(Number);
  const typed = parseList(summary.evicted.replace(/无/g, '')).list;
  return {
    wrong,
    first: wrong.findIndex((bad) => bad.length > 0),
    ratioOk: ratioOk(summary.ratio, hits, truth.length),
    evictedOk: typed.length === evicted.length && typed.every((p, i) => p === evicted[i]),
  };
}

/** 引擎的答案换成答题纸的写法。看答案时用。 */
export function answerColumns(params: Params): Column[] {
  return simulate(params).map((col) => ({ cells: col.frames.map((p) => (p === null ? '' : String(p))), result: col.hit ? '命中' : '缺页' }));
}

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

/**
 * 练习的题：3 或 4 个页面，9–11 次访问，相邻两次不访问同一页。
 * 只要有区分度的：至少两次命中、至少两次换出，而且有一次命中的页不在 a 格（FIFO 和 FIFO+LRU 在这里分开）。
 * 同一个题号总是同一道题；表里的答案都由引擎算。
 */
export function quizParams(seed: number): Params {
  const next = generator(seed * 2654435761);
  const pick = (n: number): number => Math.floor(next() * n);
  const frames = 3 + pick(2);
  const policy: Policy = (['FIFO', 'FIFO+LRU', 'FIFO', 'FIFO+LRU', 'LRU'] as const)[pick(5)]!;
  let fallback: Params | null = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const length = 9 + pick(3);
    const span = frames + 2;
    const pages: number[] = [];
    while (pages.length < length) {
      const recent = pages.slice(-frames - 1);
      const p = recent.length > 1 && pick(5) < 2 ? recent[pick(recent.length)]! : pick(span);
      if (p !== pages[pages.length - 1]) pages.push(p);
    }
    const params: Params = { frames, policy, pages };
    fallback ??= params;
    const cols = simulate(params);
    const deep = cols.some((c, i) => c.hit && i > 0 && (cols[i - 1]!.frames.indexOf(c.page) ?? 0) > 0);
    if (cols.filter((c) => c.hit).length >= 2 && cols.filter((c) => c.evicted !== null).length >= 2 && deep) return params;
  }
  return fallback!;
}
