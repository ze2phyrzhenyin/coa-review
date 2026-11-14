import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, masksFromOrder, orderFromMasks, run, simulate, validateParams, type Params } from './model';

// 朴素参照：一个时间单位一个时间单位地走，栈里存 [级, 剩余, 屏蔽字, 进入编号]。
function naive(p: Params, masks: string[]) {
  const n = p.levels;
  const resp = p.response ?? [...Array(n).keys()];
  const svc = (l: number) => (Array.isArray(p.service) ? p.service[l]! : p.service);
  const irr = new Array<boolean>(n).fill(false);
  let cur = { who: -1, left: Infinity, mask: '0'.repeat(n), id: 0 };
  const stack: (typeof cur)[] = [];
  let ids = 0;
  const units: { who: number; depth: number; id: number }[] = [];
  const done: number[] = [];
  const lastAt = Math.max(...p.arrivals.map((a) => a.at));
  for (let t = 0; ; t++) {
    if (cur.left === 0) {
      done.push(cur.who);
      cur = stack.pop()!;
    }
    for (const a of p.arrivals) if (a.at === t) irr[a.level] = true;
    for (;;) {
      const lv = resp.find((l) => irr[l] && cur.mask[l] === '0');
      if (lv === undefined) break;
      irr[lv] = false;
      stack.push(cur);
      cur = { who: lv, left: svc(lv), mask: masks[lv]!, id: ++ids };
    }
    if (cur.who === -1 && t >= lastAt) return { units, done, end: t };
    units.push({ who: cur.who, depth: stack.length, id: cur.id });
    cur.left -= 1;
  }
}

function toSegments(units: { who: number; depth: number; id: number }[]) {
  const out: [number, number, number, number][] = [];
  let lastId = -2;
  units.forEach((u, t) => {
    const last = out.at(-1);
    if (last && lastId === u.id && last[2] === t) last[2] = t + 1;
    else out.push([u.who, t, t + 1, u.depth]);
    lastId = u.id;
  });
  return out;
}

const permArb = (n: number) => fc.array(fc.nat(), { minLength: n, maxLength: n }).map((keys) => [...Array(n).keys()].sort((a, b) => keys[a]! - keys[b]! || a - b));

const paramsArb: fc.Arbitrary<Params> = fc.integer({ min: 2, max: 5 }).chain((n) =>
  fc
    .record({
      response: fc.option(permArb(n), { nil: undefined }),
      basis: fc.constantFrom('order', 'masks', 'none'),
      order: permArb(n),
      masks: fc.array(fc.array(fc.boolean(), { minLength: n, maxLength: n }), { minLength: n, maxLength: n }),
      arrivals: fc.array(fc.record({ level: fc.nat(n - 1), at: fc.integer({ min: 0, max: 12 }) }), { minLength: 1, maxLength: 8 }),
      service: fc.oneof(fc.integer({ min: 1, max: 5 }), fc.array(fc.integer({ min: 1, max: 5 }), { minLength: n, maxLength: n })),
    })
    .map(({ response, basis, order, masks, arrivals, service }) => {
      const p: Params = { levels: n, arrivals, service };
      if (response) p.response = response;
      if (basis === 'order') p.order = order;
      if (basis === 'masks') p.masks = masks.map((row) => row.map((b) => (b ? '1' : '0')).join(''));
      return p;
    }),
);

const masksOf = (p: Params) => p.masks ?? masksFromOrder(p.levels, p.order ?? p.response ?? [...Array(p.levels).keys()]);

describe('mask 引擎', () => {
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

  it('与逐单位时间的朴素参照一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const sim = simulate(p);
        const ref = naive(p, masksOf(p));
        expect(sim.segments.map((g) => [g.who, g.from, g.to, g.depth])).toEqual(toSegments(ref.units));
        expect(sim.done).toEqual(ref.done);
        expect(sim.end).toBe(ref.end);
      }),
      { numRuns: 300 },
    );
  });

  it('同时请求、屏蔽字由次序推出时，完成次序就是处理次序', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }).chain((n) => fc.tuple(fc.constant(n), permArb(n), permArb(n), fc.integer({ min: 1, max: 4 }))), ([n, order, response, service]) => {
        const p: Params = { levels: n, order, response, service, arrivals: [...Array(n).keys()].map((level) => ({ level, at: 0 })) };
        expect(simulate(p).done).toEqual(order);
      }),
    );
  });

  it('次序 → 屏蔽字 → 次序 回到原样，第 k 个处理的那行有 n−k+1 个 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }).chain((n) => fc.tuple(fc.constant(n), permArb(n))), ([n, order]) => {
        const masks = masksFromOrder(n, order);
        expect(orderFromMasks(masks)).toEqual(order);
        order.forEach((level, k) => expect(masks[level]!.split('').filter((c) => c === '1').length).toBe(n - k));
      }),
    );
  });

  it('每个（合并后的）请求恰好完成一次，结束时回到主程序；进入时该级在被打断者的屏蔽字里为 0', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        const last = t.steps.at(-1)!.state;
        expect(last.stack).toEqual([]);
        expect(last.running).toBe(-1);
        expect(last.irr).not.toContain('1');
        const responses = t.steps.filter((s) => s.level === 'cycle');
        expect(last.done.length).toBe(responses.length);
        for (const s of responses) {
          const below = s.state.stack.at(-1)!;
          expect(below.imr[s.state.running]).toBe('0');
        }
        expect(Math.max(0, ...t.steps.map((s) => s.state.stack.length))).toBeLessThanOrEqual(p.arrivals.length);
      }),
      { numRuns: 150 },
    );
  });

  it('解题表是习题 8 的版式；预测题的答案取自引擎', () => {
    const t = run({ levels: 3, order: [2, 0, 1], arrivals: [{ level: 0, at: 0 }, { level: 1, at: 0 }, { level: 2, at: 0 }], service: 1 });
    expect(t.table.columns).toEqual(['中断处理程序', 'L0 级', 'L1 级', 'L2 级']);
    expect(t.table.rows.map((r) => r.cells.slice(1).join(''))).toEqual(masksFromOrder(3, [2, 0, 1]));
    for (const s of t.steps) {
      if (s.ask?.kind === 'choice') expect(s.ask.answer).toBe(`L${s.state.running}`);
      if (s.ask?.kind === 'bits') expect(s.ask.answer).toBe(s.state.masks[t.table.rows.findIndex((r) => r.step === s.id)]);
    }
    expect(t.steps.some((s) => s.ask?.kind === 'choice')).toBe(true);
    const inv = run({ levels: 2, masks: ['11', '01'], arrivals: [{ level: 1, at: 0 }], service: 1 });
    expect(inv.table.columns.at(-1)).toBe('1 的个数');
    expect(inv.result['处理次序']).toBe('L0→L1');
  });

  it('不给次序和屏蔽字时按响应次序，屏蔽字是自己和更低级置 1', () => {
    const t = run({ levels: 4, response: [2, 0, 3, 1], arrivals: [{ level: 1, at: 0 }], service: 1 });
    expect(t.result['屏蔽字']).toBe(masksFromOrder(4, [2, 0, 3, 1]).join(' / '));
    expect(t.result['处理次序']).toBe('L2→L0→L3→L1');
  });

  it('不合格的参数抛出错误', () => {
    const ok: Params = { levels: 3, arrivals: [{ level: 0, at: 0 }], service: 1 };
    const bad: Params[] = [
      { ...ok, levels: 1 },
      { ...ok, order: [0, 1, 1] },
      { ...ok, order: [0, 1, 2], masks: ['111', '011', '001'] },
      { ...ok, masks: ['11', '01', '00'] },
      { ...ok, arrivals: [] },
      { ...ok, arrivals: [{ level: 3, at: 0 }] },
      { ...ok, service: [1, 2] },
      { ...ok, service: 0 },
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
  });
});

interface GoldenCase {
  name: string;
  params: Params;
  expect: { masks: string[]; segments: [number, number, number, number][]; result: Record<string, string> };
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/mask-cases.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/mask-cases.json', () => {
  for (const item of golden.cases) {
    it(item.name, () => {
      const t = run(item.params);
      expect(validateTrace(t)).toEqual([]);
      expect(t.table.rows.map((r) => r.cells.slice(1, 1 + item.params.levels).join(''))).toEqual(item.expect.masks);
      expect(simulate(item.params).segments.map((g) => [g.who, g.from, g.to, g.depth])).toEqual(item.expect.segments);
      expect(t.result).toEqual(item.expect.result);
    });
  }
});
