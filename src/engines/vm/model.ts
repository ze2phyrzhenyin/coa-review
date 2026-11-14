/**
 * 页式虚地址变换引擎（教材 3.7.2，p112–114，图 3.33、3.34）。规格见 specs/3-vm-addr.md。
 *
 * 虚地址 = 逻辑页号 | 页内地址；物理地址 = 物理页号 | 页内地址，是拼接不是相加。
 * 页表项有有效位和物理页号；快表（TLB）是页表有效项的副本，命中时不再查页表。
 * 状态路径（current.page、current.frame、faults …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'vm';
export const MAX_ADDRESSES = 8;
export const MAX_TLB = 16;

export interface Entry {
  page: number;
  valid: 0 | 1;
  frame: number | null;
}

export interface Params {
  /** 每页的编址单位数，2 的幂。 */
  pageSize: number;
  /** 虚页数，2 的幂。 */
  pages: number;
  /** 主存页数，2 的幂。 */
  frames: number;
  /** 页表里列出的项；没列出的页有效位为 0。 */
  table: Entry[];
  /** 快表，页表有效项的副本。 */
  tlb?: { page: number; frame: number }[];
  addresses: number[];
  radix?: 'hex' | 'dec';
}

export interface Current {
  n: number;
  address: number | null;
  bits: string;
  pageBits: string;
  offsetBits: string;
  page: number | null;
  offset: number | null;
  tlb: '命中' | '未命中' | null;
  valid: 0 | 1 | null;
  frame: number | null;
  physical: number | null;
  physicalBits: string;
  result: '物理地址' | '缺页' | null;
}

export interface State {
  current: Current;
  faults: number;
  tlbHits: number;
}

export interface Translation {
  page: number;
  offset: number;
  frame: number | null;
  physical: number | null;
  fault: boolean;
  tlbHit: boolean;
}

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
const LIMIT = 2 ** 20;

/** 参数有什么问题。空表示可以运行。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const p = params as Partial<Record<keyof Params, unknown>>;
  if (!isPowerOfTwo(p.pageSize) || p.pageSize < 2 || p.pageSize > LIMIT) problems.push('页大小必须是 2 的幂，2 到 2^20');
  if (!isPowerOfTwo(p.pages) || p.pages < 2 || p.pages > LIMIT) problems.push('虚页数必须是 2 的幂，2 到 2^20');
  if (!isPowerOfTwo(p.frames) || p.frames > LIMIT) problems.push('主存页数必须是 2 的幂，1 到 2^20');
  if (p.radix !== undefined && p.radix !== 'hex' && p.radix !== 'dec') problems.push('地址写法只能是十六进制或十进制');
  if (problems.length > 0) return problems;
  const pageSize = params.pageSize;
  if (log2(params.pages * pageSize) > 32) problems.push('虚地址不能超过 32 位');
  if (log2(params.frames * pageSize) > 32) problems.push('物理地址不能超过 32 位');

  const valid = new Map<number, number>();
  if (!Array.isArray(p.table)) problems.push('要给页表');
  else {
    const seen = new Set<number>();
    params.table.forEach((e, i) => {
      const entry = e as Partial<Record<keyof Entry, unknown>> | null;
      if (entry === null || typeof entry !== 'object' || !isNat(entry.page) || entry.page >= params.pages) {
        problems.push(`页表第 ${i + 1} 项的逻辑页号必须是 0 到 ${params.pages - 1}`);
        return;
      }
      if (seen.has(entry.page)) problems.push(`页表里逻辑页 ${entry.page} 列了两次`);
      seen.add(entry.page);
      if (entry.valid !== 0 && entry.valid !== 1) problems.push(`页表里逻辑页 ${entry.page} 的有效位只能是 0 或 1`);
      if (entry.valid === 1) {
        if (!isNat(entry.frame) || entry.frame >= params.frames) problems.push(`页表里逻辑页 ${entry.page} 的物理页号必须是 0 到 ${params.frames - 1}`);
        else valid.set(entry.page, entry.frame);
      }
    });
  }
  if (p.tlb !== undefined) {
    if (!Array.isArray(p.tlb) || p.tlb.length > MAX_TLB) problems.push(`快表最多 ${MAX_TLB} 项`);
    else {
      const seen = new Set<number>();
      params.tlb?.forEach((e, i) => {
        if (!isNat(e.page) || seen.has(e.page)) {
          problems.push(`快表第 ${i + 1} 项的逻辑页号不对或重复`);
          return;
        }
        seen.add(e.page);
        if (valid.get(e.page) !== e.frame) problems.push(`快表里逻辑页 ${e.page} 与页表不一致：快表只存页表有效项的副本`);
      });
    }
  }
  if (!Array.isArray(p.addresses) || p.addresses.length < 1 || p.addresses.length > MAX_ADDRESSES) {
    problems.push(`虚地址要有 1 到 ${MAX_ADDRESSES} 个`);
  } else {
    const limit = params.pages * pageSize;
    params.addresses.forEach((a, i) => {
      if (!isNat(a) || a >= limit) problems.push(`第 ${i + 1} 个虚地址必须是 0 到 ${limit - 1} 的整数，超出虚存空间`);
    });
  }
  return problems;
}

/** 一个虚地址变换的结果。参数要先通过 validateParams。 */
export function translate(params: Params, address: number): Translation {
  const page = Math.floor(address / params.pageSize);
  const offset = address % params.pageSize;
  const inTlb = params.tlb?.find((e) => e.page === page);
  if (inTlb) return { page, offset, frame: inTlb.frame, physical: inTlb.frame * params.pageSize + offset, fault: false, tlbHit: true };
  const entry = params.table.find((e) => e.page === page);
  if (!entry || entry.valid === 0 || entry.frame === null) return { page, offset, frame: null, physical: null, fault: true, tlbHit: false };
  return { page, offset, frame: entry.frame, physical: entry.frame * params.pageSize + offset, fault: false, tlbHit: false };
}

// ---------- 写法 ----------

function hexDigits(bits: number): number {
  return Math.max(1, Math.ceil(bits / 4));
}

/** 地址的写法：十六进制补足位数带 H，十进制原样。 */
function addr(value: number, bits: number, radix: 'hex' | 'dec'): string {
  return radix === 'hex' ? `${value.toString(16).toUpperCase().padStart(hexDigits(bits), '0')}H` : String(value);
}

/** 页内地址、页号这类小量：十六进制时带 H，不补位。 */
function small(value: number, radix: 'hex' | 'dec'): string {
  return radix === 'hex' && value > 9 ? `${value.toString(16).toUpperCase()}H` : String(value);
}

const bin = (value: number, width: number): string => (width === 0 ? '' : value.toString(2).padStart(width, '0'));

function emptyCurrent(): Current {
  return {
    n: 0,
    address: null,
    bits: '',
    pageBits: '',
    offsetBits: '',
    page: null,
    offset: null,
    tlb: null,
    valid: null,
    frame: null,
    physical: null,
    physicalBits: '',
    result: null,
  };
}

/** 逐个虚地址做变换。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`页式变换参数不对：${problems.join('；')}`);

  const radix = params.radix ?? 'hex';
  const offsetWidth = log2(params.pageSize);
  const pageWidth = log2(params.pages);
  const frameWidth = log2(params.frames);
  const vBits = pageWidth + offsetWidth;
  const pBits = frameWidth + offsetWidth;
  const hasTlb = params.tlb !== undefined;
  const hasInvalid = params.table.some((e) => e.valid === 0) || params.table.length < params.pages;

  const conditions: Condition[] = [
    { label: '页大小', value: `${params.pageSize} 个编址单位，页内地址 ${offsetWidth} 位` },
    { label: '虚地址格式', value: `${vBits} 位：逻辑页号 ${pageWidth} 位 | 页内地址 ${offsetWidth} 位（${params.pages} 页）` },
    { label: '物理地址格式', value: `${pBits} 位：物理页号 ${frameWidth} 位 | 页内地址 ${offsetWidth} 位（主存 ${params.frames} 页）` },
    {
      label: '页表',
      value:
        params.table
          .map((e) => (e.valid === 1 ? `页 ${e.page} 在主存页 ${e.frame ?? 0}` : `页 ${e.page} 有效位 0`))
          .join('；') + '；没列出的页有效位为 0',
    },
  ];
  if (hasTlb) {
    const items = params.tlb ?? [];
    conditions.push({ label: '快表', value: items.length === 0 ? '空' : items.map((e) => `页 ${e.page} 对应主存页 ${e.frame}`).join('；') });
  }
  conditions.push({ label: '地址写法', value: radix === 'hex' ? '十六进制' : '十进制' });

  const initial: State = { current: emptyCurrent(), faults: 0, tlbHits: 0 };
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditions);
  const columns = ['虚地址', '逻辑页号', '页内地址', ...(hasTlb ? ['快表'] : []), '有效位', '物理页号', '物理地址'];
  const table: SolutionTable = { columns, rows: [] };
  const result: Record<string, string> = {};
  let stepCount = 0;

  params.addresses.forEach((address, order) => {
    const n = order + 1;
    const t = translate(params, address);
    const bits = bin(address, vBits);
    const pageBits = bits.slice(0, pageWidth);
    const offsetBits = bits.slice(pageWidth);
    const va = addr(address, vBits, radix);

    // 1. 切分
    builder.step({
      title: `第 ${n} 个虚地址 ${va}：逻辑页号 ${t.page}，页内地址 ${small(t.offset, radix)}`,
      why:
        `${radix === 'dec' ? `${address} 先化成二进制` : `${va} 写成二进制`}是 ${bits}（${vBits} 位）。` +
        `页大小 ${params.pageSize}，低 ${offsetWidth} 位 ${offsetBits} 是页内地址，高 ${pageWidth} 位 ${pageBits} 是逻辑页号 ${t.page}。`,
      ref: '教材 p112',
      focus: ['current.pageBits', 'current.offsetBits'],
      update: (s) => {
        s.current = { ...emptyCurrent(), n, address, bits, pageBits, offsetBits, page: t.page, offset: t.offset };
      },
    });
    stepCount += 1;

    // 2. 快表
    if (hasTlb) {
      builder.step({
        title: t.tlbHit ? `快表里有页 ${t.page}，物理页号 ${t.frame ?? 0}` : `快表里没有页 ${t.page}`,
        why: t.tlbHit
          ? '快表按逻辑页号比较内容，找到这一项就直接得到物理页号，不用再到主存里读页表。'
          : '快表只存页表里一部分有效项。没找到这一项，物理页号要从主存中的页表（慢表）里取。',
        ref: '教材 p114',
        focus: ['current.tlb'],
        update: (s) => {
          s.current.tlb = t.tlbHit ? '命中' : '未命中';
          if (t.tlbHit) s.current.frame = t.frame;
        },
      });
      stepCount += 1;
    }

    // 3. 查页表
    const entry = params.table.find((e) => e.page === t.page);
    const validBit: 0 | 1 = entry?.valid === 1 ? 1 : 0;
    if (!t.tlbHit) {
      const ask: Ask | undefined = hasInvalid
        ? { prompt: '这一页在主存吗', kind: 'choice', options: ['在主存', '缺页'], answer: t.fault ? '缺页' : '在主存', hint: `看页表第 ${t.page} 项的有效位。` }
        : undefined;
      builder.step({
        title: t.fault ? `页表第 ${t.page} 项有效位为 0` : `页表第 ${t.page} 项有效位为 1，物理页号 ${t.frame ?? 0}`,
        why:
          `页表基地址加上逻辑页号 ${t.page}，找到第 ${t.page} 项。` +
          (t.fault
            ? `${entry ? '这一项的有效位是 0' : '页表里没有列出这一页，有效位按 0 算'}，说明这一页还没调入主存。`
            : '有效位是 1，这一页已经在主存里。'),
        ref: '教材 p112–113',
        focus: ['current.valid', 'current.frame'],
        ...(ask ? { ask } : {}),
        update: (s) => {
          s.current.valid = validBit;
          s.current.frame = t.frame;
        },
      });
      stepCount += 1;
    }

    // 4. 拼接或缺页
    if (t.fault) {
      builder.step({
        level: 'access',
        title: `缺页：页 ${t.page} 不在主存`,
        why: '有效位为 0 时得不到物理页号，存储管理部件发出缺页中断，由操作系统把这一页从辅存调进来。缺页次数加 1。',
        ref: '教材 p113',
        focus: ['current.result', 'faults'],
        update: (s) => {
          s.current.result = '缺页';
          s.faults += 1;
        },
      });
    } else {
      const frame = t.frame ?? 0;
      const physical = t.physical ?? 0;
      const frameBits = bin(frame, frameWidth);
      const physicalBits = frameBits + offsetBits;
      const pa = addr(physical, pBits, radix);
      const ask: Ask = { prompt: '物理页号是几', kind: 'number', answer: String(frame), hint: t.tlbHit ? '看快表里这一页的那一项。' : `看页表第 ${t.page} 项。` };
      builder.step({
        level: 'access',
        title: `物理地址 ${pa}`,
        why:
          `物理页号 ${frame} 写成 ${frameWidth} 位是 ${frameBits || '（0 位）'}，放在高位；页内地址 ${offsetBits} 原样放在低位。` +
          `拼起来是 ${physicalBits}，即 ${pa}。页内地址在变换中不变。`,
        ref: t.tlbHit ? '教材 p114' : '教材 p112',
        focus: ['current.physicalBits', 'current.physical'],
        ask,
        update: (s) => {
          s.current.frame = frame;
          s.current.physical = physical;
          s.current.physicalBits = physicalBits;
          s.current.result = '物理地址';
          if (t.tlbHit) s.tlbHits += 1;
        },
      });
    }
    stepCount += 1;

    const pa = t.fault ? '缺页' : addr(t.physical ?? 0, pBits, radix);
    table.rows.push({
      cells: [
        va,
        String(t.page),
        small(t.offset, radix),
        ...(hasTlb ? [t.tlbHit ? '命中' : '未命中'] : []),
        t.tlbHit ? '—' : String(validBit),
        t.fault ? '缺页' : String(t.frame ?? 0),
        pa,
      ],
      step: `s${stepCount}`,
    });
    result[va] = pa;
  });

  const end = builder.state;
  result['缺页次数'] = String(end.faults);
  if (hasTlb) result['快表命中次数'] = String(end.tlbHits);
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

/** 随机出一道页式变换题：页大小 512–4K，16 或 32 页，主存 8 或 16 页，两三个地址，可能带快表。 */
export function generate(seed: number): Params {
  const next = generator(seed);
  const pick = (n: number): number => next() % n;
  const pageSize = 2 ** (9 + pick(4));
  const pages = 2 ** (4 + pick(2));
  const frames = 2 ** (3 + pick(2));
  const loaded = 3 + pick(3);
  const freeFrames = Array.from({ length: frames }, (_, i) => i);
  const table: Entry[] = [];
  for (let page = 0; page < loaded + 2; page += 1) {
    if (page < loaded) {
      const k = pick(freeFrames.length);
      const frame = freeFrames.splice(k, 1)[0] ?? 0;
      table.push({ page, valid: 1, frame });
    } else table.push({ page, valid: 0, frame: null });
  }
  const count = 2 + pick(2);
  const addresses = Array.from({ length: count }, () => pick(loaded + 2) * pageSize + pick(pageSize));
  const params: Params = { pageSize, pages, frames, table, addresses };
  if (pick(2) === 0) {
    const valid = table.filter((e) => e.valid === 1);
    params.tlb = valid.slice(0, 2).map((e) => ({ page: e.page, frame: e.frame ?? 0 }));
  }
  return params;
}
