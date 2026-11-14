import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { fields, generate, generateFields, groupBits, run, runFields, type FieldParams, type MicroParams, type StoreWord } from './model';

// ---------- 朴素参照：只按 specs/5-micro.md 和 docs/textbook/ch04-05.md「(b) 微程序控制器」（图 5.21–5.25，p168–172）写 ----------
// 按位号直接解释 23 位微指令：1–17 位一位一个微命令，18、19 位 P1、P2，20–23 位下地址。

const BIT = {
  LDR1: 1,
  LDR2: 2,
  LDR3: 3,
  R1X: 4,
  R1Y: 5,
  R2X: 6,
  R2Y: 7,
  DRX: 8,
  R3Y: 9,
  ADD: 10,
  M: 11,
  SUB: 12,
  RDD: 13,
  LDDR: 14,
  LDIR: 15,
  LDAR: 16,
  PC1: 17,
  P1: 18,
  P2: 19,
} as const;

/** 图 5.25 十进制加法的四条，编码照摘要 p171 表（1–17 位 | P1 P2 | 下地址）。 */
const BOOK: StoreWord[] = [
  { addr: '0000', word: '00000000000000101' + '10' + '0000' },
  { addr: '1010', word: '01010010010000000' + '00' + '1001' },
  { addr: '1001', word: '01000100110000000' + '01' + '0000' },
  { addr: '0001', word: '01001100000100000' + '00' + '0000' },
];

interface RefResult {
  path: string[];
  R1: number;
  R2: number;
  R3: number;
  PC: number;
  IR: string | null;
  Cy: 0 | 1;
}

function reference(p: MicroParams): RefResult {
  const op = p.op ?? '1010';
  const store = new Map((p.store ?? BOOK).map((w) => [w.addr, w.word.replace(/\s+/g, '')]));
  const reg = { R1: p.r1 ?? 6, R2: p.a, R3: p.b, DR: p.dr ?? 0, PC: p.pc ?? 0 };
  let IR: string | null = null;
  let Cy: 0 | 1 = 0;
  let uAR = '0000';
  const path: string[] = [];
  for (let guard = 0; guard < 40; guard++) {
    path.push(uAR);
    const w = store.get(uAR) as string;
    const b = (i: number): boolean => w[i - 1] === '1';
    const x = b(BIT.R1X) ? reg.R1 : b(BIT.R2X) ? reg.R2 : b(BIT.DRX) ? reg.DR : 0;
    const y = b(BIT.R1Y) ? reg.R1 : b(BIT.R2Y) ? reg.R2 : b(BIT.R3Y) ? reg.R3 : 0;
    let out: number | null = null;
    if (b(BIT.ADD)) {
      const sum = x + y;
      out = sum & 15;
      Cy = sum > 15 ? 1 : 0;
    } else if (b(BIT.SUB)) out = (x - y) & 15;
    else if (b(BIT.M)) out = x;
    if (b(BIT.LDIR)) IR = op;
    if (b(BIT.PC1)) reg.PC += 1;
    if (out !== null) {
      if (b(BIT.LDR1)) reg.R1 = out;
      if (b(BIT.LDR2)) reg.R2 = out;
      if (b(BIT.LDR3)) reg.R3 = out;
    }
    let next = w.slice(19, 23);
    if (b(BIT.P1)) next = next.split('').map((c, i) => (c === '1' || op[i] === '1' ? '1' : '0')).join('');
    if (b(BIT.P2) && Cy === 0) next = next.slice(0, 3) + '1';
    if (next === '0000') break;
    uAR = next;
  }
  return { path, R1: reg.R1, R2: reg.R2, R3: reg.R3, PC: reg.PC, IR, Cy };
}

function engineOut(p: MicroParams) {
  const t = run(p);
  const last = t.steps[t.steps.length - 1]!.state;
  const path = t.steps.filter((s) => s.level === 'cycle').map((s) => s.state.uAR);
  return { t, last, path };
}

// ---------- 随机控存 ----------

interface Op1 {
  fn: '+' | '−' | 'M' | null;
  x: 'R1' | 'R2' | 'DR' | null;
  y: 'R1' | 'R2' | 'R3' | null;
  loads: boolean[];
  pc: boolean;
}
const opArb: fc.Arbitrary<Op1> = fc
  .record({
    fn: fc.constantFrom<Op1['fn']>('+', '+', '−', 'M', null),
    x: fc.constantFrom<'R1' | 'R2' | 'DR'>('R1', 'R2', 'DR'),
    y: fc.constantFrom<'R1' | 'R2' | 'R3'>('R1', 'R2', 'R3'),
    loads: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
    pc: fc.boolean(),
  })
  .map(({ fn, x, y, loads, pc }) => ({
    fn,
    x: fn === null ? null : x,
    y: fn === null || fn === 'M' ? null : y,
    loads: fn === null ? [false, false, false] : loads,
    pc,
  }));

function encode(o: Op1, p2: 0 | 1, next: string): string {
  const bits = new Array<string>(17).fill('0');
  const set = (i: number): void => {
    bits[i - 1] = '1';
  };
  o.loads.forEach((l, i) => l && set(i + 1));
  if (o.x === 'R1') set(BIT.R1X);
  if (o.x === 'R2') set(BIT.R2X);
  if (o.x === 'DR') set(BIT.DRX);
  if (o.y === 'R1') set(BIT.R1Y);
  if (o.y === 'R2') set(BIT.R2Y);
  if (o.y === 'R3') set(BIT.R3Y);
  if (o.fn === '+') set(BIT.ADD);
  if (o.fn === 'M') set(BIT.M);
  if (o.fn === '−') set(BIT.SUB);
  if (o.pc) set(BIT.PC1);
  return bits.join('') + '0' + String(p2) + next;
}

const b4 = (n: number): string => n.toString(2).padStart(4, '0');

/** 0000 取指（P1 按 OP 转移）→ OP 号单元起一串运算微指令 →（最后一条可带 P2 测试）→ 0001 收尾 → 0000。 */
const storeParamsArb: fc.Arbitrary<MicroParams> = fc
  .record({
    a: fc.integer({ min: 0, max: 9 }),
    b: fc.integer({ min: 0, max: 9 }),
    r1: fc.integer({ min: 0, max: 15 }),
    dr: fc.integer({ min: 0, max: 15 }),
    pc: fc.integer({ min: 0, max: 200 }),
    chainAddrs: fc.uniqueArray(fc.integer({ min: 2, max: 15 }), { minLength: 1, maxLength: 5 }),
    ops: fc.array(opArb, { minLength: 6, maxLength: 6 }),
    lastP2: fc.constantFrom<0 | 1>(0, 1),
  })
  .map(({ a, b, r1, dr, pc, chainAddrs, ops, lastP2 }) => {
    const op = b4(chainAddrs[0]!);
    const store: StoreWord[] = [{ addr: '0000', word: '00000000000000101' + '10' + '0000' }];
    chainAddrs.forEach((addr, i) => {
      const last = i === chainAddrs.length - 1;
      const next = last ? '0000' : b4(chainAddrs[i + 1]!);
      store.push({ addr: b4(addr), word: encode(ops[i]!, last ? lastP2 : 0, next) });
    });
    store.push({ addr: '0001', word: encode(ops[5]!, 0, '0000') });
    return { a, b, r1, dr, pc, op, store };
  });

// ---------- 教材例题 ----------

describe('micro 图 5.25 十进制加法微程序（p170–172）', () => {
  it('a=3、b=4：6+3=9 → 9+4=13 无进位 → 走 0001 减 6 → R2=7，路径 0000→1010→1001→0001', () => {
    const { path, last, t } = engineOut({ a: 3, b: 4 });
    expect(validateTrace(t)).toEqual([]);
    expect(path).toEqual(['0000', '1010', '1001', '0001']);
    expect(last.reg.R2).toBe(7);
    expect(last.Cy).toBe(0);
  });

  it('a=8、b=5：6+8=14 → 14+5=19 进位 Cy=1、R2=3 → P2 不改，回 0000；路径 0000→1010→1001', () => {
    const { path, last } = engineOut({ a: 8, b: 5 });
    expect(path).toEqual(['0000', '1010', '1001']);
    expect(last.reg.R2).toBe(3);
    expect(last.Cy).toBe(1);
  });

  it('引擎缺省控存与按摘要 p171 表手抄的四条编码跑出同样的 Trace 结果', () => {
    for (const [a, b] of [
      [0, 0],
      [9, 9],
      [4, 5],
      [5, 5],
    ] as const) {
      const mine = engineOut({ a, b, store: BOOK });
      const dflt = engineOut({ a, b });
      expect(mine.path).toEqual(dflt.path);
      expect(mine.last.reg).toEqual(dflt.last.reg);
    }
  });

  it('一条微指令同时有 R1→X 和 R2→X：抛错', () => {
    const bad: StoreWord[] = [...BOOK.slice(0, 1), { addr: '1010', word: '01010110010000000' + '00' + '0000' }];
    expect(() => run({ a: 1, b: 2, store: bad })).toThrow();
  });
});

describe('micro 性质', () => {
  it('性质 1（穷举 100 种）：R2 是 a+b 的个位，Cy 是十进制进位；和不超过 9 走 4 条，否则 3 条', () => {
    for (let a = 0; a <= 9; a++) {
      for (let b = 0; b <= 9; b++) {
        const { path, last, t } = engineOut({ a, b });
        expect(last.reg.R2).toBe((a + b) % 10);
        expect(last.Cy).toBe(a + b > 9 ? 1 : 0);
        expect(path.length).toBe(a + b <= 9 ? 4 : 3);
        expect(path).toEqual(reference({ a, b }).path);
        expect(validateTrace(t)).toEqual([]);
      }
    }
  });

  it('性质 2：随机的运算微指令组成的控存，逐条与按位号直接解释的参照一致', () => {
    fc.assert(
      fc.property(storeParamsArb, (p) => {
        const r = reference(p);
        const { path, last, t } = engineOut(p);
        expect(path).toEqual(r.path);
        expect({ R1: last.reg.R1, R2: last.reg.R2, R3: last.reg.R3, PC: last.reg.PC, IR: last.reg.IR, Cy: last.Cy }).toEqual({
          R1: r.R1,
          R2: r.R2,
          R3: r.R3,
          PC: r.PC,
          IR: r.IR,
          Cy: r.Cy,
        });
        expect(last.cycle).toBe(r.path.length);
        expect(validateTrace(t)).toEqual([]);
        expect(run(p)).toEqual(t);
      }),
      { numRuns: 300 },
    );
  });

  it('下一微地址：P1=1 把 OP 按位并进下地址；P2=1 且 Cy=0 置最低位，Cy=1 不改', () => {
    fc.assert(
      fc.property(storeParamsArb, (p) => {
        const t = run(p);
        const r = reference(p);
        // 每条微指令的最后一步形成下一微地址：取下一个 cycle 步的前一步，以及整个 Trace 的最后一步。
        const starts = t.steps.flatMap((s, i) => (s.level === 'cycle' ? [i] : []));
        const ends = [...starts.slice(1).map((i) => i - 1), t.steps.length - 1];
        for (const e of ends) expect(t.steps[e]!.level).toBe('explain');
        const formed = ends.map((e) => t.steps[e]!.state.branch?.modified);
        expect(formed).toEqual([...r.path.slice(1), '0000']);
      }),
      { numRuns: 150 },
    );
  });

  it('相斥组里同时出现两个、用到 13/14/16 位、LDIR′ 不在 0000、打入却没有 ALU 操作：都抛错', () => {
    const groups = [
      [BIT.R1X, BIT.R2X, BIT.DRX],
      [BIT.R1Y, BIT.R2Y, BIT.R3Y],
      [BIT.ADD, BIT.M, BIT.SUB],
    ];
    fc.assert(
      fc.property(storeParamsArb, fc.nat(), fc.nat(), (p, gi, pick) => {
        const g = groups[gi % 3];
        const i = pick % 3;
        const j = (i + 1 + (pick % 2)) % 3;
        const store = (p.store as StoreWord[]).map((w) => ({ ...w }));
        const target = store[1];
        const bits = target!.word.split('');
        bits[g![i]! - 1] = '1';
        bits[g![j]! - 1] = '1';
        target!.word = bits.join('');
        expect(() => run({ ...p, store })).toThrow();
      }),
      { numRuns: 100 },
    );
    const flip = (bit: number): StoreWord[] => {
      const s = BOOK.map((w) => ({ ...w }));
      const bits = s[1]!.word.split('');
      bits[bit - 1] = '1';
      s[1]!.word = bits.join('');
      return s;
    };
    expect(() => run({ a: 1, b: 1, store: flip(BIT.RDD) })).toThrow();
    expect(() => run({ a: 1, b: 1, store: flip(BIT.LDDR) })).toThrow();
    expect(() => run({ a: 1, b: 1, store: flip(BIT.LDAR) })).toThrow();
    expect(() => run({ a: 1, b: 1, store: flip(BIT.LDIR) })).toThrow();
    const noAlu = BOOK.map((w) => ({ ...w }));
    noAlu[3] = { addr: '0001', word: '01000000000000000' + '00' + '0000' };
    expect(() => run({ a: 1, b: 1, store: noAlu })).toThrow();
  });

  it('generate 出的题能跑、validateTrace 为空', () => {
    for (let seed = 1; seed <= 30; seed++) expect(validateTrace(run(generate(seed)))).toEqual([]);
  });
});

// ---------- 字段位数与控存容量 ----------

function refGroupBits(k: number): number {
  let b = 0;
  let cap = 1;
  while (cap < k + 1) {
    cap *= 2;
    b++;
  }
  return b;
}

interface RefFields {
  groupBits: number[];
  controlBits: number;
  testBits: number;
  nextBits: number;
  wordBits: number;
  words: number;
  capacityBits: number;
}

function refFields(p: FieldParams): RefFields {
  const gb = (p.groups ?? []).map(refGroupBits);
  const cond = p.conditions ?? 0;
  const testBits = (p.testEncoding ?? '每个条件一位') === '编码' ? refGroupBits(cond) : cond;
  const hasControl = p.direct !== undefined || p.groups !== undefined;
  let control = hasControl ? (p.direct ?? 0) + gb.reduce((x, y) => x + y, 0) : null;
  let next: number;
  let words: number;
  if (p.cmWords !== undefined) {
    next = Math.log2(p.cmWords);
    words = p.cmWords;
  } else if (p.program) {
    words = p.program.instructions * (p.program.perInstruction - 1) + 1;
    next = refGroupBits(words - 1);
  } else {
    next = (p.wordBits as number) - (control as number) - testBits;
    words = 2 ** next;
  }
  if (control === null) control = (p.wordBits as number) - testBits - next;
  const wordBits = p.wordBits ?? control + testBits + next;
  return { groupBits: gb, controlBits: control, testBits, nextBits: next, wordBits, words, capacityBits: words * wordBits };
}

const fieldArb: fc.Arbitrary<FieldParams> = fc
  .record({
    kind: fc.constantFrom('字长', '控存', '字长+控存', '程序'),
    direct: fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }),
    groups: fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 6 }),
    conditions: fc.integer({ min: 0, max: 6 }),
    testEncoding: fc.constantFrom<FieldParams['testEncoding']>(undefined, '每个条件一位', '编码'),
    nextBits: fc.integer({ min: 2, max: 10 }),
    slack: fc.integer({ min: 1, max: 30 }),
    program: fc.record({ instructions: fc.integer({ min: 2, max: 120 }), perInstruction: fc.integer({ min: 2, max: 8 }) }),
  })
  .map(({ kind, direct, groups, conditions, testEncoding, nextBits, slack, program }): FieldParams => {
    const base: FieldParams = { conditions };
    if (testEncoding) base.testEncoding = testEncoding;
    const test = testEncoding === '编码' ? refGroupBits(conditions) : conditions;
    const dir = direct === undefined ? {} : { direct };
    const control = (direct ?? 0) + groups.map(refGroupBits).reduce((x, y) => x + y, 0);
    if (kind === '字长') return { ...base, ...dir, groups, wordBits: control + test + nextBits };
    if (kind === '控存') return { ...base, ...dir, groups, cmWords: 2 ** nextBits };
    if (kind === '字长+控存') return { ...base, cmWords: 2 ** nextBits, wordBits: test + nextBits + slack };
    const words = program.instructions * (program.perInstruction - 1) + 1;
    return { ...base, program, wordBits: test + refGroupBits(words - 1) + slack };
  });

describe('micro 字段位数（runFields）', () => {
  it('析12：五组 4、5、8、15、20 → 3、3、4、4、5 位，2 个条件 2 位，字长 29 → 下地址 29−19−2=8 位，控存 256×29', () => {
    const f = fields({ groups: [4, 5, 8, 15, 20], conditions: 2, wordBits: 29 });
    expect(f.groupBits).toEqual([3, 3, 4, 4, 5]);
    expect(f.nextBits).toBe(8);
    expect(f.words).toBe(256);
    expect(f.capacityBits).toBe(256 * 29);
  });

  it('设5：10 个直接 + 7/15/3/5 四组（3、4、2、3 位）= 22 位，4 个条件编码 3 位，字长 32 → 下地址 7 位、128 单元', () => {
    const f = fields({ direct: 10, groups: [7, 15, 3, 5], conditions: 4, testEncoding: '编码', wordBits: 32 });
    expect(f.controlBits).toBe(22);
    expect(f.testBits).toBe(3);
    expect(f.nextBits).toBe(7);
    expect(f.words).toBe(128);
  });

  it('析8：512×48 位、4 个条件 → 下地址 9、判别 4、微命令 48−4−9=35；习题 6：(80×3+1)×32 位', () => {
    const f = fields({ cmWords: 512, wordBits: 48, conditions: 4 });
    expect([f.controlBits, f.testBits, f.nextBits]).toEqual([35, 4, 9]);
    const g = fields({ program: { instructions: 80, perInstruction: 4 }, wordBits: 32 });
    expect(g.words).toBe(241);
    expect(g.capacityBits).toBe(241 * 32);
  });

  it('性质 3：⌈log2(k+1)⌉ 与逐个翻倍的参照一致', () => {
    for (let k = 0; k <= 300; k++) expect(groupBits(k)).toBe(refGroupBits(k));
  });

  it('性质 3：字段之和等于字长；各量与参照一致；validateTrace 为空', () => {
    fc.assert(
      fc.property(fieldArb, (p) => {
        const r = refFields(p);
        const f = fields(p);
        expect(f.controlBits + f.testBits + f.nextBits).toBe(f.wordBits);
        expect({ ...f, groupBits: f.groupBits }).toEqual({ ...r, groupBits: p.groups ? r.groupBits : f.groupBits });
        const t = runFields(p);
        expect(validateTrace(t)).toEqual([]);
        expect(runFields(p)).toEqual(t);
      }),
      { numRuns: 300 },
    );
    for (let seed = 1; seed <= 30; seed++) expect(validateTrace(runFields(generateFields(seed)))).toEqual([]);
  });

  it('参数不够或矛盾时抛错', () => {
    expect(() => fields({ groups: [4, 5] })).toThrow();
    expect(() => fields({ groups: [15, 15], conditions: 2, wordBits: 8 })).toThrow();
  });
});
