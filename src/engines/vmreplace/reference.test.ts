import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, simulate, validateParams, type Params } from './model';

// ---------- 朴素参照：只按规格写，不看引擎 ----------
// 不挪格子：FIFO 记每页的调入时刻，LRU 记最近访问时刻；每列按时刻从新到旧排序就是 a、b、c… 的顺序。

interface Col {
  page: number;
  hit: boolean;
  frames: (number | null)[];
  evicted: number | null;
}

/** 不管 Params 的具体写法，按规格里的字段名读。 */
interface Loose {
  frames: number;
  policy: 'FIFO' | 'FIFO+LRU' | 'LRU';
  pages?: number[];
  addresses?: number[];
  pageSize?: number;
  initial?: number[];
}
const loose = (p: Params): Loose => p as unknown as Loose;

function sequence(p: Params): number[] {
  const q = loose(p);
  return q.pages ?? q.addresses!.map((a) => Math.floor(a / q.pageSize!));
}

function reference(p: Params): Col[] {
  const q = loose(p);
  const byUse = q.policy !== 'FIFO';
  const loadedAt = new Map<number, number>();
  const usedAt = new Map<number, number>();
  // 开始已在主存的页：a 最新，往下依次更旧。
  (q.initial ?? []).forEach((page, i) => {
    loadedAt.set(page, -1 - i);
    usedAt.set(page, -1 - i);
  });
  return sequence(p).map((page, t) => {
    const clock = byUse ? usedAt : loadedAt;
    const hit = loadedAt.has(page);
    let evicted: number | null = null;
    if (!hit) {
      if (loadedAt.size === q.frames) {
        let oldest = Infinity;
        for (const [pg, time] of clock) {
          if (time < oldest) {
            oldest = time;
            evicted = pg;
          }
        }
        loadedAt.delete(evicted!);
        usedAt.delete(evicted!);
      }
      loadedAt.set(page, t);
    }
    usedAt.set(page, t);
    const order = [...loadedAt.keys()].sort((x, y) => clock.get(y)! - clock.get(x)!);
    const frames: (number | null)[] = [...order];
    while (frames.length < q.frames) frames.push(null);
    return { page, hit, frames, evicted };
  });
}

// ---------- 表格写法 ----------

/** 带圈数字：0 → ⓪，1–20 → ①…⑳，21–35 → ㉑…㉟，36–50 → ㊱…㊿，超过 50 → (51)。 */
function circled(n: number): string {
  // 规格不清：0 的带圈写法没写，这里用 ⓪（U+24EA）。
  if (n === 0) return '⓪';
  if (n <= 20) return String.fromCodePoint(0x2460 + n - 1);
  if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n <= 50) return String.fromCodePoint(0x32b1 + n - 36);
  return `(${n})`;
}

function rate(hits: number, total: number): string {
  const pct = Math.round((hits * 1000) / total) / 10;
  return `${hits}/${total}=${pct}%`;
}

const letter = (i: number): string => String.fromCharCode(97 + i);

// ---------- 状态的读法（字段名照规格要求 3） ----------

interface ReplState {
  frames: (number | null)[];
  current: { n: number; page: number; hit: boolean; evicted: number | null; marked: number | null };
  hits: number;
  faults: number;
  evicted: number[];
}
type ReplTrace = ReturnType<typeof run>;
const stateOf = (s: ReplTrace['steps'][number]): ReplState => s.state as unknown as ReplState;

// ---------- 合格参数的生成 ----------

const arbParams: fc.Arbitrary<Params> = fc
  .record({
    frames: fc.integer({ min: 1, max: 8 }),
    policy: fc.constantFrom<Loose['policy']>('FIFO', 'FIFO+LRU', 'LRU'),
    span: fc.integer({ min: 1, max: 12 }),
    // 偶尔把页号整体抬到 45 以上，覆盖 ㊿ 和 (51) 的写法。
    base: fc.constantFrom(0, 0, 0, 45),
    byAddress: fc.boolean(),
    pageSize: fc.integer({ min: 1, max: 200 }),
    withInitial: fc.boolean(),
  })
  .chain((s) =>
    fc
      .record({
        raw: fc.array(fc.tuple(fc.nat(s.span - 1), fc.nat(s.pageSize - 1)), { minLength: 1, maxLength: 40 }),
        initial: fc.uniqueArray(fc.nat(s.span - 1), { maxLength: s.frames }),
      })
      .map(({ raw, initial }) => {
        const pages = raw.map(([pg]) => pg + s.base);
        const p = {
          frames: s.frames,
          policy: s.policy,
          ...(s.byAddress
            ? { addresses: raw.map(([pg, off]) => (pg + s.base) * s.pageSize + off), pageSize: s.pageSize }
            : { pages }),
          ...(s.withInitial ? { initial: initial.map((pg) => pg + s.base) } : {}),
        };
        return p as Params;
      }),
  );

const RUNS = { numRuns: 150 };

// ---------- 通用 ----------

describe('任意合格参数', () => {
  it('validateParams 为空，validateTrace 为空，两次 run 完全相同', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        expect(validateParams(p)).toEqual([]);
        const trace = run(p);
        expect(validateTrace(trace)).toEqual([]);
        expect(run(p)).toEqual(trace);
      }),
      RUNS,
    );
  });

  it('4. simulate 与参照逐列一致', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        expect(simulate(p)).toEqual(reference(p));
      }),
      RUNS,
    );
  });

  it('每次访问一个比较步（explain）加一个填列步（access），状态与参照一致', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(p);
        const cols = reference(p);
        const idx = trace.steps.flatMap((s, i) => (s.level === 'access' ? [i] : []));
        expect(idx.length).toBe(cols.length);
        let hits = 0;
        const gone: number[] = [];
        idx.forEach((i, k) => {
          expect(trace.steps[i - 1]?.level).toBe('explain');
          const col = cols[k]!;
          if (col.hit) hits += 1;
          if (col.evicted !== null) gone.push(col.evicted);
          const st = stateOf(trace.steps[i]!);
          expect(st.frames).toEqual(col.frames);
          expect(st.current.page).toBe(col.page);
          expect(st.current.hit).toBe(col.hit);
          expect(st.current.evicted).toBe(col.evicted);
          // 规格不清：marked 取这一列填完之后命中页所在格（加圈的位置）。
          expect(st.current.marked).toBe(col.hit ? col.frames.indexOf(col.page) : null);
          expect(st.hits).toBe(hits);
          expect(st.faults).toBe(k + 1 - hits);
          expect(st.evicted).toEqual(gone);
        });
      }),
      RUNS,
    );
  });

  it('result：命中次数、缺页次数、命中率、淘汰页号', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const cols = reference(p);
        const hits = cols.filter((c) => c.hit).length;
        const gone = cols.flatMap((c) => (c.evicted === null ? [] : [c.evicted]));
        const { result } = run(p);
        expect(Number.parseInt(result.命中次数!, 10)).toBe(hits);
        expect(Number.parseInt(result.缺页次数!, 10)).toBe(cols.length - hits);
        expect(result.命中率).toBe(rate(hits, cols.length));
        expect(result.淘汰页号).toBe(gone.length === 0 ? '无' : gone.join('、'));
      }),
      RUNS,
    );
  });

  it('解题表：例 3.11 的横排版式', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const cols = reference(p);
        const q = loose(p);
        const hits = cols.filter((c) => c.hit).length;
        const { table } = run(p);
        expect(table.columns).toEqual(['页面访问序列', ...cols.map((c) => (c.hit ? circled(c.page) : String(c.page))), '命中率']);
        expect(table.rows.length).toBe(q.frames + 1);
        for (let r = 0; r < q.frames; r += 1) {
          const want = [
            letter(r),
            ...cols.map((c) => {
              const pg = c.frames[r];
              if (pg === null || pg === undefined) return '';
              return c.hit && pg === c.page ? circled(pg) : String(pg);
            }),
            r === 0 ? rate(hits, cols.length) : '',
          ];
          expect(table.rows[r]!.cells).toEqual(want);
        }
        // 规格不清：「命中」行第一格按行名写「命中」。
        expect(table.rows[q.frames]!.cells).toEqual(['', ...cols.map((c) => (c.hit ? '命中' : '')), '']) // 例 3.11 这一行没有行名;
        for (const row of table.rows) expect(row.step).toBeUndefined();
      }),
      RUNS,
    );
  });

  it('预测题：比较步问「命中吗」，FIFO+LRU/LRU 命中且不在 a 时问 a 格', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const q = loose(p);
        const seq = sequence(p);
        const cols = reference(p);
        const trace = run(p);
        const idx = trace.steps.flatMap((s, i) => (s.level === 'access' ? [i] : []));
        idx.forEach((i, k) => {
          const page = seq[k]!;
          const col = cols[k]!;
          const compare = trace.steps[i - 1]!.ask;
          // 规格不清：第一次访问没有「上一次」，按「与上一次不同」成立处理。
          const differs = k === 0 || seq[k - 1] !== page;
          const seen = seq.slice(0, k).includes(page) || (q.initial ?? []).includes(page);
          if (differs && seen) {
            expect(compare, `第 ${k + 1} 列`).toBeDefined();
            expect(compare!.kind).toBe('choice');
            expect(compare!.options).toEqual(expect.arrayContaining(['命中', '缺页']));
          }
          if (compare?.kind === 'choice') expect(compare.answer).toBe(col.hit ? '命中' : '缺页');
          const before = k === 0 ? initialColumn(q) : cols[k - 1]!.frames;
          const fill = trace.steps[i]!.ask;
          if (q.policy !== 'FIFO' && col.hit && before[0] !== page) {
            expect(fill, `第 ${k + 1} 列`).toBeDefined();
            expect(fill!.kind).toBe('number');
            expect(fill!.answer).toBe(String(page));
          }
        });
      }),
      RUNS,
    );
  });
});

function initialColumn(q: Loose): (number | null)[] {
  const col: (number | null)[] = [...(q.initial ?? [])];
  while (col.length < q.frames) col.push(null);
  return col;
}

// ---------- 规格「性质」 ----------

describe('性质', () => {
  it('1. 命中 + 缺页 = 访问次数；淘汰次数 = 缺页次数 − 开始的空格数（不小于 0）', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const q = loose(p);
        const cols = simulate(p);
        const hits = cols.filter((c) => c.hit).length;
        const faults = cols.filter((c) => !c.hit).length;
        expect(hits + faults).toBe(sequence(p).length);
        const empty = q.frames - (q.initial ?? []).length;
        expect(cols.filter((c) => c.evicted !== null).length).toBe(Math.max(0, faults - empty));
      }),
      RUNS,
    );
  });

  it('2. 每列各格的页互不相同，刚访问的页在表里', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        for (const c of simulate(p)) {
          const filled = c.frames.filter((x) => x !== null);
          expect(new Set(filled).size).toBe(filled.length);
          expect(c.frames).toContain(c.page);
        }
      }),
      RUNS,
    );
  });

  it('3. FIFO+LRU 与 LRU 每列相同；FIFO+LRU 最下一格是最久没访问的页', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const q = loose(p);
        const mixed = simulate({ ...q, policy: 'FIFO+LRU' } as unknown as Params);
        const lru = simulate({ ...q, policy: 'LRU' } as unknown as Params);
        expect(mixed).toEqual(lru);
        const seq = sequence(p);
        const init = q.initial ?? [];
        // 最近访问时刻：开始已在主存的页按 a 最新往下排，记成负的时刻。
        const lastUse = (page: number, upTo: number): number => {
          for (let t = upTo; t >= 0; t -= 1) if (seq[t] === page) return t;
          return -1 - init.indexOf(page);
        };
        mixed.forEach((c, k) => {
          const filled = c.frames.filter((x): x is number => x !== null);
          // 规格不清：没填满时「最下一格」取最后一个有页的格。
          const bottom = filled.at(-1)!;
          for (const pg of filled) expect(lastUse(bottom, k)).toBeLessThanOrEqual(lastUse(pg, k));
        });
      }),
      RUNS,
    );
  });
});

// ---------- 规格「场景」 ----------

describe('场景', () => {
  const book = [0, 1, 2, 4, 2, 3, 0, 2, 1, 3, 2];

  it('例 3.11 FIFO：命中 2 次，2/11=18.2%', () => {
    const { result } = run({ frames: 3, policy: 'FIFO', pages: book } as Params);
    expect(Number.parseInt(result.命中次数!, 10)).toBe(2);
    expect(result.命中率).toBe('2/11=18.2%');
  });

  it('例 3.11 FIFO+LRU：命中 3 次，3/11=27.3%，第 5 列为 2、4、1', () => {
    const p = { frames: 3, policy: 'FIFO+LRU', pages: book } as Params;
    const { result } = run(p);
    expect(Number.parseInt(result.命中次数!, 10)).toBe(3);
    expect(result.命中率).toBe('3/11=27.3%');
    expect(simulate(p)[4]!.frames).toEqual([2, 4, 1]);
  });

  it('本站自拟 2 3 2 1 5 2 4 5 FIFO：表头与 a 行', () => {
    const { table } = run({ frames: 3, policy: 'FIFO', pages: [2, 3, 2, 1, 5, 2, 4, 5] } as Params);
    expect(table.columns).toEqual(['页面访问序列', '2', '3', '②', '1', '5', '2', '4', '⑤', '命中率']);
    expect(table.rows[0]!.cells).toEqual(['a', '2', '3', '3', '1', '5', '2', '4', '4', '2/8=25%']);
  });

  const words = [115, 228, 120, 88, 446, 102, 321, 432, 260, 167];

  it('字地址、页大小 100、3 页、第 0 页已在主存：FIFO 缺页 5 次淘汰 0、1、2', () => {
    const { result } = run({ frames: 3, policy: 'FIFO', addresses: words, pageSize: 100, initial: [0] } as Params);
    expect(Number.parseInt(result.缺页次数!, 10)).toBe(5);
    expect(result.淘汰页号).toBe('0、1、2');
  });

  it('同上 LRU：缺页 6 次淘汰 2、0、1、3', () => {
    const { result } = run({ frames: 3, policy: 'LRU', addresses: words, pageSize: 100, initial: [0] } as Params);
    expect(Number.parseInt(result.缺页次数!, 10)).toBe(6);
    expect(result.淘汰页号).toBe('2、0、1、3');
  });

  it('非法参数：run 抛错', () => {
    const bad = [
      { frames: 3, policy: 'FIFO', pages: [1, 2], addresses: [100, 200], pageSize: 100 }, // 两种都给（场景）
      { frames: 3, policy: 'FIFO', pages: [1, 2], initial: [0, 0] }, // initial 重复（场景）
      { frames: 0, policy: 'FIFO', pages: [1] },
      { frames: 9, policy: 'FIFO', pages: [1] },
      { frames: 2, policy: 'FIFO', pages: [1], initial: [0, 1, 2] },
      { frames: 3, policy: 'FIFO', pages: [] },
      { frames: 3, policy: 'FIFO', pages: Array.from({ length: 41 }, (_, i) => i % 5) },
      { frames: 3, policy: 'FIFO', pages: [1, -1] },
      { frames: 3, policy: 'FIFO', addresses: [100] }, // 缺页大小
      { frames: 3, policy: 'OPT', pages: [1] },
      { frames: 3, policy: 'FIFO' },
    ] as unknown as Params[];
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
