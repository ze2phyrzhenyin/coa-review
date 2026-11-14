import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, masksFromOrder, orderFromMasks, run, simulate, validateParams } from './model';

// ---------- 朴素参照实现：只按规格写，不看引擎 ----------
// 一个时间单位一个单位地走：先结束、再登记、再响应，最后让当前程序跑 1 个单位。

interface Arrival {
  level: number;
  at: number;
}
interface P {
  levels: number;
  response?: number[];
  order?: number[];
  masks?: string[];
  arrivals: Arrival[];
  service: number | number[];
}
interface Seg {
  who: number;
  from: number;
  to: number;
  depth: number;
}

type EP = Parameters<typeof run>[0];
const asEngine = (p: P): EP => p as unknown as EP;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** Li 的屏蔽字：自己和次序排在后面的级为 1。 */
function refMasks(n: number, order: number[]): string[] {
  return range(n).map((i) =>
    range(n)
      .map((j) => (order.indexOf(j) >= order.indexOf(i) ? '1' : '0'))
      .join(''),
  );
}

function refOrder(masks: string[]): number[] | null {
  const ones = masks.map((m) => m.split('').filter((c) => c === '1').length);
  if (new Set(ones).size !== ones.length) return null;
  const order = range(masks.length).sort((a, b) => ones[b]! - ones[a]!);
  return refMasks(masks.length, order).join() === masks.join() ? order : null;
}

function refSim(p: P): { segments: Seg[]; done: number[]; end: number; served: number } {
  const n = p.levels;
  const response = p.response ?? range(n);
  const masks = p.masks ?? refMasks(n, p.order ?? response);
  const svc = (l: number): number => (typeof p.service === 'number' ? p.service : p.service[l]!);
  const lastAt = Math.max(...p.arrivals.map((a) => a.at));
  let running = -1;
  let imr = '0'.repeat(n);
  let remaining = 0;
  const irr = range(n).map(() => false);
  const stack: { who: number; remaining: number; imr: string }[] = [];
  const done: number[] = [];
  // epoch：每次进入或返回加 1，同一 epoch 的单位才算同一段
  const units: { who: number; depth: number; epoch: number }[] = [];
  let epoch = 0;
  let served = 0;
  let t = 0;
  for (;;) {
    // 1. 剩余为 0 的处理程序返回
    while (running !== -1 && remaining === 0) {
      done.push(running);
      const back = stack.pop()!;
      running = back.who;
      remaining = back.remaining;
      imr = back.imr;
      epoch++;
    }
    // 2. 登记这一刻到达的请求，已是 1 的合并
    for (const a of p.arrivals) {
      if (a.at !== t) continue;
      if (!irr[a.level]) served++;
      irr[a.level] = true;
    }
    // 3. 请求 ∧ ¬屏蔽，按响应次序挑最高的，可以连着进
    for (;;) {
      const l = response.find((x) => irr[x] && imr[x] === '0');
      if (l === undefined) break;
      stack.push({ who: running, remaining, imr });
      running = l;
      imr = masks[l]!;
      remaining = svc(l);
      irr[l] = false;
      epoch++;
    }
    if (running === -1 && t >= lastAt) break;
    // 4. 跑一个单位
    units.push({ who: running, depth: stack.length, epoch });
    if (running !== -1) remaining--;
    t++;
  }
  // 同一 epoch 的相邻单位并成一段
  const segments: Seg[] = [];
  const epochs: number[] = [];
  units.forEach((u, i) => {
    const prev = segments[segments.length - 1];
    if (prev && epochs[epochs.length - 1] === u.epoch) prev.to = i + 1;
    else {
      segments.push({ who: u.who, from: i, to: i + 1, depth: u.depth });
      epochs.push(u.epoch);
    }
  });
  return { segments, done, end: t, served };
}

/** 段逐一相同（含主程序段和 depth：主程序 0，每嵌套一层加 1）。 */
function sameTrack(got: Seg[], want: Seg[]): void {
  expect(got).toEqual(want);
}

// ---------- 生成合格参数 ----------

const perm = (n: number): fc.Arbitrary<number[]> => fc.shuffledSubarray(range(n), { minLength: n, maxLength: n });

const arbParams: fc.Arbitrary<P> = fc.integer({ min: 2, max: 6 }).chain((n) =>
  fc
    .record({
      response: fc.option(perm(n), { nil: undefined }),
      kind: fc.constantFrom<'order' | 'masks' | 'none'>('order', 'masks', 'none'),
      order: perm(n),
      masks: fc.array(fc.array(fc.constantFrom('0', '1'), { minLength: n, maxLength: n }).map((a) => a.join('')), { minLength: n, maxLength: n }),
      arrivals: fc.array(fc.record({ level: fc.nat(n - 1), at: fc.oneof(fc.nat(10), fc.nat(100)) }), { minLength: 1, maxLength: 12 }),
      service: fc.oneof(fc.integer({ min: 1, max: 20 }), fc.array(fc.integer({ min: 1, max: 20 }), { minLength: n, maxLength: n })),
    })
    .map((r) => {
      const p: P = { levels: n, arrivals: r.arrivals, service: r.service };
      if (r.response) p.response = r.response;
      if (r.kind === 'order') p.order = r.order;
      if (r.kind === 'masks') p.masks = r.masks;
      return p;
    }),
);

// ---------- 状态的读法（按规格要求 6） ----------

interface MState {
  t: number;
  running: number;
  imr: unknown;
  irr: unknown;
  stack: { who: number; remaining: number; imr: unknown }[];
  remaining: number | null;
  masks: string[];
  order: number[] | null;
  segments: Seg[];
  done: number[];
}
const st = (s: unknown): MState => s as MState;
const bits = (v: unknown): string => (Array.isArray(v) ? v.map(String).join('') : String(v).replace(/[^01]/g, ''));
const levelsIn = (s: string | undefined): number[] => [...(s ?? '').matchAll(/L(\d)/g)].map((m) => Number(m[1]));

function usedMasks(p: P): string[] {
  return p.masks ?? refMasks(p.levels, p.order ?? p.response ?? range(p.levels));
}

// ---------- 与参照对拍 ----------

describe('mask 与朴素参照对拍', () => {
  it('随机参数：运行轨迹、完成次序、结束时刻一致', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const want = refSim(p);
        const got = simulate(asEngine(p));
        expect(got.done).toEqual(want.done);
        expect(got.end).toBe(want.end);
        sameTrack(got.segments, want.segments);
      }),
      { numRuns: 200 },
    );
  });

  it('masksFromOrder、orderFromMasks 与参照一致', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((n) =>
          fc.tuple(fc.constant(n), perm(n), fc.array(fc.array(fc.constantFrom('0', '1'), { minLength: n, maxLength: n }).map((a) => a.join('')), { minLength: n, maxLength: n })),
        ),
        ([n, order, masks]) => {
          expect(masksFromOrder(n, order)).toEqual(refMasks(n, order));
          expect(orderFromMasks(masks)).toEqual(refOrder(masks));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('generate(seed) 的参数合格，且与参照一致', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generate(seed) as unknown as P;
      expect(validateParams(asEngine(p))).toEqual([]);
      const want = refSim(p);
      const got = simulate(asEngine(p));
      expect(got.done).toEqual(want.done);
      expect(got.end).toBe(want.end);
      sameTrack(got.segments, want.segments);
      expect(validateTrace(run(asEngine(p)))).toEqual([]);
    }
  });
});

// ---------- 规格里的性质 ----------

describe('mask 性质', () => {
  it('性质 1：每个（合并后的）请求恰好完成一次；结束时栈空、回到主程序', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const got = simulate(asEngine(p));
        expect(got.done.length).toBe(refSim(p).served);
        const last = st(run(asEngine(p)).steps.at(-1)!.state);
        expect(last.stack).toEqual([]);
        expect(last.running).toBe(-1);
        expect(last.done).toEqual(got.done);
      }),
      { numRuns: 150 },
    );
  });

  it('性质 2：进入某级时它在被打断者的屏蔽字里为 0；栈深不超过请求次数', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(asEngine(p));
        for (const s of trace.steps) {
          const state = st(s.state);
          expect(state.stack.length).toBeLessThanOrEqual(p.arrivals.length);
          if (s.level !== 'cycle') continue;
          const top = state.stack.at(-1)!;
          expect(bits(top.imr)[state.running]).toBe('0');
          expect(bits(state.imr)).toBe(usedMasks(p)[state.running]);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('性质 3：同时到达、屏蔽字由 order 推出时，完成次序等于 order', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((n) =>
          fc.record({
            n: fc.constant(n),
            order: perm(n),
            response: perm(n),
            at: fc.nat(100),
            service: fc.oneof(fc.integer({ min: 1, max: 20 }), fc.array(fc.integer({ min: 1, max: 20 }), { minLength: n, maxLength: n })),
          }),
        ),
        ({ n, order, response, at, service }) => {
          const arrivals = range(n).map((level) => ({ level, at }));
          expect(simulate(asEngine({ levels: n, order, response, arrivals, service })).done).toEqual(order);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('性质 4：orderFromMasks(masksFromOrder(o)) = o；第 k 个处理的级那一行有 n−k+1 个 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }).chain((n) => fc.tuple(fc.constant(n), perm(n))),
        ([n, order]) => {
          const masks = masksFromOrder(n, order);
          expect(orderFromMasks(masks)).toEqual(order);
          order.forEach((level, k) => expect(masks[level]!.split('').filter((c) => c === '1').length).toBe(n - k));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('性质 5：同样参数同样 Trace，validateTrace 为空；状态里的轨迹与 simulate 一致', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const a = run(asEngine(p));
        expect(validateTrace(a)).toEqual([]);
        expect(run(asEngine(p))).toEqual(a);
        const sim = simulate(asEngine(p));
        expect(st(a.steps.at(-1)!.state).segments).toEqual(sim.segments);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- Trace 的内容（要求 5–9） ----------

describe('mask Trace 内容', () => {
  it('先每级一步写屏蔽字，状态里的 masks、order', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(asEngine(p));
        const n = p.levels;
        const masks = usedMasks(p);
        for (const s of trace.steps.slice(0, n)) expect(s.level).toBe('explain');
        const last = st(trace.steps.at(-1)!.state);
        expect(last.masks).toEqual(masks);
        const order = p.masks ? refOrder(p.masks) : (p.order ?? p.response ?? range(n));
        expect(last.order).toEqual(order);
        // 推屏蔽字时第二个及以后问屏蔽字
        if (!p.masks) {
          const asks = trace.steps.slice(0, n).map((s) => s.ask);
          expect(asks[0]?.kind).not.toBe('bits');
          for (const a of asks.slice(1)) {
            expect(a?.kind).toBe('bits');
            expect(masks).toContain(a?.answer);
          }
        }
        for (const s of trace.steps) {
          if (!['explain', 'cycle', 'instruction'].includes(s.level)) throw new Error(`没想到的层级 ${s.level}`);
        }
      }),
      { numRuns: 120 },
    );
  });

  it('table 是习题 8 的版式；result 各量', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(asEngine(p));
        const n = p.levels;
        const masks = usedMasks(p);
        const cols = trace.table.columns.map((c) => c.replace(/\s/g, ''));
        expect(cols.slice(0, n + 1)).toEqual(['中断处理程序', ...range(n).map((i) => `L${i}级`)]);
        expect(cols.length).toBe(n + 1 + (p.masks ? 1 : 0));
        if (p.masks) expect(cols[n + 1]).toBe('1的个数');
        expect(trace.table.rows.map((r) => r.cells.slice(1, n + 1).join('')).sort()).toEqual([...masks].sort());
        for (const r of trace.table.rows) expect(r.step).toBeTruthy();
        const sim = simulate(asEngine(p));
        const res = trace.result;
        for (const key of ['屏蔽字', '处理次序', '完成次序', '运行轨迹', '结束时刻']) expect(res).toHaveProperty(key);
        expect(res['屏蔽字']!.replace(/\s/g, '')).toBe(masks.join('/'));
        expect(levelsIn(res['完成次序'])).toEqual(sim.done);
        expect(res['结束时刻']).toContain(String(sim.end));
        const order = p.masks ? refOrder(p.masks) : (p.order ?? p.response ?? range(n));
        if (order) expect(levelsIn(res['处理次序'])).toEqual(order);
      }),
      { numRuns: 120 },
    );
  });
});

// ---------- 规格里的场景 ----------

describe('mask 场景', () => {
  const order = [1, 3, 0, 4, 2];

  it('5 级、L0 最高、处理次序 L1→L3→L0→L4→L2：屏蔽字', () => {
    expect(masksFromOrder(5, order)).toEqual(['10101', '11111', '00100', '10111', '00101']);
  });

  it('同上、5 级都在 0 时刻请求、每级运行 2：完成 L1、L3、L0、L4、L2，结束 10', () => {
    const p: P = { levels: 5, order, arrivals: range(5).map((level) => ({ level, at: 0 })), service: 2 };
    const r = simulate(asEngine(p));
    expect(r.done).toEqual(order);
    expect(r.end).toBe(10);
  });

  it('不给 order 和 masks：处理次序就是响应次序，屏蔽字上三角全 1', () => {
    const p: P = { levels: 3, arrivals: [{ level: 2, at: 0 }], service: 1 };
    const last = st(run(asEngine(p)).steps.at(-1)!.state);
    expect(last.masks).toEqual(['111', '011', '001']);
    expect(last.order).toEqual([0, 1, 2]);
  });

  it('屏蔽字把自己置 0，处理中又来本级请求：自己打断自己，栈深加 1', () => {
    const p: P = { levels: 2, masks: ['01', '11'], arrivals: [{ level: 0, at: 0 }, { level: 0, at: 1 }], service: 3 };
    const r = simulate(asEngine(p));
    expect(r.done).toEqual([0, 0]);
    expect(r.end).toBe(6);
    expect(r.segments).toEqual([
      { who: 0, from: 0, to: 1, depth: 1 },
      { who: 0, from: 1, to: 4, depth: 2 },
      { who: 0, from: 4, to: 6, depth: 1 },
    ]);
  });

  it('同一级先后两次进入，同一深度也是两段；被屏蔽的到达不切段', () => {
    const p: P = { levels: 2, arrivals: [{ level: 0, at: 0 }, { level: 0, at: 1 }, { level: 1, at: 1 }], service: 2 };
    expect(simulate(asEngine(p)).segments).toEqual([
      { who: 0, from: 0, to: 2, depth: 1 },
      { who: 0, from: 2, to: 4, depth: 1 },
      { who: 1, from: 4, to: 6, depth: 1 },
    ]);
  });

  it('主程序段：第一个请求前主程序在跑，深度 0', () => {
    const p: P = { levels: 2, arrivals: [{ level: 1, at: 3 }], service: 2 };
    expect(simulate(asEngine(p)).segments).toEqual([
      { who: -1, from: 0, to: 3, depth: 0 },
      { who: 1, from: 3, to: 5, depth: 1 },
    ]);
  });

  it('同一级没响应前又来一次，只记一次', () => {
    // L1 被 L0 挡住期间来了两次
    const p: P = { levels: 2, arrivals: [{ level: 0, at: 0 }, { level: 1, at: 1 }, { level: 1, at: 2 }], service: 5 };
    expect(simulate(asEngine(p)).done).toEqual([0, 1]);
  });

  it('反推不出时 orderFromMasks 为 null，仍照屏蔽字仿真', () => {
    const masks = ['11', '11'];
    expect(orderFromMasks(masks)).toBeNull();
    const p: P = { levels: 2, masks, arrivals: [{ level: 1, at: 0 }, { level: 0, at: 1 }], service: 2 };
    expect(simulate(asEngine(p)).done).toEqual([1, 0]);
    expect(validateTrace(run(asEngine(p)))).toEqual([]);
  });
});

// ---------- 非法参数 ----------

describe('mask 非法参数', () => {
  const good: P = { levels: 3, arrivals: [{ level: 0, at: 0 }], service: 2 };
  const bad: [string, unknown][] = [
    ['只有 1 级', { ...good, levels: 1 }],
    ['7 级', { ...good, levels: 7 }],
    ['response 不是排列', { ...good, response: [0, 0, 1] }],
    ['order 不是排列', { ...good, order: [2, 1] }],
    ['同时给 order 和 masks', { ...good, order: [0, 1, 2], masks: ['111', '011', '001'] }],
    ['masks 行数不对', { ...good, masks: ['111', '011'] }],
    ['masks 长度不对', { ...good, masks: ['11', '011', '001'] }],
    ['masks 不是 0/1', { ...good, masks: ['112', '011', '001'] }],
    ['没有请求', { ...good, arrivals: [] }],
    ['13 个请求', { ...good, arrivals: Array.from({ length: 13 }, () => ({ level: 0, at: 0 })) }],
    ['到达时刻超过 100', { ...good, arrivals: [{ level: 0, at: 101 }] }],
    ['到达时刻不是整数', { ...good, arrivals: [{ level: 0, at: 0.5 }] }],
    ['级号越界', { ...good, arrivals: [{ level: 3, at: 0 }] }],
    ['service 为 0', { ...good, service: 0 }],
    ['service 为 21', { ...good, service: 21 }],
    ['service 数组长度不对', { ...good, service: [1, 2] }],
  ];
  it('合格参数没有问题', () => {
    expect(validateParams(asEngine(good))).toEqual([]);
  });
  for (const [name, p] of bad) {
    it(`${name}：validateParams 报问题，run 抛错`, () => {
      expect(validateParams(p as EP).length).toBeGreaterThan(0);
      expect(() => run(p as EP)).toThrow();
    });
  }
});
