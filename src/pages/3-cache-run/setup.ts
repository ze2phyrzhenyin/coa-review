/**
 * 这一页用到的参数：讲解的例题、试一试的选项、访问序列的写法。
 * 台面的尺寸固定：cache 4 行，每块 2 字，按字编址，地址 5 位，主存 16 块。
 * 这里只拼参数，不算结果；结果都由 src/engines/cache 给出。
 */
import type { Access, Mapping, Params, Replacement } from '../../engines/cache/model';

export const ROWS = 4;
export const BLOCK_WORDS = 2;
export const ADDRESS_BITS = 5;
export const MAX_SEQUENCE = 12;

/** 讲解的例题：直接映射。写 10 是写缺失，写 8 是写命中；块 5 被块 13 顶出（写回）之后再访问，又缺失一次。 */
export const exampleSequence: Access[] = [
  { address: 9, op: '读' },
  { address: 10, op: '写' },
  { address: 8, op: '写' },
  { address: 26, op: '读' },
  { address: 11, op: '读' },
  { address: 9, op: '读' },
];

export function makeParams(mapping: Mapping, replacement: Replacement, accesses: Access[]): Params {
  const params: Params = { mapping, rows: ROWS, blockWords: BLOCK_WORDS, addressBits: ADDRESS_BITS, accesses };
  if (mapping === '组相联') params.rowsPerSet = 2;
  if (mapping !== '直接') params.replacement = replacement;
  return params;
}

/** 试一试的缺省序列：直接映射、LRU、LFU 三者的命中次数各不相同。 */
export const trySequence: Access[] = [
  { address: 7, op: '读' },
  { address: 6, op: '读' },
  { address: 10, op: '写' },
  { address: 11, op: '读' },
  { address: 22, op: '读' },
  { address: 31, op: '读' },
  { address: 13, op: '读' },
  { address: 23, op: '读' },
];

export const exampleParams: Params = makeParams('直接', 'LRU', exampleSequence);

/** 网址里的写法 ↔ 引擎的取值。 */
export const mappingKeys: { key: string; mapping: Mapping; label: string }[] = [
  { key: 'direct', mapping: '直接', label: '直接映射' },
  { key: 'set', mapping: '组相联', label: '2 路组相联' },
  { key: 'full', mapping: '全相联', label: '全相联' },
];
export const policyKeys: { key: string; policy: Replacement; label: string }[] = [
  { key: 'lru', policy: 'LRU', label: 'LRU' },
  { key: 'lfu', policy: 'LFU', label: 'LFU' },
];

export function mappingOf(key: string): Mapping {
  return mappingKeys.find((item) => item.key === key)?.mapping ?? '直接';
}
export function policyOf(key: string): Replacement {
  return policyKeys.find((item) => item.key === key)?.policy ?? 'LRU';
}
export function mappingKey(mapping: Mapping): string {
  return mappingKeys.find((item) => item.mapping === mapping)?.key ?? 'direct';
}
export function policyKey(policy: Replacement): string {
  return policyKeys.find((item) => item.policy === policy)?.key ?? 'lru';
}

/** 网址里的序列：逗号隔开，写操作前加 w，例如 9,w10,8。 */
export function encodeSequence(accesses: Access[]): string {
  return accesses.map((a) => `${a.op === '写' ? 'w' : ''}${a.address}`).join(',');
}

/** 给学生看的写法：空格隔开，写操作前加「写」。 */
export function showSequence(accesses: Access[]): string {
  return accesses.map((a) => `${a.op === '写' ? '写' : ''}${a.address}`).join(' ');
}

export interface Parsed {
  accesses: Access[];
  problems: string[];
}

/** 读学生输入或网址里的序列。认空格、逗号、顿号；写操作前加「写」或 w。 */
export function parseSequence(text: string): Parsed {
  const tokens = text
    .trim()
    .split(/[\s,，、;；]+/)
    .filter((token) => token !== '');
  const accesses: Access[] = [];
  const problems: string[] = [];
  for (const token of tokens) {
    const match = /^(写|w|W|读|r|R)?(\d+)$/.exec(token);
    if (!match) {
      problems.push(`看不懂「${token}」：每项写一个十进制地址，写操作前加「写」`);
      continue;
    }
    const address = Number(match[2]);
    if (address >= 2 ** ADDRESS_BITS) {
      problems.push(`地址 ${address} 超出范围，地址 ${ADDRESS_BITS} 位，最大 ${2 ** ADDRESS_BITS - 1}`);
      continue;
    }
    accesses.push({ address, op: match[1] === '写' || match[1] === 'w' || match[1] === 'W' ? '写' : '读' });
  }
  if (tokens.length === 0) problems.push('至少写一个地址');
  if (accesses.length > MAX_SEQUENCE) problems.push(`最多 ${MAX_SEQUENCE} 次访问`);
  return { accesses: accesses.slice(0, MAX_SEQUENCE), problems };
}
