/**
 * 这一页的参数：讲解的例题、网址里的写法、练习的出题和判分。只拼参数、比对答案；位数和切分都由 src/engines/cacheaddr 给出。
 */
import { generate, run, validateParams } from '../../engines/cacheaddr/model';
import type { Mapping, Params } from '../../engines/cacheaddr/model';

/** 讲解的例题（本站自拟）：主存 256K 字，cache 2K 字，每块 8 字，地址 2D6B5H。三种映射用同一组数，只换映射方式。 */
const BASE = { blockWords: 8, memoryUnits: 2 ** 18, cacheUnits: 2 ** 11, address: '2D6B5' };
export const examples: { key: string; label: string; params: Params }[] = [
  { key: 'direct', label: '直接映射', params: { mapping: '直接', ...BASE } },
  { key: 'set', label: '4 路组相联', params: { mapping: '组相联', rowsPerSet: 4, ...BASE } },
  { key: 'full', label: '全相联', params: { mapping: '全相联', ...BASE } },
];

export const mappingKeys: { key: string; mapping: Mapping; label: string }[] = [
  { key: 'direct', mapping: '直接', label: '直接映射' },
  { key: 'set', mapping: '组相联', label: '组相联' },
  { key: 'full', mapping: '全相联', label: '全相联' },
];

/** 容量的写法：4096、4K、1M、2^12 都认。 */
export function parseSize(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').toUpperCase();
  const pow = /^2\^(\d+)$/.exec(t);
  if (pow) return 2 ** Number(pow[1]);
  const m = /^(\d+)([KMG]?)$/.exec(t);
  if (!m) return null;
  const scale = m[2] === 'K' ? 2 ** 10 : m[2] === 'M' ? 2 ** 20 : m[2] === 'G' ? 2 ** 30 : 1;
  return Number(m[1]) * scale;
}

/** 2 的幂写成 4K、1M。 */
export function showSize(n: number): string {
  if (n >= 2 ** 30 && n % 2 ** 30 === 0) return `${n / 2 ** 30}G`;
  if (n >= 2 ** 20 && n % 2 ** 20 === 0) return `${n / 2 ** 20}M`;
  if (n >= 2 ** 10 && n % 2 ** 10 === 0) return `${n / 2 ** 10}K`;
  return String(n);
}

/** 试一试的输入（全部是网址里的字符串）。 */
export interface TryInput {
  map: string;
  v: string;
  unit: string;
  wb: string;
  k: string;
  mem: string;
  memIn: string;
  cache: string;
  cacheIn: string;
  addr: string;
}

export const DEFAULT_TRY: TryInput = { map: 'set', v: '2', unit: 'word', wb: '2', k: '4', mem: '64K', memIn: 'unit', cache: '1K', cacheIn: 'unit', addr: 'A3C6' };

/** 试一试的输入 → 引擎参数。有问题时给出第一条。 */
export function tryParams(input: TryInput): { params: Params | null; problem: string } {
  const mapping = mappingKeys.find((item) => item.key === input.map)?.mapping ?? '组相联';
  const k = Number(input.k);
  const mem = parseSize(input.mem);
  const cache = parseSize(input.cache);
  if (!Number.isInteger(k) || k < 1) return { params: null, problem: '每块字数写一个正整数，如 4' };
  if (mem === null) return { params: null, problem: '主存容量写成 64K、1M 或 4096 这样' };
  if (cache === null) return { params: null, problem: 'cache 容量写成 1K、2K 或 128 这样' };
  const params: Params = { mapping, blockWords: k };
  if (input.unit === 'byte') {
    params.unit = '字节';
    params.wordBytes = Number(input.wb);
  }
  if (input.memIn === 'block') params.memoryBlocks = mem;
  else params.memoryUnits = mem;
  if (input.cacheIn === 'row') params.cacheRows = cache;
  else params.cacheUnits = cache;
  if (mapping === '组相联') params.rowsPerSet = Number(input.v);
  const address = input.addr.trim().replace(/[Hh]$/, '');
  if (address !== '') params.address = address.toUpperCase();
  const problems = validateParams(params);
  return problems.length ? { params: null, problem: problems[0]! } : { params, problem: '' };
}

/** 引擎参数 → 试一试的输入（练习里「看演示」用）。 */
export function inputOf(params: Params): TryInput {
  const byte = params.unit === '字节';
  return {
    map: mappingKeys.find((item) => item.mapping === params.mapping)?.key ?? 'set',
    v: String(params.rowsPerSet ?? 2),
    unit: byte ? 'byte' : 'word',
    wb: String(params.wordBytes ?? 2),
    k: String(params.blockWords ?? 1),
    mem: showSize(params.memoryBlocks ?? params.memoryUnits ?? 0),
    memIn: params.memoryBlocks !== undefined ? 'block' : 'unit',
    cache: showSize(params.cacheRows ?? params.cacheUnits ?? 0),
    cacheIn: params.cacheRows !== undefined ? 'row' : 'unit',
    addr: params.address ?? '',
  };
}

export const indexName = (mapping: Mapping): string => (mapping === '直接' ? '行号' : mapping === '组相联' ? '组号' : '');

/** 练习：引擎按种子出题。 */
export const quizParams = (seed: number): Params => generate(seed);

export interface Answer {
  /** 标记、行号或组号、字地址的位数。 */
  bits: string[];
  /** 三段的十六进制。 */
  hex: string[];
  length: string;
}

export interface Grade {
  /** 错的格：'b0' 'b1' 'b2' 是位数，'h0'… 是十六进制，'len' 是地址位数。按答题顺序排。 */
  wrong: string[];
}

const hexKey = (text: string): string => {
  const t = text.trim().toUpperCase().replace(/H$/, '').replace(/^0+(?=.)/, '');
  return t === '' || t === '无' ? '无' : t;
};

/** 答题纸上的格子顺序：先位数（字地址、中间段、标记），再地址位数，再十六进制（标记、中间段、字地址）。 */
export function grade(params: Params, answer: Answer): Grade {
  const result = run(params).result;
  const name = indexName(params.mapping);
  const keys = params.mapping === '全相联' ? ['标记', '字地址'] : ['标记', name, '字地址'];
  const wrong: string[] = [];
  const bitsOf = (key: string): string => result[`${key}位数`] ?? '';
  for (const i of [keys.length - 1, ...(keys.length === 3 ? [1] : []), 0]) {
    const typed = (answer.bits[i] ?? '').trim();
    if (typed === '' || Number(typed) !== Number(bitsOf(keys[i]!))) wrong.push(`b${i}`);
  }
  if (Number(answer.length.trim() || NaN) !== Number(result['地址位数'])) wrong.push('len');
  keys.forEach((key, i) => {
    if (hexKey(answer.hex[i] ?? '') !== hexKey(result[key] ?? '')) wrong.push(`h${i}`);
  });
  return { wrong };
}

/** 引擎的答案换成答题纸的写法。看答案时用。 */
export function answerOf(params: Params): Answer {
  const result = run(params).result;
  const name = indexName(params.mapping);
  const keys = params.mapping === '全相联' ? ['标记', '字地址'] : ['标记', name, '字地址'];
  return { bits: keys.map((key) => result[`${key}位数`] ?? ''), hex: keys.map((key) => result[key] ?? ''), length: result['地址位数'] ?? '' };
}
