import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import {
  BOOK_STORE,
  decimalSum,
  decode,
  fields,
  generate,
  generateFields,
  groupBits,
  nextAddress,
  run,
  runFields,
  type FieldParams,
  type MicroParams,
  type StoreWord,
} from './model';

// ---------- 朴素参照：直接按位号读 23 位字符串执行 ----------

function naiveRun(p: { a: number; b: number; op?: string; r1?: number; store?: StoreWord[] }): { path: string[]; R1: number; R2: number; R3: number; Cy: number; after: (number | null)[] } {
  const store = new Map((p.store ?? BOOK_STORE).map((w) => [w.addr, w.word.replace(/ /g, '')]));
  const op = p.op ?? '1010';
  const r: Record<string, number> = { R1: p.r1 ?? 6, R2: p.a, R3: p.b, DR: 0 };
  let cy = 0;
  let addr = '0000';
  const path: string[] = [];
  const after: (number | null)[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const w = store.get(addr)!;
    path.push(addr);
    const bit = (n: number): boolean => w.charAt(n - 1) === '1';
    const x = bit(4) ? r.R1! : bit(6) ? r.R2! : bit(8) ? r.DR! : 0;
    const y = bit(5) ? r.R1! : bit(7) ? r.R2! : bit(9) ? r.R3! : 0;
    let out: number | null = null;
    if (bit(10)) {
      out = (x + y) % 16;
      cy = x + y >= 16 ? 1 : 0;
    } else if (bit(12)) out = (x - y + 16) % 16;
    else if (bit(11)) out = x;
    if (out !== null) {
      if (bit(1)) r.R1 = out;
      if (bit(2)) r.R2 = out;
      if (bit(3)) r.R3 = out;
    }
    after.push(bit(1) || bit(2) || bit(3) ? out : null);
    let next = parseInt(w.slice(19, 23), 2);
    if (bit(18)) next |= parseInt(op, 2);
    if (bit(19) && cy === 0) next |= 1;
    addr = next.toString(2).padStart(4, '0');
    if (addr === '0000' && path.length > 1) break;
  }
  return { path, R1: r.R1!, R2: r.R2!, R3: r.R3!, Cy: cy, after };
}

const pathOf = (p: MicroParams): string[] => run(p).table.rows.map((row) => row.cells[1]!);

describe('十进制加法微程序：穷举 a、b', () => {
  it('100 种组合：R2 是个位，Cy 是进位，与参照一致，Trace 合格', () => {
    for (let a = 0; a <= 9; a += 1) {
      for (let b = 0; b <= 9; b += 1) {
        const t = run({ a, b });
        expect(validateTrace(t)).toEqual([]);
        const last = t.steps.at(-1)!.state;
        const want = decimalSum(a, b);
        expect(last.reg.R2).toBe(want.digit);
        expect(last.Cy).toBe(want.carry);
        const ref = naiveRun({ a, b });
        expect(pathOf({ a, b })).toEqual(ref.path);
        expect(last.reg.R2).toBe(ref.R2);
        expect(last.done).toBe(true);
        expect(last.reg.PC).toBe(1);
        expect(last.reg.IR).toBe('1010');
        // 和不超过 9 走 4 条微指令，否则 3 条。
        expect(t.result['微指令条数']).toBe(a + b > 9 ? '3' : '4');
      }
    }
  });

  it('同样的参数得到同样的 Trace', () => {
    expect(JSON.stringify(run({ a: 4, b: 7 }))).toBe(JSON.stringify(run({ a: 4, b: 7 })));
  });

  it('P1、P2 各问一次下一微地址，答案就是表里的下一微地址', () => {
    const t = run({ a: 2, b: 5 });
    const asks = t.steps.filter((s) => s.ask);
    expect(asks.map((s) => s.ask!.answer)).toEqual(['1010', '0001']);
  });
});

// 自定义控存：只用运算器的微命令，随机拼出不出错的程序，和参照对拍。
const aluWord = fc
  .record({
    x: fc.constantFrom(4, 6),
    y: fc.constantFrom(5, 7, 9),
    fn: fc.constantFrom(10, 11, 12),
    load: fc.constantFrom(1, 2, 3),
    p2: fc.boolean(),
  })
  .map(({ x, y, fn, load, p2 }) => {
    const bits = Array.from({ length: 23 }, () => '0');
    for (const i of [x, y, fn, load]) bits[i - 1] = '1';
    if (p2) bits[18] = '1';
    return bits;
  });

describe('自定义控存', () => {
  it('随机的两条运算微指令，与参照逐条一致', () => {
    fc.assert(
      fc.property(aluWord, aluWord, fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }), (w1, w2, a, b) => {
        // 0000 取指 → 1010 → 1001 → 回 0000（或 P2 改到 0001 再回 0000）。
        const first = [...w1];
        first.splice(19, 4, ...'1001');
        const second = [...w2];
        second.splice(19, 4, ...'0000');
        const store: StoreWord[] = [
          BOOK_STORE[0]!,
          { addr: '1010', word: first.join('') },
          { addr: '1001', word: second.join('') },
          { addr: '0001', word: BOOK_STORE[3]!.word },
        ];
        const p = { a, b, store };
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        const ref = naiveRun(p);
        expect(pathOf(p)).toEqual(ref.path);
        const last = t.steps.at(-1)!.state;
        expect([last.reg.R1, last.reg.R2, last.reg.R3, last.Cy]).toEqual([ref.R1, ref.R2, ref.R3, ref.Cy]);
      }),
      { numRuns: 200 },
    );
  });

  it('nextAddress：P1 并入 OP，P2 只在 Cy=0 时置最低位', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 15 }), fc.integer({ min: 0, max: 15 }), fc.boolean(), fc.boolean(), fc.constantFrom<0 | 1>(0, 1), (n, o, p1, p2, cy) => {
        const next = n.toString(2).padStart(4, '0');
        const op = o.toString(2).padStart(4, '0');
        let want = n;
        if (p1) want |= o;
        if (p2 && cy === 0) want |= 1;
        expect(nextAddress({ p1: p1 ? 1 : 0, p2: p2 ? 1 : 0, next }, op, cy)).toBe(want.toString(2).padStart(4, '0'));
      }),
    );
  });

  it('不合法的微指令和参数抛出错误', () => {
    expect(() => decode('0'.repeat(22))).toThrow(/23 位/);
    expect(() => decode(`000101${'0'.repeat(17)}`)).toThrow(/相斥/);
    expect(() => decode(`${'0'.repeat(12)}1${'0'.repeat(10)}`)).toThrow(/数存/);
    expect(() => decode(`01${'0'.repeat(21)}`)).toThrow(/ALU/);
    expect(() => run({ a: 10, b: 1 })).toThrow(/0 到 9/);
    expect(() => run({ a: 1, b: 1, op: '10' })).toThrow(/操作码/);
    expect(() => run({ a: 1, b: 1, store: [BOOK_STORE[1]!] })).toThrow(/0000/);
    expect(() => run({ a: 1, b: 1, store: [BOOK_STORE[0]!] })).toThrow(/空的/);
    expect(() => run({ a: 1, b: 1, store: [BOOK_STORE[0]!, { addr: '1010', word: `${'0'.repeat(19)}1010` }] })).toThrow(/死循环/);
  });

  it('出题器给出的参数都能跑通', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const p = generate(seed);
      expect(validateTrace(run(p))).toEqual([]);
    }
  });
});

// ---------- 字段位数 ----------

function naiveGroupBits(k: number): number {
  let bits = 0;
  let states = 1;
  while (states < k + 1) {
    states *= 2;
    bits += 1;
  }
  return bits;
}

describe('字段位数与控存容量', () => {
  it('⌈log2(k+1)⌉ 与逐个翻倍的参照一致', () => {
    for (let k = 1; k <= 300; k += 1) expect(groupBits(k)).toBe(naiveGroupBits(k));
  });

  it('各字段相加等于字长；给字长时下地址 = 字长 − 其余；Trace 合格', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const p = generateFields(seed);
        const f = fields(p);
        expect(f.controlBits + f.testBits + f.nextBits).toBe(f.wordBits);
        const control = (p.direct ?? 0) + (p.groups ?? []).map(naiveGroupBits).reduce((a, c) => a + c, 0);
        expect(f.controlBits).toBe(control);
        if (p.cmWords !== undefined) expect(2 ** f.nextBits).toBe(p.cmWords);
        if (p.wordBits !== undefined) expect(f.wordBits).toBe(p.wordBits);
        expect(f.capacityBits).toBe(f.words * f.wordBits);
        const t = runFields(p);
        expect(validateTrace(t)).toEqual([]);
        expect(JSON.stringify(runFields(p))).toBe(JSON.stringify(t));
      }),
      { numRuns: 200 },
    );
  });

  it('参数不够或矛盾时抛出错误', () => {
    expect(() => fields({ groups: [3], conditions: 1 })).toThrow(/下地址/);
    expect(() => fields({ groups: [3, 3], conditions: 1, wordBits: 4 })).toThrow(/不够/);
    expect(() => fields({ groups: [3], conditions: 1, wordBits: 20, cmWords: 16 })).toThrow(/对不上/);
    expect(() => fields({ cmWords: 100, wordBits: 20 })).toThrow(/2 的幂/);
    expect(() => fields({ program: { instructions: 100, perInstruction: 4 }, cmWords: 128, wordBits: 32 })).toThrow(/控存只有/);
  });
});

// ---------- 固定用例 ----------

interface GoldenRun {
  store: { addr: string; word: string; commands: string[] }[];
  cases: { name: string; params: MicroParams; expect: { path: string[]; R2: number; Cy: number; afterEach: (number | null)[] } }[];
}
const goldenRun = JSON.parse(readFileSync(new URL('../../../evals/golden/micro-decimal-add.json', import.meta.url), 'utf8')) as GoldenRun;

describe('evals/golden/micro-decimal-add.json', () => {
  it('控存四条微指令的编码与微命令', () => {
    for (const w of goldenRun.store) {
      const book = BOOK_STORE.find((x) => x.addr === w.addr)!;
      expect(book.word.replace(/ /g, '')).toBe(w.word);
      expect(decode(w.word).commands).toEqual(w.commands);
    }
  });
  for (const c of goldenRun.cases) {
    it(c.name, () => {
      const t = run(c.params);
      expect(validateTrace(t)).toEqual([]);
      expect(pathOf(c.params)).toEqual(c.expect.path);
      const last = t.steps.at(-1)!.state;
      expect(last.reg.R2).toBe(c.expect.R2);
      expect(last.Cy).toBe(c.expect.Cy);
      expect(naiveRun(c.params).after).toEqual(c.expect.afterEach);
    });
  }
});

interface GoldenFields {
  cases: { name: string; params: FieldParams; expect: Partial<Record<'controlBits' | 'testBits' | 'nextBits' | 'wordBits' | 'words' | 'capacityBits', number>> & { groupBits?: number[] } }[];
}
const goldenFields = JSON.parse(readFileSync(new URL('../../../evals/golden/micro-fields.json', import.meta.url), 'utf8')) as GoldenFields;

describe('evals/golden/micro-fields.json', () => {
  for (const c of goldenFields.cases) {
    it(c.name, () => {
      const f = fields(c.params);
      for (const [key, value] of Object.entries(c.expect)) expect(f[key as keyof typeof f]).toEqual(value);
      expect(validateTrace(runFields(c.params))).toEqual([]);
    });
  }
});
