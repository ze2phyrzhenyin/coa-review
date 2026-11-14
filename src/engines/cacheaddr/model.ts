/**
 * cache 地址字段划分引擎（教材 3.6.2，p102–108，例 3.5–3.7）。规格见 specs/3-cache-addr.md。
 *
 * 记号跟教材：每块 k = 2^w 字，cache m = 2^r 行；组相联 u = 2^d 组、每组 v 行；主存 2^s 块。
 * 地址格式：全相联 标记 s | 字地址 w；直接 标记 s−r | 行号 r | 字地址 w；组相联 标记 s−d | 组号 d | 字地址 w。
 * 切分复用 cache 引擎的 layout 和 splitAddress。状态路径（w、tag、address.tagBits …）是页面引用的 id，不要改名。
 */
import { TraceBuilder, type Condition, type SolutionTable, type Trace } from '../trace';
import { layout, splitAddress, type Layout, type Params as CacheParams } from '../cache/model';

export const ENGINE = 'cacheaddr';
export const MAX_ADDRESS_BITS = 32;
export const MAX_BLOCK_WORDS = 2 ** 16;

export type Mapping = '全相联' | '直接' | '组相联';

export interface Params {
  mapping: Mapping;
  rowsPerSet?: number;
  unit?: '字' | '字节';
  wordBytes?: number;
  blockWords?: number;
  memoryBlocks?: number;
  memoryUnits?: number;
  cacheRows?: number;
  cacheUnits?: number;
  /** 直接给各字段位数（例 3.5 型）。 */
  fields?: { tag: number; index: number; word: number };
  /** 要切分的地址，十六进制，不带 H。 */
  address?: string;
}

export interface Split {
  hex: string;
  bits: string;
  tagBits: string;
  indexBits: string;
  wordBits: string;
  tagHex: string;
  indexHex: string;
  wordHex: string;
}

export interface State {
  w: number | null;
  v: number | null;
  r: number | null;
  d: number | null;
  u: number | null;
  s: number | null;
  tag: number | null;
  length: number | null;
  format: string;
  address: Split | null;
}

/** 由参数求出的各量。没有的为 null。 */
export interface Widths {
  w: number;
  /** cache 行数 m；全相联没给容量时为 null。 */
  m: number | null;
  v: number | null;
  r: number | null;
  d: number | null;
  u: number | null;
  s: number;
  tag: number;
  /** 中间一段的位数：直接 r，组相联 d，全相联 0。 */
  index: number;
  length: number;
}

const MAPPINGS: readonly string[] = ['全相联', '直接', '组相联'];

function isPowerOfTwo(n: unknown): n is number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return false;
  let x = n;
  while (x % 2 === 0) x /= 2;
  return x === 1;
}

function log2(n: number): number {
  let bits = 0;
  for (let x = n; x > 1; x /= 2) bits += 1;
  return bits;
}

const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function blockUnitsOf(params: Params): number {
  return (params.blockWords ?? 1) * (params.unit === '字节' ? (params.wordBytes ?? 1) : 1);
}

/** 参数有什么问题。空表示可以运行。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const p = params as Partial<Record<keyof Params, unknown>>;
  if (!MAPPINGS.includes(p.mapping as string)) problems.push('映射方式只能是全相联、直接、组相联');
  const capacity = (['rowsPerSet', 'unit', 'wordBytes', 'blockWords', 'memoryBlocks', 'memoryUnits', 'cacheRows', 'cacheUnits'] as const).filter(
    (key) => p[key] !== undefined,
  );
  if (p.address !== undefined && (typeof p.address !== 'string' || !/^[0-9A-Fa-f]{1,8}$/.test(p.address))) {
    problems.push('地址要写成十六进制，1 到 8 位，不带 H');
  }
  if (p.fields !== undefined) {
    if (capacity.length > 0) problems.push('直接给了字段位数，就不要再给容量');
    const f = p.fields as Partial<Record<'tag' | 'index' | 'word', unknown>> | null;
    if (f === null || typeof f !== 'object' || !isNat(f.tag) || !isNat(f.index) || !isNat(f.word)) {
      problems.push('字段位数必须是非负整数');
    } else {
      if (f.tag < 1) problems.push('标记至少 1 位');
      if (p.mapping === '全相联' && f.index !== 0) problems.push('全相联没有行号或组号，中间一段为 0 位');
      if (f.tag + f.index + f.word > MAX_ADDRESS_BITS) problems.push(`地址不能超过 ${MAX_ADDRESS_BITS} 位`);
    }
  } else {
    if (p.unit !== undefined && p.unit !== '字' && p.unit !== '字节') problems.push('编址单位只能是字或字节');
    if (p.wordBytes !== undefined && (!isPowerOfTwo(p.wordBytes) || p.wordBytes > 8)) problems.push('每字的字节数必须是 1、2、4 或 8');
    if (!isPowerOfTwo(p.blockWords) || p.blockWords > MAX_BLOCK_WORDS) problems.push('每块字数必须是 2 的幂，不超过 65536');
    if ((p.memoryBlocks === undefined) === (p.memoryUnits === undefined)) problems.push('主存块数和主存容量要给一个，只能给一个');
    for (const key of ['memoryBlocks', 'memoryUnits', 'cacheRows', 'cacheUnits'] as const) {
      if (p[key] !== undefined && (!isPowerOfTwo(p[key]) || (p[key] as number) > 2 ** MAX_ADDRESS_BITS)) problems.push(`${key} 必须是 2 的幂`);
    }
    const hasCache = p.cacheRows !== undefined || p.cacheUnits !== undefined;
    if (p.cacheRows !== undefined && p.cacheUnits !== undefined) problems.push('cache 行数和 cache 容量只能给一个');
    if (!hasCache && p.mapping !== '全相联') problems.push('直接映射和组相联要给 cache 行数或容量');
    if (p.mapping === '组相联' && !isPowerOfTwo(p.rowsPerSet)) problems.push('组相联必须给每组行数，且是 2 的幂');
    if (p.mapping !== '组相联' && p.rowsPerSet !== undefined) problems.push('只有组相联要给每组行数');
    if (problems.length > 0) return problems;

    const k = blockUnitsOf(params);
    if (params.memoryUnits !== undefined && params.memoryUnits < k) problems.push('主存容量不能小于一块');
    if (params.cacheUnits !== undefined && params.cacheUnits < k) problems.push('cache 容量不能小于一块');
    if (problems.length > 0) return problems;
    const g = widths(params);
    if (g.m !== null) {
      const blocks = 2 ** g.s;
      if (g.m > blocks) problems.push('cache 行数不能多于主存块数');
      if (g.v !== null && g.v > g.m) problems.push('每组行数不能超过 cache 行数');
    }
    if (problems.length > 0) return problems;
    if (g.tag < 1) problems.push('标记至少要 1 位：主存太小或 cache 太大');
    if (g.length > MAX_ADDRESS_BITS) problems.push(`地址不能超过 ${MAX_ADDRESS_BITS} 位`);
  }
  if (problems.length === 0 && typeof params.address === 'string') {
    const g = widths(params);
    if (parseInt(params.address, 16) >= 2 ** g.length) problems.push(`地址超出 ${g.length} 位能表示的范围`);
  }
  return problems;
}

/** 由容量或给定格式求出 w、r、d、u、s、标记位数和地址长度。参数要先通过 validateParams。 */
export function widths(params: Params): Widths {
  const f = params.fields;
  if (f) {
    const s = f.tag + f.index;
    const direct = params.mapping === '直接';
    const set = params.mapping === '组相联';
    return {
      w: f.word,
      m: direct ? 2 ** f.index : null,
      v: null,
      r: direct ? f.index : null,
      d: set ? f.index : null,
      u: set ? 2 ** f.index : null,
      s,
      tag: f.tag,
      index: f.index,
      length: s + f.word,
    };
  }
  const k = blockUnitsOf(params);
  const w = log2(k);
  const m = params.cacheRows ?? (params.cacheUnits !== undefined ? params.cacheUnits / k : null);
  const s = params.memoryBlocks !== undefined ? log2(params.memoryBlocks) : log2(params.memoryUnits ?? k) - w;
  if (params.mapping === '直接') {
    const r = log2(m ?? 1);
    return { w, m, v: null, r, d: null, u: null, s, tag: s - r, index: r, length: s + w };
  }
  if (params.mapping === '组相联') {
    const v = params.rowsPerSet ?? 1;
    const u = (m ?? v) / v;
    const d = log2(u);
    return { w, m, v, r: null, d, u, s, tag: s - d, index: d, length: s + w };
  }
  return { w, m, v: null, r: null, d: null, u: null, s, tag: s, index: 0, length: s + w };
}

/** 换成 cache 引擎的 Layout，好用它的 splitAddress。 */
function toLayout(params: Params, g: Widths): Layout {
  const cache: CacheParams = {
    mapping: params.mapping,
    rows: params.mapping === '全相联' ? 1 : 2 ** g.index,
    blockWords: 2 ** g.w,
    addressBits: g.length,
    accesses: [],
  };
  if (params.mapping === '组相联') cache.rowsPerSet = 1;
  return layout(cache);
}

const hexOf = (bits: string): string => (bits === '' ? '无' : `${parseInt(bits, 2).toString(16).toUpperCase()}H`);

/** 从右往左每 4 位空一格，方便对着转十六进制。 */
function group4(bits: string): string {
  const out: string[] = [];
  for (let end = bits.length; end > 0; end -= 4) out.unshift(bits.slice(Math.max(0, end - 4), end));
  return out.join(' ');
}

function indexName(mapping: Mapping): string {
  return mapping === '直接' ? '行号' : mapping === '组相联' ? '组号' : '';
}

function formatOf(mapping: Mapping, g: Widths): string {
  const parts = [`标记 ${g.tag} 位`];
  if (mapping !== '全相联') parts.push(`${indexName(mapping)} ${g.index} 位`);
  parts.push(`字地址 ${g.w} 位`);
  return parts.join(' | ');
}

/** 2 的幂写成 4K、1M 这样。 */
function size(n: number): string {
  if (n >= 2 ** 30 && n % 2 ** 30 === 0) return `${n / 2 ** 30}G`;
  if (n >= 2 ** 20 && n % 2 ** 20 === 0) return `${n / 2 ** 20}M`;
  if (n >= 2 ** 10 && n % 2 ** 10 === 0) return `${n / 2 ** 10}K`;
  return String(n);
}

function conditionsOf(params: Params, g: Widths): Condition[] {
  const list: Condition[] = [];
  const mapName = params.mapping === '组相联' ? `组相联映射（每组 ${params.rowsPerSet ?? '?'} 行）` : `${params.mapping}映射`;
  if (params.fields) {
    list.push({ label: '映射方式', value: params.mapping === '组相联' ? '组相联映射' : `${params.mapping}映射` });
    list.push({ label: '给定格式', value: formatOf(params.mapping, g) });
  } else {
    list.push({ label: '映射方式', value: mapName });
    const byte = params.unit === '字节';
    const unitName = byte ? '字节' : '字';
    if (byte) list.push({ label: '编址', value: `按字节编址，每字 ${params.wordBytes ?? 1} 字节` });
    else list.push({ label: '编址', value: '按字编址' });
    list.push({ label: '块大小', value: `每块 ${params.blockWords ?? 1} 字${byte ? `，共 ${blockUnitsOf(params)} 字节` : ''}` });
    if (params.memoryBlocks !== undefined) list.push({ label: '主存', value: `${size(params.memoryBlocks)} 块` });
    else list.push({ label: '主存', value: `${size(params.memoryUnits ?? 0)} ${unitName}` });
    if (params.cacheRows !== undefined) list.push({ label: 'cache', value: `${params.cacheRows} 行` });
    else if (params.cacheUnits !== undefined) list.push({ label: 'cache', value: `${size(params.cacheUnits)} ${unitName}` });
  }
  if (params.mapping !== '全相联') list.push({ label: '教材图中的叫法', value: '区号 | 区内块号 | 字地址' });
  if (params.address !== undefined) list.push({ label: '地址', value: `(${params.address.toUpperCase()})16` });
  return list;
}

const REF = {
  full: '教材 p102–103',
  direct: '教材 p103–104',
  set: '教材 p105–106',
  e5: '教材 p107 例 3.5',
  e6: '教材 p107–108 例 3.6',
  e7: '教材 p108 例 3.7',
};

/** 求字段位数，再切分地址。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`cache 地址参数不对：${problems.join('；')}`);

  const g = widths(params);
  const mapping = params.mapping;
  const iName = indexName(mapping);
  const format = formatOf(mapping, g);
  const initial: State = { w: null, v: null, r: null, d: null, u: null, s: null, tag: null, length: null, format: '', address: null };
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditionsOf(params, g));
  const table: SolutionTable = { columns: ['项目', '算式或二进制', '结果'], rows: [] };
  let n = 0;
  const add = (label: string, how: string, value: string): void => {
    table.rows.push({ cells: [label, how, value], step: `s${n}` });
  };
  const tagRef = mapping === '全相联' ? REF.e7 : mapping === '组相联' ? REF.e6 : REF.direct;
  const tagWhy =
    mapping === '全相联'
      ? `全相联不限定行，块号整个用来比较，标记 = s = ${g.s} 位。`
      : `块号 s 位里，低 ${g.index} 位是${iName}，剩下的高位才存进 cache 当标记：${g.s} − ${g.index} = ${g.tag} 位。`;
  const tagFormula = mapping === '全相联' ? 's' : mapping === '直接' ? 's − r' : 's − d';

  if (params.fields) {
    const f = params.fields;
    builder.step({
      title: `地址格式已给出：${format}`,
      why: `题目直接给了各字段的位数，不用再由容量推算。${mapping === '全相联' ? '' : `中间 ${f.index} 位是${iName}。`}`,
      ref: REF.e5,
      focus: ['w', 'tag', 'format'],
      update: (st) => {
        st.w = g.w;
        st.r = g.r;
        st.d = g.d;
        st.u = g.u;
        st.tag = g.tag;
        st.format = format;
      },
    });
    n += 1;
    add('地址格式', '已给出', format);
    builder.step({
      title: `地址共 ${g.length} 位`,
      why: `三段位数相加：${g.tag} + ${f.index} + ${f.word} = ${g.length}。主存块号 s = 标记 + ${iName || '中间段'} = ${g.s} 位。`,
      ref: REF.e5,
      focus: ['length', 's'],
      update: (st) => {
        st.s = g.s;
        st.length = g.length;
      },
    });
    n += 1;
    add('地址位数', `${g.tag} + ${f.index} + ${f.word}`, String(g.length));
  } else {
    const k = blockUnitsOf(params);
    const byte = params.unit === '字节';
    const unitName = byte ? '字节' : '字';
    // w
    builder.step({
      title: `字地址 w = ${g.w} 位`,
      why: byte
        ? `按字节编址，一块 ${params.blockWords ?? 1} 字 × ${params.wordBytes ?? 1} 字节 = ${k} 字节 = 2^${g.w}，块内要 ${g.w} 位地址，这一段仍叫字地址。`
        : `一块 ${k} 个字 = 2^${g.w}，要 ${g.w} 位才能选中块里的每个字。`,
      ref: byte ? REF.e7 : REF.e6,
      focus: ['w'],
      update: (st) => {
        st.w = g.w;
      },
    });
    n += 1;
    add('字地址 w', `2^w = ${k}`, `${g.w} 位`);

    const m = g.m;
    const rowsWhy = params.cacheUnits !== undefined && m !== null ? `cache ${size(params.cacheUnits)} ${unitName} ÷ 每块 ${k} ${unitName} = ${m} 行。` : '';
    if (mapping === '组相联' && m !== null) {
      const v = g.v ?? 1;
      builder.step({
        title: `每组 v = ${v} 行`,
        why: `${v} 路组相联：一个块可以放在组内 ${v} 行中的任意一行。`,
        ref: REF.e6,
        focus: ['v'],
        update: (st) => {
          st.v = v;
        },
      });
      n += 1;
      add('每组行数 v', '已知', String(v));
      builder.step({
        title: `组号 d = ${g.d ?? 0} 位`,
        why: `${rowsWhy}cache 行数 = u × v = 2^d × ${v} = ${m}，所以 2^d = ${m / v}，d = ${g.d ?? 0}。组数要用行数除以每组行数，不能直接拿行数算。`,
        ref: REF.e6,
        focus: ['d'],
        update: (st) => {
          st.d = g.d;
        },
      });
      n += 1;
      add('组号 d', `2^d × ${v} = ${m}`, `${g.d ?? 0} 位`);
      builder.step({
        title: `组数 u = ${g.u ?? 0}`,
        why: `u = 2^d = 2^${g.d ?? 0} = ${g.u ?? 0}，块号 j 按 j mod ${g.u ?? 0} 归组。`,
        ref: '教材 p105 式(3.8)',
        focus: ['u'],
        update: (st) => {
          st.u = g.u;
        },
      });
      n += 1;
      add('组数 u', `2^${g.d ?? 0}`, String(g.u ?? 0));
    } else if (mapping === '直接' && m !== null) {
      builder.step({
        title: `行号 r = ${g.r ?? 0} 位`,
        why: `${rowsWhy}cache 有 m = ${m} 行 = 2^${g.r ?? 0}，选一行要 ${g.r ?? 0} 位。`,
        ref: REF.direct,
        focus: ['r'],
        update: (st) => {
          st.r = g.r;
        },
      });
      n += 1;
      add('行号 r', `2^r = ${m}`, `${g.r ?? 0} 位`);
    }

    // s
    const sWhy =
      params.memoryBlocks !== undefined
        ? `主存有 ${size(params.memoryBlocks)} 块 = 2^${g.s}，块号 s = ${g.s} 位。`
        : `主存 ${size(params.memoryUnits ?? 0)} ${unitName} = 2^${g.s + g.w}，地址 s + w = ${g.s + g.w} 位，减去字地址 ${g.w} 位，s = ${g.s}。`;
    builder.step({
      title: `块号 s = ${g.s} 位`,
      why: sWhy,
      ref: params.memoryBlocks !== undefined ? REF.e6 : REF.e7,
      focus: ['s'],
      update: (st) => {
        st.s = g.s;
      },
    });
    n += 1;
    add('块号 s', params.memoryBlocks !== undefined ? `2^s = ${size(params.memoryBlocks)}` : `s + w = ${g.s + g.w}`, `${g.s} 位`);

    builder.step({
      title: `标记 ${g.tag} 位`,
      why: tagWhy,
      ref: tagRef,
      focus: ['tag'],
      ask: { prompt: '标记几位', kind: 'number', answer: String(g.tag), hint: `标记 = ${tagFormula}。` },
      update: (st) => {
        st.tag = g.tag;
      },
    });
    n += 1;
    add('标记', mapping === '全相联' ? 's' : `${tagFormula} = ${g.s} − ${g.index}`, `${g.tag} 位`);

    builder.step({
      title: `地址 ${g.length} 位：${format}`,
      why: `地址长度 = s + w = ${g.s} + ${g.w} = ${g.length}，能寻址 2^${g.length} 个${unitName}。从高到低依次是${mapping === '全相联' ? '标记、字地址' : `标记、${iName}、字地址`}。`,
      ref: tagRef,
      focus: ['length', 'format'],
      update: (st) => {
        st.length = g.length;
        st.format = format;
      },
    });
    n += 1;
    add('地址位数', 's + w', String(g.length));
  }

  const result: Record<string, string> = { 标记位数: String(g.tag) };
  if (mapping !== '全相联') result[`${iName}位数`] = String(g.index);
  result['字地址位数'] = String(g.w);
  result['地址位数'] = String(g.length);
  result['地址格式'] = format;

  if (params.address !== undefined) {
    const hex = params.address.toUpperCase();
    const value = parseInt(hex, 16);
    const f = splitAddress(toLayout(params, g), g.length, value);
    const split: Split = {
      hex,
      bits: f.bits,
      tagBits: f.tagBits,
      indexBits: f.indexBits,
      wordBits: f.wordBits,
      tagHex: hexOf(f.tagBits),
      indexHex: hexOf(f.indexBits),
      wordHex: hexOf(f.wordBits),
    };
    const blank: Split = { hex, bits: '', tagBits: '', indexBits: '', wordBits: '', tagHex: '', indexHex: '', wordHex: '' };
    builder.step({
      title: `(${hex})16 写成二进制 ${group4(f.bits)}`,
      why: `每个十六进制位换成 4 位二进制，再按地址长度 ${g.length} 位${hex.length * 4 > g.length ? '去掉高位多出的 0' : '在高位补 0'}。`,
      ref: REF.e5,
      focus: ['address.bits'],
      update: (st) => {
        st.address = { ...blank, bits: f.bits };
      },
    });
    n += 1;
    add('地址', `(${hex})16`, group4(f.bits));

    const pieces = [`高 ${g.tag} 位 ${f.tagBits} 是标记`];
    if (mapping !== '全相联') pieces.push(g.index > 0 ? `接着 ${g.index} 位 ${f.indexBits} 是${iName}` : `${iName} 0 位`);
    pieces.push(g.w > 0 ? `最低 ${g.w} 位 ${f.wordBits} 是字地址` : '字地址 0 位');
    builder.step({
      title: `按 ${format.replace(/ /g, '')} 切开`,
      why: `从高位往低位数：${pieces.join('，')}。字段边界不一定落在十六进制位的边界上，所以要先写成二进制再切。`,
      ref: REF.e5,
      focus: ['address.tagBits', 'address.indexBits', 'address.wordBits'],
      update: (st) => {
        if (st.address) {
          st.address.tagBits = f.tagBits;
          st.address.indexBits = f.indexBits;
          st.address.wordBits = f.wordBits;
        }
      },
    });
    n += 1;

    const parts = [`标记 ${split.tagHex}`];
    if (mapping !== '全相联') parts.push(`${iName} ${split.indexHex}`);
    parts.push(`字地址 ${split.wordHex}`);
    builder.step({
      title: parts.join('，'),
      why: '每一段单独从右往左每 4 位一组换回十六进制，最左一组不足 4 位时高位补 0。',
      ref: REF.e5,
      focus: ['address.tagHex', 'address.indexHex', 'address.wordHex'],
      ask: { prompt: '标记是多少', kind: 'text', answer: split.tagHex, hint: '把标记那一段从右往左 4 位一组换成十六进制，后面写 H。' },
      update: (st) => {
        if (st.address) {
          st.address.tagHex = split.tagHex;
          st.address.indexHex = split.indexHex;
          st.address.wordHex = split.wordHex;
        }
      },
    });
    n += 1;
    add('标记', group4(f.tagBits), split.tagHex);
    if (mapping !== '全相联') add(iName, group4(f.indexBits) || '（0 位）', split.indexHex);
    add('字地址', group4(f.wordBits) || '（0 位）', split.wordHex);
    result['标记'] = split.tagHex;
    if (mapping !== '全相联') result[iName] = split.indexHex;
    result['字地址'] = split.wordHex;
  }

  return builder.finish(result, table);
}

/** 种子 → 32 位无符号数序列（mulberry32）。 */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** 随机出一道题：三种映射、按字或按字节、给块数或容量，带一个十六进制地址。 */
export function generate(seed: number): Params {
  const next = generator(seed);
  const pick = (n: number): number => next() % n;
  const mappings: Mapping[] = ['全相联', '直接', '组相联'];
  const mapping = mappings[pick(3)] ?? '直接';
  const byte = pick(2) === 0;
  const wordBytes = byte ? 2 ** pick(3) : 1;
  const blockWords = 2 ** (1 + pick(5));
  const k = blockWords * wordBytes;
  const rows = 2 ** (4 + pick(6));
  const s = log2(rows) + 4 + pick(6);
  const params: Params = { mapping, blockWords };
  if (byte) {
    params.unit = '字节';
    params.wordBytes = wordBytes;
  }
  if (pick(2) === 0) params.memoryBlocks = 2 ** s;
  else params.memoryUnits = 2 ** s * k;
  if (pick(2) === 0) params.cacheRows = rows;
  else params.cacheUnits = rows * k;
  if (mapping === '组相联') params.rowsPerSet = 2 ** (1 + pick(3));
  const length = s + log2(k);
  const value = (next() * 2 ** 20 + next()) % 2 ** length;
  params.address = value.toString(16).toUpperCase();
  return params;
}
