import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace, type Step, type Trace } from '../trace';
import { layout, performance, run, validateParams, type Access, type Params, type Replacement, type State } from './model';

// ---------- 朴素参照实现：只按规格写，不看引擎的写法 ----------
// 每组一排格子。LRU 记「上次用到的时刻」，LFU 记访问次数，随机用规格写明的 mulberry32。

interface Slot {
  block: number;
  modified: boolean;
  lastUse: number;
  uses: number;
}

interface RefOutcome {
  block: number;
  set: number;
  hit: boolean;
  row: number;
  evicted: number | null;
  writeBack: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function reference(p: Params): { outcomes: RefOutcome[]; slots: (Slot | null)[][]; history: number[][] } {
  const perBlock = p.blockWords * (p.unit === '字节' ? (p.wordBytes ?? 1) : 1);
  const ways = p.mapping === '直接' ? 1 : p.mapping === '全相联' ? p.rows : p.rowsPerSet!;
  const setCount = p.rows / ways;
  const slots: (Slot | null)[][] = Array.from({ length: setCount }, () => Array.from({ length: ways }, () => null));
  /** 每组依次用到了哪一路。 */
  const history: number[][] = Array.from({ length: setCount }, () => []);
  const random = mulberry32(p.seed ?? 0);
  const outcomes: RefOutcome[] = [];
  p.accesses.forEach((access, time) => {
    const block = Math.trunc(access.address / perBlock);
    const set = block % setCount;
    const line = slots[set]!;
    let way = line.findIndex((slot) => slot !== null && slot.block === block);
    const hit = way >= 0;
    let evicted: number | null = null;
    let writeBack = false;
    if (hit) {
      line[way]!.uses += 1;
    } else {
      way = line.indexOf(null);
      if (way < 0) {
        const full = line as Slot[];
        if (ways === 1) way = 0;
        else if (p.replacement === 'LRU') way = full.reduce((best, slot, i) => (slot.lastUse < full[best]!.lastUse ? i : best), 0);
        else if (p.replacement === 'LFU') {
          way = full.reduce((best, slot, i) => (slot.uses < full[best]!.uses ? i : best), 0);
          for (const slot of full) slot.uses = 0;
        } else way = random() % ways;
        evicted = full[way]!.block;
        writeBack = full[way]!.modified;
      }
      line[way] = { block, modified: false, lastUse: time, uses: 0 };
    }
    const slot = line[way]!;
    slot.lastUse = time;
    if (access.op === '写') slot.modified = true;
    history[set]!.push(way);
    outcomes.push({ block, set, hit, row: set * ways + way, evicted, writeBack });
  });
  return { outcomes, slots, history };
}

// ---------- 取数的小工具 ----------

type CacheTrace = Trace<Params, State>;
const accessSteps = (trace: CacheTrace): Step<State>[] => trace.steps.filter((s) => s.level === 'access');
const lastState = (trace: CacheTrace): State => trace.steps[trace.steps.length - 1]!.state;

// ---------- 生成合格的参数 ----------

interface Shape {
  mapping: Params['mapping'];
  r: number;
  vExp: number;
  w: number;
  tagBits: number;
  byte: boolean;
  wordBytes: number;
  replacement: Replacement;
  seed: number;
  hot: number;
  raw: [number, boolean][];
  times: [number, number] | null;
  validBit: boolean;
}

const arbShape: fc.Arbitrary<Shape> = fc.record({
  mapping: fc.constantFrom<Params['mapping']>('全相联', '直接', '组相联'),
  r: fc.integer({ min: 0, max: 3 }),
  vExp: fc.integer({ min: 0, max: 3 }),
  w: fc.integer({ min: 0, max: 2 }),
  tagBits: fc.integer({ min: 1, max: 3 }),
  byte: fc.boolean(),
  wordBytes: fc.constantFrom(1, 2, 4),
  replacement: fc.constantFrom<Replacement>('LFU', 'LRU', '随机'),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  hot: fc.integer({ min: 1, max: 12 }),
  raw: fc.array(fc.tuple(fc.nat(1 << 20), fc.boolean()), { minLength: 1, maxLength: 24 }),
  times: fc.option(fc.tuple(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 51, max: 500 })), { nil: null }),
  validBit: fc.boolean(),
});

function build(shape: Shape, override: Partial<Params> = {}): Params {
  const rows = 2 ** shape.r;
  const mapping = override.mapping ?? shape.mapping;
  const rowsPerSet = override.rowsPerSet ?? 2 ** Math.min(shape.vExp, shape.r);
  const ways = mapping === '直接' ? 1 : mapping === '全相联' ? rows : rowsPerSet;
  const blockWords = 2 ** shape.w;
  const perBlock = blockWords * (shape.byte ? shape.wordBytes : 1);
  const indexBits = mapping === '全相联' ? 0 : Math.log2(rows / ways);
  const addressBits = shape.tagBits + indexBits + Math.log2(perBlock);
  // 多数访问落在前 hot 块里，这样才有命中和冲突。
  const span = Math.min(2 ** addressBits, shape.hot * perBlock);
  const accesses: Access[] = shape.raw.map(([n, write]) => ({ address: n % span, op: write ? '写' : '读' }));
  const params: Params = {
    mapping,
    rows,
    blockWords,
    addressBits,
    unit: shape.byte ? '字节' : '字',
    replacement: shape.replacement,
    seed: shape.seed,
    accesses,
  };
  if (mapping === '组相联') params.rowsPerSet = rowsPerSet;
  if (shape.byte) params.wordBytes = shape.wordBytes;
  if (shape.times) {
    params.tc = shape.times[0];
    params.tm = shape.times[1];
  }
  if (shape.validBit) params.validBit = true;
  return params;
}

const arbParams = arbShape.map((shape) => build(shape));
const RUNS = { numRuns: 100 };
// 这台机器常有别的任务在跑，性质测试给足时间，免得因为超时误报。
const SLOW = 30_000;

// ---------- 性质 ----------

describe('Trace 的形状', () => {
  it('对任意参数：validateTrace 为空，每次访问 4 个讲解步加 1 个访问步，解题表每行指回访问步', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        expect(validateTrace(trace)).toEqual([]);
        const n = params.accesses.length;
        expect(trace.steps.length).toBe(5 * n);
        trace.steps.forEach((step, i) => {
          expect(step.level).toBe(i % 5 === 4 ? 'access' : 'explain');
          expect(step.state.access.n).toBe(Math.floor(i / 5) + 1);
          expect(step.ref).toMatch(/^教材 p\d+/);
        });
        expect(trace.table.columns.length).toBe(6);
        expect(trace.table.rows.length).toBe(n);
        trace.table.rows.forEach((row, i) => expect(row.step).toBe(trace.steps[5 * i + 4]!.id));
      }),
      RUNS,
    );
  }, SLOW);

  it('五步的顺序：切地址、定位、比标记、处理、记数', () => {
    const trace = run({
      mapping: '直接',
      rows: 4,
      blockWords: 2,
      addressBits: 5,
      accesses: [{ address: 9, op: '读' }],
    });
    const [split, locate, compare, outcome, count] = trace.steps;
    expect(split!.changes.some((c) => c.at === 'access.tagBits')).toBe(true);
    expect(split!.state.access).toMatchObject({ bits: '01001', tagBits: '01', indexBits: '00', wordBits: '1', tag: 1, index: 0, word: 1, block: 4 });
    expect(locate!.changes.map((c) => c.at)).toEqual(['access.candidates.0']);
    expect(locate!.why).toContain('4 mod 4 = 0');
    expect(compare!.changes.map((c) => c.at)).toEqual(['access.result']);
    expect(outcome!.changes.map((c) => c.at)).toEqual(['access.action', 'access.row', 'rows.0.block', 'rows.0.tag']);
    expect(count!.changes.map((c) => c.at)).toEqual(['misses']);
  });

  it('组相联的定位步写出 q = j mod u 的算式', () => {
    const trace = run({
      mapping: '组相联',
      rows: 8,
      rowsPerSet: 2,
      blockWords: 4,
      addressBits: 8,
      replacement: 'LRU',
      accesses: [{ address: 45, op: '读' }],
    });
    expect(trace.steps[1]!.why).toContain('11 mod 4 = 3');
    expect(trace.steps[1]!.state.access.candidates).toEqual([6, 7]);
  });

  it('对任意参数：同样的参数得到完全相同的 Trace，参数对象不被改动', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const copy = JSON.stringify(params);
        const a = run(params);
        const b = run(JSON.parse(copy) as Params);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(JSON.stringify(params)).toBe(copy);
      }),
      RUNS,
    );
  }, SLOW);
});

describe('命中与缺失', () => {
  it('对任意参数：命中次数 + 缺失次数 = 访问次数，result 与最后状态一致', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        const end = lastState(trace);
        expect(end.hits + end.misses).toBe(params.accesses.length);
        expect(trace.result['命中次数']).toBe(String(end.hits));
        expect(trace.result['缺失次数']).toBe(String(end.misses));
        expect(trace.table.rows.filter((r) => r.cells[4] === '命中').length).toBe(end.hits);
        expect(trace.result['h']!.startsWith(`${end.hits}/${params.accesses.length} `)).toBe(true);
      }),
      RUNS,
    );
  }, SLOW);

  it('对任意参数：块已经在 cache 里就一定命中，不在就一定缺失；一个块不会同时占两行', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        let rows = trace.initial.rows;
        for (const step of accessSteps(trace)) {
          const block = step.state.access.block;
          const present = rows.some((r) => r.block === block);
          expect(step.state.access.result).toBe(present ? '命中' : '缺失');
          const held = step.state.rows.map((r) => r.block).filter((b) => b !== null);
          expect(new Set(held).size).toBe(held.length);
          expect(held).toContain(block);
          rows = step.state.rows;
        }
      }),
      RUNS,
    );
  }, SLOW);

  it('对任意参数：与朴素参照实现逐次对拍（命中、所在行、换出的块、写回、最后各行）', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        const ref = reference(params);
        const steps = accessSteps(trace);
        expect(steps.length).toBe(ref.outcomes.length);
        steps.forEach((step, i) => {
          const want = ref.outcomes[i]!;
          const got = step.state.access;
          expect(got.block).toBe(want.block);
          expect(got.result).toBe(want.hit ? '命中' : '缺失');
          expect(got.row).toBe(want.row);
          expect(got.evicted).toBe(want.evicted);
          expect(got.writeBack).toBe(want.writeBack);
          if (params.mapping !== '全相联') expect(got.index).toBe(want.set);
        });
        const flat = ref.slots.flat();
        const end = lastState(trace);
        expect(end.rows.map((r) => r.block)).toEqual(flat.map((slot) => slot?.block ?? null));
        expect(end.rows.map((r) => r.modified)).toEqual(flat.map((slot) => (slot?.modified ? 1 : 0)));
      }),
      { numRuns: 300 },
    );
  }, SLOW);

  it('小规模穷举：3 个块、长 5 的全部序列，三种映射、三种算法都与参照一致', () => {
    const configs: Params[] = [
      { mapping: '直接', rows: 2, blockWords: 1, addressBits: 2, accesses: [] },
      { mapping: '全相联', rows: 2, blockWords: 1, addressBits: 2, replacement: 'LRU', accesses: [] },
      { mapping: '全相联', rows: 2, blockWords: 1, addressBits: 2, replacement: 'LFU', accesses: [] },
      { mapping: '全相联', rows: 2, blockWords: 1, addressBits: 2, replacement: '随机', seed: 20261114, accesses: [] },
      { mapping: '组相联', rows: 2, rowsPerSet: 2, blockWords: 1, addressBits: 2, replacement: 'LRU', accesses: [] },
      { mapping: '组相联', rows: 4, rowsPerSet: 2, blockWords: 1, addressBits: 3, replacement: 'LFU', accesses: [] },
    ];
    for (const config of configs) {
      const blocks = config.rows === 4 ? [0, 2, 4] : [0, 1, 2];
      for (let code = 0; code < 3 ** 5; code += 1) {
        const accesses: Access[] = Array.from({ length: 5 }, (_, k) => ({
          address: blocks[Math.floor(code / 3 ** k) % 3]!,
          op: '读',
        }));
        const params = { ...config, accesses };
        const got = accessSteps(run(params)).map((s) => [s.state.access.result === '命中', s.state.access.row, s.state.access.evicted]);
        const want = reference(params).outcomes.map((o) => [o.hit, o.row, o.evicted]);
        expect(got).toEqual(want);
      }
    }
  }, SLOW);
});

describe('三种映射之间的关系', () => {
  it('对任意参数：每组 1 行的组相联，逐步与直接映射相同', () => {
    fc.assert(
      fc.property(arbShape, (shape) => {
        const direct = run(build(shape, { mapping: '直接' }));
        const oneWay = run(build(shape, { mapping: '组相联', rowsPerSet: 1 }));
        expect(oneWay.steps.length).toBe(direct.steps.length);
        oneWay.steps.forEach((step, i) => {
          const other = direct.steps[i]!;
          expect(step.level).toBe(other.level);
          expect(step.state).toEqual(other.state);
          expect(step.changes).toEqual(other.changes);
          expect(step.focus).toEqual(other.focus);
          expect(step.ask).toEqual(other.ask);
        });
        expect(oneWay.table.rows).toEqual(direct.table.rows);
        expect(oneWay.result).toEqual(direct.result);
      }),
      RUNS,
    );
  }, SLOW);

  it('对任意参数：只有 1 组的组相联，行为与全相联相同', () => {
    fc.assert(
      fc.property(arbShape, (shape) => {
        const full = run(build(shape, { mapping: '全相联' }));
        const oneSet = run(build(shape, { mapping: '组相联', rowsPerSet: 2 ** shape.r }));
        expect(oneSet.steps.length).toBe(full.steps.length);
        oneSet.steps.forEach((step, i) => {
          const other = full.steps[i]!;
          expect(step.level).toBe(other.level);
          expect(step.state.rows).toEqual(other.state.rows);
          expect([step.state.hits, step.state.misses]).toEqual([other.state.hits, other.state.misses]);
          // 只差一处：全相联没有组号，index 为 null；1 组的组相联组号恒为 0。
          expect({ ...step.state.access, index: null }).toEqual(other.state.access);
          expect(step.ask).toEqual(other.ask);
        });
        expect(oneSet.table.rows.map((r) => [r.cells[0], r.cells[1], r.cells[3], r.cells[4], r.cells[5]])).toEqual(
          full.table.rows.map((r) => [r.cells[0], r.cells[1], r.cells[3], r.cells[4], r.cells[5]]),
        );
        expect(oneSet.result).toEqual(full.result);
      }),
      RUNS,
    );
  }, SLOW);

  it('对任意参数：按字节编址、每字 b 字节、每块 k 字，与按字编址、每块 k×b 字切法和结果相同', () => {
    fc.assert(
      fc.property(arbShape, (shape) => {
        const bytes = build({ ...shape, byte: true });
        const words: Params = { ...bytes, unit: '字', blockWords: bytes.blockWords * (bytes.wordBytes ?? 1) };
        delete words.wordBytes;
        const a = run(bytes);
        const b = run(words);
        expect(a.steps.map((s) => s.state)).toEqual(b.steps.map((s) => s.state));
        expect(a.table).toEqual(b.table);
      }),
      { numRuns: 100 },
    );
  }, SLOW);
});

describe('替换算法', () => {
  const withPolicy = (policy: Replacement) =>
    arbShape.map((shape) => build({ ...shape, replacement: policy, mapping: shape.mapping === '直接' ? '组相联' : shape.mapping }));

  it('LRU：不会换出本组最近用过的那一行，被换出的是最久没用的一行，且计数器最大值唯一', () => {
    fc.assert(
      fc.property(withPolicy('LRU'), (params) => {
        const trace = run(params);
        const g = layout(params);
        /** 每组各行上次被用到的访问序号。 */
        const lastUse = new Map<number, number>();
        let before = trace.initial.rows;
        accessSteps(trace).forEach((step, time) => {
          const a = step.state.access;
          if (a.action === '替换') {
            const used = a.candidates.map((i) => lastUse.get(i)!);
            const newest = a.candidates[used.indexOf(Math.max(...used))]!;
            const oldest = a.candidates[used.indexOf(Math.min(...used))]!;
            if (g.ways > 1) expect(a.row).not.toBe(newest);
            expect(a.row).toBe(oldest);
            const counts = a.candidates.map((i) => before[i]!.count);
            expect(counts.filter((c) => c === Math.max(...counts)).length).toBe(1);
          }
          lastUse.set(a.row!, time);
          before = step.state.rows;
        });
      }),
      RUNS,
    );
  }, SLOW);

  it('LRU 的计数器：等于本组在这一行上次用过之后又用了几次别的行', () => {
    fc.assert(
      fc.property(withPolicy('LRU'), (params) => {
        const g = layout(params);
        const { history, slots } = reference(params);
        const end = lastState(run(params));
        slots.forEach((line, set) => {
          line.forEach((slot, way) => {
            const used = history[set]!;
            const since = slot === null ? 0 : used.length - 1 - used.lastIndexOf(way);
            expect(end.rows[set * g.ways + way]!.count).toBe(g.ways === 1 ? 0 : since);
          });
        });
      }),
      RUNS,
    );
  }, SLOW);

  it('LFU 的计数器：调入从 0 起，命中加 1，替换时候选行全部清零；换出的是计数最小、并列时行号最小的行', () => {
    fc.assert(
      fc.property(withPolicy('LFU'), (params) => {
        const trace = run(params);
        const g = layout(params);
        const { slots } = reference(params);
        let before = trace.initial.rows;
        for (const step of accessSteps(trace)) {
          const a = step.state.access;
          if (a.action === '替换' && g.ways > 1) {
            const counts = a.candidates.map((i) => before[i]!.count);
            expect(a.row).toBe(a.candidates[counts.indexOf(Math.min(...counts))]);
            for (const i of a.candidates) expect(step.state.rows[i]!.count).toBe(0);
          }
          if (a.action === '命中' && g.ways > 1) expect(step.state.rows[a.row!]!.count).toBe(before[a.row!]!.count + 1);
          if (a.action === '调入') expect(step.state.rows[a.row!]!.count).toBe(0);
          before = step.state.rows;
        }
        const flat = slots.flat();
        expect(before.map((r) => r.count)).toEqual(flat.map((slot) => (g.ways === 1 ? 0 : (slot?.uses ?? 0))));
      }),
      RUNS,
    );
  }, SLOW);

  it('随机：同一个种子结果相同；计数器始终为 0；不出「换出哪一行」的题', () => {
    fc.assert(
      fc.property(withPolicy('随机'), (params) => {
        const trace = run(params);
        expect(JSON.stringify(run(params))).toBe(JSON.stringify(trace));
        for (const step of trace.steps) {
          expect(step.state.rows.every((r) => r.count === 0)).toBe(true);
          expect(step.ask?.prompt).not.toBe('换出哪一行');
        }
      }),
      { numRuns: 100 },
    );
  }, SLOW);

  it('随机：换一个种子，同一串访问可以选到不同的行', () => {
    const base: Params = {
      mapping: '全相联',
      rows: 4,
      blockWords: 1,
      addressBits: 4,
      replacement: '随机',
      seed: 1,
      accesses: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((address) => ({ address, op: '读' as const })),
    };
    const picks = new Set<string>();
    for (let seed = 1; seed <= 8; seed += 1) {
      picks.add(run({ ...base, seed }).table.rows.map((r) => r.cells[2]).join(','));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('候选行里有空行时不替换，空行取行号最小的', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        let before = trace.initial.rows;
        for (const step of accessSteps(trace)) {
          const a = step.state.access;
          const free = a.candidates.filter((i) => before[i]!.block === null);
          if (a.result === '缺失') {
            expect(a.action).toBe(free.length > 0 ? '调入' : '替换');
            if (free.length > 0) expect(a.row).toBe(free[0]);
            expect(a.evicted).toBe(free.length > 0 ? null : before[a.row!]!.block);
          }
          before = step.state.rows;
        }
      }),
      RUNS,
    );
  }, SLOW);
});

describe('修改位（写回法）', () => {
  it('对任意参数：修改位为 1 当且仅当这一行调入之后被写过；换出修改过的块时标出写回', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        const written = new Map<number, boolean>();
        for (const step of accessSteps(trace)) {
          const a = step.state.access;
          if (a.action !== '命中') {
            if (a.action === '替换') expect(a.writeBack).toBe(written.get(a.row!) === true);
            written.set(a.row!, false);
          }
          if (a.op === '写') written.set(a.row!, true);
          step.state.rows.forEach((r, i) => expect(r.modified).toBe(written.get(i) === true ? 1 : 0));
        }
        trace.table.rows.forEach((row, i) => {
          const a = accessSteps(trace)[i]!.state.access;
          expect(row.cells[5]!.includes('写回')).toBe(a.writeBack);
        });
      }),
      { numRuns: 150 },
    );
  }, SLOW);
});

describe('预测题', () => {
  it('对任意参数：答案取自引擎的结果；只出在比标记步和替换步上；出题条件符合规格', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        const g = layout(params);
        const seen = new Set<number>();
        let previous: number | null = null;
        let before = trace.initial.rows;
        for (let i = 0; i < trace.steps.length; i += 5) {
          const [split, locate, compare, outcome, count] = trace.steps.slice(i, i + 5) as [Step<State>, Step<State>, Step<State>, Step<State>, Step<State>];
          const a = count.state.access;
          const block = a.block!;
          expect(split.ask).toBeUndefined();
          expect(locate.ask).toBeUndefined();
          expect(count.ask).toBeUndefined();
          const full = a.candidates.every((r) => before[r]!.block !== null);
          const decisive = block !== previous && (seen.has(block) || full);
          expect(compare.ask !== undefined).toBe(decisive);
          if (compare.ask) {
            expect(compare.ask.options).toEqual(['命中', '缺失']);
            expect(compare.ask.answer).toBe(a.result);
          }
          const counts = a.candidates.map((r) => before[r]!.count);
          const tie = params.replacement === 'LFU' && counts.filter((c) => c === Math.min(...counts)).length > 1;
          const pick = a.action === '替换' && g.ways > 1 && params.replacement !== '随机' && !tie;
          expect(outcome.ask !== undefined).toBe(pick);
          if (outcome.ask) {
            expect(outcome.ask.options).toEqual(a.candidates.map((r) => `行 ${r}`));
            expect(outcome.ask.answer).toBe(`行 ${a.row}`);
          }
          seen.add(block);
          previous = block;
          before = count.state.rows;
        }
      }),
      RUNS,
    );
  }, SLOW);
});

describe('h、t_a、e', () => {
  it('对任意次数和时间：t_a = h·t_c + (1−h)·t_m，e = t_c/t_a = 1/[r + (1−r)h]', () => {
    fc.assert(
      fc.property(fc.nat(500), fc.nat(500), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 1000 }), (hits, misses, tc, tm) => {
        fc.pre(hits + misses > 0);
        const p = performance(hits, misses, tc, tm);
        expect(p.h).toBeCloseTo(hits / (hits + misses), 12);
        expect(p.ta!).toBeCloseTo(p.h * tc + (1 - p.h) * tm, 9);
        expect(p.r!).toBeCloseTo(tm / tc, 12);
        expect(p.e!).toBeCloseTo(tc / p.ta!, 12);
        expect(p.e!).toBeCloseTo(1 / (p.r! + (1 - p.r!) * p.h), 9);
      }),
    );
  }, SLOW);

  it('对任意参数：给了时间才有 r、t_a、e，数值与公式一致；没给只有三项', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        const end = lastState(trace);
        if (params.tc === undefined || params.tm === undefined) {
          expect(Object.keys(trace.result)).toEqual(['命中次数', '缺失次数', 'h']);
          return;
        }
        expect(Object.keys(trace.result)).toEqual(['命中次数', '缺失次数', 'h', 'r', 't_a', 'e']);
        const h = end.hits / params.accesses.length;
        const ta = h * params.tc + (1 - h) * params.tm;
        expect(Number.parseFloat(trace.result['t_a']!)).toBeCloseTo(ta, 3);
        expect(trace.result['t_a']!.endsWith(' ns')).toBe(true);
        expect(Number.parseFloat(trace.result['e']!)).toBeCloseTo((params.tc / ta) * 100, 1);
        expect(Number.parseFloat(trace.result['r']!)).toBeCloseTo(params.tm / params.tc, 3);
      }),
      RUNS,
    );
  }, SLOW);
});

describe('有效位只是显示选项', () => {
  it('对任意参数：打开后结果、解题表、各行内容不变，只多出 valid；不打开时状态里没有 valid', () => {
    fc.assert(
      fc.property(arbShape, (shape) => {
        const off = run(build({ ...shape, validBit: false }));
        const on = run(build({ ...shape, validBit: true }));
        expect(on.table).toEqual(off.table);
        expect(on.result).toEqual(off.result);
        on.steps.forEach((step, i) => {
          const plain = off.steps[i]!;
          expect(step.ask).toEqual(plain.ask);
          step.state.rows.forEach((r, k) => {
            expect(r.valid).toBe(r.block === null ? 0 : 1);
            const { valid: _valid, ...rest } = r;
            expect(rest).toEqual(plain.state.rows[k]);
            expect('valid' in plain.state.rows[k]!).toBe(false);
          });
        });
        expect(off.conditions.some((c) => c.label === '有效位')).toBe(false);
        expect(on.conditions.some((c) => c.label === '有效位')).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, SLOW);
});

describe('文字', () => {
  it('对任意参数：只用教材术语，行为不变时不提有效位', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const trace = run(params);
        const text = [
          ...trace.steps.flatMap((s) => [s.title, s.why, s.ask?.prompt ?? '', s.ask?.hint ?? '']),
          ...trace.conditions.flatMap((c) => [c.label, c.value]),
          ...trace.table.columns,
        ].join('\n');
        for (const banned of ['脏位', '块内偏移', '偏移', '索引', 'undefined', 'NaN', 'null']) expect(text).not.toContain(banned);
        if (params.validBit !== true) expect(text).not.toContain('有效位');
      }),
      RUNS,
    );
  }, SLOW);

  it('直接映射的条件里写明不用替换算法；LFU 写明并列时的约定', () => {
    const direct = run({ mapping: '直接', rows: 2, blockWords: 1, addressBits: 3, replacement: 'LRU', accesses: [{ address: 1, op: '读' }] });
    expect(direct.conditions.find((c) => c.label === '替换算法')!.value).toContain('不需要');
    const lfu = run({ mapping: '全相联', rows: 2, blockWords: 1, addressBits: 3, replacement: 'LFU', accesses: [{ address: 1, op: '读' }] });
    expect(lfu.conditions.some((c) => c.label === '计数器并列')).toBe(true);
  });
});

describe('地址字段', () => {
  it('对任意参数：三段位串拼起来就是地址，位数与 layout 一致，块号 = 标记 × 组数 + 组号', () => {
    fc.assert(
      fc.property(arbParams, (params) => {
        const g = layout(params);
        expect(g.tagBits + g.indexBits + g.wordBits).toBe(params.addressBits);
        expect(g.sets * g.ways).toBe(g.rows);
        for (const step of accessSteps(run(params))) {
          const a = step.state.access;
          expect(a.tagBits + a.indexBits + a.wordBits).toBe(a.bits);
          expect(Number.parseInt(a.bits, 2)).toBe(a.address);
          expect([a.tagBits.length, a.indexBits.length, a.wordBits.length]).toEqual([g.tagBits, g.indexBits, g.wordBits]);
          expect(a.tag! * g.sets + (a.index ?? 0)).toBe(a.block);
          expect(a.block! * g.blockUnits + a.word!).toBe(a.address);
          expect(a.index).toBe(params.mapping === '全相联' ? null : a.block! % g.sets);
        }
      }),
      RUNS,
    );
  }, SLOW);

  it('教材例 3.5–3.7 的字段位数（p107–108）', () => {
    const none: Access[] = [{ address: 0, op: '读' }];
    // 例 3.5：直接映射，标记 8 位、行 14 位、字地址 2 位。
    expect(layout({ mapping: '直接', rows: 2 ** 14, blockWords: 4, addressBits: 24, accesses: none })).toMatchObject({ tagBits: 8, indexBits: 14, wordBits: 2 });
    // 例 3.6：64 行、每组 4 行、4K 块、每块 128 字 → 8 | 4 | 7，地址 19 位。
    expect(layout({ mapping: '组相联', rows: 64, rowsPerSet: 4, blockWords: 128, addressBits: 19, accesses: none })).toMatchObject({
      tagBits: 8,
      indexBits: 4,
      wordBits: 7,
      sets: 16,
      blocks: 4096,
    });
    // 例 3.7：全相联，字长 1B，块 16B，主存 1MB → 标记 16 位、字地址 4 位。
    expect(
      layout({ mapping: '全相联', rows: 4096, blockWords: 16, addressBits: 20, unit: '字节', wordBytes: 1, accesses: none }),
    ).toMatchObject({ tagBits: 16, indexBits: 0, wordBits: 4 });
  });
});

describe('非法参数', () => {
  const good: Params = {
    mapping: '组相联',
    rows: 4,
    rowsPerSet: 2,
    blockWords: 2,
    addressBits: 5,
    replacement: 'LRU',
    accesses: [{ address: 3, op: '读' }],
  };

  it('合格的参数没有问题', () => {
    expect(validateParams(good)).toEqual([]);
  });

  const bad: [string, unknown][] = [
    ['行数不是 2 的幂', { ...good, rows: 6 }],
    ['行数太大', { ...good, rows: 512 }],
    ['每组行数不是 2 的幂', { ...good, rowsPerSet: 3 }],
    ['每组行数超过行数', { ...good, rowsPerSet: 8 }],
    ['组相联没给每组行数', { mapping: '组相联', rows: 4, blockWords: 2, addressBits: 5, replacement: 'LRU', accesses: good.accesses }],
    ['每块字数不是 2 的幂', { ...good, blockWords: 3 }],
    ['地址太短，标记没有位数', { ...good, addressBits: 2 }],
    ['地址位数超过 32', { ...good, addressBits: 33 }],
    ['映射方式不认识', { ...good, mapping: 'direct' }],
    ['编址单位不认识', { ...good, unit: 'bit' }],
    ['每字字节数不对', { ...good, unit: '字节', wordBytes: 3 }],
    ['多路却没给替换算法', { mapping: '全相联', rows: 4, blockWords: 2, addressBits: 5, accesses: good.accesses }],
    ['替换算法不认识', { ...good, replacement: 'FIFO' }],
    ['随机替换没给种子', { ...good, replacement: '随机' }],
    ['种子不是整数', { ...good, replacement: '随机', seed: 1.5 }],
    ['访问序列为空', { ...good, accesses: [] }],
    ['地址超出范围', { ...good, accesses: [{ address: 32, op: '读' }] }],
    ['地址是负数', { ...good, accesses: [{ address: -1, op: '读' }] }],
    ['地址不是整数', { ...good, accesses: [{ address: 1.5, op: '读' }] }],
    ['没写读还是写', { ...good, accesses: [{ address: 1 }] }],
    ['只给了 t_c', { ...good, tc: 10 }],
    ['t_m 不是正数', { ...good, tc: 10, tm: 0 }],
    ['有效位开关不是布尔值', { ...good, validBit: 'yes' }],
  ];

  for (const [name, params] of bad) {
    it(`${name}：validateParams 报出问题，run 抛出错误`, () => {
      expect(validateParams(params as Params).length).toBeGreaterThan(0);
      expect(() => run(params as Params)).toThrow(/cache 参数不对/);
    });
  }

  it('直接映射可以不给替换算法；随机替换的种子在每块只有一行可放时可以不给', () => {
    expect(validateParams({ mapping: '直接', rows: 4, blockWords: 2, addressBits: 5, accesses: good.accesses })).toEqual([]);
    expect(validateParams({ ...good, rowsPerSet: 1, replacement: '随机' })).toEqual([]);
  });
});
