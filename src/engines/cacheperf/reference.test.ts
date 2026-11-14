import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { compute, generate, run, validateParams, type Params } from './model';

// ---------- 朴素参照：只按规格写的闭式公式，不看引擎 ----------
// 正向一律先用式(3.5)求 t_a，再 e = t_c/t_a；反求时把解出的 h 代回原式核对。

type Values = Record<string, number>;

/** 不管 Params 的具体写法，按规格里的字段名读。 */
type Loose = Record<string, number | string | undefined>;
const loose = (p: Params): Loose => p as unknown as Loose;
/** compute 的数值，按键读。 */
const values = (p: Params): Values => compute(p) as unknown as Values;

function reference(p: Params): Values {
  const q = loose(p);
  const n = (k: string): number => q[k] as number;
  const has = (k: string): boolean => q[k] !== undefined;
  switch (q.kind) {
    case '正向': {
      const h = has('h') ? n('h') : n('nc') / (n('nc') + n('nm'));
      const ta = h * n('tc') + (1 - h) * n('tm');
      return { h, r: n('tm') / n('tc'), e: n('tc') / ta, t_a: ta };
    }
    case '由ta求h': {
      const h = (n('tm') - n('ta')) / (n('tm') - n('tc'));
      return { h, r: n('tm') / n('tc'), e: n('tc') / n('ta') };
    }
    case '由e求h': {
      const e = n('e');
      if (has('r')) {
        // 规格不清：给了 r 时 r 不算「求出」，result 只有 h（按「求出的那些」字面理解）。
        return { h: (n('r') - 1 / e) / (n('r') - 1) };
      }
      const r = n('tm') / n('tc');
      return { r, h: (r - 1 / e) / (r - 1), t_a: n('tc') / e };
    }
    case '二级cache': {
      const f = n('clockGHz');
      const memory = n('memoryNs') * f;
      const l2 = n('l2Ns') * f;
      const one = n('baseCpi') + n('l1Miss') * memory;
      const two = n('baseCpi') + n('l1Miss') * l2 + n('l2Miss') * memory;
      return { 时钟周期: 1 / f, 主存缺失损失: memory, 一级CPI: one, 二级缺失损失: l2, 两级CPI: two, 性能比: one / two };
    }
    default:
      throw new Error(`参照不认识 kind ${String(q.kind)}`);
  }
}

// ---------- 显示格式的核对 ----------

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
/** 最多 4 位小数、去掉末尾 0 的量。 */
const FOUR = new Set(['h', 'r', '一级CPI', '两级CPI', '性能比']);

function checkShown(key: string, shown: string, value: number): void {
  const approx = shown.startsWith('≈');
  const body = (approx ? shown.slice(1) : shown).trim();
  if (FOUR.has(key)) {
    expect(body, `${key}=${shown}`).toMatch(/^\d+(\.\d{0,3}[1-9])?$/);
    expect(Math.abs(Number(body) - value)).toBeLessThanOrEqual(5e-5 + 1e-9);
    // 规格第 7 条：≈ 只出现在 why 里，result 只写数值。
    expect(approx, `${key}=${shown} 不带 ≈`).toBe(false);
  } else if (key === 'e') {
    expect(body, `e=${shown}`).toMatch(/^\d+(\.[1-9])?%$/);
    expect(Math.abs(Number(body.slice(0, -1)) / 100 - value)).toBeLessThanOrEqual(5e-4 + 1e-9);
    expect(approx, `e=${shown} 不带 ≈`).toBe(false);
  } else {
    // 时间、周期数：规格没写几位小数，只核对数字（容差按 1 位小数）和单位。
    const m = /^-?\d+(\.\d+)?/.exec(body);
    expect(m, `${key}=${shown}`).not.toBeNull();
    expect(Math.abs(Number(m![0]) - value)).toBeLessThanOrEqual(0.05 + 1e-9);
    if (key === 't_a' || key === '时钟周期') expect(body).toMatch(/ns$/);
  }
}

// ---------- 合格参数的生成 ----------

type Forward = Extract<Params, { kind: '正向' }>;

const arbTimes = fc
  .integer({ min: 1, max: 200 })
  .chain((tc) => fc.integer({ min: tc + 1, max: tc + 2000 }).map((tm) => ({ tc, tm })));

const arbSource = fc.oneof(
  fc.record({ nc: fc.nat(10_000), nm: fc.nat(10_000) }).filter((c) => c.nc + c.nm > 0),
  fc.integer({ min: 0, max: 10_000 }).map((k) => ({ h: k / 10_000 })),
);

const arbForward: fc.Arbitrary<Forward> = fc
  .record({ times: arbTimes, source: arbSource, order: fc.constantFrom<'例3.4' | '先求ta' | null>('例3.4', '先求ta', null) })
  .map(({ times, source, order }) => ({ kind: '正向', ...source, ...times, ...(order === null ? {} : { order }) }) as Forward);

const arbFromTa: fc.Arbitrary<Params> = arbTimes.chain(({ tc, tm }) =>
  fc.integer({ min: tc, max: tm }).map((ta) => ({ kind: '由ta求h', tc, tm, ta }) as Params),
);

// e = 1/[r+(1−r)h] 对任意 h∈[0,1] 都落在 [1/r, 1] 里。
const arbFromE: fc.Arbitrary<Params> = fc
  .record({ times: arbTimes, k: fc.integer({ min: 0, max: 1000 }), withR: fc.boolean() })
  .map(({ times, k, withR }) => {
    const r = times.tm / times.tc;
    const e = Math.min(1, Math.max(1 / r, 1 / (r + (1 - r) * (k / 1000))));
    return (withR ? { kind: '由e求h', e, r } : { kind: '由e求h', e, tc: times.tc, tm: times.tm }) as Params;
  });

const arbTwoLevel: fc.Arbitrary<Params> = fc
  .record({
    clock: fc.integer({ min: 1, max: 50 }),
    base: fc.integer({ min: 5, max: 30 }),
    memoryNs: fc.integer({ min: 10, max: 500 }),
    l2Ns: fc.integer({ min: 1, max: 600 }),
    l1: fc.integer({ min: 0, max: 1000 }),
    l2Part: fc.integer({ min: 0, max: 1000 }),
  })
  .map(
    ({ clock, base, memoryNs, l2Ns, l1, l2Part }) =>
      ({
        kind: '二级cache',
        clockGHz: clock / 10,
        baseCpi: base / 10,
        memoryNs,
        l1Miss: l1 / 1000,
        l2Ns,
        l2Miss: Math.floor((l1 * l2Part) / 1000) / 1000,
      }) as Params,
  );

const arbAny = fc.oneof(arbForward as fc.Arbitrary<Params>, arbFromTa, arbFromE, arbTwoLevel);

const RUNS = { numRuns: 150 };

// ---------- 通用：Trace、对拍、显示 ----------

describe('任意合格参数', () => {
  it('validateParams 为空，validateTrace 为空，两次 run 完全相同', () => {
    fc.assert(
      fc.property(arbAny, (p) => {
        expect(validateParams(p)).toEqual([]);
        const trace = run(p);
        expect(validateTrace(trace)).toEqual([]);
        expect(run(p)).toEqual(trace);
      }),
      RUNS,
    );
  });

  it('compute 与参照逐量一致，键与 result 相同', () => {
    fc.assert(
      fc.property(arbAny, (p) => {
        const want = reference(p);
        const got = values(p);
        expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
        expect(Object.keys(run(p).result).sort()).toEqual(Object.keys(want).sort());
        for (const [k, v] of Object.entries(want)) expect(near(got[k]!, v, 1e-9), `${k}: ${got[k]} vs ${v}`).toBe(true);
      }),
      RUNS,
    );
  });

  it('result 的显示：位数、百分数、≈、ns', () => {
    fc.assert(
      fc.property(arbAny, (p) => {
        const want = reference(p);
        const { result } = run(p);
        for (const [k, v] of Object.entries(want)) checkShown(k, result[k]!, v);
      }),
      RUNS,
    );
  });

  it('全部讲解步；解题表 量|公式|代入|结果，每个量一行并指回一步', () => {
    fc.assert(
      fc.property(arbAny, (p) => {
        const trace = run(p);
        for (const s of trace.steps) expect(s.level).toBe('explain');
        expect(trace.table.columns).toEqual(['量', '公式', '代入', '结果']);
        const keys = Object.keys(trace.result);
        expect(trace.table.rows.length).toBe(keys.length);
        expect(trace.steps.length).toBeGreaterThanOrEqual(keys.length);
        const ids = new Set(trace.steps.map((s) => s.id));
        for (const row of trace.table.rows) expect(ids.has(row.step ?? '')).toBe(true);
        const shown = trace.table.rows.map((row) => row.cells[3]);
        for (const k of keys) expect(shown).toContain(trace.result[k]);
      }),
      RUNS,
    );
  });
});

// ---------- 反求：把解出的 h 代回原式 ----------

describe('反求代回', () => {
  it('由ta求h：h·t_c + (1−h)·t_m 回到给定的 t_a', () => {
    fc.assert(
      fc.property(arbFromTa, (p) => {
        const q = loose(p) as Record<string, number>;
        const h = values(p).h!;
        expect(h).toBeGreaterThanOrEqual(-1e-12);
        expect(h).toBeLessThanOrEqual(1 + 1e-12);
        expect(near(h * q.tc! + (1 - h) * q.tm!, q.ta!, 1e-9)).toBe(true);
      }),
      RUNS,
    );
  });

  it('由e求h：1/[r+(1−r)h] 回到给定的 e', () => {
    fc.assert(
      fc.property(arbFromE, (p) => {
        const q = loose(p) as Record<string, number>;
        const r = q.r ?? q.tm! / q.tc!;
        const h = values(p).h!;
        expect(near(1 / (r + (1 - r) * h), q.e!, 1e-9)).toBe(true);
      }),
      RUNS,
    );
  });
});

// ---------- 规格「性质」 ----------

describe('性质', () => {
  it('1. 正向：e = t_c/t_a（1e−9），t_a 在 [t_c, t_m] 内', () => {
    fc.assert(
      fc.property(arbForward, (p) => {
        const { e, t_a } = values(p);
        expect(Math.abs(e! - p.tc / t_a!)).toBeLessThanOrEqual(1e-9);
        expect(t_a!).toBeGreaterThanOrEqual(p.tc - 1e-9);
        expect(t_a!).toBeLessThanOrEqual(p.tm + 1e-9);
      }),
      RUNS,
    );
  });

  it('2. 正向的 t_a、e 代回两种反求，得到原来的 h', () => {
    fc.assert(
      fc.property(arbForward, (p) => {
        const { h, e, t_a } = values(p);
        const r = p.tm / p.tc;
        // 浮点可能越过边界一点点，夹回合法范围再代回。
        const ta = Math.min(p.tm, Math.max(p.tc, t_a!));
        const e1 = Math.min(1, Math.max(1 / r, e!));
        const viaTa = values({ kind: '由ta求h', tc: p.tc, tm: p.tm, ta } as Params).h!;
        const viaER = values({ kind: '由e求h', e: e1, r } as Params).h!;
        const viaET = values({ kind: '由e求h', e: e1, tc: p.tc, tm: p.tm } as Params).h!;
        for (const back of [viaTa, viaER, viaET]) expect(Math.abs(back - h!)).toBeLessThanOrEqual(1e-6);
      }),
      RUNS,
    );
  });

  it('3. 两种顺序数值相同；例3.4 是 r→e→t_a，先求ta 是 t_a→e→r', () => {
    fc.assert(
      fc.property(arbForward, (p) => {
        const { order: _drop, ...rest } = p as Forward & { order?: string };
        const book = { ...rest, order: '例3.4' } as Params;
        const taFirst = { ...rest, order: '先求ta' } as Params;
        const a = values(book);
        const b = values(taFirst);
        for (const k of Object.keys(a)) expect(near(a[k]!, b[k]!, 1e-9)).toBe(true);
        // 规格不清：状态里量的路径没写名字，这里假定路径是 h/r/e/t_a 或以 .h/.r/.e/.t_a 结尾，求出时从 null 变成数。
        const at = (p2: Params, key: string): number =>
          run(p2).steps.findIndex((s) => s.changes.some((c) => (c.at === key || c.at.endsWith(`.${key}`)) && c.from === 'null'));
        const [r1, e1, t1] = ['r', 'e', 't_a'].map((k) => at(book, k));
        expect(r1!).toBeGreaterThanOrEqual(0);
        expect(r1!).toBeLessThan(e1!);
        expect(e1!).toBeLessThan(t1!);
        const [r2, e2, t2] = ['r', 'e', 't_a'].map((k) => at(taFirst, k));
        expect(t2!).toBeGreaterThanOrEqual(0);
        expect(t2!).toBeLessThan(e2!);
        expect(e2!).toBeLessThan(r2!);
      }),
      { numRuns: 60 },
    );
  });

  it('4. 二级 cache：二级缺失代价不大于它省下的主存代价时，两级 CPI 不大于一级 CPI', () => {
    fc.assert(
      fc.property(arbTwoLevel, (p) => {
        const q = loose(p) as Record<string, number>;
        // 规格不清：性质 4 只写「l2Ns ≤ memoryNs 时」，但 l1Miss = l2Miss > 0 时不成立（两级 = 一级 + l1Miss×二级损失）。
        // 这里用真正成立的条件 l1Miss·l2Ns ≤ (l1Miss − l2Miss)·memoryNs。
        if (q.l1Miss! * q.l2Ns! > (q.l1Miss! - q.l2Miss!) * q.memoryNs!) return;
        const v = values(p);
        expect(v.两级CPI!).toBeLessThanOrEqual(v.一级CPI! + 1e-9);
      }),
      RUNS,
    );
  });

  it('5. 预测题：正向的 e 步问 e，答案是百分数 1 位小数、不带 %', () => {
    fc.assert(
      fc.property(arbForward, (p) => {
        const e = reference(p).e!;
        const asks = run(p).steps.flatMap((s) => (s.ask ? [s.ask] : []));
        const ask = asks.find((a) => a.kind === 'number');
        expect(ask).toBeDefined();
        expect(ask!.answer).toMatch(/^\d+(\.\d)?$/);
        expect(Math.abs(Number(ask!.answer) - e * 100)).toBeLessThanOrEqual(0.05 + 1e-9);
      }),
      RUNS,
    );
  });
});

// ---------- 规格「场景」 ----------

describe('场景', () => {
  const book: Params = { kind: '正向', nc: 1900, nm: 100, tc: 50, tm: 250 };

  it('例 3.4：h = 0.95，r = 5，e = 83.3%，t_a = 60 ns', () => {
    const v = values(book);
    expect(v.h).toBeCloseTo(0.95, 12);
    expect(v.r).toBeCloseTo(5, 12);
    expect(v.e).toBeCloseTo(50 / 60, 12);
    expect(v.t_a).toBeCloseTo(60, 9);
    const { result } = run(book);
    expect(result.h).toBe('0.95');
    expect(result.r).toBe('5');
    expect(result.e!.replace('≈', '')).toBe('83.3%');
    expect(Number(/[\d.]+/.exec(result.t_a!)![0])).toBeCloseTo(60, 9);
  });

  it('同一组数用 先求ta：数值相同', () => {
    const p = { ...book, order: '先求ta' } as Params;
    const a = values(book);
    const b = values(p);
    for (const k of Object.keys(a)) expect(b[k]).toBeCloseTo(a[k]!, 9);
  });

  it('本站自拟 4750/250/20/120：h = 0.95，r = 6，e = 80%，t_a = 25 ns', () => {
    const p: Params = { kind: '正向', nc: 4750, nm: 250, tc: 20, tm: 120 };
    const v = values(p);
    expect(v.r).toBeCloseTo(6, 12);
    expect(v.e).toBeCloseTo(0.8, 12);
    expect(v.t_a).toBeCloseTo(25, 9);
    expect(run(p).result.e).toBe('80%');
  });

  it('t_c = 40、t_m = 200、t_a = 50：h = 0.9375', () => {
    const p = { kind: '由ta求h', tc: 40, tm: 200, ta: 50 } as Params;
    expect(values(p).h).toBeCloseTo(0.9375, 12);
    expect(run(p).result.h).toBe('0.9375');
  });

  it('例 3.8：500 周期，一级 CPI 11，25 周期，两级 CPI 4，性能比 2.75', () => {
    const p = { kind: '二级cache', clockGHz: 5, baseCpi: 1, memoryNs: 100, l1Miss: 0.02, l2Ns: 5, l2Miss: 0.005 } as Params;
    const v = values(p);
    expect(v.时钟周期).toBeCloseTo(0.2, 12);
    expect(v.主存缺失损失).toBeCloseTo(500, 9);
    expect(v.一级CPI).toBeCloseTo(11, 9);
    expect(v.二级缺失损失).toBeCloseTo(25, 9);
    expect(v.两级CPI).toBeCloseTo(4, 9);
    expect(v.性能比).toBeCloseTo(2.75, 9);
    const { result } = run(p);
    expect(result.一级CPI).toBe('11');
    expect(result.两级CPI).toBe('4');
    expect(result.性能比).toBe('2.75');
  });

  it('非法参数：run 抛错', () => {
    const bad: Params[] = [
      { kind: '由ta求h', tc: 40, tm: 200, ta: 30 } as Params, // t_a < t_c（场景）
      { kind: '由ta求h', tc: 40, tm: 200, ta: 201 } as Params,
      { kind: '正向', nc: 0, nm: 0, tc: 50, tm: 250 },
      { kind: '正向', nc: 1900, nm: 100, tc: 250, tm: 50 },
      { kind: '正向', nc: 1900, nm: 100, tc: 50, tm: 50 },
      { kind: '正向', h: 1.5, tc: 50, tm: 250 } as Params,
      { kind: '由e求h', e: 1.2, r: 5 } as Params,
      { kind: '由e求h', e: 0.1, r: 5 } as Params,
      { kind: '由e求h', e: 0.9, r: 1 } as Params,
      { kind: '二级cache', clockGHz: 5, baseCpi: 1, memoryNs: 100, l1Miss: 0.02, l2Ns: 5, l2Miss: 0.05 } as Params,
    ];
    for (const p of bad) {
      expect(() => run(p), JSON.stringify(p)).toThrow();
      expect(validateParams(p).length, JSON.stringify(p)).toBeGreaterThan(0);
    }
  });
});

// ---------- generate ----------

describe('generate', () => {
  it('几个种子：参数合格、run 不抛错、同种子同参数', () => {
    for (const seed of [0, 1, 2, 7, 42, 2026, 123_456, 2 ** 31 - 1]) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(() => run(p)).not.toThrow();
      expect(validateTrace(run(p))).toEqual([]);
      expect(generate(seed)).toEqual(p);
    }
  });
});
