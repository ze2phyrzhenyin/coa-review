import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, validateParams, widths, type Params } from './model';

// 独立参照测试：只按 specs/3-cache-addr.md 写，不看 model.ts。
// 参照的做法：字段值用除法和取余算，不切二进制串；位数靠数翻倍次数。

// ---------- 规格里的参数和状态形状 ----------

type Mapping = '全相联' | '直接' | '组相联';
interface Spec {
  mapping: Mapping;
  rowsPerSet?: number;
  unit?: '字' | '字节';
  wordBytes?: number;
  blockWords?: number;
  memoryBlocks?: number;
  memoryUnits?: number;
  cacheRows?: number;
  cacheUnits?: number;
  fields?: { tag: number; index: number; word: number };
  address?: string;
}
const P = (s: Spec): Params => s as unknown as Params;

interface AddressState {
  hex: string;
  bits: string;
  tagBits: string;
  indexBits: string;
  wordBits: string;
  tagHex: string;
  indexHex: string;
  wordHex: string;
}
interface CacheAddrState {
  w: number | null;
  v: number | null;
  r: number | null;
  d: number | null;
  u: number | null;
  s: number | null;
  tag: number | null;
  length: number | null;
  format: string;
  address: AddressState | null;
}

// ---------- 小工具 ----------

function bitsFor(x: number): number {
  let n = 0;
  let v = 1;
  while (v < x) {
    v *= 2;
    n += 1;
  }
  return n;
}

const middleName = (m: Mapping): string | null => (m === '直接' ? '行号' : m === '组相联' ? '组号' : null);

/** 读「BBH」这种写法；「无」读成 null。 */
function readHex(text: string): number | null {
  if (text === '无') return null;
  const m = /^([0-9A-F]+)H$/.exec(text);
  expect(m, `不是带 H 的大写十六进制：${text}`).not.toBeNull();
  return parseInt(m![1]!, 16);
}

const firstInt = (text: string): number => Number(/(\d+)/.exec(text)![1]!);

// ---------- 朴素参照实现 ----------

interface Ref {
  tag: number;
  index: number;
  word: number;
  length: number;
  /** 按容量求时的中间量；给 fields 时为 null。 */
  w: number | null;
  s: number | null;
  r: number | null;
  d: number | null;
  u: number | null;
  v: number | null;
  /** 每块单位数和中间段的行数或组数（全相联为 1）。 */
  perBlock: number;
  lines: number;
  format: string;
  split: { value: number; tag: number; index: number; word: number } | null;
}

function reference(sp: Spec): Ref {
  let perBlock: number;
  let lines: number;
  let w: number | null = null;
  let s: number | null = null;
  let r: number | null = null;
  let d: number | null = null;
  let u: number | null = null;
  let v: number | null = null;
  let tag: number;
  let index: number;
  let word: number;
  if (sp.fields) {
    tag = sp.fields.tag;
    index = sp.fields.index;
    word = sp.fields.word;
    perBlock = 2 ** word;
    lines = 2 ** index;
  } else {
    perBlock = sp.blockWords! * (sp.unit === '字节' ? (sp.wordBytes ?? 1) : 1);
    w = bitsFor(perBlock);
    const blocks = sp.memoryBlocks ?? sp.memoryUnits! / perBlock;
    s = bitsFor(blocks);
    const rows = sp.cacheRows ?? (sp.cacheUnits === undefined ? null : sp.cacheUnits / perBlock);
    if (sp.mapping === '直接') {
      r = bitsFor(rows!);
      lines = rows!;
      tag = s - r;
    } else if (sp.mapping === '组相联') {
      v = sp.rowsPerSet!;
      u = rows! / v;
      d = bitsFor(u);
      lines = u;
      tag = s - d;
    } else {
      lines = 1;
      tag = s;
    }
    index = bitsFor(lines);
    word = w;
  }
  const length = tag + index + word;
  const mid = middleName(sp.mapping);
  const format = mid === null ? `标记 ${tag} 位 | 字地址 ${word} 位` : `标记 ${tag} 位 | ${mid} ${index} 位 | 字地址 ${word} 位`;
  let split: Ref['split'] = null;
  if (sp.address !== undefined) {
    const value = parseInt(sp.address, 16);
    const block = Math.floor(value / perBlock);
    split = { value, word: value % perBlock, index: block % lines, tag: Math.floor(block / lines) };
  }
  return { tag, index, word, length, w, s, r, d, u, v, perBlock, lines, format, split };
}

// ---------- 生成合格的参数 ----------

interface Capacity {
  kExp: number;
  byte: boolean;
  wordBytes: number;
  s: number;
  r: number;
  vExp: number;
  memAsUnits: boolean;
  cacheAsUnits: boolean;
  fullGivesCache: boolean;
}

/** 同一组容量可以同时用于三种映射：r ≤ s − 1 保证直接映射标记至少 1 位。 */
const arbCapacity: fc.Arbitrary<Capacity> = fc
  .record({
    kExp: fc.integer({ min: 0, max: 8 }),
    byte: fc.boolean(),
    wordBytes: fc.constantFrom(1, 2, 4, 8),
    sRaw: fc.nat(),
    rRaw: fc.nat(),
    vRaw: fc.nat(),
    memAsUnits: fc.boolean(),
    cacheAsUnits: fc.boolean(),
    fullGivesCache: fc.boolean(),
  })
  .map(({ kExp, byte, wordBytes, sRaw, rRaw, vRaw, ...rest }) => {
    const w = kExp + (byte ? bitsFor(wordBytes) : 0);
    const s = 1 + (sRaw % (32 - w));
    const r = rRaw % s;
    const vExp = vRaw % (r + 1);
    return { kExp, byte, wordBytes, s, r, vExp, ...rest };
  });

function build(c: Capacity, mapping: Mapping, address: number | null): Spec {
  const blockWords = 2 ** c.kExp;
  const perBlock = blockWords * (c.byte ? c.wordBytes : 1);
  const sp: Spec = { mapping, blockWords };
  if (c.byte) {
    sp.unit = '字节';
    sp.wordBytes = c.wordBytes;
  }
  if (c.memAsUnits) sp.memoryUnits = 2 ** c.s * perBlock;
  else sp.memoryBlocks = 2 ** c.s;
  if (mapping !== '全相联' || c.fullGivesCache) {
    if (c.cacheAsUnits) sp.cacheUnits = 2 ** c.r * perBlock;
    else sp.cacheRows = 2 ** c.r;
  }
  if (mapping === '组相联') sp.rowsPerSet = 2 ** c.vExp;
  if (address !== null) {
    const length = c.s + bitsFor(perBlock);
    sp.address = hexOf(address % 2 ** length, length);
  }
  return sp;
}

const hexOf = (value: number, length: number): string => value.toString(16).toUpperCase().padStart(Math.ceil(length / 4), '0');

const arbMapping = fc.constantFrom<Mapping>('全相联', '直接', '组相联');
const arbAddress = fc.option(fc.integer({ min: 0, max: 0xffffffff }), { nil: null });

const arbCapacitySpec: fc.Arbitrary<Spec> = fc
  .tuple(arbCapacity, arbMapping, arbAddress)
  .map(([c, mapping, address]) => build(c, mapping, address));

// 规格不清：给 fields 时组相联要不要 rowsPerSet 没说；按「容量参数都不给」不给。
const arbFieldsSpec: fc.Arbitrary<Spec> = fc
  .record({
    mapping: arbMapping,
    tag: fc.integer({ min: 1, max: 16 }),
    index: fc.integer({ min: 0, max: 10 }),
    word: fc.integer({ min: 0, max: 6 }),
    address: arbAddress,
  })
  .map(({ mapping, tag, index, word, address }) => {
    const idx = mapping === '全相联' ? 0 : index;
    const sp: Spec = { mapping, fields: { tag, index: idx, word } };
    const length = tag + idx + word;
    if (address !== null) sp.address = hexOf(address % 2 ** length, length);
    return sp;
  });

const arbSpec = fc.oneof(arbCapacitySpec, arbCapacitySpec, arbFieldsSpec);

const RUNS = { numRuns: 200 };
const SLOW = 30_000;

const lastState = (sp: Spec): CacheAddrState => {
  const trace = run(P(sp));
  return trace.steps[trace.steps.length - 1]!.state as unknown as CacheAddrState;
};

// ---------- 性质 ----------

describe('cacheaddr：Trace 的形状', () => {
  it('validateTrace 为空，两次 run 完全相同；按容量求时每个量一步', () => {
    fc.assert(
      fc.property(arbSpec, (sp) => {
        const trace = run(P(sp));
        expect(validateTrace(trace)).toEqual([]);
        expect(run(P(sp))).toEqual(trace);
        const extra = sp.address === undefined ? 0 : 3;
        if (!sp.fields) {
          const quantities = sp.mapping === '直接' ? 5 : sp.mapping === '组相联' ? 7 : 4;
          expect(trace.steps.length).toBe(quantities + extra);
          for (const step of trace.steps.slice(0, quantities)) expect(step.level).toBe('explain');
        }
        expect(trace.table.columns).toEqual(['项目', '算式或二进制', '结果']);
        for (const row of trace.table.rows) expect(row.step).toBeDefined();
        const cond = JSON.stringify(trace.conditions);
        if (sp.mapping !== '全相联') for (const word of ['区号', '区内块号', '字地址']) expect(cond).toContain(word);
      }),
      RUNS,
    );
  }, SLOW);

  it('预测题：求标记的步问几位，切分步问标记是多少', () => {
    fc.assert(
      fc.property(arbSpec, (sp) => {
        const trace = run(P(sp));
        const ref = reference(sp);
        if (!sp.fields) {
          // 顺序 w → [v] → r|d → [u] → s → 标记 → 长度
          const at = sp.mapping === '直接' ? 3 : sp.mapping === '组相联' ? 5 : 2;
          const ask = trace.steps[at]!.ask!;
          expect(ask.kind).toBe('number');
          expect(ask.answer).toBe(String(ref.tag));
        }
        if (sp.address !== undefined) {
          const asks = trace.steps.slice(-3).flatMap((step) => (step.ask?.kind === 'text' ? [step.ask] : []));
          expect(asks.length).toBeGreaterThan(0);
          // 规格不清：答案的十六进制位数（BBH 与 0BBH）没定，只比数值。
          for (const ask of asks) expect(readHex(ask.answer)).toBe(ref.split!.tag);
        }
      }),
      RUNS,
    );
  }, SLOW);
});

describe('cacheaddr：与参照对拍', () => {
  it('result 的位数、地址格式、各字段值与参照一致', () => {
    fc.assert(
      fc.property(arbSpec, (sp) => {
        const { result } = run(P(sp));
        const ref = reference(sp);
        const mid = middleName(sp.mapping);
        expect(firstInt(result['标记位数']!)).toBe(ref.tag);
        expect(firstInt(result['字地址位数']!)).toBe(ref.word);
        expect(firstInt(result['地址位数']!)).toBe(ref.length);
        for (const name of ['行号', '组号']) {
          if (name === mid) expect(firstInt(result[`${name}位数`]!)).toBe(ref.index);
          else expect(result[`${name}位数`]).toBeUndefined();
        }
        if (ref.word > 0 && (mid === null || ref.index > 0)) {
          expect(result['地址格式']).toBe(ref.format);
        } else {
          // 规格不清：有 0 位的段时格式里写不写这一段没说，只比各段数字。
          const nums = [...result['地址格式']!.matchAll(/(\d+) 位/g)].map((m) => Number(m[1]!));
          expect(nums.reduce((a, b) => a + b, 0)).toBe(ref.length);
          expect(nums[0]).toBe(ref.tag);
        }
        if (ref.split === null) {
          expect(result['标记']).toBeUndefined();
          return;
        }
        // 规格不清：十六进制是否补到 ⌈位数/4⌉ 位没说，只比数值。
        expect(readHex(result['标记']!)).toBe(ref.split.tag);
        if (mid !== null) {
          if (ref.index === 0) expect(result[mid]).toBe('无');
          else expect(readHex(result[mid]!)).toBe(ref.split.index);
        }
        if (ref.word === 0) expect(result['字地址']).toBe('无');
        else expect(readHex(result['字地址']!)).toBe(ref.split.word);
      }),
      RUNS,
    );
  }, SLOW);

  it('最后状态：各量与参照一致，address 的三段二进制拼起来等于地址', () => {
    fc.assert(
      fc.property(arbSpec, (sp) => {
        const st = lastState(sp);
        const ref = reference(sp);
        expect(st.tag).toBe(ref.tag);
        expect(st.length).toBe(ref.length);
        expect(st.format).toBe(run(P(sp)).result['地址格式']);
        if (!sp.fields) {
          expect(st.w).toBe(ref.w);
          expect(st.s).toBe(ref.s);
          if (sp.mapping === '组相联') {
            expect(st.v).toBe(ref.v);
            expect(st.d).toBe(ref.d);
            expect(st.u).toBe(ref.u);
          } else {
            expect(st.v).toBeNull();
            expect(st.d).toBeNull();
            expect(st.u).toBeNull();
          }
          // 规格不清：组相联要不要求 r（m = 2^r）没说清，只查直接映射有、全相联没有。
          if (sp.mapping === '直接') expect(st.r).toBe(ref.r);
          if (sp.mapping === '全相联') expect(st.r).toBeNull();
        }
        if (ref.split === null) {
          expect(st.address).toBeNull();
          return;
        }
        const a = st.address!;
        expect(a.bits).toBe(ref.split.value.toString(2).padStart(ref.length, '0'));
        expect(a.tagBits + a.indexBits + a.wordBits).toBe(a.bits);
        expect(a.tagBits.length).toBe(ref.tag);
        expect(a.indexBits.length).toBe(ref.index);
        expect(a.wordBits.length).toBe(ref.word);
        // 性质 3：除法取余与二进制切分一致。
        expect(parseInt(a.tagBits, 2)).toBe(ref.split.tag);
        if (ref.index > 0) expect(parseInt(a.indexBits, 2)).toBe(ref.split.index);
        if (ref.word > 0) expect(parseInt(a.wordBits, 2)).toBe(ref.split.word);
        expect(readHex(a.tagHex)).toBe(ref.split.tag);
      }),
      RUNS,
    );
  }, SLOW);

  it('性质 4：同样容量，组相联的标记位数介于直接映射与全相联之间', () => {
    fc.assert(
      fc.property(arbCapacity, (c) => {
        const tagOf = (m: Mapping): number => firstInt(run(P(build(c, m, null))).result['标记位数']!);
        const direct = tagOf('直接');
        const set = tagOf('组相联');
        const full = tagOf('全相联');
        expect(direct).toBeLessThanOrEqual(set);
        expect(set).toBeLessThanOrEqual(full);
      }),
      { numRuns: 100 },
    );
  }, SLOW);

  it('widths 给出的数里有标记、字地址和地址位数', () => {
    fc.assert(
      fc.property(arbCapacitySpec, (sp) => {
        const ref = reference(sp);
        // 规格不清：widths 的返回形状没写，只查这三个数都在里面。
        const values = Object.values(widths(P(sp)) as unknown as Record<string, unknown>);
        for (const n of [ref.tag, ref.word, ref.length]) expect(values).toContain(n);
      }),
      { numRuns: 100 },
    );
  }, SLOW);
});

describe('cacheaddr：generate', () => {
  it('generate(seed) 给出合格参数，同一种子同一结果', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(generate(seed)).toEqual(p);
      expect(() => run(p)).not.toThrow();
      expect(validateTrace(run(p))).toEqual([]);
    }
  });
});

// ---------- 场景 ----------

describe('cacheaddr：场景', () => {
  it('例 3.5：直接映射 8 | 14 | 2，地址 BBBBBB → 标记 BBH、行号 2EEEH、字地址 3H', () => {
    const trace = run(P({ mapping: '直接', fields: { tag: 8, index: 14, word: 2 }, address: 'BBBBBB' }));
    expect(validateTrace(trace)).toEqual([]);
    expect(trace.result['标记']).toBe('BBH');
    expect(trace.result['行号']).toBe('2EEEH');
    expect(trace.result['字地址']).toBe('3H');
    expect(firstInt(trace.result['地址位数']!)).toBe(24);
  });

  it('例 3.6：组相联 64 行、每组 4 行、主存 4K 块、每块 128 字', () => {
    const sp: Spec = { mapping: '组相联', cacheRows: 64, rowsPerSet: 4, memoryBlocks: 4096, blockWords: 128 };
    const st = lastState(sp);
    expect(st).toMatchObject({ w: 7, d: 4, u: 16, s: 12, tag: 8, length: 19 });
    expect(run(P(sp)).result['地址格式']).toBe('标记 8 位 | 组号 4 位 | 字地址 7 位');
  });

  it('例 3.7：全相联、按字节编址、主存 1M 字节、每块 16 字节、地址 B0010', () => {
    const { result } = run(P({ mapping: '全相联', unit: '字节', memoryUnits: 2 ** 20, blockWords: 16, cacheUnits: 65536, address: 'B0010' }));
    expect(firstInt(result['标记位数']!)).toBe(16);
    expect(firstInt(result['字地址位数']!)).toBe(4);
    expect(result['标记']).toBe('B001H');
    expect(result['字地址']).toBe('0H');
    expect(result['行号']).toBeUndefined();
    expect(result['组号']).toBeUndefined();
  });

  it('自拟 (A3C6)16：直接映射与 2 路组相联', () => {
    const base: Spec = { mapping: '直接', memoryUnits: 65536, cacheUnits: 1024, blockWords: 4, address: 'A3C6' };
    const direct = run(P(base)).result;
    expect(direct['标记']).toBe('28H');
    expect(direct['行号']).toBe('F1H');
    expect(readHex(direct['字地址']!)).toBe(2);
    const twoWay = run(P({ ...base, mapping: '组相联', rowsPerSet: 2 })).result;
    expect(twoWay['标记']).toBe('51H');
    expect(twoWay['组号']).toBe('71H');
  });

  it('组相联没给 rowsPerSet、memoryBlocks 与 memoryUnits 同时给时 run 抛错', () => {
    const noWays: Spec = { mapping: '组相联', cacheRows: 64, memoryBlocks: 4096, blockWords: 128 };
    const both: Spec = { mapping: '直接', cacheRows: 64, memoryBlocks: 4096, memoryUnits: 4096 * 128, blockWords: 128 };
    for (const sp of [noWays, both]) {
      expect(() => run(P(sp))).toThrow();
      expect(validateParams(P(sp)).length).toBeGreaterThan(0);
    }
  });
});
