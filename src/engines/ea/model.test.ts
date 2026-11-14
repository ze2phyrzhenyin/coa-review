import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { FORMULA, MODE_KINDS, generate, hex, run, sampleParams, solveWord, type EaParams, type Mode, type ModeKind } from './model';

// ---------- 朴素参照：按公式表逐字解释，十六进制字符串逐位转二进制 ----------

const HEX2BIN: Record<string, string> = Object.fromEntries('0123456789ABCDEF'.split('').map((c, i) => [c, i.toString(2).padStart(4, '0')]));

function naive(p: EaParams, word: string): { ea: number | null; operand: number | null; reads: number } {
  const bin = word.toUpperCase().split('').map((c) => HEX2BIN[c]).join('');
  const f: Record<string, string> = {};
  let pos = 0;
  for (const fd of p.fields) {
    f[fd.name] = bin.substr(pos, fd.bits);
    pos += fd.bits;
  }
  const mode = p.modes[p.modeFields.map((m) => f[m]).join('')]!;
  const aBits = f[p.addressField ?? 'A']!;
  let a = parseInt(aBits, 2);
  const signed = mode.signed ?? mode.kind.includes('相对');
  if (signed && aBits.startsWith('1')) a -= 1 << aBits.length;
  const size = 2 ** (p.addressBits ?? 16);
  const mod = (v: number): number => ((v % size) + size) % size;
  const mem = (addr: number): number => {
    for (const [k, v] of Object.entries(p.memory ?? {})) if (parseInt(k, 16) === addr) return v;
    return 0;
  };
  const regName = mode.reg ?? (mode.regField ? `R${parseInt(f[mode.regField]!, 2)}` : 'PC');
  const r = p.registers[regName] ?? 0;
  let reads = 0;
  const load = (addr: number): number => {
    reads += 1;
    return mem(addr);
  };
  let ea: number | null;
  const table: Record<ModeKind, () => number | null> = {
    立即: () => null,
    寄存器: () => null,
    直接: () => mod(a),
    寄存器间接: () => mod(r),
    变址: () => mod(r + a),
    基址: () => mod(r + a),
    相对: () => mod(p.registers.PC! + a),
    段: () => mod(r * 16 + a),
    间接: () => mod(load(mod(a))),
    先变址后间接: () => mod(load(mod(r + a))),
    先基址后间接: () => mod(load(mod(r + a))),
    先相对后间接: () => mod(load(mod(p.registers.PC! + a))),
  };
  ea = table[mode.kind]();
  let operand: number | null = null;
  if (mode.kind === '立即') operand = a;
  else if (mode.kind === '寄存器') operand = r;
  else if (p.fetchOperand !== false) operand = load(ea!);
  return { ea, operand, reads };
}

// 随机格式：OP | M（3 位，选方式）| A，每个方式码随机指一种方式。
const modeArb: fc.Arbitrary<Mode> = fc.constantFrom(...MODE_KINDS).chain((kind) =>
  fc.record({ kind: fc.constant(kind), reg: fc.constantFrom('B', 'X', 'R1'), signed: fc.boolean() }).map((m) => {
    const out: Mode = { kind: m.kind, signed: m.signed };
    if (['寄存器', '寄存器间接', '变址', '基址', '先变址后间接', '先基址后间接', '段'].includes(kind)) out.reg = m.reg;
    return out;
  }),
);
const paramsArb: fc.Arbitrary<EaParams> = fc
  .record({
    wordBits: fc.constantFrom(12, 16, 20, 24),
    opBits: fc.integer({ min: 1, max: 4 }),
    modes: fc.array(modeArb, { minLength: 8, maxLength: 8 }),
    addressBits: fc.integer({ min: 8, max: 24 }),
    regs: fc.tuple(fc.nat(0xfffff), fc.nat(0xfffff), fc.nat(0xfffff), fc.nat(0xfffff)),
    memory: fc.array(fc.tuple(fc.nat(0xfff), fc.nat(0xffff)), { maxLength: 12 }),
    seedWords: fc.array(fc.nat(0xffffff), { minLength: 1, maxLength: 4 }),
    fetchOperand: fc.boolean(),
  })
  .map((x) => ({
    wordBits: x.wordBits,
    fields: [
      { name: 'OP', bits: x.opBits },
      { name: 'M', bits: 3 },
      { name: 'A', bits: x.wordBits - x.opBits - 3 },
    ],
    modeFields: ['M'],
    modes: Object.fromEntries(x.modes.map((m, i) => [i.toString(2).padStart(3, '0'), m])),
    words: x.seedWords.map((w) => (w % 2 ** x.wordBits).toString(16).toUpperCase().padStart(x.wordBits / 4, '0')),
    registers: { PC: x.regs[0], B: x.regs[1], X: x.regs[2], R1: x.regs[3] },
    memory: Object.fromEntries(x.memory.map(([a, v]) => [a.toString(16), v])),
    addressBits: x.addressBits,
    fetchOperand: x.fetchOperand,
  }));

describe('有效地址：性质', () => {
  it('每条指令的 EA、操作数、访存次数与按公式表直接算的参照一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        for (const w of p.words) {
          const got = solveWord(p, w);
          const ref = naive(p, w);
          expect(got.ea).toBe(ref.ea);
          expect(got.operand).toBe(ref.operand);
          expect(got.reads.length).toBe(ref.reads);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('Trace 合格、可重现；访存步数等于访存次数；表一行一条指令', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(t));
        const total = p.words.reduce((a, w) => a + solveWord(p, w).reads.length, 0);
        expect(t.steps.filter((s) => s.level === 'access').length).toBe(total);
        expect(t.table.rows.length).toBe(p.words.length);
      }),
      { numRuns: 150 },
    );
  });

  it('间接类比对应的直接类多访存一次；立即、寄存器寻址不访存', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        for (const w of p.words) {
          const s = solveWord(p, w);
          const base = p.fetchOperand === false ? 0 : 1;
          if (s.mode.kind === '立即' || s.mode.kind === '寄存器') expect(s.reads.length).toBe(0);
          else if (s.mode.kind === '间接' || s.mode.kind.startsWith('先')) expect(s.reads.length).toBe(base + 1);
          else expect(s.reads.length).toBe(base);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('每种方式都有公式；样例和出题器都能跑通', () => {
    for (const k of MODE_KINDS) expect(FORMULA[k]).toBeTruthy();
    expect(validateTrace(run(sampleParams()))).toEqual([]);
    for (let seed = 0; seed < 100; seed += 1) expect(validateTrace(run(generate(seed)))).toEqual([]);
  });

  it('寄存器编号取自字段', () => {
    const p: EaParams = {
      wordBits: 16,
      fields: [
        { name: 'OP', bits: 6 },
        { name: 'R', bits: 2 },
        { name: 'A', bits: 8 },
      ],
      modeFields: [],
      modes: { '': { kind: '变址', regField: 'R' } },
      words: ['0210', '0310'],
      registers: { R2: 0x100, R3: 0x200 },
      fetchOperand: false,
    };
    expect(run(p).table.rows.map((r) => r.cells[4])).toEqual(['0110H', '0210H']);
  });

  it('非法参数抛出错误', () => {
    const p = sampleParams();
    expect(() => run({ ...p, wordBits: 15 })).toThrow(/字长/);
    expect(() => run({ ...p, words: ['12345'] })).toThrow(/十六进制/);
    expect(() => run({ ...p, fields: [{ name: 'OP', bits: 8 }, { name: 'A', bits: 4 }, { name: 'X', bits: 4 }] })).toThrow(/键/);
    expect(() => run({ ...p, fields: [{ name: 'OP', bits: 8 }, { name: 'A', bits: 8 }] })).toThrow(/寻址特征字段/);
    expect(() => run({ ...p, registers: { X1: 1, X2: 2 } })).toThrow(/PC/);
    expect(() => run({ ...p, modes: { '00': { kind: '变址' } } })).toThrow(/寄存器/);
    expect(() => run({ ...p, modes: { '00': { kind: '直接' } } })).toThrow(/没有对应/);
    expect(hex(0x3a, 16)).toBe('003AH');
  });
});

// ---------- 固定用例 ----------

interface Golden {
  cases: { name: string; params: EaParams; expect: { mode: ModeKind; ea: string | null; operand?: string; reads: number }[] }[];
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/ea-cases.json', import.meta.url), 'utf8')) as Golden;

describe('evals/golden/ea-cases.json', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const t = run(c.params);
      expect(validateTrace(t)).toEqual([]);
      c.params.words.forEach((w, i) => {
        const e = c.expect[i]!;
        const tag = `I${i + 1}（${w}H）`;
        expect(t.result[`${tag} 寻址方式`]).toBe(e.mode);
        expect(t.result[`${tag} 有效地址`]).toBe(e.ea ?? '无（不访存）');
        expect(t.result[`${tag} 访存次数`]).toBe(String(e.reads));
        if (e.operand) expect(t.result[`${tag} 操作数`]).toBe(e.operand);
      });
    });
  }
});
