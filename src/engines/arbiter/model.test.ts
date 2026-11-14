import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, schedule, validateParams, type Mode, type Params } from './model';

// 朴素参照：一个周期一个周期地走。每个周期开头若总线空闲，就在已到的请求里按方式挑一个。
function naive(p: Params): { order: [number, number, number][]; never: number[] } {
  const n = p.devices;
  const left = p.requests.map((r, i) => ({ ...r, i }));
  const done = new Set<number>();
  const order: [number, number, number][] = [];
  let busyUntil = 0;
  let last = -1;
  const ok = (d: number) =>
    !(p.mode === '链式查询' && p.broken !== undefined && d > p.broken) && !(p.mode === '独立请求' && (p.masked ?? []).includes(d));
  for (let t = 0; t <= 60 + 12 * 6; t++) {
    if (t < busyUntil) continue;
    // 每台设备拿出最早的那个请求
    const firstOf = (d: number) =>
      left.filter((r) => r.device === d && !done.has(r.i)).sort((a, b) => a.at - b.at || a.i - b.i)[0];
    const ready: number[] = [];
    for (let d = 0; d < n; d++) {
      const r = firstOf(d);
      if (r && r.at <= t && ok(d)) ready.push(d);
    }
    if (ready.length === 0) continue;
    let pick: number;
    if (p.mode === '独立请求') pick = (p.priority ?? [...Array(n).keys()]).find((d) => ready.includes(d))!;
    else if (p.mode === '计数器定时查询' && p.counterFrom === '中止点') {
      pick = -1;
      for (let k = 1; k <= n; k++) {
        const c = (last + k + n) % n;
        if (ready.includes(c)) {
          pick = c;
          break;
        }
      }
    } else pick = Math.min(...ready);
    const r = firstOf(pick)!;
    done.add(r.i);
    order.push([pick, t, r.i]);
    busyUntil = t + r.hold;
    last = pick;
  }
  return { order, never: left.filter((r) => !done.has(r.i)).map((r) => r.i) };
}

const modeArb = fc.constantFrom<Mode>('链式查询', '计数器定时查询', '独立请求');
const paramsArb: fc.Arbitrary<Params> = fc
  .record({
    mode: modeArb,
    n: fc.integer({ min: 2, max: 6 }),
    reqs: fc.array(fc.record({ device: fc.nat(7), at: fc.integer({ min: 0, max: 12 }), hold: fc.integer({ min: 1, max: 4 }) }), { minLength: 1, maxLength: 8 }),
    from: fc.constantFrom('0' as const, '中止点' as const),
    perm: fc.array(fc.nat(), { minLength: 8, maxLength: 8 }),
    mask: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    broken: fc.option(fc.nat(7), { nil: undefined }),
  })
  .map(({ mode, n, reqs, from, perm, mask, broken }) => {
    const p: Params = { mode, devices: n, requests: reqs.map((r) => ({ ...r, device: r.device % n })) };
    if (mode === '计数器定时查询') p.counterFrom = from;
    if (mode === '独立请求') {
      p.priority = [...Array(n).keys()].sort((a, b) => perm[a]! - perm[b]! || a - b);
      const m = [...Array(n).keys()].filter((d) => mask[d] && d % 3 === 0);
      if (m.length) p.masked = m;
    }
    if (mode === '链式查询' && broken !== undefined) p.broken = broken % n;
    return p;
  });

describe('arbiter 引擎', () => {
  it('validateTrace 为空，同样参数同样 Trace', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(run(p)).toEqual(t);
      }),
      { numRuns: 150 },
    );
  });

  it('与逐周期的朴素参照一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const s = schedule(p);
        const ref = naive(p);
        expect(s.grants.map((g) => [g.device, g.at, g.request])).toEqual(ref.order);
        expect([...s.never].sort((a, b) => a - b)).toEqual([...ref.never].sort((a, b) => a - b));
      }),
      { numRuns: 300 },
    );
  });

  it('占用区间不重叠，授权不早于请求', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const { grants } = schedule(p);
        grants.forEach((g, i) => {
          expect(g.at).toBeGreaterThanOrEqual(p.requests[g.request]!.at);
          expect(g.until - g.at).toBe(p.requests[g.request]!.hold);
          if (i > 0) expect(g.at).toBeGreaterThanOrEqual(grants[i - 1]!.until);
        });
      }),
    );
  });

  it('链式、计数器从 0、缺省独立请求三者次序相同', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const base = { devices: p.devices, requests: p.requests };
        const a = schedule({ ...base, mode: '链式查询' }).grants;
        const b = schedule({ ...base, mode: '计数器定时查询', counterFrom: '0' }).grants;
        const c = schedule({ ...base, mode: '独立请求' }).grants;
        expect(b).toEqual(a);
        expect(c).toEqual(a);
      }),
    );
  });

  it('解题表一轮一行，每行指回一步；获胜者置 BS 那一步状态对得上', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        const { grants } = schedule(p);
        const won = t.table.rows.filter((r) => r.cells[4] !== '无');
        expect(won.length).toBe(grants.length);
        won.forEach((row, i) => {
          const step = t.steps.find((s) => s.id === row.step)!;
          expect(step.level).toBe('access');
          expect(step.state.owner).toBe(grants[i]!.device);
          expect(step.state.bs).toBe(1);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('预测题的答案取自引擎的授权', () => {
    const t = run({ mode: '链式查询', devices: 4, requests: [{ device: 3, at: 0, hold: 1 }, { device: 2, at: 0, hold: 1 }] });
    const ask = t.steps.find((s) => s.ask)!.ask!;
    expect(ask.answer).toBe('设备 2');
    expect(ask.options).toEqual(['设备 2', '设备 3']);
  });

  it('规格里的场景', () => {
    const chain = run({ mode: '链式查询', devices: 4, requests: [{ device: 1, at: 0, hold: 1 }, { device: 3, at: 0, hold: 1 }] });
    expect(chain.result['授权次序']).toBe('设备 1，设备 3');
    const firstAccess = chain.steps.find((s) => s.level === 'access')!;
    expect(firstAccess.state.devices.map((d) => d.bg)).toEqual([1, 1, 0, 0]);

    const reqs = [0, 2, 0, 2, 0, 2].map((device) => ({ device, at: 0, hold: 1 }));
    expect(schedule({ mode: '计数器定时查询', counterFrom: '中止点', devices: 3, requests: reqs }).grants.map((g) => g.device)).toEqual([0, 2, 0, 2, 0, 2]);
    expect(schedule({ mode: '计数器定时查询', counterFrom: '0', devices: 3, requests: reqs }).grants.map((g) => g.device)).toEqual([0, 0, 0, 2, 2, 2]);

    const ind = schedule({ mode: '独立请求', priority: [3, 2, 1, 0], devices: 4, requests: [{ device: 0, at: 0, hold: 1 }, { device: 3, at: 0, hold: 1 }] });
    expect(ind.grants[0]!.device).toBe(3);

    const broken = run({ mode: '链式查询', broken: 1, devices: 4, requests: [{ device: 2, at: 0, hold: 1 }] });
    expect(broken.result['授权次序']).toBe('无');
    expect(broken.result['得不到总线']).toBe('设备 2');
  });

  it('全部被屏蔽时也有一步，不返回空 Trace', () => {
    const t = run({ mode: '独立请求', masked: [1], devices: 2, requests: [{ device: 1, at: 2, hold: 1 }] });
    expect(validateTrace(t)).toEqual([]);
    expect(t.result['得不到总线']).toBe('设备 1');
  });

  it('不合格的参数抛出错误', () => {
    const bad: Params[] = [
      { mode: '链式查询', devices: 1, requests: [{ device: 0, at: 0, hold: 1 }] },
      { mode: '链式查询', devices: 3, requests: [] },
      { mode: '链式查询', devices: 3, requests: [{ device: 3, at: 0, hold: 1 }] },
      { mode: '链式查询', devices: 3, requests: [{ device: 0, at: 0, hold: 0 }] },
      { mode: '计数器定时查询', devices: 3, requests: [{ device: 0, at: 0, hold: 1 }] },
      { mode: '独立请求', priority: [0, 0, 1], devices: 3, requests: [{ device: 0, at: 0, hold: 1 }] },
      { mode: '链式查询', broken: 5, devices: 3, requests: [{ device: 0, at: 0, hold: 1 }] },
    ];
    for (const p of bad) {
      expect(validateParams(p).length).toBeGreaterThan(0);
      expect(() => run(p)).toThrow();
    }
  });

  it('generate 按种子出合格且固定的题', () => {
    for (let seed = 0; seed < 150; seed++) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(generate(seed)).toEqual(p);
      expect(validateTrace(run(p))).toEqual([]);
    }
    expect(generate(3, '独立请求').mode).toBe('独立请求');
  });
});

interface GoldenCase {
  name: string;
  params: Params;
  expect: { table: string[][]; result: Record<string, string>; never: number[] };
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/arbiter-cases.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/arbiter-cases.json', () => {
  for (const item of golden.cases) {
    it(item.name, () => {
      const t = run(item.params);
      expect(validateTrace(t)).toEqual([]);
      expect(t.table.rows.map((r) => r.cells)).toEqual(item.expect.table);
      expect(t.result).toEqual(item.expect.result);
      expect(schedule(item.params).never).toEqual(item.expect.never);
    });
  }
});
