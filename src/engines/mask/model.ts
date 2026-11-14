/**
 * 多级中断屏蔽字与运行轨迹引擎（教材 8.3.5，p270–272；习题 8，p290）。规格见 specs/8-mask.md。
 *
 * 教材正文只给了规则（响应某级后关闭本级和更低级、开放更高级，屏蔽寄存器的内容随现场进栈），
 * 没有屏蔽字的例题，也没有运行轨迹的画法；习题 8 是唯一的题型。这里的做法是按规则推出的。
 * 屏蔽位 1 = 屏蔽，0 = 允许。屏蔽字左起依次是 L0…L(n−1) 位。
 * 状态路径（imr、irr、running、stack、segments …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Condition, type SolutionTable, type StepInput, type Trace } from '../trace';

export const ENGINE = 'mask';
export const MAX_LEVELS = 6;
export const MAX_ARRIVALS = 12;
export const MAX_AT = 100;
export const MAX_SERVICE = 20;
/** 主程序在 running、who 里的编号。 */
export const MAIN = -1;

export interface Arrival {
  level: number;
  at: number;
}

export interface Params {
  levels: number;
  /** 响应优先次序，高到低；缺省 L0 最高。 */
  response?: number[];
  /** 要求的处理次序，先到后。 */
  order?: number[];
  /** 第 i 个是 Li 处理程序的屏蔽字。 */
  masks?: string[];
  arrivals: Arrival[];
  /** 每级处理程序自身要运行的时间。 */
  service: number | number[];
}

export interface Segment {
  /** 级号，主程序为 −1。 */
  who: number;
  from: number;
  to: number;
  /** 主程序为 0，每嵌套一层加 1。 */
  depth: number;
}

export interface Frame {
  who: number;
  remaining: number | null;
  imr: string;
}

export interface State {
  t: number;
  running: number;
  imr: string;
  irr: string;
  stack: Frame[];
  remaining: number | null;
  masks: string[];
  order: number[] | null;
  segments: Segment[];
  done: number[];
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isPerm = (xs: unknown, n: number) =>
  Array.isArray(xs) && xs.length === n && [...xs].sort((a, b) => a - b).every((v, i) => v === i);

export function validateParams(p: Params): string[] {
  const problems: string[] = [];
  if (!p || !isInt(p.levels) || p.levels < 2 || p.levels > MAX_LEVELS) return [`级数必须是 2–${MAX_LEVELS}`];
  const n = p.levels;
  if (p.response !== undefined && !isPerm(p.response, n)) problems.push(`响应次序必须是 0–${n - 1} 的一个排列`);
  if (p.order !== undefined && p.masks !== undefined) problems.push('处理次序和屏蔽字只能给一个');
  if (p.order !== undefined && !isPerm(p.order, n)) problems.push(`处理次序必须是 0–${n - 1} 的一个排列`);
  if (p.masks !== undefined && (!Array.isArray(p.masks) || p.masks.length !== n || p.masks.some((m) => typeof m !== 'string' || !new RegExp(`^[01]{${n}}$`).test(m))))
    problems.push(`屏蔽字必须是 ${n} 个长 ${n} 的 0/1 串`);
  if (!Array.isArray(p.arrivals) || p.arrivals.length < 1 || p.arrivals.length > MAX_ARRIVALS) problems.push(`请求必须有 1–${MAX_ARRIVALS} 个`);
  else
    p.arrivals.forEach((a, i) => {
      if (!isInt(a.level) || a.level < 0 || a.level >= n) problems.push(`第 ${i + 1} 个请求的级必须是 0–${n - 1}`);
      if (!isInt(a.at) || a.at < 0 || a.at > MAX_AT) problems.push(`第 ${i + 1} 个请求的时刻必须是 0–${MAX_AT} 的整数`);
    });
  const services = Array.isArray(p.service) ? p.service : [p.service];
  if ((Array.isArray(p.service) && p.service.length !== n) || services.some((s) => !isInt(s) || s < 1 || s > MAX_SERVICE))
    problems.push(`运行时间必须是 1–${MAX_SERVICE} 的整数，或每级一个`);
  return problems;
}

function check(p: Params): void {
  const problems = validateParams(p);
  if (problems.length) throw new Error(problems.join('；'));
}

/** 由处理次序推屏蔽字：自己和排在自己之后的级置 1。 */
export function masksFromOrder(levels: number, order: number[]): string[] {
  const rank = new Array<number>(levels);
  order.forEach((level, k) => (rank[level] = k));
  return Array.from({ length: levels }, (_, i) => Array.from({ length: levels }, (_, j) => (rank[j]! >= rank[i]! ? '1' : '0')).join(''));
}

const ones = (m: string) => m.split('').filter((c) => c === '1').length;

/** 由屏蔽字反推处理次序：1 越多越先处理。排不成一个次序时为 null。 */
export function orderFromMasks(masks: string[]): number[] | null {
  const n = masks.length;
  const counts = masks.map(ones);
  if (new Set(counts).size !== n) return null;
  const order = masks.map((_, i) => i).sort((a, b) => counts[b]! - counts[a]!);
  const back = masksFromOrder(n, order);
  return back.every((m, i) => m === masks[i]) ? order : null;
}

const L = (level: number) => (level === MAIN ? '主程序' : `L${level}`);
/** 「主程序」两边不留拼接时多出的空格。 */
const tidy = (text: string) => text.replace(/([\u4e00-\u9fff]) (?=[\u4e00-\u9fff])/g, '$1');

interface Setup {
  n: number;
  response: number[];
  masks: string[];
  order: number[] | null;
  service: number[];
  /** 屏蔽字是由次序推出来的（推屏蔽字），还是给定的（反推次序）。 */
  derived: boolean;
}

function setup(p: Params): Setup {
  check(p);
  const n = p.levels;
  const response = p.response ?? Array.from({ length: n }, (_, i) => i);
  const service = Array.isArray(p.service) ? p.service : Array.from({ length: n }, () => p.service as number);
  if (p.masks) return { n, response, masks: p.masks, order: orderFromMasks(p.masks), service, derived: false };
  const order = p.order ?? response;
  return { n, response, masks: masksFromOrder(n, order), order, service, derived: true };
}

type Event =
  | { kind: 'arrive'; t: number; levels: number[]; merged: number[]; held: number[] }
  | { kind: 'enter'; level: number; from: number; pending: number[]; nested: boolean }
  | { kind: 'run'; who: number; from: number; to: number }
  | { kind: 'finish'; level: number; back: number };

/** 按规格第 3 条推进。每改一次状态就报一个事件，附上改完后的状态。 */
function simulateCore(p: Params, s: Setup, emit: (e: Event, state: State) => void): State {
  const n = s.n;
  const arrivals = p.arrivals.map((a, i) => ({ ...a, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  const state: State = {
    t: 0,
    running: MAIN,
    imr: '0'.repeat(n),
    irr: '0'.repeat(n),
    stack: [],
    remaining: null,
    masks: s.masks,
    order: s.order,
    segments: [],
    done: [],
  };
  const irr = () => state.irr.split('').map(Number);
  const setBit = (bits: string, k: number, v: string) => bits.slice(0, k) + v + bits.slice(k + 1);
  /** 每次进入一个程序给它一个编号；同一次进入的连续运行合成一段。 */
  let invocation = 0;
  const invocations: number[] = [0];
  let lastSegmentInvocation = -1;
  let next = 0;
  for (;;) {
    // 登记这一时刻到达的请求。
    const now = arrivals.filter((a, k) => k >= next && a.at === state.t);
    if (now.length) {
      next += now.length;
      const levels: number[] = [];
      const merged: number[] = [];
      for (const a of now) {
        if (state.irr[a.level] === '1') merged.push(a.level);
        else {
          state.irr = setBit(state.irr, a.level, '1');
          levels.push(a.level);
        }
      }
      const held = levels.filter((l) => state.imr[l] === '1');
      emit({ kind: 'arrive', t: state.t, levels, merged, held }, state);
    }
    // 请求 ∧ ¬屏蔽 不为 0 就响应，直到没有可响应的。
    for (;;) {
      const open = irr()
        .map((bit, l) => (bit === 1 && state.imr[l] === '0' ? l : -1))
        .filter((l) => l >= 0);
      if (!open.length) break;
      const level = s.response.find((l) => open.includes(l))!;
      const pending = irr()
        .map((bit, l) => (bit ? l : -1))
        .filter((l) => l >= 0);
      const from = state.running;
      state.stack.push({ who: state.running, remaining: state.remaining, imr: state.imr });
      state.irr = setBit(state.irr, level, '0');
      state.imr = s.masks[level]!;
      state.running = level;
      state.remaining = s.service[level]!;
      invocation += 1;
      invocations.push(invocation);
      const nested = irr().some((bit, l) => bit === 1 && state.imr[l] === '0');
      emit({ kind: 'enter', level, from, pending, nested }, state);
    }
    // 下一个时刻：下一个请求到达，或当前处理程序做完。
    const nextArrival = next < arrivals.length ? arrivals[next]!.at : Infinity;
    if (state.running === MAIN && nextArrival === Infinity) break;
    const finish = state.remaining === null ? Infinity : state.t + state.remaining;
    const until = Math.min(nextArrival, finish);
    const from = state.t;
    const current = invocations.at(-1)!;
    const depth = state.stack.length;
    const last = state.segments.at(-1);
    if (last && lastSegmentInvocation === current && last.to === from) last.to = until;
    else state.segments.push({ who: state.running, from, to: until, depth });
    lastSegmentInvocation = current;
    state.t = until;
    if (state.remaining !== null) state.remaining -= until - from;
    emit({ kind: 'run', who: state.running, from, to: until }, state);
    if (state.remaining === 0) {
      const level = state.running;
      const top = state.stack.pop()!;
      invocations.pop();
      state.done.push(level);
      state.running = top.who;
      state.remaining = top.remaining;
      state.imr = top.imr;
      emit({ kind: 'finish', level, back: top.who }, state);
    }
  }
  return state;
}

/** 只算轨迹，不出 Trace。 */
export function simulate(p: Params): { segments: Segment[]; done: number[]; end: number } {
  const s = setup(p);
  const final = simulateCore(p, s, () => {});
  return { segments: final.segments, done: final.done, end: final.t };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function run(p: Params): Trace<Params, State> {
  const s = setup(p);
  const { n } = s;
  const levelsText = (ls: number[]) => ls.map(L).join('、');
  const conditions: Condition[] = [
    { label: '级', value: Array.from({ length: n }, (_, i) => L(i)).join('、') },
    { label: '响应优先次序', value: s.response.map(L).join(' > ') },
    { label: '屏蔽位', value: '1 = 屏蔽，0 = 允许；主程序的屏蔽字全 0（教材 p270、p290）' },
    { label: '请求', value: p.arrivals.map((a) => `${L(a.level)} 在 ${a.at}`).join('，') },
    { label: '运行时间', value: s.service.map((v, i) => `${L(i)} ${v}`).join('，') },
    { label: '约定', value: '响应和返回不占时间；同一级没被响应前又来的请求只记一次' },
  ];
  if (p.order) conditions.splice(2, 0, { label: '要求的处理次序', value: p.order.map(L).join('→') });
  if (p.masks) conditions.splice(2, 0, { label: '给定的屏蔽字', value: p.masks.join(' / ') });

  const initial: State = {
    t: 0,
    running: MAIN,
    imr: '0'.repeat(n),
    irr: '0'.repeat(n),
    stack: [],
    remaining: null,
    masks: Array.from({ length: n }, () => ''),
    order: null,
    segments: [],
    done: [],
  };
  const b = new TraceBuilder<Params, State>(ENGINE, p, initial, conditions);
  let count = 0;
  const step = (input: StepInput<State>): string => {
    b.step({ ...input, title: tidy(input.title), why: tidy(input.why) });
    count += 1;
    return `s${count}`;
  };
  const rows: SolutionTable['rows'] = [];
  const orderText = s.order ? s.order.map(L).join('→') : '不能排成一个处理次序';

  // ---- 屏蔽字表 ----
  for (let i = 0; i < n; i++) {
    const m = s.masks[i]!;
    let title: string;
    let why: string;
    if (s.derived) {
      const rank = s.order!.indexOf(i);
      const after = s.order!.slice(rank + 1);
      const before = s.order!.slice(0, rank);
      title = `${L(i)} 处理程序的屏蔽字 ${m}`;
      why =
        `处理次序里 ${L(i)} 排第 ${rank + 1}。${after.length ? `它要挡住自己和排在后面的 ${levelsText(after)}，这些位置 1；` : '它只挡住自己，这一位置 1；'}`
        + (before.length ? `排在前面的 ${levelsText(before)} 要能打断它，置 0。` : '没有级排在它前面，全部置 1。')
        + (p.order ? '' : '没给处理次序时它就是响应次序。');
    } else {
      title = `${L(i)} 处理程序的屏蔽字 ${m}，有 ${ones(m)} 个 1`;
      why = `${m} 里为 0 的位是它允许打断自己的级${m.includes('0') ? `：${levelsText(m.split('').flatMap((c, j) => (c === '0' ? [j] : [])))}` : '，这里没有'}。1 越多，能打断它的级越少，它越先处理完。`;
    }
    const id = step({
      title,
      why,
      ref: '教材 p270、p290 习题 8',
      focus: [`masks.${i}`],
      ...(s.derived && i > 0 ? { ask: { prompt: `${L(i)} 处理程序的屏蔽字是什么？（左起 L0）`, kind: 'bits' as const, answer: m, hint: '自己和处理次序排在自己后面的级置 1。' } } : {}),
      update: (d) => {
        d.masks[i] = m;
      },
    });
    rows.push({ cells: [`${L(i)} 中断处理程序`, ...m.split(''), ...(s.derived ? [] : [String(ones(m))])], step: id });
  }
  step({
    title: s.order ? `处理次序 ${orderText}` : '这组屏蔽字排不成一个处理次序',
    why: s.derived
      ? '每一行 1 的个数从多到少，正好是处理次序：最先处理的那一级把所有级都挡住。'
      : s.order
        ? '各行 1 的个数各不相同，而且按个数排出的次序再推一遍屏蔽字，与给定的完全一样。'
        : '有两行 1 的个数相同，或者按个数排出次序再推一遍屏蔽字对不上。下面仍按这组屏蔽字推进。',
    ref: '教材 p270',
    focus: ['order'],
    update: (d) => {
      d.order = s.order;
    },
  });

  // ---- 按事件推进 ----
  simulateCore(p, s, (e, now) => {
    const apply = (d: State) => {
      const keep = { masks: d.masks, order: d.order };
      Object.assign(d, clone(now), keep);
    };
    if (e.kind === 'arrive') {
      const parts: string[] = [];
      if (e.levels.length) parts.push(`${levelsText(e.levels)} 的请求触发器置 1`);
      if (e.merged.length) parts.push(`${levelsText(e.merged)} 的上一个请求还没被响应，这次合并`);
      step({
        title: `t=${e.t}：${levelsText([...e.levels, ...e.merged])} 请求`,
        why: parts.join('；') + '。' + (e.held.length ? `当前屏蔽字 ${now.imr} 把 ${levelsText(e.held)} 挡住，先挂着。` : ''),
        ref: '教材 p271–272 图 8.13',
        focus: ['irr'],
        update: apply,
      });
    } else if (e.kind === 'enter') {
      const highest = s.response.find((l) => e.pending.includes(l))!;
      const askable = e.pending.length >= 2 && (highest !== e.level || e.nested);
      step({
        level: 'cycle',
        title: `进入 ${L(e.level)}，屏蔽字换成 ${now.imr}`,
        why:
          `请求与屏蔽字取反相与后还剩 ${levelsText(e.pending.filter((l) => now.stack.at(-1)!.imr[l] === '0'))}，排队器按响应次序选 ${L(e.level)}。`
          + `${L(e.from)} 连同它的屏蔽字进栈。`,
        ref: '教材 p270–272',
        focus: ['running', 'imr', 'stack'],
        ...(askable
          ? {
              ask: {
                prompt: '接下来 CPU 进入哪一级？',
                kind: 'choice' as const,
                options: e.pending.map(L),
                answer: L(e.level),
                hint: `先看 ${L(e.from)} 的屏蔽字放过了谁，再在放过的里面按响应次序挑。`,
              },
            }
          : {}),
        update: apply,
      });
    } else if (e.kind === 'run') {
      step({
        level: 'instruction',
        title: `${L(e.who)} 运行 ${e.from}–${e.to}`,
        why:
          e.who === MAIN
            ? '没有请求要处理，主程序照常运行。'
            : now.remaining === 0
              ? `${L(e.who)} 的运行时间用完。`
              : `到 ${e.to} 有新的请求到达，先停在这里看要不要打断。`,
        focus: ['t', 'segments'],
        update: apply,
      });
    } else {
      step({
        title: `${L(e.level)} 处理完，回到 ${L(e.back)}`,
        why: `出栈恢复 ${L(e.back)} 的现场和屏蔽字 ${now.imr}。${now.irr.includes('1') ? '挂着的请求在新的屏蔽字下重新排队。' : ''}`,
        ref: '教材 p270',
        focus: ['running', 'imr', 'stack', 'done'],
        update: apply,
      });
    }
  });

  const final = b.state;
  const result: Record<string, string> = {
    屏蔽字: s.masks.join(' / '),
    处理次序: orderText,
    完成次序: final.done.map(L).join('、'),
    运行轨迹: final.segments.map((g) => `${L(g.who)} ${g.from}–${g.to}`).join('，'),
    结束时刻: String(final.t),
  };
  const columns = ['中断处理程序', ...Array.from({ length: n }, (_, i) => `${L(i)} 级`), ...(s.derived ? [] : ['1 的个数'])];
  return b.finish(result, { columns, rows });
}

/** mulberry32：同一个种子给出同一串数。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按种子出一道题：4–5 级，给一个处理次序，请求要么同时到，要么错开。 */
export function generate(seed: number): Params {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const n = int(4, 5);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = int(0, i);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const together = r() < 0.5;
  const arrivals: Arrival[] = together
    ? order.map((level) => ({ level, at: 0 })).sort((a, b) => a.level - b.level)
    : Array.from({ length: int(3, 5) }, () => ({ level: int(0, n - 1), at: int(0, 8) }));
  return { levels: n, order, arrivals, service: int(2, 4) };
}
