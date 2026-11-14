import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, schedule, validateParams } from './model';

// ---------- 朴素参照实现：只按规格写，不看引擎 ----------
// 一个总线周期一个周期地往前走：总线空闲就看谁在要，按方式挑一个。

type Mode = '链式查询' | '计数器定时查询' | '独立请求';
interface Req {
  device: number;
  at: number;
  hold: number;
}
interface P {
  mode: Mode;
  devices: number;
  requests: Req[];
  counterFrom?: '0' | '中止点';
  priority?: number[];
  masked?: number[];
  broken?: number;
}
interface Grant {
  request: number;
  device: number;
  at: number;
  until: number;
}

type EP = Parameters<typeof run>[0];
const asEngine = (p: P): EP => p as unknown as EP;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** 这台设备能不能参与仲裁（没被屏蔽、不在坏点之后）。 */
function canJoin(p: P, d: number): boolean {
  if (p.mode === '独立请求' && (p.masked ?? []).includes(d)) return false;
  if (p.mode === '链式查询' && p.broken !== undefined && d > p.broken) return false;
  return true;
}

function reference(p: P): { grants: Grant[]; never: number[] } {
  const served = p.requests.map(() => false);
  const grants: Grant[] = [];
  let busyUntil = 0;
  let lastStop = -1;
  for (let t = 0; t <= 300; t++) {
    if (t < busyUntil) continue; // 总线忙，这一周期不仲裁
    // 每台设备的排头：未服务里 at 最早、再按序号
    const head = range(p.devices).map((d) => {
      let best = -1;
      p.requests.forEach((r, i) => {
        if (r.device === d && !served[i] && (best < 0 || r.at < p.requests[best]!.at)) best = i;
      });
      return best;
    });
    const wants = (d: number): boolean => head[d]! >= 0 && p.requests[head[d]!]!.at <= t && canJoin(p, d);
    let order: number[];
    if (p.mode === '独立请求') order = p.priority ?? range(p.devices);
    else if (p.mode === '计数器定时查询' && p.counterFrom === '中止点') order = range(p.devices).map((k) => (lastStop + 1 + k) % p.devices);
    else order = range(p.devices);
    const winner = order.find(wants);
    if (winner === undefined) continue;
    const i = head[winner]!;
    served[i] = true;
    grants.push({ request: i, device: winner, at: t, until: t + p.requests[i]!.hold });
    busyUntil = t + p.requests[i]!.hold;
    lastStop = winner;
  }
  return { grants, never: range(p.requests.length).filter((i) => !served[i]) };
}

// ---------- 生成合格参数 ----------

const arbReqs = (n: number): fc.Arbitrary<Req[]> =>
  fc.array(
    fc.record({
      device: fc.nat(n - 1),
      // 多数挤在前面，才有争用
      at: fc.oneof(fc.nat(6), fc.nat(60)),
      hold: fc.integer({ min: 1, max: 6 }),
    }),
    { minLength: 1, maxLength: 12 },
  );

const arbParams = (modes: Mode[]): fc.Arbitrary<P> =>
  fc.integer({ min: 2, max: 8 }).chain((n) =>
    fc
      .record({
        mode: fc.constantFrom(...modes),
        requests: arbReqs(n),
        from: fc.constantFrom<'0' | '中止点'>('0', '中止点'),
        priority: fc.option(fc.shuffledSubarray(range(n), { minLength: n, maxLength: n }), { nil: undefined }),
        masked: fc.option(fc.subarray(range(n)), { nil: undefined }),
        broken: fc.option(fc.nat(n - 1), { nil: undefined }),
      })
      .map((r) => {
        const p: P = { mode: r.mode, devices: n, requests: r.requests };
        if (r.mode === '计数器定时查询') p.counterFrom = r.from;
        if (r.mode === '独立请求') {
          if (r.priority) p.priority = r.priority;
          if (r.masked) p.masked = r.masked;
        }
        if (r.mode === '链式查询' && r.broken !== undefined) p.broken = r.broken;
        return p;
      }),
  );

const ALL: Mode[] = ['链式查询', '计数器定时查询', '独立请求'];

// ---------- 状态的读法（按规格要求 8） ----------

interface AState {
  t: number;
  devices: { br: unknown; bg: unknown; pending: number }[];
  bs: unknown;
  owner: number | null;
  counter: number | null;
  grants: number[];
}
const st = (s: unknown): AState => s as AState;
const on = (v: unknown): boolean => v === true || v === 1 || v === '1';

// ---------- 与参照对拍 ----------

describe('arbiter 与朴素参照对拍', () => {
  it('随机参数：grants、never 一致', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const want = reference(p);
        const got = schedule(asEngine(p));
        expect(got.grants).toEqual(want.grants);
        expect([...got.never].sort((a, b) => a - b)).toEqual(want.never);
      }),
      { numRuns: 200 },
    );
  });

  it('generate(seed) 的参数合格，且与参照一致', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const mode of [undefined, ...ALL]) {
        const p = (mode ? generate(seed, mode) : generate(seed)) as unknown as P;
        if (mode) expect(p.mode).toBe(mode);
        expect(validateParams(asEngine(p))).toEqual([]);
        const got = schedule(asEngine(p));
        const want = reference(p);
        expect(got.grants).toEqual(want.grants);
        expect([...got.never].sort((a, b) => a - b)).toEqual(want.never);
        expect(validateTrace(run(asEngine(p)))).toEqual([]);
      }
    }
  });
});

// ---------- 规格里的性质 ----------

describe('arbiter 性质', () => {
  it('性质 1：能参与的请求恰好授权一次，不早于 at，占用不重叠', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const { grants, never } = schedule(asEngine(p));
        const joinable = range(p.requests.length).filter((i) => canJoin(p, p.requests[i]!.device));
        expect(grants.map((g) => g.request).sort((a, b) => a - b)).toEqual(joinable);
        expect([...never].sort((a, b) => a - b)).toEqual(range(p.requests.length).filter((i) => !joinable.includes(i)));
        for (const g of grants) {
          const r = p.requests[g.request]!;
          expect(g.device).toBe(r.device);
          expect(g.at).toBeGreaterThanOrEqual(r.at);
          expect(g.until).toBe(g.at + r.hold);
        }
        for (let k = 1; k < grants.length; k++) expect(grants[k]!.at).toBeGreaterThanOrEqual(grants[k - 1]!.until);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 2：总线空闲且有能参与的请求时马上仲裁', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const { grants } = schedule(asEngine(p));
        const grantedAt = new Map(grants.map((g) => [g.request, g.at]));
        const last = Math.max(0, ...grants.map((g) => g.until), ...p.requests.map((r) => r.at));
        for (let t = 0; t <= last; t++) {
          const busy = grants.some((g) => g.at <= t && t < g.until);
          if (busy) continue;
          const waiting = p.requests.some((r, i) => canJoin(p, r.device) && r.at <= t && (grantedAt.get(i) ?? Infinity) > t);
          if (waiting) expect(grants.some((g) => g.at === t)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('性质 3：链式、计数器从 0、缺省独立请求三者授权相同，获胜者是当时最小设备号', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }).chain((n) => arbReqs(n).map((requests) => ({ n, requests }))), ({ n, requests }) => {
        const chain = schedule(asEngine({ mode: '链式查询', devices: n, requests }));
        const counter = schedule(asEngine({ mode: '计数器定时查询', devices: n, requests, counterFrom: '0' }));
        const indep = schedule(asEngine({ mode: '独立请求', devices: n, requests }));
        expect(counter.grants).toEqual(chain.grants);
        expect(indep.grants).toEqual(chain.grants);
        const done = new Set<number>();
        for (const g of chain.grants) {
          const askers = requests.flatMap((r, i) => (!done.has(i) && r.at <= g.at ? [r.device] : []));
          expect(g.device).toBe(Math.min(...askers));
          done.add(g.request);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('性质 4：中止点时，获胜者是上次停点加 1 起循环第一个有请求的设备', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }).chain((n) => arbReqs(n).map((requests) => ({ n, requests }))), ({ n, requests }) => {
        const { grants } = schedule(asEngine({ mode: '计数器定时查询', devices: n, requests, counterFrom: '中止点' }));
        const done = new Set<number>();
        let stop = -1;
        for (const g of grants) {
          const askers = new Set(requests.flatMap((r, i) => (!done.has(i) && r.at <= g.at ? [r.device] : [])));
          const first = range(n)
            .map((k) => (stop + 1 + k) % n)
            .find((d) => askers.has(d));
          expect(g.device).toBe(first);
          stop = g.device;
          done.add(g.request);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('性质 5：同样参数同样 Trace，validateTrace 为空', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const a = run(asEngine(p));
        expect(validateTrace(a)).toEqual([]);
        expect(run(asEngine(p))).toEqual(a);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- Trace 的内容（要求 7、8、10、11） ----------

describe('arbiter Trace 内容', () => {
  it('置 BS 的步数等于授权数；最终 grants、owner、counter 与授权一致', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const trace = run(asEngine(p));
        const { grants } = schedule(asEngine(p));
        const access = trace.steps.filter((s) => s.level === 'access');
        expect(access.length).toBe(grants.length);
        for (const s of trace.steps) expect(['explain', 'access']).toContain(s.level);
        access.forEach((s, k) => {
          const state = st(s.state);
          const g = grants[k]!;
          expect(state.t).toBe(g.at);
          expect(state.owner).toBe(g.device);
          expect(on(state.bs)).toBe(true);
          if (p.mode === '计数器定时查询') expect(state.counter).toBe(g.device);
          if (p.mode === '链式查询') {
            // BG 从接口 0 传到获胜者为止
            state.devices.forEach((d, i) => expect(on(d.bg)).toBe(i <= g.device));
          }
          if (p.mode === '独立请求') state.devices.forEach((d, i) => expect(on(d.bg)).toBe(i === g.device));
        });
        const last = st(trace.steps[trace.steps.length - 1]!.state);
        expect(last.grants).toEqual(grants.map((g) => g.device));
        if (p.mode !== '计数器定时查询') for (const s of trace.steps) expect(st(s.state).counter).toBeNull();
        expect(st(trace.initial).devices.length).toBe(p.devices);
      }),
      { numRuns: 120 },
    );
  });

  it('每次仲裁的步数：登记 1 + 查询 + 置 BS 1 + 释放 1（无坏点、无屏蔽）', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        delete p.broken;
        delete p.masked;
        const { grants } = schedule(asEngine(p));
        let stop = -1;
        let total = 0;
        for (const g of grants) {
          let queries = 1;
          if (p.mode === '链式查询' || (p.mode === '计数器定时查询' && p.counterFrom === '0')) queries = g.device + 1;
          else if (p.mode === '计数器定时查询') queries = ((g.device - (stop + 1)) % p.devices + p.devices) % p.devices + 1;
          total += 1 + queries + 1 + 1;
          stop = g.device;
        }
        expect(run(asEngine(p)).steps.length).toBe(total);
      }),
      { numRuns: 120 },
    );
  });

  it('table 列名、result 各量', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const trace = run(asEngine(p));
        const { grants, never } = schedule(asEngine(p));
        expect(trace.table.columns).toEqual(['次序', '时刻', '提出请求的设备', '查询经过', '获得总线', '占用']);
        expect(trace.table.rows.length).toBeGreaterThanOrEqual(grants.length);
        const ids = new Map(trace.steps.map((s) => [s.id, s]));
        // 有授权的行指回置 BS 的那一步
        const accessRows = trace.table.rows.filter((r) => r.step && ids.get(r.step)?.level === 'access');
        expect(accessRows.length).toBe(grants.length);
        for (const key of ['授权次序', '结束时刻', '等待合计']) expect(trace.result).toHaveProperty(key);
        expect('得不到总线' in trace.result).toBe(never.length > 0);
        const wait = grants.reduce((sum, g) => sum + g.at - p.requests[g.request]!.at, 0);
        expect(trace.result['等待合计']).toContain(String(wait));
        if (grants.length > 0) expect(trace.result['结束时刻']).toContain(String(Math.max(...grants.map((g) => g.until))));
      }),
      { numRuns: 100 },
    );
  });

  it('预测题只在登记请求步、能参与的请求来自两台以上设备时出', () => {
    fc.assert(
      fc.property(arbParams(ALL), (p) => {
        const trace = run(asEngine(p));
        const asks = trace.steps.filter((s) => s.ask);
        for (const s of asks) expect(s.level).toBe('explain');
        // 只有一台设备发过请求、又没有坏点时，不该有预测题
        const devs = new Set(p.requests.map((r) => r.device));
        if (devs.size === 1 && p.broken === undefined) expect(asks.length).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- 规格里的场景 ----------

describe('arbiter 场景', () => {
  it('链式 4 台，设备 1、3 在 t=0 请求：BG 到接口 1 被截住', () => {
    const p: P = { mode: '链式查询', devices: 4, requests: [{ device: 3, at: 0, hold: 2 }, { device: 1, at: 0, hold: 2 }] };
    const { grants } = schedule(asEngine(p));
    expect(grants.map((g) => g.device)).toEqual([1, 3]);
    expect(grants[0]).toEqual({ request: 1, device: 1, at: 0, until: 2 });
  });

  it('计数器：中止点时 0 与 2 轮流；从 0 计时 0 总是先得', () => {
    const requests: Req[] = [0, 0, 0, 2, 2, 2].map((device) => ({ device, at: 0, hold: 1 }));
    const stop = schedule(asEngine({ mode: '计数器定时查询', devices: 4, requests, counterFrom: '中止点' }));
    expect(stop.grants.map((g) => g.device)).toEqual([0, 2, 0, 2, 0, 2]);
    const zero = schedule(asEngine({ mode: '计数器定时查询', devices: 4, requests, counterFrom: '0' }));
    expect(zero.grants.map((g) => g.device)).toEqual([0, 0, 0, 2, 2, 2]);
  });

  it('独立请求 priority [3,2,1,0]：同时请求时设备 3 先得', () => {
    const requests: Req[] = [0, 1, 2, 3].map((device) => ({ device, at: 0, hold: 1 }));
    const { grants } = schedule(asEngine({ mode: '独立请求', devices: 4, requests, priority: [3, 2, 1, 0] }));
    expect(grants.map((g) => g.device)).toEqual([3, 2, 1, 0]);
  });

  it('独立请求带屏蔽：被屏蔽的列入得不到总线', () => {
    const requests: Req[] = [0, 1, 2].map((device) => ({ device, at: 0, hold: 1 }));
    const r = schedule(asEngine({ mode: '独立请求', devices: 3, requests, masked: [1] }));
    expect(r.grants.map((g) => g.device)).toEqual([0, 2]);
    expect(r.never).toEqual([1]);
  });

  it('链式 broken=1，只有设备 2 请求：没有设备得到总线', () => {
    const p: P = { mode: '链式查询', devices: 4, requests: [{ device: 2, at: 0, hold: 1 }], broken: 1 };
    const r = schedule(asEngine(p));
    expect(r.grants).toEqual([]);
    expect(r.never).toEqual([0]);
    const trace = run(asEngine(p));
    expect(validateTrace(trace)).toEqual([]);
    expect(trace.result).toHaveProperty('得不到总线');
  });

  it('坏点本身还能截住 BG', () => {
    const p: P = { mode: '链式查询', devices: 4, requests: [{ device: 1, at: 0, hold: 1 }, { device: 3, at: 0, hold: 1 }], broken: 1 };
    const r = schedule(asEngine(p));
    expect(r.grants.map((g) => g.device)).toEqual([1]);
    expect(r.never).toEqual([1]);
  });
});

// ---------- 非法参数 ----------

describe('arbiter 非法参数', () => {
  const good: P = { mode: '链式查询', devices: 4, requests: [{ device: 1, at: 0, hold: 2 }] };
  const bad: [string, unknown][] = [
    ['设备只有 1 台', { ...good, devices: 1 }],
    ['设备 9 台', { ...good, devices: 9 }],
    ['没有请求', { ...good, requests: [] }],
    ['13 个请求', { ...good, requests: Array.from({ length: 13 }, () => ({ device: 0, at: 0, hold: 1 })) }],
    ['at 超过 60', { ...good, requests: [{ device: 0, at: 61, hold: 1 }] }],
    ['at 不是整数', { ...good, requests: [{ device: 0, at: 1.5, hold: 1 }] }],
    ['hold 为 0', { ...good, requests: [{ device: 0, at: 0, hold: 0 }] }],
    ['hold 为 7', { ...good, requests: [{ device: 0, at: 0, hold: 7 }] }],
    ['设备号越界', { ...good, requests: [{ device: 4, at: 0, hold: 1 }] }],
    ['方式不认识', { ...good, mode: '轮询' }],
    ['计数器缺 counterFrom', { ...good, mode: '计数器定时查询' }],
    ['priority 不是排列', { ...good, mode: '独立请求', priority: [0, 0, 1, 2] }],
    ['broken 越界', { ...good, broken: 4 }],
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
