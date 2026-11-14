/**
 * cache 逐次访问引擎（教材 3.6 节，p100–109）。规格见 specs/3-cache-run.md。
 *
 * 记号跟教材：cache 一侧叫行（m = 2^r 行），主存一侧叫块（2^s 块），每块 k = 2^w 个字；
 * 组相联分 u = 2^d 组、每组 v 行。地址字段是 标记 | 行号或组号 | 字地址。
 * 行里只有标记、修改位、计数器；空行用 tag 和 block 为 null 表示。
 * 状态路径（rows.2.tag、access.tag、hits …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'cache';
export const MAX_ROWS = 256;
export const MAX_BLOCK_WORDS = 1024;
export const MAX_ADDRESS_BITS = 32;
export const MAX_ACCESSES = 200;

/** 全相联 / 直接 / 组相联。 */
export type Mapping = '全相联' | '直接' | '组相联';
/** 最不经常使用 / 近期最少使用 / 随机替换。 */
export type Replacement = 'LFU' | 'LRU' | '随机';
/** 按字编址 / 按字节编址。 */
export type AddressUnit = '字' | '字节';
export type Op = '读' | '写';

export interface Access {
  address: number;
  op: Op;
}

export interface Params {
  mapping: Mapping;
  /** cache 行数 m，2 的幂。 */
  rows: number;
  /** 每组行数 v，2 的幂；只有组相联用。 */
  rowsPerSet?: number;
  /** 每块（行）的字数 k，2 的幂。 */
  blockWords: number;
  /** 主存地址位数，按编址单位算。 */
  addressBits: number;
  /** 编址单位，缺省按字。 */
  unit?: AddressUnit;
  /** 按字节编址时每个字的字节数，2 的幂，缺省 1。 */
  wordBytes?: number;
  /** 替换算法；每个块有不止一行可放时必须给。 */
  replacement?: Replacement;
  /** 随机替换的种子，0 到 2^32−1 的整数。 */
  seed?: number;
  accesses: Access[];
  /** 命中时的 cache 访问时间，单位 ns。与 tm 一起给。 */
  tc?: number;
  /** 未命中时的主存访问时间，单位 ns。 */
  tm?: number;
  /** 只影响显示：为真时每行多一个有效位，行为不变。 */
  validBit?: boolean;
}

export interface Row {
  /** 标记的数值；空行为 null。 */
  tag: number | null;
  /** 这一行装的主存块号；空行为 null。 */
  block: number | null;
  /** 修改位。 */
  modified: 0 | 1;
  /** 行计数器。 */
  count: number;
  /** 只在 validBit 为真时出现。 */
  valid?: 0 | 1;
}

/** 当前这次访问：地址怎么切、落在哪、结果如何。各字段随讲解步逐个填上。 */
export interface Current {
  /** 第几次访问，从 1 起；0 表示还没开始。 */
  n: number;
  address: number | null;
  op: Op | null;
  /** 地址的二进制写法。 */
  bits: string;
  tagBits: string;
  /** 行号或组号字段；全相联为空串。 */
  indexBits: string;
  wordBits: string;
  tag: number | null;
  /** 直接映射是行号，组相联是组号，全相联为 null。 */
  index: number | null;
  word: number | null;
  /** 块号 j。 */
  block: number | null;
  /** 允许存放这个块的行。 */
  candidates: number[];
  result: '命中' | '缺失' | null;
  action: '命中' | '调入' | '替换' | null;
  /** 命中的行，或调入的行。 */
  row: number | null;
  /** 被换出的块号。 */
  evicted: number | null;
  /** 换出的块修改位为 1，要写回主存。 */
  writeBack: boolean;
}

export interface State {
  rows: Row[];
  access: Current;
  hits: number;
  misses: number;
}

/** 由参数算出的各种位数和个数。 */
export interface Layout {
  mapping: Mapping;
  /** 行数 m 和它的位数 r。 */
  rows: number;
  rowBits: number;
  /** 组数 u 和它的位数 d。全相联算 1 组，直接映射每行算 1 组。 */
  sets: number;
  setBits: number;
  /** 每组行数 v：一个块有几行可放。 */
  ways: number;
  /** 每块占多少个编址单位，和它的位数 w。 */
  blockUnits: number;
  wordBits: number;
  /** 主存块数 2^s 和 s。 */
  blocks: number;
  blockBits: number;
  tagBits: number;
  /** 地址中间那一段的位数：直接映射 r，组相联 d，全相联 0。 */
  indexBits: number;
}

const MAPPINGS: readonly string[] = ['全相联', '直接', '组相联'];
const POLICIES: readonly string[] = ['LFU', 'LRU', '随机'];

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

/** 参数有什么问题。空表示可以运行。页面在调用 run 之前先用它给输入框报错。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const p = params as Partial<Record<keyof Params, unknown>>;
  if (!MAPPINGS.includes(p.mapping as string)) problems.push('映射方式只能是全相联、直接、组相联');
  if (!isPowerOfTwo(p.rows) || p.rows > MAX_ROWS) problems.push(`cache 行数必须是 2 的幂，不超过 ${MAX_ROWS}`);
  if (!isPowerOfTwo(p.blockWords) || p.blockWords > MAX_BLOCK_WORDS) {
    problems.push(`每块字数必须是 2 的幂，不超过 ${MAX_BLOCK_WORDS}`);
  }
  if (p.unit !== undefined && p.unit !== '字' && p.unit !== '字节') problems.push('编址单位只能是字或字节');
  if (p.wordBytes !== undefined && (!isPowerOfTwo(p.wordBytes) || p.wordBytes > 8)) {
    problems.push('每字的字节数必须是 1、2、4 或 8');
  }
  if (p.mapping === '组相联') {
    if (!isPowerOfTwo(p.rowsPerSet)) problems.push('组相联必须给每组行数，且是 2 的幂');
    else if (isPowerOfTwo(p.rows) && p.rowsPerSet > p.rows) problems.push('每组行数不能超过 cache 行数');
  }
  if (typeof p.addressBits !== 'number' || !Number.isInteger(p.addressBits) || p.addressBits < 1 || p.addressBits > MAX_ADDRESS_BITS) {
    problems.push(`地址位数必须是 1 到 ${MAX_ADDRESS_BITS} 的整数`);
  }
  if (p.validBit !== undefined && typeof p.validBit !== 'boolean') problems.push('有效位开关只能是真或假');
  if ((p.tc === undefined) !== (p.tm === undefined)) problems.push('t_c 和 t_m 要一起给');
  for (const [name, value] of [['t_c', p.tc], ['t_m', p.tm]] as const) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      problems.push(`${name} 必须是正数`);
    }
  }
  if (!Array.isArray(p.accesses) || p.accesses.length < 1 || p.accesses.length > MAX_ACCESSES) {
    problems.push(`访问序列要有 1 到 ${MAX_ACCESSES} 项`);
  }
  if (problems.length > 0) return problems;

  const g = layout(params);
  if (g.tagBits < 1) {
    const need = g.wordBits + g.indexBits + 1;
    problems.push(`地址至少要 ${need} 位，标记才有位数（字地址 ${g.wordBits} 位，${indexName(g) || '行号'} ${g.indexBits} 位）`);
    return problems;
  }
  if (g.ways > 1) {
    if (!POLICIES.includes(p.replacement as string)) problems.push('一个块有不止一行可放时必须给替换算法：LFU、LRU 或随机');
    if (p.replacement === '随机') {
      const seed = p.seed;
      if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
        problems.push('随机替换必须给种子，0 到 4294967295 的整数');
      }
    }
  }
  const limit = 2 ** params.addressBits;
  params.accesses.forEach((access, index) => {
    const a = access as Partial<Record<keyof Access, unknown>> | null;
    if (a === null || typeof a !== 'object') {
      problems.push(`第 ${index + 1} 次访问缺地址和读写方式`);
      return;
    }
    if (typeof a.address !== 'number' || !Number.isInteger(a.address) || a.address < 0 || a.address >= limit) {
      problems.push(`第 ${index + 1} 次访问的地址必须是 0 到 ${limit - 1} 的整数`);
    }
    if (a.op !== '读' && a.op !== '写') problems.push(`第 ${index + 1} 次访问要写明读还是写`);
  });
  return problems;
}

/** 各字段的位数和个数。参数要先通过 validateParams。 */
export function layout(params: Params): Layout {
  const rows = params.rows;
  const ways = params.mapping === '全相联' ? rows : params.mapping === '直接' ? 1 : (params.rowsPerSet ?? 1);
  const sets = rows / ways;
  const blockUnits = params.blockWords * (params.unit === '字节' ? (params.wordBytes ?? 1) : 1);
  const wordBits = log2(blockUnits);
  const blockBits = params.addressBits - wordBits;
  const indexBits = params.mapping === '全相联' ? 0 : log2(sets);
  return {
    mapping: params.mapping,
    rows,
    rowBits: log2(rows),
    sets,
    setBits: log2(sets),
    ways,
    blockUnits,
    wordBits,
    blocks: blockBits >= 0 ? 2 ** blockBits : 0,
    blockBits,
    tagBits: blockBits - indexBits,
    indexBits,
  };
}

/** 第 index 组（直接映射时即第 index 行）包含哪些行。 */
export function rowsOf(g: Layout, index: number): number[] {
  return Array.from({ length: g.ways }, (_, k) => index * g.ways + k);
}

export interface Fields {
  bits: string;
  tagBits: string;
  indexBits: string;
  wordBits: string;
  tag: number;
  /** 组号（直接映射时即行号）；全相联恒为 0。 */
  set: number;
  word: number;
  block: number;
}

/** 把一个地址切成 标记 | 行号或组号 | 字地址。 */
export function splitAddress(g: Layout, addressBits: number, address: number): Fields {
  const bits = address.toString(2).padStart(addressBits, '0');
  const block = Math.floor(address / g.blockUnits);
  return {
    bits,
    tagBits: bits.slice(0, g.tagBits),
    indexBits: bits.slice(g.tagBits, g.tagBits + g.indexBits),
    wordBits: bits.slice(g.tagBits + g.indexBits),
    tag: Math.floor(block / g.sets),
    set: block % g.sets,
    word: address % g.blockUnits,
    block,
  };
}

/** 命中率和访问时间的数值。t_c、t_m 没给时只有 h。式(3.4)–(3.6)，教材 p101。 */
export function performance(
  hits: number,
  misses: number,
  tc?: number,
  tm?: number,
): { h: number; r?: number; ta?: number; e?: number } {
  const total = hits + misses;
  const h = total === 0 ? 0 : hits / total;
  if (tc === undefined || tm === undefined || total === 0) return { h };
  const ta = (hits * tc + misses * tm) / total;
  return { h, r: tm / tc, ta, e: tc / ta };
}

/** 最多 digits 位小数，去掉末尾的 0。 */
function fmt(x: number, digits = 4): string {
  const text = x.toFixed(digits);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** 随机替换用的发生器（mulberry32）：同一个种子给出同一串 32 位无符号数。 */
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

// ---------- 文字 ----------

const row = (i: number): string => `行 ${i}`;

function rowList(rows: number[]): string {
  const first = rows[0] ?? 0;
  const last = rows[rows.length - 1] ?? first;
  if (rows.length === 1) return row(first);
  if (rows.length === 2) return `${row(first)}、${row(last)}`;
  return `${row(first)} 到${row(last)}`;
}

function indexName(g: Layout): string {
  return g.mapping === '直接' ? '行号' : g.mapping === '组相联' ? '组号' : '';
}

function mappingName(g: Layout): string {
  if (g.mapping === '全相联') return '全相联映射';
  if (g.mapping === '直接') return '直接映射';
  return `组相联映射（${g.ways} 路）`;
}

function policyName(policy: Replacement): string {
  if (policy === 'LFU') return 'LFU（最不经常使用）';
  if (policy === 'LRU') return 'LRU（近期最少使用）';
  return '随机替换';
}

/** 候选行里现在存着什么标记。 */
function describeTags(rows: Row[], candidates: number[]): string {
  const cell = (i: number): number | null => rows[i]?.tag ?? null;
  if (candidates.length > 1 && candidates.every((i) => cell(i) === null)) return `${rowList(candidates)} 都是空的`;
  if (candidates.length <= 2) {
    return candidates.map((i) => (cell(i) === null ? `${row(i)} 是空的` : `${row(i)} 存的标记是 ${cell(i)}`)).join('，');
  }
  return `${rowList(candidates)} 存的标记依次是 ${candidates.map((i) => cell(i) ?? '空').join('、')}`;
}

function describeCounts(rows: Row[], candidates: number[]): string {
  const count = (i: number): number => rows[i]?.count ?? 0;
  if (candidates.length <= 2) return candidates.map((i) => `${row(i)} 的计数器是 ${count(i)}`).join('，');
  return `${rowList(candidates)} 的计数器依次是 ${candidates.map(count).join('、')}`;
}

/** 这一步在教材的哪一页。 */
const REF = {
  split: { 全相联: '教材 p102', 直接: '教材 p104', 组相联: '教材 p105' },
  locate: { 全相联: '教材 p102', 直接: '教材 p103 式(3.7)', 组相联: '教材 p105 式(3.8)' },
  compare: { 全相联: '教材 p102', 直接: '教材 p104', 组相联: '教材 p106' },
  read: '教材 p100',
  write: '教材 p109',
  load: '教材 p100',
  loadFree: '教材 p105',
  replace: '教材 p108',
  random: '教材 p109',
  count: '教材 p101 式(3.4)，p108',
  countNone: '教材 p101 式(3.4)',
} as const;

function conditionsOf(params: Params, g: Layout, policy: Replacement | null, hasWrite: boolean): Condition[] {
  const list: Condition[] = [];
  const add = (label: string, value: string): void => {
    list.push({ label, value });
  };
  add('映射方式', mappingName(g));
  if (g.mapping === '组相联') {
    add('cache', `${g.rows} 行，分 ${g.sets} 组，每组 ${g.ways} 行（u = 2^${g.setBits}，v = ${g.ways}）`);
  } else {
    add('cache', `${g.rows} 行（m = 2^${g.rowBits}）`);
  }
  if (params.unit === '字节') {
    const bytes = params.wordBytes ?? 1;
    add('块大小', `每块 ${params.blockWords} 字，每字 ${bytes} 字节，共 ${g.blockUnits} 字节（2^${g.wordBits}）`);
    add('编址', `按字节编址，地址 ${params.addressBits} 位`);
  } else {
    add('块大小', `每块 ${params.blockWords} 字（k = 2^${g.wordBits}）`);
    add('编址', `按字编址，地址 ${params.addressBits} 位`);
  }
  add('主存', `${g.blocks} 块（2^${g.blockBits}）`);
  const fields = [`标记 ${g.tagBits} 位`];
  if (g.mapping !== '全相联') fields.push(`${indexName(g)} ${g.indexBits} 位`);
  fields.push(`字地址 ${g.wordBits} 位`);
  add('地址格式', fields.join(' | '));
  if (g.mapping !== '全相联') add('教材图中的叫法', '区号 | 区内块号 | 字地址');
  if (policy === null) add('替换算法', '不需要，每个块只有一行可放');
  else if (policy === '随机') add('替换算法', `${policyName(policy)}，种子 ${params.seed ?? 0}`);
  else add('替换算法', policyName(policy));
  if (g.ways > 1) add('空行', '候选行里有空行时先用空行，取行号最小的');
  if (policy === 'LFU') add('计数器并列', '换出行号最小的行');
  if (hasWrite) add('写操作', '写回法：写只改 cache 并把修改位置 1，换出时才写回主存');
  add('初始状态', '各行都是空的，计数器为 0');
  if (params.tc !== undefined && params.tm !== undefined) add('访问时间', `t_c = ${fmt(params.tc)} ns，t_m = ${fmt(params.tm)} ns`);
  if (params.validBit === true) add('有效位', '只为标出空行而显示，教材的行里没有这一位');
  return list;
}

/** 讲地址怎么切：从低位往高位说。 */
function splitWhy(params: Params, g: Layout, address: number, f: Fields): string {
  const parts: string[] = [`地址有 ${params.addressBits} 位，写成二进制是 ${f.bits}。`];
  let used = 0;
  const place = (bits: number): string => {
    const text = used === 0 ? `最低 ${bits} 位` : `往上 ${bits} 位`;
    used += bits;
    return text;
  };
  const size =
    params.unit === '字节'
      ? `每块 ${params.blockWords} 字、每字 ${params.wordBytes ?? 1} 字节，共 ${g.blockUnits} 字节`
      : `每块 ${params.blockWords} 字`;
  if (g.wordBits > 0) parts.push(`${size}，${place(g.wordBits)} ${f.wordBits} 是字地址。`);
  else parts.push(`${size}，地址里没有字地址这一段。`);
  if (g.mapping === '直接') {
    if (g.indexBits > 0) parts.push(`cache 有 ${g.rows} 行，${place(g.indexBits)} ${f.indexBits} 是行号。`);
    else parts.push('cache 只有 1 行，地址里没有行号这一段。');
  } else if (g.mapping === '组相联') {
    if (g.indexBits > 0) parts.push(`cache 分 ${g.sets} 组，${place(g.indexBits)} ${f.indexBits} 是组号。`);
    else parts.push('cache 只有 1 组，地址里没有组号这一段。');
  }
  const rest = used === 0 ? `整个地址 ${g.tagBits} 位` : `剩下的高 ${g.tagBits} 位`;
  parts.push(`${rest} ${f.tagBits} 是标记${g.mapping === '全相联' ? '，全相联的标记就是块号' : ''}。`);
  if (g.blockUnits > 1) parts.push(`块号 j = ${address} ÷ ${g.blockUnits} 取整 = ${f.block}。`);
  else parts.push(`块号 j 就是地址 ${f.block}。`);
  return parts.join('');
}

function fieldSummary(g: Layout, f: Fields): string {
  const parts = [`标记 ${f.tag}`];
  if (g.mapping !== '全相联' && g.indexBits > 0) parts.push(`${indexName(g)} ${f.set}`);
  if (g.wordBits > 0) parts.push(`字地址 ${f.word}`);
  return parts.join('、');
}

function emptyAccess(): Current {
  return {
    n: 0,
    address: null,
    op: null,
    bits: '',
    tagBits: '',
    indexBits: '',
    wordBits: '',
    tag: null,
    index: null,
    word: null,
    block: null,
    candidates: [],
    result: null,
    action: null,
    row: null,
    evicted: null,
    writeBack: false,
  };
}

function at<T>(list: T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`内部错误：下标 ${index} 越界`);
  return item;
}

/** 逐次访问 cache，给出每一步的状态、理由和解题表。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`cache 参数不对：${problems.join('；')}`);

  const g = layout(params);
  const policy: Replacement | null = g.ways > 1 ? (params.replacement ?? null) : null;
  const hasWrite = params.accesses.some((a) => a.op === '写');
  const showValid = params.validBit === true;
  const next = generator(params.seed ?? 0);

  const emptyRow = (): Row => {
    const blank: Row = { tag: null, block: null, modified: 0, count: 0 };
    if (showValid) blank.valid = 0;
    return blank;
  };
  const initial: State = {
    rows: Array.from({ length: g.rows }, emptyRow),
    access: emptyAccess(),
    hits: 0,
    misses: 0,
  };
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditionsOf(params, g, policy, hasWrite));
  const table: SolutionTable = {
    columns: ['访问', '块号', g.mapping === '直接' ? '行号' : g.mapping === '组相联' ? '组号' : '行', '标记', '结果', '换出'],
    rows: [],
  };

  const seen = new Set<number>();
  let previousBlock: number | null = null;
  let stepCount = 0;
  const only = g.ways === 1;
  const whereOnly =
    g.mapping === '直接' ? '直接映射里' : g.mapping === '组相联' ? '每组只有 1 行，' : 'cache 只有 1 行，';

  params.accesses.forEach((access, order) => {
    const n = order + 1;
    const f = splitAddress(g, params.addressBits, access.address);
    const candidates = rowsOf(g, f.set);
    const snapshot = builder.state;
    const before = snapshot.rows;
    const hitRow = candidates.find((i) => at(before, i).block === f.block);
    const isHit = hitRow !== undefined;
    const free = candidates.filter((i) => at(before, i).block === null);
    const full = free.length === 0;
    const isWrite = access.op === '写';
    const verb = isWrite ? '写' : '读';
    const j = f.block;

    // 1. 切地址
    builder.step({
      title: `第 ${n} 次访问：${verb}地址 ${access.address}，切出${fieldSummary(g, f)}`,
      why: splitWhy(params, g, access.address, f),
      ref: REF.split[g.mapping],
      focus: ['access.tagBits', 'access.indexBits', 'access.wordBits'],
      update: (s) => {
        s.access = {
          ...emptyAccess(),
          n,
          address: access.address,
          op: access.op,
          bits: f.bits,
          tagBits: f.tagBits,
          indexBits: f.indexBits,
          wordBits: f.wordBits,
          tag: f.tag,
          index: g.mapping === '全相联' ? null : f.set,
          word: f.word,
          block: j,
        };
      },
    });

    // 2. 定位行或组
    let locateTitle: string;
    let locateWhy: string;
    if (g.mapping === '直接') {
      locateTitle = `块 ${j} 只能放在${row(f.set)}`;
      locateWhy = `直接映射用 i = j mod m 定行：${j} mod ${g.rows} = ${f.set}。一个块只对应这一行。`;
    } else if (g.mapping === '组相联') {
      locateTitle = `块 ${j} 归第 ${f.set} 组，候选是${rowList(candidates)}`;
      locateWhy =
        `组相联用 q = j mod u 定组：${j} mod ${g.sets} = ${f.set}。` +
        (only ? `第 ${f.set} 组只有${rowList(candidates)} 这 1 行。` : `第 ${f.set} 组有 ${g.ways} 行，块可以放在其中任意一行。`);
    } else {
      locateTitle = `块 ${j} 可以放在任意一行`;
      locateWhy = `全相联映射不限定位置，不用求余，${g.rows} 行的标记都要比。`;
    }
    builder.step({
      title: locateTitle,
      why: locateWhy,
      ref: REF.locate[g.mapping],
      focus: ['access.index', ...candidates.map((i) => `rows.${i}`)],
      update: (s) => {
        s.access.candidates = [...candidates];
      },
    });

    // 3. 比标记
    const tags = describeTags(before, candidates);
    const absent = isWrite
      ? `块 ${j} 不在 cache 里，要先把它从主存调入。`
      : `块 ${j} 不在 cache 里，这个字要到主存去取。`;
    let compareTitle: string;
    let compareWhy: string;
    if (isHit) {
      compareTitle = `${row(hitRow)} 的标记也是 ${f.tag}，命中`;
      compareWhy = `${tags}。地址切出的标记是 ${f.tag}，和${row(hitRow)} 存的相同，这一行装的就是块 ${j}。`;
    } else if (free.length === candidates.length) {
      compareTitle = only ? `${rowList(candidates)} 还空着，缺失` : '候选行都空着，缺失';
      compareWhy = `${tags}，没有标记可比。${absent}`;
    } else {
      compareTitle = only
        ? `${rowList(candidates)} 的标记是 ${at(before, at(candidates, 0)).tag}，要找的是 ${f.tag}，缺失`
        : `候选行里没有标记 ${f.tag}，缺失`;
      compareWhy = `${tags}。没有哪一行的标记等于 ${f.tag}，${absent}`;
    }
    const decisive = j !== previousBlock && (seen.has(j) || full);
    const hitAsk: Ask = {
      prompt: '这次访问命中吗',
      kind: 'choice',
      options: ['命中', '缺失'],
      answer: isHit ? '命中' : '缺失',
      hint: `看${rowList(candidates)} 现在存的标记，和地址切出的标记比一比。`,
    };
    builder.step({
      title: compareTitle,
      why: compareWhy,
      ref: REF.compare[g.mapping],
      focus: ['access.tag', ...candidates.map((i) => `rows.${i}.tag`)],
      ...(decisive ? { ask: hitAsk } : {}),
      update: (s) => {
        s.access.result = isHit ? '命中' : '缺失';
        if (isHit) s.access.row = hitRow;
      },
    });

    // 4. 命中，或调入空行，或替换
    let target: number;
    let action: '命中' | '调入' | '替换';
    let evicted: number | null = null;
    let writeBack = false;
    let outcomeTitle: string;
    let outcomeWhy: string;
    let outcomeRef: string;
    let victimAsk: Ask | undefined;
    const writeTail = isWrite ? '写回法下写缺失也先把块调入，再在 cache 里改，修改位置 1。' : '';
    if (isHit) {
      target = hitRow;
      action = '命中';
      if (!isWrite) {
        outcomeTitle = `从${row(target)} 取出要读的字`;
        outcomeWhy =
          g.wordBits > 0
            ? `命中后不用访问主存，按字地址 ${f.word} 在行内取字。`
            : '命中后不用访问主存，这一行只有 1 个字，直接取出。';
        outcomeRef = REF.read;
      } else if (at(before, target).modified === 1) {
        outcomeTitle = `写${row(target)}，修改位已经是 1`;
        outcomeWhy = '写回法：写命中只改 cache 里的这一行，先不写主存。这一行之前写过，修改位保持 1。';
        outcomeRef = REF.write;
      } else {
        outcomeTitle = `写${row(target)}，修改位置 1`;
        outcomeWhy = '写回法：写命中只改 cache 里的这一行，先不写主存。修改位记下这一行改过，换出时再写回主存。';
        outcomeRef = REF.write;
      }
    } else if (!full) {
      target = at(free, 0);
      action = '调入';
      outcomeTitle = `块 ${j} 调入空着的${row(target)}${isWrite ? '，写入后修改位置 1' : ''}`;
      const spot = only
        ? `${row(target)} 还空着，直接放进去。`
        : free.length === 1
          ? `候选行里只有${row(target)} 空着，放进去，不用换出别的块。`
          : `候选行里有空行就不用替换；空行不止一个，这里取行号最小的${row(target)}。`;
      outcomeWhy = `缺失时把整块从主存复制到 cache。${spot}${showValid ? '有效位置 1。' : ''}${writeTail}`;
      outcomeRef = only ? REF.load : REF.loadFree;
    } else {
      action = '替换';
      const counts = describeCounts(before, candidates);
      let lead: string;
      let reason: string;
      let tie = false;
      if (policy === 'LRU') {
        const worst = Math.max(...candidates.map((i) => at(before, i).count));
        target = at(candidates.filter((i) => at(before, i).count === worst), 0);
        lead = `${row(target)} 的计数器最大，`;
        reason = `候选行都占着，要换出一行。LRU 换出计数器最大的行，计数器越大说明越久没用到。${counts}，最大的是${row(target)}。`;
        outcomeRef = REF.replace;
      } else if (policy === 'LFU') {
        const least = Math.min(...candidates.map((i) => at(before, i).count));
        const lowest = candidates.filter((i) => at(before, i).count === least);
        target = at(lowest, 0);
        tie = lowest.length > 1;
        lead = `${row(target)} 的计数器最小，`;
        reason =
          `候选行都占着，要换出一行。LFU 换出计数器最小的行，计数器记的是这一行被访问了几次。${counts}，` +
          (tie ? `最小值 ${least} 有 ${lowest.length} 行并列，这里取行号最小的${row(target)}。` : `最小的是${row(target)}。`);
        outcomeRef = REF.replace;
      } else if (policy === '随机') {
        target = at(candidates, next() % candidates.length);
        lead = `随机选到${row(target)}，`;
        reason = `候选行都占着，要换出一行。随机替换不看使用情况，在候选行里任取一行；这里的随机数由种子 ${params.seed ?? 0} 算出，同一个种子每次选到的行相同。`;
        outcomeRef = REF.random;
      } else {
        target = at(candidates, 0);
        lead = '';
        reason = `${whereOnly}块 ${j} 只有${row(target)} 可放，里面已经有别的块，只能把它换出。`;
        outcomeRef = REF.replace;
      }
      const old = at(before, target);
      evicted = old.block;
      writeBack = old.modified === 1;
      const back = writeBack
        ? `块 ${evicted} 的修改位是 1，换出前先写回主存。`
        : hasWrite
          ? `块 ${evicted} 的修改位是 0，没改过，不用写回。`
          : '';
      outcomeTitle = `${lead}${lead ? '' : `${row(target)} 里的`}块 ${evicted} 换出，块 ${j} 调入${isWrite ? '，写入后修改位置 1' : ''}`;
      outcomeWhy = `${reason}${back}${writeTail}`;
      if (writeBack) outcomeRef = `${outcomeRef}，p109`;
      if ((policy === 'LRU' || policy === 'LFU') && !tie) {
        victimAsk = {
          prompt: '换出哪一行',
          kind: 'choice',
          options: candidates.map(row),
          answer: row(target),
          hint: `比较${rowList(candidates)} 的计数器，${policy} 看${policy === 'LRU' ? '最大' : '最小'}的。`,
        };
      }
    }
    const landing = target;
    builder.step({
      title: outcomeTitle,
      why: outcomeWhy,
      ref: outcomeRef,
      focus: [`rows.${landing}`],
      ...(victimAsk ? { ask: victimAsk } : {}),
      update: (s) => {
        const cell = at(s.rows, landing);
        s.access.action = action;
        s.access.row = landing;
        s.access.evicted = evicted;
        s.access.writeBack = writeBack;
        if (action !== '命中') {
          cell.tag = f.tag;
          cell.block = j;
          cell.modified = 0;
          if (showValid) cell.valid = 1;
        }
        if (isWrite) cell.modified = 1;
      },
    });

    // 5. 计数器和统计
    const others = candidates.filter((i) => i !== landing && at(before, i).block !== null);
    let countTitle = '';
    let countWhy: string;
    if (policy === null) {
      countWhy = `${whereOnly}一个块只有一行可放，换出谁没有选择，计数器用不上。`;
    } else if (policy === '随机') {
      countWhy = '随机替换不用计数器。';
    } else if (policy === 'LRU') {
      countTitle = `；${row(landing)} 计数器清零${others.length > 0 ? `，${rowList(others)} 加 1` : ''}`;
      countWhy = isHit
        ? 'LRU 的计数规则：命中的行清零，候选行里其余有块的行加 1。'
        : 'LRU 的计数规则：刚调入的行算刚用过，计数器清零，候选行里其余有块的行加 1。';
    } else if (action === '命中') {
      countTitle = `；${row(landing)} 计数器加 1`;
      countWhy = 'LFU 的计数规则：每访问一次，被访问的行计数器加 1。';
    } else if (action === '调入') {
      countTitle = `；${row(landing)} 从 0 开始计数`;
      countWhy = 'LFU 的计数规则：新调入的行从 0 开始计数，其余行不变。';
    } else {
      countTitle = `；${rowList(candidates)} 的计数器清零`;
      countWhy = 'LFU 的计数规则：发生替换时，候选各行的计数器一起清零，新调入的行也从 0 开始。';
    }
    const hits = snapshot.hits + (isHit ? 1 : 0);
    const misses = snapshot.misses + (isHit ? 0 : 1);
    builder.step({
      level: 'access',
      title: `第 ${n} 次访问记为${isHit ? '命中' : '缺失'}${countTitle}`,
      why: `${countWhy}${isHit ? '命中' : '缺失'}次数加 1，到这里共 ${hits} 次命中、${misses} 次缺失。`,
      ref: policy === 'LRU' || policy === 'LFU' ? REF.count : REF.countNone,
      focus: [isHit ? 'hits' : 'misses', ...(policy === 'LRU' || policy === 'LFU' ? candidates.map((i) => `rows.${i}.count`) : [])],
      update: (s) => {
        if (isHit) s.hits += 1;
        else s.misses += 1;
        if (policy === 'LRU') {
          at(s.rows, landing).count = 0;
          for (const i of others) at(s.rows, i).count += 1;
        } else if (policy === 'LFU') {
          if (action === '命中') at(s.rows, landing).count += 1;
          else if (action === '调入') at(s.rows, landing).count = 0;
          else for (const i of candidates) at(s.rows, i).count = 0;
        }
      },
    });
    stepCount += 5;

    table.rows.push({
      cells: [
        `${access.address}${isWrite ? '（写）' : ''}`,
        String(j),
        String(g.mapping === '全相联' ? landing : f.set),
        String(f.tag),
        isHit ? '命中' : '缺失',
        evicted === null ? '' : `块 ${evicted}${writeBack ? '（写回）' : ''}`,
      ],
      step: `s${stepCount}`,
    });
    seen.add(j);
    previousBlock = j;
  });

  const end = builder.state;
  const total = end.hits + end.misses;
  const perf = performance(end.hits, end.misses, params.tc, params.tm);
  const exact = (end.hits * 10000) % total === 0;
  const result: Record<string, string> = {
    命中次数: String(end.hits),
    缺失次数: String(end.misses),
    h: `${end.hits}/${total} ${exact ? '=' : '≈'} ${fmt(perf.h)}`,
  };
  if (perf.r !== undefined && perf.ta !== undefined && perf.e !== undefined) {
    result['r'] = fmt(perf.r);
    result['t_a'] = `${fmt(perf.ta)} ns`;
    result['e'] = `${fmt(perf.e * 100, 2)}%`;
  }
  return builder.finish(result, table);
}
