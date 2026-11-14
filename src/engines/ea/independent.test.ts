import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { run, solveWord, generate, sampleParams, type EaParams, type Mode, type ModeKind } from './model';

// ---------- 朴素参照：只按 specs/4-ea.md 和 docs/textbook/ch04-05.md「寻址方式」（表 4.5，p135；解析书 析6、析10）写 ----------

interface RefOut {
  kind: ModeKind;
  a: number;
  ea: number | null;
  operand: number | null;
  reads: { addr: number; value: number }[];
}

const RELATIVE: ModeKind[] = ['相对', '先相对后间接'];

function hexToBits(word: string, bits: number): string {
  return word
    .toUpperCase()
    .split('')
    .map((c) => parseInt(c, 16).toString(2).padStart(4, '0'))
    .join('')
    .padStart(bits, '0');
}

function reference(p: EaParams, word: string): RefOut {
  const bits = hexToBits(word, p.wordBits);
  const f: Record<string, string> = {};
  let at = 0;
  for (const fld of p.fields) {
    f[fld.name] = bits.slice(at, at + fld.bits);
    at += fld.bits;
  }
  const key = p.modeFields.map((n) => f[n]).join('');
  const mode = p.modes[key];
  if (!mode) throw new Error(`没有寻址特征 ${key}`);
  const aBits = f[p.addressField ?? 'A'];
  const width = aBits!.length;
  const raw = parseInt(aBits!, 2);
  const signed = mode.signed ?? RELATIVE.includes(mode.kind);
  const a = signed && aBits![0] === '1' ? raw - 2 ** width : raw;
  const ab = p.addressBits ?? 16;
  const mod = (v: number): number => ((v % 2 ** ab) + 2 ** ab) % 2 ** ab;
  const mem = (addr: number): number => {
    for (const [k, v] of Object.entries(p.memory ?? {})) if (parseInt(k, 16) === addr) return v;
    return 0;
  };
  const regName = mode.regField ? `R${parseInt(f[mode.regField]!, 2)}` : mode.reg;
  const reg = (): number => {
    const name = RELATIVE.includes(mode.kind) ? 'PC' : (regName as string);
    if (!(name in p.registers)) throw new Error(`缺寄存器 ${name}`);
    return p.registers[name]!;
  };
  const reads: { addr: number; value: number }[] = [];
  const read = (addr: number): number => {
    const v = mem(addr);
    reads.push({ addr, value: v });
    return v;
  };
  let ea: number | null = null;
  let operand: number | null = null;
  switch (mode.kind) {
    case '立即':
      operand = raw;
      break;
    case '寄存器':
      operand = reg();
      break;
    case '直接':
      ea = mod(a);
      break;
    case '间接':
      ea = mod(read(mod(a)));
      break;
    case '寄存器间接':
      ea = mod(reg());
      break;
    case '变址':
    case '基址':
    case '相对':
      ea = mod(reg() + a);
      break;
    case '先变址后间接':
    case '先基址后间接':
    case '先相对后间接':
      ea = mod(read(mod(reg() + a)));
      break;
    case '段':
      ea = mod(reg() * 16 + a);
      break;
  }
  if (ea !== null && (p.fetchOperand ?? true)) operand = read(ea);
  return { kind: mode.kind, a, ea, operand, reads };
}

const hexH = (v: number, ab: number): string => `${v.toString(16).toUpperCase().padStart(Math.ceil(ab / 4), '0')}H`;

// ---------- 随机参数 ----------

const KINDS: ModeKind[] = ['立即', '直接', '间接', '寄存器', '寄存器间接', '变址', '基址', '相对', '先变址后间接', '先基址后间接', '先相对后间接', '段'];
const NEEDS_REG: ModeKind[] = ['寄存器', '寄存器间接', '变址', '基址', '先变址后间接', '先基址后间接', '段'];
const HAS_A_CALC: ModeKind[] = ['直接', '间接', '变址', '基址', '相对', '先变址后间接', '先基址后间接', '先相对后间接', '段'];

const modeArb: fc.Arbitrary<Mode> = fc
  .record({
    kind: fc.constantFrom(...KINDS),
    regPick: fc.constantFrom('X1', 'X2', 'BR', 'DS', 'field'),
    signed: fc.constantFrom(undefined, true, false),
  })
  .map(({ kind, regPick, signed }) => {
    const m: Mode = { kind };
    if (NEEDS_REG.includes(kind)) {
      if (regPick === 'field') m.regField = 'R';
      else m.reg = regPick;
    }
    if (signed !== undefined && HAS_A_CALC.includes(kind)) m.signed = signed;
    return m;
  });

const paramsArb: fc.Arbitrary<EaParams> = fc
  .record({
    opBits: fc.integer({ min: 1, max: 4 }),
    aBits: fc.integer({ min: 4, max: 12 }),
    addressBits: fc.constantFrom(12, 16, 20),
    modes: fc.array(modeArb, { minLength: 8, maxLength: 8 }),
    words: fc.array(fc.nat(), { minLength: 1, maxLength: 8 }),
    regs: fc.array(fc.nat({ max: 0xffff }), { minLength: 9, maxLength: 9 }),
    vals: fc.array(fc.nat({ max: 0xfffff }), { minLength: 40, maxLength: 40 }),
    fetchOperand: fc.boolean(),
  })
  .map(({ opBits, aBits, addressBits, modes, words, regs, vals, fetchOperand }) => {
    // OP | M(3) | R(2) | A，凑成 4 的倍数：剩下的位并进 OP。
    let total = opBits + 3 + 2 + aBits;
    const op = opBits + ((4 - (total % 4)) % 4);
    total = op + 3 + 2 + aBits;
    const fields = [
      { name: 'OP', bits: op },
      { name: 'M', bits: 3 },
      { name: 'R', bits: 2 },
      { name: 'A', bits: aBits },
    ];
    const modeMap: Record<string, Mode> = {};
    modes.forEach((m, i) => (modeMap[i.toString(2).padStart(3, '0')] = m));
    const mask = 2 ** addressBits;
    const registers: Record<string, number> = {
      PC: regs[0]! % mask,
      X1: regs[1]! % mask,
      X2: regs[2]! % mask,
      BR: regs[3]! % mask,
      DS: regs[4]!,
      R0: regs[5]! % mask,
      R1: regs[6]! % mask,
      R2: regs[7]! % mask,
      R3: regs[8]! % mask,
    };
    const hexWords = words.map((w) => (w % 2 ** Math.min(total, 30)).toString(16).toUpperCase().padStart(total / 4, '0'));
    const p: EaParams = { wordBits: total, fields, modeFields: ['M'], modes: modeMap, words: hexWords, registers, addressBits, fetchOperand, memory: {} };
    // 把参照要读的单元填上数，让间接、取操作数读到的不全是 0。
    let k = 0;
    for (const w of hexWords) {
      for (let pass = 0; pass < 2; pass++) {
        const r = reference(p, w);
        for (const rd of r.reads) {
          const key = rd.addr.toString(16).toUpperCase();
          if (!(key in (p.memory as Record<string, number>))) (p.memory as Record<string, number>)[key] = vals[k++ % vals.length]! % mask;
        }
      }
    }
    return p;
  });

// ---------- 教材例题 ----------

const xi10: EaParams = {
  // 解析书 析10（p64–65）的格式与寄存器：16 位，OP 6、X 2、D 8；(PC)=1234H，(X1)=0037H，(X2)=1122H
  wordBits: 16,
  fields: [
    { name: 'OP', bits: 6 },
    { name: 'X', bits: 2 },
    { name: 'D', bits: 8 },
  ],
  addressField: 'D',
  modeFields: ['X'],
  modes: { '00': { kind: '直接' }, '01': { kind: '变址', reg: 'X1' }, '10': { kind: '变址', reg: 'X2' }, '11': { kind: '相对' } },
  words: ['4420', '2244', '1322'],
  registers: { PC: 0x1234, X1: 0x0037, X2: 0x1122 },
  fetchOperand: false,
};

describe('ea 教材例题（手算）', () => {
  it('析10：2244H → 0010 0010 0100 0100，X=10 用 X2，EA=1122H+44H=1166H；4420H 直接 0020H；1322H 相对 1234H+22H=1256H', () => {
    const t = run(xi10);
    expect(validateTrace(t)).toEqual([]);
    const s = t.steps[t.steps.length - 1]!.state;
    expect(s.words.map((w) => w.ea)).toEqual(['0020H', '1166H', '1256H']);
    expect(s.words.map((w) => w.mode)).toEqual(['直接', '变址', '相对']);
    expect(solveWord(xi10, '2244').ea).toBe(0x1166);
  });

  it('例 4.4 格式（p140）相对：D=FFF0H 按补码是 −10H，(PC)=1000H → EA=0FF0H', () => {
    const p: EaParams = {
      wordBits: 32,
      fields: [
        { name: 'OP', bits: 6 },
        { name: '—', bits: 3 },
        { name: 'R', bits: 4 },
        { name: 'I', bits: 1 },
        { name: 'X', bits: 2 },
        { name: 'D', bits: 16 },
      ],
      addressField: 'D',
      modeFields: ['I', 'X'],
      modes: { '001': { kind: '相对' }, '100': { kind: '间接' } },
      words: ['0401FFF0'],
      registers: { PC: 0x1000 },
      fetchOperand: false,
    };
    const s = solveWord(p, '0401FFF0');
    expect(s.mode.kind).toBe('相对');
    expect(s.a).toBe(-16);
    expect(s.ea).toBe(0x0ff0);
  });

  it('析6 先变址后间接：(X)=0300H、A=10H → 读 (0310H)=0600H 得 EA，再读操作数，共两次访存', () => {
    const p: EaParams = {
      wordBits: 16,
      fields: [
        { name: 'OP', bits: 5 },
        { name: 'M', bits: 3 },
        { name: 'A', bits: 8 },
      ],
      modeFields: ['M'],
      modes: { '101': { kind: '先变址后间接', reg: 'X' }, '111': { kind: '段', reg: 'DS' } },
      words: ['0D10', '0F34'],
      registers: { PC: 0, X: 0x0300, DS: 0x1200 },
      memory: { '310': 0x0600, '600': 0x4444, '12034': 0x6666 },
      addressBits: 20,
    };
    const s = solveWord(p, '0D10');
    expect(s.ea).toBe(0x0600);
    expect(s.operand).toBe(0x4444);
    expect(s.reads.map((r) => r.addr)).toEqual([0x310, 0x600]);
    // 段寻址（p137）：1200H×16 + 34H = 12034H，一次访存
    const g = solveWord(p, '0F34');
    expect(g.ea).toBe(0x12034);
    expect(g.reads.length).toBe(1);
    const t = run(p);
    expect(t.steps.filter((x) => x.level === 'access').length).toBe(3);
    expect(t.steps[t.steps.length - 1]!.state.words[1]!.ea).toBe('12034H');
  });

  it('寻址特征在表里没有、寄存器缺、字段位数对不上：抛错', () => {
    expect(() => run({ ...xi10, modes: { '00': { kind: '直接' } }, words: ['2244'] })).toThrow();
    expect(() => run({ ...xi10, registers: { PC: 1 } })).toThrow();
    expect(() => run({ ...xi10, fields: [{ name: 'OP', bits: 6 }, { name: 'X', bits: 2 }, { name: 'D', bits: 7 }] })).toThrow();
    expect(() => run({ ...xi10, words: ['22444'] })).toThrow();
  });
});

// ---------- 对拍与性质 ----------

describe('ea 与公式表参照对拍（性质 1）', () => {
  it('每条指令的方式、形式地址、EA、操作数、访存次数和地址一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        for (const w of p.words) {
          const r = reference(p, w);
          const s = solveWord(p, w);
          expect(s.mode.kind).toBe(r.kind);
          expect(s.a).toBe(r.a);
          expect(s.ea).toBe(r.ea);
          if (r.ea === null || (p.fetchOperand ?? true)) expect(s.operand).toBe(r.operand);
          expect(s.reads.map((x) => [x.addr, x.value])).toEqual(r.reads.map((x) => [x.addr, x.value]));
        }
      }),
      { numRuns: 400 },
    );
  });

  it('Trace 的状态与解题表：EA 写成十六进制带 H、按地址位数补齐', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        const last = t.steps[t.steps.length - 1]!.state;
        p.words.forEach((w, i) => {
          const r = reference(p, w);
          expect(last.words[i]!.ea).toBe(r.ea === null ? null : hexH(r.ea, p.addressBits ?? 16));
          expect(last.words[i]!.reads.length).toBe(r.reads.length);
        });
        expect(t.table.rows.length).toBe(p.words.length);
      }),
      { numRuns: 150 },
    );
  });
});

describe('ea 性质', () => {
  it('性质 2：access 步数等于访存次数之和；立即、寄存器方式不访存；间接类比对应直接类多一次', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        let total = 0;
        for (const w of p.words) {
          const s = solveWord(p, w);
          total += s.reads.length;
          const fetch = p.fetchOperand ?? true ? 1 : 0;
          if (s.mode.kind === '立即' || s.mode.kind === '寄存器') expect(s.reads.length).toBe(0);
          else if (['间接', '先变址后间接', '先基址后间接', '先相对后间接'].includes(s.mode.kind)) expect(s.reads.length).toBe(1 + fetch);
          else expect(s.reads.length).toBe(fetch);
        }
        expect(t.steps.filter((x) => x.level === 'access').length).toBe(total);
        expect(t.steps.filter((x) => x.level === 'instruction').length).toBe(p.words.length);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 3：validateTrace 为空；同参数同 Trace；sampleParams、generate 能跑', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(run(p)).toEqual(t);
      }),
      { numRuns: 100 },
    );
    expect(validateTrace(run(sampleParams()))).toEqual([]);
    for (let seed = 1; seed <= 30; seed++) expect(validateTrace(run(generate(seed)))).toEqual([]);
  });

  it('同一条指令只改 PC：相对类的 EA 跟着变同样的量（模 2^地址位数），其余不变', () => {
    fc.assert(
      fc.property(paramsArb, fc.integer({ min: 1, max: 0xff }), (p, d) => {
        const ab = p.addressBits ?? 16;
        const q: EaParams = { ...p, registers: { ...p.registers, PC: (p.registers.PC! + d) % 2 ** ab } };
        for (const w of p.words) {
          const a = solveWord(p, w);
          const b = solveWord(q, w);
          if (a.mode.kind === '相对') expect(b.ea).toBe(((a.ea as number) + d) % 2 ** ab);
          else if (!RELATIVE.includes(a.mode.kind)) expect(b.ea).toBe(a.ea);
        }
      }),
      { numRuns: 150 },
    );
  });
});
