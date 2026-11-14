/**
 * 集中式总线仲裁引擎（教材 6.3.1，p211–213，图 6.10）。规格见 specs/6-arbiter.md。
 *
 * 三种方式：链式查询（BG 从接口 0 起往下传，第一个有请求的接口截住）、计数器定时查询（计数值逐个发出，
 * 与有请求的设备地址相同就停）、独立请求（排队电路一步选出）。时间以总线周期为单位，占用期间不被打断。
 * 状态路径（devices.2.bg、bs、owner、counter …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Condition, type SolutionTable, type StepInput, type Trace } from '../trace';

export const ENGINE = 'arbiter';
export const MAX_DEVICES = 8;
export const MAX_REQUESTS = 12;
export const MAX_AT = 60;
export const MAX_HOLD = 6;

export type Mode = '链式查询' | '计数器定时查询' | '独立请求';
/** 计数器每轮从 0 计，或从上次停下的值加 1 计。 */
export type CounterFrom = '0' | '中止点';

export interface Request {
  device: number;
  /** 发请求的总线周期。 */
  at: number;
  /** 要占用几个总线周期。 */
  hold: number;
}

export interface Params {
  mode: Mode;
  devices: number;
  requests: Request[];
  counterFrom?: CounterFrom;
  /** 独立请求的优先次序，高到低。 */
  priority?: number[];
  /** 独立请求里被屏蔽的设备。 */
  masked?: number[];
  /** 链式查询里传 BG 的电路坏掉的接口。 */
  broken?: number;
}

export interface DeviceState {
  /** 这一刻有没有请求。 */
  br: 0 | 1;
  /** BG 到没到这个接口（独立请求时是 BGi）。 */
  bg: 0 | 1;
  /** 已发出、还没得到总线的请求数。 */
  pending: number;
}

export interface State {
  t: number;
  devices: DeviceState[];
  bs: 0 | 1;
  owner: number | null;
  /** 计数器的当前值；不是计数器方式时为 null。 */
  counter: number | null;
  /** 已授权的设备号，按先后。 */
  grants: number[];
}

export interface Grant {
  /** 请求在 params.requests 里的序号。 */
  request: number;
  device: number;
  /** 获准的时刻。 */
  at: number;
  /** 释放的时刻。 */
  until: number;
}

/** 一轮仲裁：总线空闲、有请求时发生。 */
interface Round {
  t: number;
  /** 这一刻有请求的设备（含不能参与的）。 */
  requesting: number[];
  /** 能参与仲裁的。 */
  eligible: number[];
  /** 查询经过：链式是接口序列，计数器是计数值序列，独立请求为空。 */
  visited: number[];
  winner: number | null;
  request: number | null;
  /** 计数器这一轮的起点。 */
  start: number;
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

export function validateParams(p: Params): string[] {
  const problems: string[] = [];
  if (!p || !['链式查询', '计数器定时查询', '独立请求'].includes(p.mode)) return ['方式必须是 链式查询、计数器定时查询、独立请求 之一'];
  const n = p.devices;
  if (!isInt(n) || n < 2 || n > MAX_DEVICES) {
    problems.push(`设备数必须是 2–${MAX_DEVICES}`);
    return problems;
  }
  if (!Array.isArray(p.requests) || p.requests.length < 1 || p.requests.length > MAX_REQUESTS) problems.push(`请求必须有 1–${MAX_REQUESTS} 个`);
  else
    p.requests.forEach((r, i) => {
      if (!isInt(r.device) || r.device < 0 || r.device >= n) problems.push(`第 ${i + 1} 个请求的设备号必须是 0–${n - 1}`);
      if (!isInt(r.at) || r.at < 0 || r.at > MAX_AT) problems.push(`第 ${i + 1} 个请求的时刻必须是 0–${MAX_AT} 的整数`);
      if (!isInt(r.hold) || r.hold < 1 || r.hold > MAX_HOLD) problems.push(`第 ${i + 1} 个请求的占用周期数必须是 1–${MAX_HOLD}`);
    });
  if (p.mode === '计数器定时查询' && p.counterFrom !== '0' && p.counterFrom !== '中止点') problems.push('计数器定时查询必须给计数起点：0 或 中止点');
  if (p.mode === '独立请求') {
    if (p.priority !== undefined) {
      const sorted = [...p.priority].sort((a, b) => a - b);
      if (sorted.length !== n || sorted.some((v, i) => v !== i)) problems.push(`优先次序必须是 0–${n - 1} 的一个排列`);
    }
    if (p.masked !== undefined) {
      if (p.masked.some((d) => !isInt(d) || d < 0 || d >= n) || new Set(p.masked).size !== p.masked.length) problems.push('屏蔽的设备号必须各不相同且在范围内');
    }
  }
  if (p.mode === '链式查询' && p.broken !== undefined && (!isInt(p.broken) || p.broken < 0 || p.broken >= n)) problems.push(`坏掉的接口必须是 0–${n - 1}`);
  return problems;
}

function check(p: Params): void {
  const problems = validateParams(p);
  if (problems.length) throw new Error(problems.join('；'));
}

function canTakePart(p: Params, device: number): boolean {
  if (p.mode === '链式查询' && p.broken !== undefined) return device <= p.broken;
  if (p.mode === '独立请求' && p.masked) return !p.masked.includes(device);
  return true;
}

/** 逐轮推出仲裁过程。 */
function rounds(p: Params): { rounds: Round[]; grants: Grant[]; never: number[] } {
  check(p);
  const n = p.devices;
  const order = p.requests.map((r, i) => ({ ...r, index: i })).sort((a, b) => a.at - b.at || a.index - b.index);
  const served = new Set<number>();
  const head = (d: number) => order.find((r) => r.device === d && !served.has(r.index));
  const result: Round[] = [];
  const grants: Grant[] = [];
  let free = 0;
  let stop = -1;
  let lastWasEmpty = false;
  const priority = p.priority ?? Array.from({ length: n }, (_, i) => i);
  for (;;) {
    const heads = Array.from({ length: n }, (_, d) => head(d));
    const okHeads = heads.filter((h, d) => h && canTakePart(p, d)) as NonNullable<(typeof heads)[number]>[];
    const nextOk = okHeads.length ? Math.min(...okHeads.map((h) => h.at)) : Infinity;
    const blocked = order.filter((r) => !served.has(r.index) && !canTakePart(p, r.device));
    const nextBlocked = blocked.length ? Math.max(free, Math.min(...blocked.map((r) => r.at))) : Infinity;
    const okTime = Math.max(free, nextOk);
    let t: number;
    let empty: boolean;
    const stuckChain = p.mode === '链式查询' && p.broken !== undefined;
    if (okHeads.length && okTime <= nextBlocked) {
      t = okTime;
      empty = false;
    } else if (stuckChain && blocked.length && !lastWasEmpty) {
      t = nextBlocked;
      empty = true;
    } else if (okHeads.length) {
      t = okTime;
      empty = false;
    } else break;
    const requesting = Array.from({ length: n }, (_, d) => d).filter((d) => order.some((r) => r.device === d && !served.has(r.index) && r.at <= t));
    const eligible = requesting.filter((d) => canTakePart(p, d));
    let winner: number | null = null;
    let visited: number[] = [];
    let start = 0;
    if (p.mode === '链式查询') {
      const last = p.broken ?? n - 1;
      for (let i = 0; i <= last; i++) {
        visited.push(i);
        if (eligible.includes(i)) {
          winner = i;
          break;
        }
      }
    } else if (p.mode === '计数器定时查询') {
      start = p.counterFrom === '中止点' ? (stop + 1) % n : 0;
      for (let k = 0; k < n; k++) {
        const c = (start + k) % n;
        visited.push(c);
        if (eligible.includes(c)) {
          winner = c;
          break;
        }
      }
    } else {
      winner = priority.find((d) => eligible.includes(d)) ?? null;
      visited = [];
    }
    if (empty) winner = null;
    let request: number | null = null;
    if (winner !== null) {
      const h = head(winner)!;
      request = h.index;
      served.add(h.index);
      grants.push({ request: h.index, device: winner, at: t, until: t + h.hold });
      free = t + h.hold;
      stop = winner;
      lastWasEmpty = false;
    } else {
      lastWasEmpty = true;
    }
    result.push({ t, requesting, eligible, visited, winner, request, start });
  }
  const never = p.requests.map((_, i) => i).filter((i) => !served.has(i));
  return { rounds: result, grants, never };
}

/** 只算授权，不出 Trace。 */
export function schedule(p: Params): { grants: Grant[]; never: number[] } {
  const { grants, never } = rounds(p);
  return { grants, never };
}

const name = (d: number) => `设备 ${d}`;
const list = (ds: number[]) => (ds.length ? ds.join('、') : '无');

export function run(p: Params): Trace<Params, State> {
  const { rounds: all, grants, never } = rounds(p);
  const n = p.devices;
  const conditions: Condition[] = [
    { label: '方式', value: p.mode },
    { label: '设备', value: `接口 0 到 ${n - 1}；${p.mode === '独立请求' ? '每台设备一对 BRi、BGi' : '接口 0 离仲裁器最近'}` },
    { label: '请求', value: p.requests.map((r) => `设备 ${r.device} 在 t=${r.at} 请求，占用 ${r.hold} 个周期`).join('；') },
    { label: '约定', value: '时间以总线周期计；总线占用期间不被打断；BS=1 表示总线正被使用（教材 p212）' },
  ];
  if (p.mode === '计数器定时查询') conditions.push({ label: '计数起点', value: p.counterFrom === '0' ? '每轮从 0 开始' : '从上次停下的值的下一个开始' });
  if (p.mode === '独立请求') {
    conditions.push({ label: '优先次序', value: (p.priority ?? Array.from({ length: n }, (_, i) => i)).map(name).join(' > ') });
    if (p.masked?.length) conditions.push({ label: '屏蔽', value: p.masked.map(name).join('、') });
  }
  if (p.mode === '链式查询' && p.broken !== undefined) conditions.push({ label: '故障', value: `接口 ${p.broken} 传 BG 的电路坏了` });

  const initial: State = {
    t: 0,
    devices: Array.from({ length: n }, () => ({ br: 0, bg: 0, pending: 0 })),
    bs: 0,
    owner: null,
    counter: p.mode === '计数器定时查询' ? 0 : null,
    grants: [],
  };
  const b = new TraceBuilder<Params, State>(ENGINE, p, initial, conditions);
  let count = 0;
  const step = (input: StepInput<State>): string => {
    b.step(input);
    count += 1;
    return `s${count}`;
  };
  const rows: SolutionTable['rows'] = [];
  const arrived = (d: number, t: number) => p.requests.filter((r, i) => r.device === d && r.at <= t && !grants.some((g) => g.request === i && g.at < t)).length;
  const brokenChain = p.mode === '链式查询' && p.broken !== undefined;

  all.forEach((round, index) => {
    const { t, requesting, eligible, visited, winner } = round;
    const askable = eligible.length >= 2 || (brokenChain && requesting.some((d) => !eligible.includes(d)));
    const options = requesting.map(name);
    if (brokenChain) options.push('没有设备');
    step({
      title: `t=${t}：${requesting.map(name).join('、')} 有请求`,
      why:
        p.mode === '独立请求'
          ? `总线空闲（BS=0），这些设备各自的 BR 线为 1，排队电路开始工作。`
          : `总线空闲（BS=0），公共的 BR 线上有请求，仲裁器开始${p.mode === '链式查询' ? '发 BG' : '计数'}。`,
      ref: '教材 p212',
      focus: ['t', ...requesting.map((d) => `devices.${d}.br`)],
      ...(askable
        ? {
            ask: {
              prompt: '这一轮谁得到总线？',
              kind: 'choice' as const,
              options,
              answer: winner === null ? '没有设备' : name(winner),
              hint: p.mode === '链式查询' ? '看 BG 从接口 0 往下传时先碰到谁。' : p.mode === '计数器定时查询' ? '看这一轮计数从几开始。' : '看优先次序和屏蔽。',
            },
          }
        : {}),
      update: (s) => {
        s.t = t;
        s.bs = 0;
        s.owner = null;
        s.devices.forEach((dev, d) => {
          dev.bg = 0;
          dev.pending = arrived(d, t);
          dev.br = dev.pending > 0 ? 1 : 0;
        });
      },
    });

    let lastId = '';
    if (p.mode === '链式查询') {
      for (const i of visited) {
        const has = requesting.includes(i);
        const captured = winner === i;
        const stuck = !captured && p.broken === i;
        lastId = step({
          title: captured ? `BG 到接口 ${i}：有请求，截住` : stuck ? `BG 到接口 ${i}：传不下去` : `BG 到接口 ${i}：没有请求，往下传`,
          why: captured
            ? `接口 ${i} 有请求，它不再把 BG 往下送，自己接管总线。${i > 0 ? `前面的接口都没有请求，所以轮到它。` : '它离仲裁器最近，最先拿到 BG。'}`
            : stuck
              ? `接口 ${i} 里传 BG 的电路坏了，${has ? '' : '它自己又没有请求，'}BG 停在这里，后面的接口永远收不到。`
              : `接口 ${i} 没有请求，BG 原样送给下一个接口。`,
          ref: '教材 p212',
          focus: [`devices.${i}.bg`],
          update: (s) => {
            s.devices[i]!.bg = 1;
          },
        });
      }
    } else if (p.mode === '计数器定时查询') {
      visited.forEach((c, k) => {
        const captured = winner === c;
        lastId = step({
          title: `计数值 ${c}：${captured ? `设备 ${c} 有请求，计数停止` : `设备 ${c} 没有请求`}`,
          why:
            (k === 0
              ? p.counterFrom === '0'
                ? '每一轮都从 0 计起。'
                : index === 0
                  ? '第一轮从 0 计起。'
                  : `上一轮停在 ${(round.start + n - 1) % n}，这一轮从它的下一个 ${round.start} 计起。`
              : '')
            + (captured ? `地址线上的 ${c} 与设备 ${c} 的地址相同，而它有请求，于是它置 BS。` : `地址线上的 ${c} 与设备 ${c} 的地址相同，但它没有请求，计数加 1。`),
          ref: '教材 p212',
          focus: ['counter', `devices.${c}.br`],
          update: (s) => {
            s.counter = c;
          },
        });
      });
    } else {
      const masked = requesting.filter((d) => !eligible.includes(d));
      lastId = step({
        title: winner === null ? '排队电路：没有可以响应的请求' : `排队电路选出设备 ${winner}，回 BG${winner}`,
        why:
          (masked.length ? `${masked.map(name).join('、')} 被屏蔽，不参加排队。` : '')
          + (winner === null ? '' : `有请求的设备里，按优先次序设备 ${winner} 最靠前，一步选出，不用逐个查询。`),
        ref: '教材 p212',
        focus: winner === null ? [] : [`devices.${winner}.bg`],
        update: (s) => {
          if (winner !== null) s.devices[winner]!.bg = 1;
        },
      });
    }

    if (winner === null) {
      rows.push({ cells: [String(index + 1), String(t), list(requesting), visited.join('→') || '排队电路', '无', '—'], step: lastId });
      return;
    }
    const g = grants.find((x) => x.request === round.request)!;
    const id = step({
      level: 'access',
      title: `设备 ${winner} 置 BS=1，占用 t=${g.at} 到 t=${g.until}`,
      why: `它拿到了授权，置 BS 表示总线已被使用；占用的 ${g.until - g.at} 个周期里别的请求只能等。`,
      ref: '教材 p211–212',
      focus: ['bs', 'owner'],
      update: (s) => {
        s.bs = 1;
        s.owner = winner;
        const dev = s.devices[winner]!;
        dev.pending -= 1;
        dev.br = dev.pending > 0 ? 1 : 0;
        s.grants.push(winner);
      },
    });
    const via = p.mode === '链式查询' ? visited.join('→') : p.mode === '计数器定时查询' ? `计数 ${visited.join('→')}` : '排队电路';
    rows.push({ cells: [String(index + 1), String(t), list(requesting), via, name(winner), `${g.at}–${g.until}`], step: id });
    step({
      title: `t=${g.until}：设备 ${winner} 用完，BS 清 0`,
      why: '总线占用期结束，主方撤掉 BS，总线又空闲了，授权线也撤销。',
      ref: '教材 p212',
      focus: ['bs', 'owner'],
      update: (s) => {
        s.t = g.until;
        s.bs = 0;
        s.owner = null;
        s.devices.forEach((dev) => (dev.bg = 0));
      },
    });
  });

  if (count === 0) {
    // 只有独立请求、所有请求都被屏蔽时会一轮都没有。
    step({
      title: '没有可以响应的请求',
      why: '发出请求的设备都被屏蔽了，排队电路不给任何设备授权，总线一直空闲。',
      ref: '教材 p212',
      update: (s) => {
        s.devices.forEach((dev, d) => {
          dev.pending = p.requests.filter((r) => r.device === d).length;
          dev.br = dev.pending > 0 ? 1 : 0;
        });
      },
    });
  }
  const result: Record<string, string> = {
    授权次序: grants.length ? grants.map((g) => name(g.device)).join('，') : '无',
    结束时刻: grants.length ? String(grants.at(-1)!.until) : '—',
    等待合计: String(grants.reduce((sum, g) => sum + g.at - p.requests[g.request]!.at, 0)),
  };
  if (never.length) result['得不到总线'] = [...new Set(never.map((i) => p.requests[i]!.device))].sort((a, b) => a - b).map(name).join('、');
  return b.finish(result, { columns: ['次序', '时刻', '提出请求的设备', '查询经过', '获得总线', '占用'], rows });
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

/** 按种子出一道题：3–5 台设备，3–6 个请求，大多挤在前几个周期里，好让它们争。 */
export function generate(seed: number, mode?: Mode): Params {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const chosen: Mode = mode ?? (['链式查询', '计数器定时查询', '独立请求'] as const)[int(0, 2)]!;
  const n = int(3, 5);
  const requests: Request[] = Array.from({ length: int(3, 6) }, () => ({ device: int(0, n - 1), at: int(0, 6), hold: int(1, 3) }));
  const p: Params = { mode: chosen, devices: n, requests };
  if (chosen === '计数器定时查询') p.counterFrom = r() < 0.5 ? '0' : '中止点';
  if (chosen === '独立请求' && r() < 0.5) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = int(0, i);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    p.priority = order;
  }
  return p;
}
