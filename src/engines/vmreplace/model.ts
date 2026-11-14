/**
 * 页面替换列表法引擎（教材 3.7.4，p117–118，例 3.11）。规格见 specs/3-vm-replace.md。
 *
 * 主存页面自上而下叫 a、b、c…，按「a 进 c 出」排成队列：缺页时新页进 a，其余下移，最下一格换出。
 * FIFO 命中不动；FIFO+LRU 命中时把该页提到 a。LRU 的表与 FIFO+LRU 相同。
 * 状态路径（frames.0、current.page、hits …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'vmreplace';
export const MAX_FRAMES = 8;
export const MAX_REFS = 40;

export type Policy = 'FIFO' | 'FIFO+LRU' | 'LRU';

export interface Params {
  /** 主存页面数。 */
  frames: number;
  policy: Policy;
  /** 虚页号序列。 */
  pages?: number[];
  /** 或者给字地址序列和页大小，页号 = 地址 ÷ 页大小取整。 */
  addresses?: number[];
  pageSize?: number;
  /** 开始时已在主存的页，从 a 往下。 */
  initial?: number[];
}

export interface Current {
  /** 第几次访问，从 1 起；0 表示还没开始。 */
  n: number;
  page: number | null;
  hit: boolean | null;
  /** 这次被换出的页。 */
  evicted: number | null;
  /** 命中页所在格的下标（加圈用）。 */
  marked: number | null;
}

export interface State {
  frames: (number | null)[];
  current: Current;
  hits: number;
  faults: number;
  /** 依次淘汰的页号。 */
  evicted: number[];
}

export interface Column {
  page: number;
  hit: boolean;
  frames: (number | null)[];
  evicted: number | null;
}

const POLICIES: readonly string[] = ['FIFO', 'FIFO+LRU', 'LRU'];

const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** 参数有什么问题。空表示可以运行。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const p = params as Partial<Record<keyof Params, unknown>>;
  if (!isNat(p.frames) || p.frames < 1 || p.frames > MAX_FRAMES) problems.push(`主存页面数必须是 1 到 ${MAX_FRAMES} 的整数`);
  if (!POLICIES.includes(p.policy as string)) problems.push('替换算法只能是 FIFO、FIFO+LRU 或 LRU');
  const hasPages = p.pages !== undefined;
  const hasAddresses = p.addresses !== undefined || p.pageSize !== undefined;
  if (hasPages === hasAddresses) problems.push('页号序列和字地址序列只能给一种');
  const checkList = (list: unknown, name: string): void => {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_REFS) {
      problems.push(`${name}要有 1 到 ${MAX_REFS} 项`);
      return;
    }
    if (!list.every(isNat)) problems.push(`${name}里只能是非负整数`);
  };
  if (hasPages) checkList(p.pages, '页号序列');
  else if (hasAddresses) {
    checkList(p.addresses, '字地址序列');
    if (!isNat(p.pageSize) || p.pageSize < 1) problems.push('页大小必须是正整数');
  }
  if (p.initial !== undefined) {
    const init = p.initial;
    if (!Array.isArray(init) || !init.every(isNat)) problems.push('开始时的页只能是非负整数');
    else {
      if (new Set(init).size !== init.length) problems.push('开始时的页不能重复');
      if (isNat(p.frames) && init.length > p.frames) problems.push('开始时的页不能多于主存页面数');
    }
  }
  return problems;
}

/** 页号序列（给字地址时先换算）。 */
export function pageList(params: Params): number[] {
  if (params.pages) return [...params.pages];
  const size = params.pageSize ?? 1;
  return (params.addresses ?? []).map((a) => Math.floor(a / size));
}

function startFrames(params: Params): (number | null)[] {
  const frames: (number | null)[] = Array.from({ length: params.frames }, () => null);
  (params.initial ?? []).forEach((page, i) => {
    frames[i] = page;
  });
  return frames;
}

/** 一次访问之后各格的页。 */
function step(frames: (number | null)[], page: number, policy: Policy): { frames: (number | null)[]; hit: boolean; evicted: number | null } {
  const at = frames.indexOf(page);
  if (at >= 0) {
    if (policy === 'FIFO') return { frames: [...frames], hit: true, evicted: null };
    const next = [page, ...frames.slice(0, at), ...frames.slice(at + 1)];
    return { frames: next, hit: true, evicted: null };
  }
  const last = frames[frames.length - 1] ?? null;
  return { frames: [page, ...frames.slice(0, frames.length - 1)], hit: false, evicted: last };
}

/** 逐列的结果，不带讲解。参数要先通过 validateParams。 */
export function simulate(params: Params): Column[] {
  let frames = startFrames(params);
  return pageList(params).map((page) => {
    const out = step(frames, page, params.policy);
    frames = out.frames;
    return { page, hit: out.hit, frames: [...out.frames], evicted: out.evicted };
  });
}

// ---------- 文字 ----------

const LETTERS = 'abcdefgh';
const slot = (i: number): string => LETTERS[i] ?? `第 ${i + 1} 格`;

/** 带圈数字：0–50 用 Unicode 的圈码，再大写成 (n)。 */
export function circled(n: number): string {
  if (n === 0) return '⓪';
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return `(${n})`;
}

function trim(x: number, digits: number): string {
  const text = x.toFixed(digits);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** 命中率写成「2/11=18.2%」。 */
export function hitRatio(hits: number, total: number): string {
  return `${hits}/${total}=${trim((hits / total) * 100, 1)}%`;
}

function describe(frames: (number | null)[]): string {
  const filled = frames.map((p, i) => (p === null ? null : `${slot(i)} 格是 ${p}`)).filter((x): x is string => x !== null);
  return filled.length === 0 ? '主存里还没有页' : `现在 ${filled.join('、')}`;
}

function policyName(policy: Policy): string {
  if (policy === 'FIFO') return 'FIFO 算法';
  if (policy === 'FIFO+LRU') return 'FIFO+LRU 算法';
  return 'LRU 算法';
}

function conditionsOf(params: Params): Condition[] {
  const n = params.frames;
  const list: Condition[] = [
    { label: '主存页面', value: `${n} 个，自上而下 ${Array.from({ length: n }, (_, i) => slot(i)).join('、')}` },
    { label: '队列', value: n === 1 ? '只有一格，缺页就换掉它' : `${slot(0)} 进 ${slot(n - 1)} 出：新页进 ${slot(0)}，其余下移，${slot(n - 1)} 的页换出` },
    { label: '替换算法', value: policyName(params.policy) },
  ];
  if (params.policy === 'FIFO') list.push({ label: '命中时', value: '各页不动' });
  else list.push({ label: '命中时', value: `命中的页移到 ${slot(0)}，它上面的页各下移一格` });
  if (params.addresses) list.push({ label: '页号', value: `页大小 ${params.pageSize ?? 1}，页号 = 字地址 ÷ 页大小，取整` });
  const init = params.initial ?? [];
  if (init.length > 0) list.push({ label: '开始时', value: `${init.map((p, i) => `${slot(i)} 格是 ${p}`).join('、')}，已在主存，不算缺页` });
  else list.push({ label: '开始时', value: '主存是空的' });
  return list;
}

function emptyCurrent(): Current {
  return { n: 0, page: null, hit: null, evicted: null, marked: null };
}

/** 逐列填表。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`页面替换参数不对：${problems.join('；')}`);

  const refs = pageList(params);
  const policy = params.policy;
  const initial: State = { frames: startFrames(params), current: emptyCurrent(), hits: 0, faults: 0, evicted: [] };
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditionsOf(params));
  const ref = { list: '教材 p117', fifo: '教材 p118 例 3.11', lru: '教材 p118 例 3.11' };
  const top = slot(0);
  const bottom = slot(params.frames - 1);

  const seen = new Set<number>(params.initial ?? []);
  let previous: number | null = null;
  const cells: { frames: (number | null)[]; hit: boolean; marked: number | null; page: number }[] = [];

  refs.forEach((page, order) => {
    const n = order + 1;
    const before = builder.state.frames;
    const at = before.indexOf(page);
    const hit = at >= 0;
    const out = step(before, page, policy);

    // 1. 比较
    const lead = params.addresses
      ? `字地址 ${params.addresses[order] ?? 0} ÷ ${params.pageSize ?? 1} 取整得页号 ${page}。`
      : '';
    const ask: Ask | undefined =
      page !== previous && seen.has(page)
        ? { prompt: '命中吗', kind: 'choice', options: ['命中', '缺页'], answer: hit ? '命中' : '缺页', hint: `看各格里现在有没有页 ${page}。` }
        : undefined;
    builder.step({
      title: `第 ${n} 次访问页 ${page}：${hit ? `在 ${slot(at)} 格，命中` : '不在主存，缺页'}`,
      why: `${lead}${describe(before)}。${hit ? `页 ${page} 已经在 ${slot(at)} 格。` : `各格里都没有页 ${page}，要从辅存调入。`}`,
      ref: ref.list,
      focus: ['current.page', ...before.map((_, i) => `frames.${i}`)],
      ...(ask ? { ask } : {}),
      update: (s) => {
        s.current = { n, page, hit, evicted: null, marked: hit ? at : null };
      },
    });

    // 2. 填这一列
    let title: string;
    let why: string;
    if (hit && policy === 'FIFO') {
      title = '各格不动';
      why = 'FIFO 只看调入的先后，命中不改变队列的顺序。';
    } else if (hit) {
      title = at === 0 ? `页 ${page} 本来就在 ${top}，各格不动` : `页 ${page} 移到 ${top}，上面的页各下移一格`;
      why =
        policy === 'LRU'
          ? `LRU 把刚用过的页放在 ${top}，${bottom} 留给最久没用的页。${at === 0 ? '' : `${slot(at)} 以下的页不动。`}`
          : `FIFO+LRU 命中时把这一页挪回队列入口，推迟它被换出的时间。${at === 0 ? '' : `${slot(at)} 以下的页不动。`}`;
    } else if (out.evicted !== null) {
      title = `页 ${out.evicted} 从 ${bottom} 换出，页 ${page} 进 ${top}`;
      why = `主存已满，按「${top} 进 ${bottom} 出」，最下一格的页 ${out.evicted} 被淘汰，其余各页下移一格，新页放进 ${top}。`;
    } else {
      title = `页 ${page} 进 ${top}，其余下移`;
      why = `主存还有空格，不用换出。新页从 ${top} 进入，已有的页各下移一格。`;
    }
    const lift: Ask | undefined =
      hit && policy !== 'FIFO' && at > 0
        ? { prompt: `命中后 ${top} 格是哪一页`, kind: 'number', answer: String(page), hint: `${policyName(policy)}命中时页面怎么移动，看条件里的规则。` }
        : undefined;
    builder.step({
      level: 'access',
      title,
      why: `${why}${hit ? `命中次数加 1。` : `缺页次数加 1。`}`,
      ref: policy === 'FIFO' ? ref.fifo : ref.lru,
      focus: [...out.frames.map((_, i) => `frames.${i}`), hit ? 'hits' : 'faults'],
      ...(lift ? { ask: lift } : {}),
      update: (s) => {
        s.frames = [...out.frames];
        s.current.evicted = out.evicted;
        s.current.marked = hit ? out.frames.indexOf(page) : null;
        if (hit) s.hits += 1;
        else s.faults += 1;
        if (out.evicted !== null) s.evicted.push(out.evicted);
      },
    });
    cells.push({ frames: out.frames, hit, marked: hit ? out.frames.indexOf(page) : null, page });
    seen.add(page);
    previous = page;
  });

  const end = builder.state;
  const total = refs.length;
  const ratio = hitRatio(end.hits, total);
  const table: SolutionTable = {
    columns: ['页面访问序列', ...cells.map((c) => (c.hit ? circled(c.page) : String(c.page))), '命中率'],
    rows: [
      ...Array.from({ length: params.frames }, (_, i) => ({
        cells: [
          slot(i),
          ...cells.map((c) => {
            const p = c.frames[i] ?? null;
            if (p === null) return '';
            return c.marked === i ? circled(p) : String(p);
          }),
          i === 0 ? ratio : '',
        ],
      })),
      { cells: ['', ...cells.map((c) => (c.hit ? '命中' : '')), ''] },
    ],
  };
  const result: Record<string, string> = {
    命中次数: String(end.hits),
    缺页次数: String(end.faults),
    命中率: ratio,
    淘汰页号: end.evicted.length === 0 ? '无' : end.evicted.join('、'),
  };
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

/** 随机出一道列表法的题：3 或 4 个页面，8–12 次访问，页号 0–6。 */
export function generate(seed: number): Params {
  const next = generator(seed);
  const pick = (n: number): number => next() % n;
  const frames = 3 + pick(2);
  const length = 8 + pick(5);
  const span = frames + 2 + pick(2);
  const pages: number[] = [];
  for (let i = 0; i < length; i += 1) {
    // 一半的访问取最近用过的页，命中才有得看。
    const recent = pages.slice(-frames);
    pages.push(recent.length > 0 && pick(2) === 0 ? (recent[pick(recent.length)] ?? 0) : pick(span));
  }
  const policies: Policy[] = ['FIFO', 'FIFO+LRU', 'LRU'];
  return { frames, policy: policies[pick(3)] ?? 'FIFO', pages };
}
