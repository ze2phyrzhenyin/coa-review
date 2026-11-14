import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import type { Instruction, Op, SignalNames } from '../cpu/model';
import { ALL_OPS, BOOK_OPS, expression, generate, run, runReverse, signals } from './model';
import { runFlow, sampleFlow } from './flow';

// ---------- 朴素参照：直接读 evals/golden/cpu-cycles.json 的信号栏（规格 5-hardwired 性质 1 指定的参照） ----------
// 规则只按 specs/5-hardwired.md、5-flow.md 和 docs/textbook/ch04-05.md「(c) 硬布线控制器」：
// 第 k 个 CPU 周期是 Mk；「名字(Tn)」是脉冲，只在 Mk·Tn；不带 (T) 的是电位，整个 Mk 四拍都有效。全角括号开头的是说明，不是信号。

interface Micro {
  beat: string;
  level: string;
  op: string;
  book: string[];
  solutions: string[];
}
interface Cycles {
  fetch: { micros: Micro[] };
  execute: Record<string, { cycles: { name: string; micros: Micro[] }[] }>;
}
const cpu = JSON.parse(readFileSync(new URL('../../../evals/golden/cpu-cycles.json', import.meta.url), 'utf8')) as Cycles;

const cyclesOf = (op: Op): Micro[][] => [cpu.fetch.micros, ...cpu.execute[op]!.cycles.map((c) => c.micros)];

interface Sig {
  name: string;
  t: number | null;
}
function parseSig(raw: string): Sig | null {
  if (raw.startsWith('（')) return null;
  const m = /^(.*)\(T([1-4])\)$/.exec(raw);
  return m ? { name: m[1]!, t: Number(m[2]) } : { name: raw, t: null };
}

const cell = (op: string, m: number, t: number): string => `${op}·M${m}·T${t}`;

interface RefSignal {
  kind: '电位' | '脉冲';
  points: Set<string>;
}

/** 某个指令集、某套名字下的全部信号，以及每个信号为 1 的（指令·M·T）格子。 */
function refSignals(ops: readonly Op[], names: SignalNames): Map<string, RefSignal> {
  const out = new Map<string, RefSignal>();
  for (const op of ops) {
    cyclesOf(op).forEach((micros, idx) => {
      const m = idx + 1;
      for (const mic of micros) {
        for (const raw of mic[names]) {
          const s = parseSig(raw.replace(/\{x\}/g, 'Rx').replace(/\{y\}/g, 'Ry'));
          if (!s) continue;
          const entry = out.get(s.name) ?? { kind: s.t === null ? '电位' : '脉冲', points: new Set<string>() };
          if (s.t === null) for (let t = 1; t <= 4; t++) entry.points.add(cell(op, m, t));
          else entry.points.add(cell(op, m, s.t));
          out.set(s.name, entry);
        }
      }
    });
  }
  return out;
}

/** 规格 要求 5 的写法：按 M（电位）或 M·T（脉冲）归组，组内指令按指令集顺序相或；所有指令都有就不写指令；按 M、T 先后排。 */
function refExpression(sig: RefSignal, ops: readonly Op[]): string {
  const groups = new Map<string, { m: number; t: number | null; ops: Set<string> }>();
  for (const p of sig.points) {
    const [op, M, T] = p.split('·');
    const m = Number(M!.slice(1));
    const t = sig.kind === '电位' ? null : Number(T!.slice(1));
    const key = `${m}:${t ?? 0}`;
    const g = groups.get(key) ?? { m, t, ops: new Set<string>() };
    g.ops.add(op!);
    groups.set(key, g);
  }
  const terms = [...groups.values()]
    .sort((a, b) => a.m - b.m || (a.t ?? 0) - (b.t ?? 0))
    .map((g) => {
      let s = `M${g.m}`;
      if (g.t !== null) s += `·T${g.t}`;
      const list = ops.filter((o) => g.ops.has(o));
      if (list.length === ops.length) return s;
      return list.length === 1 ? `${s}·${list[0]}` : `${s}·(${list.join('+')})`;
    });
  return terms.join('+');
}

// 自己写的表达式求值：· * × 是与，+ 是或，括号；只认 M1–M3、T1–T4、指令名。
type Node = { k: 'or' | 'and'; xs: Node[] } | { k: 'lit'; v: string };
function parse(text: string): Node {
  const toks = text.replace(/\s+/g, '').match(/M[1-3]|T[1-4]|[A-Z]+|[·*×+()]/g) ?? [];
  if (toks.join('') !== text.replace(/\s+/g, '')) throw new Error(`不认识的符号：${text}`);
  let i = 0;
  const or = (): Node => {
    const xs = [and()];
    while (toks[i] === '+') {
      i++;
      xs.push(and());
    }
    return xs.length === 1 ? xs[0]! : { k: 'or', xs };
  };
  const and = (): Node => {
    const xs = [atom()];
    while (toks[i] === '·' || toks[i] === '*' || toks[i] === '×') {
      i++;
      xs.push(atom());
    }
    return xs.length === 1 ? xs[0]! : { k: 'and', xs };
  };
  const atom = (): Node => {
    const t = toks[i++];
    if (t === '(') {
      const n = or();
      if (toks[i++] !== ')') throw new Error('括号不配对');
      return n;
    }
    return { k: 'lit', v: t! };
  };
  const n = or();
  if (i !== toks.length) throw new Error('多余的符号');
  return n;
}
function evalAt(n: Node, op: string, m: number, t: number): boolean {
  if (n.k === 'lit') return n.v === `M${m}` || n.v === `T${t}` || n.v === op;
  return n.k === 'and' ? n.xs.every((x) => evalAt(x, op, m, t)) : n.xs.some((x) => evalAt(x, op, m, t));
}
function pointsOf(text: string, ops: readonly Op[]): Set<string> {
  const n = parse(text);
  const out = new Set<string>();
  for (const op of ops) for (let m = 1; m <= 3; m++) for (let t = 1; t <= 4; t++) if (evalAt(n, op, m, t)) out.add(cell(op, m, t));
  return out;
}
const topTerms = (text: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === '+' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
};
const sorted = (s: Iterable<string>): string[] => [...s].sort();

// ---------- 随机 ----------

/** 按 ALL_OPS 顺序取的非空子集，再配一套名字。 */
const opsArb = fc.subarray([...ALL_OPS], { minLength: 1 }) as fc.Arbitrary<Op[]>;
const namesArb = fc.constantFrom<SignalNames>('book', 'solutions');

// ---------- 例 5.3 ----------

describe('hardwired 例 5.3（p179）的十个式子', () => {
  const book: [string, string][] = [
    ['RD(I)', 'M1'],
    ['RD(D)', 'M3·LAD'],
    ['WE(D)', 'M3·T3·STO'],
    ['LDPC', 'M1·T4+M2·T4·JMP'],
    ['LDIR', 'M1·T3'],
    ['LDAR', 'M2·T4·(LAD+STO)'],
    ['LDDR', 'M2·T3·(MOV+ADD)+M3·T3·LAD'],
    ['PC+1', 'M1·T4'],
    ['LDRx', 'M2·T4·MOV+M3·T4·LAD'],
    ['LDRy', 'M2·T4·ADD'],
  ];
  for (const [sig, want] of book) {
    it(`${sig} = ${want}`, () => {
      expect(expression(sig, BOOK_OPS, 'book').text).toBe(want);
      const t = run({ signal: sig });
      expect(validateTrace(t)).toEqual([]);
      expect(t.steps.every((s) => s.level === 'explain')).toBe(true);
    });
  }

  it('反查：M2·T3·ADD+M3·T3·LAD 对照 LDDR 漏掉 MOV·M2·T3；M3·STO 对照 WE(D) 多出 T1、T2、T4', () => {
    const a = runReverse({ expression: 'M2·T3·ADD+M3·T3·LAD', signal: 'LDDR' });
    const sa = a.steps[a.steps.length - 1]!.state;
    expect(sa.missing).toEqual(['MOV·M2·T3']);
    expect(sa.extra ?? []).toEqual([]);
    const b = runReverse({ expression: 'M3·STO', signal: 'WE(D)' });
    const sb = b.steps[b.steps.length - 1]!.state;
    expect(sorted(sb.extra ?? [])).toEqual(['STO·M3·T1', 'STO·M3·T2', 'STO·M3·T4']);
    expect(sb.missing ?? []).toEqual([]);
  });

  it('同步方式下 MOV、ADD、JMP 也走 M3（空过，p179）：M2·T3·(MOV+ADD)+M3·T3 对照 LDDR 多出的是 M3·T3 上除 LAD 外的四条', () => {
    const t = runReverse({ expression: 'M2·T3·(MOV+ADD)+M3·T3', signal: 'LDDR' });
    const s = t.steps[t.steps.length - 1]!.state;
    expect(sorted(s.extra ?? [])).toEqual(['ADD·M3·T3', 'JMP·M3·T3', 'MOV·M3·T3', 'STO·M3·T3']);
    expect(t.result['有效节拍数']).toBe('7');
  });

  it('抛错：指令集只有 MOV、ADD 求 WE(D)；空指令集；重复；不认识的符号；括号不配对', () => {
    expect(() => run({ signal: 'WE(D)', instructions: ['MOV', 'ADD'] })).toThrow();
    expect(() => run({ signal: 'LDDR', instructions: [] })).toThrow();
    expect(() => run({ signal: 'LDDR', instructions: ['MOV', 'MOV'] })).toThrow();
    expect(() => runReverse({ expression: 'M2·T5·ADD' })).toThrow();
    expect(() => runReverse({ expression: 'M2·(T3+T4' })).toThrow();
    expect(() => runReverse({ expression: 'M2·T3·FOO' })).toThrow();
  });
});

// ---------- 对拍与性质 ----------

describe('hardwired 与 cpu-cycles.json 信号栏的参照对拍', () => {
  it('信号表：名字和电位/脉冲与参照相同', () => {
    fc.assert(
      fc.property(opsArb, namesArb, (ops, names) => {
        const ref = refSignals(ops, names);
        const got = signals(ops, names);
        expect(sorted(got.map((s) => s.name))).toEqual(sorted(ref.keys()));
        for (const s of got) expect(s.kind).toBe(ref.get(s.name)?.kind);
      }),
      { numRuns: 120 },
    );
  });

  it('性质 1：任意指令子集、每个信号，表达式文字与参照相同', () => {
    fc.assert(
      fc.property(opsArb, namesArb, (ops, names) => {
        for (const [name, sig] of refSignals(ops, names)) {
          expect(expression(name, ops, names).text, `${name} @ ${ops.join(',')} ${names}`).toBe(refExpression(sig, ops));
        }
      }),
      { numRuns: 120 },
    );
  });

  it('性质 2：推出的式子正好在流程图发这个信号的（指令·M·T）格子上为 1；去掉任一项就不一致', () => {
    fc.assert(
      fc.property(opsArb, namesArb, (ops, names) => {
        for (const [name, sig] of refSignals(ops, names)) {
          const text = expression(name, ops, names).text;
          expect(sorted(pointsOf(text, ops)), `${name}: ${text}`).toEqual(sorted(sig.points));
          const terms = topTerms(text);
          if (terms.length > 1) {
            terms.forEach((_, k) => {
              const less = terms.filter((__, j) => j !== k).join('+');
              expect(sorted(pointsOf(less, ops))).not.toEqual(sorted(sig.points));
            });
          }
        }
      }),
      { numRuns: 120 },
    );
  });

  it('性质 3：电位信号各项不含 T，脉冲信号各项都含 T', () => {
    fc.assert(
      fc.property(opsArb, namesArb, (ops, names) => {
        for (const [name, sig] of refSignals(ops, names)) {
          const e = expression(name, ops, names);
          expect(e.kind).toBe(sig.kind);
          for (const term of topTerms(e.text)) {
            if (sig.kind === '电位') expect(term).not.toMatch(/T[1-4]/);
            else expect(term).toMatch(/T[1-4]/);
          }
        }
      }),
      { numRuns: 80 },
    );
  });

  it('性质 4：run 的 validateTrace 为空、同参数同 Trace、最后问的答案就是表达式', () => {
    fc.assert(
      fc.property(opsArb, namesArb, fc.nat(), (ops, names, pick) => {
        const all = [...refSignals(ops, names).keys()];
        const signal = all[pick % all.length]!;
        const t = run({ signal, instructions: ops, names });
        expect(validateTrace(t)).toEqual([]);
        expect(run({ signal, instructions: ops, names })).toEqual(t);
        const want = expression(signal, ops, names).text;
        expect(Object.values(t.result).some((v) => v === want || v.endsWith(`=${want}`))).toBe(true);
      }),
      { numRuns: 80 },
    );
    for (let seed = 1; seed <= 20; seed++) expect(validateTrace(run(generate(seed)))).toEqual([]);
  });

  it('反查：随机拼的式子，有效节拍、漏掉、多出与参照的集合差相同', () => {
    const cells: string[] = [];
    for (let m = 1; m <= 3; m++) for (let t = 0; t <= 4; t++) cells.push(t === 0 ? `M${m}` : `M${m}·T${t}`);
    fc.assert(
      fc.property(
        opsArb,
        namesArb,
        fc.nat(),
        fc.array(fc.record({ cell: fc.constantFrom(...cells), opMask: fc.nat() }), { minLength: 1, maxLength: 4 }),
        (ops, names, pick, raw) => {
          const all = [...refSignals(ops, names).entries()];
          const [signal, sig] = all[pick % all.length]!;
          const terms = raw.map(({ cell: c, opMask }) => {
            const chosen = ops.filter((_, i) => (opMask >> i) & 1);
            if (chosen.length === 0 || chosen.length === ops.length) return c;
            return chosen.length === 1 ? `${c}·${chosen[0]}` : `${c}·(${chosen.join('+')})`;
          });
          const text = terms.join('+');
          const got = pointsOf(text, ops);
          const t = runReverse({ expression: text, signal, instructions: ops, names });
          expect(validateTrace(t)).toEqual([]);
          const s = t.steps[t.steps.length - 1]!.state;
          expect(sorted(s.missing ?? [])).toEqual(sorted([...sig.points].filter((p) => !got.has(p))));
          expect(sorted(s.extra ?? [])).toEqual(sorted([...got].filter((p) => !sig.points.has(p))));
          expect(sorted(new Set(s.matches.flat()))).toEqual(sorted(got));
          expect(t.result['有效节拍数']).toBe(String(got.size));
        },
      ),
      { numRuns: 150 },
    );
  });
});

// ---------- 方框图（specs/5-flow.md） ----------

const REGS = ['R0', 'R1', 'R2', 'R3'] as const;
const insArb: fc.Arbitrary<Instruction> = fc
  .record({ op: fc.constantFrom(...ALL_OPS), x: fc.constantFrom(...REGS), y: fc.constantFrom(...REGS), addr: fc.nat({ max: 255 }) })
  .map(({ op, x, y, addr }): Instruction => {
    if (op === 'LAD') return { op, rx: x, addr };
    if (op === 'JMP') return { op, addr };
    return { op, rx: x, ry: y } as Instruction;
  });

function refBoxes(ins: Instruction, names: SignalNames): { level: string[]; pulse: string[] }[] {
  const x = 'rx' in ins ? ins.rx : '';
  const y = 'ry' in ins ? ins.ry : '';
  return cyclesOf(ins.op).map((micros) => {
    const level: string[] = [];
    const pulse: string[] = [];
    for (const mic of micros) {
      for (const raw of mic[names]) {
        if (raw.startsWith('（')) continue;
        const s = raw.replace(/\{x\}/g, x).replace(/\{y\}/g, y);
        const list = /\(T[1-4]\)$/.test(s) ? pulse : level;
        if (!list.includes(s)) list.push(s);
      }
    }
    return { level, pulse };
  });
}

describe('flow 方框图（5-flow）', () => {
  it('场景：LAD R0,9 三个方框的信号（p161–162 图 5.15、例 5.3）', () => {
    const t = runFlow({ instructions: [{ op: 'LAD', rx: 'R0', addr: 9 }] });
    expect(validateTrace(t)).toEqual([]);
    const b = t.steps[t.steps.length - 1]!.state.boxes;
    expect(b.map((x) => ({ level: x.level, pulse: x.pulse }))).toEqual([
      { level: ['RD(I)'], pulse: ['LDIR(T3)', 'PC+1(T4)', 'LDPC(T4)'] },
      { level: ['C3'], pulse: ['LDAR(T4)'] },
      { level: ['RD(D)'], pulse: ['LDDR(T3)', 'LDR0(T4)'] },
    ]);
  });

  it('场景：JMP 37 两个方框，第二个是 C3 与 LDPC(T4)；解析书名字的取指方框是 IR/W̄=1，SIR(T3)、PC+1(T4)', () => {
    const t = runFlow({ instructions: [{ op: 'JMP', addr: 37 }] });
    const b = t.steps[t.steps.length - 1]!.state.boxes;
    expect(b.length).toBe(2);
    expect(b[1]!.level).toEqual(['C3']);
    expect(b[1]!.pulse).toEqual(['LDPC(T4)']);
    const s = runFlow({ instructions: [{ op: 'JMP', addr: 37 }], names: 'solutions' });
    const f = s.steps[s.steps.length - 1]!.state.boxes[0];
    expect(f!.level).toEqual(['IR/W̄=1']);
    expect(sorted(f!.pulse)).toEqual(sorted(['SIR(T3)', 'PC+1(T4)']));
  });

  it('性质 1–3：方框数 = CPU 周期数、每条以「～」结束、脉冲都带 (T1)–(T4)、电位都不带；信号与参照相同', () => {
    fc.assert(
      fc.property(fc.array(insArb, { minLength: 1, maxLength: 7 }), namesArb, (list, names) => {
        const t = runFlow({ instructions: list, names });
        expect(validateTrace(t)).toEqual([]);
        expect(runFlow({ instructions: list, names })).toEqual(t);
        const last = t.steps[t.steps.length - 1]!.state;
        list.forEach((ins, i) => {
          const mine = last.boxes.filter((b) => b.ins === i);
          const ref = refBoxes(ins, names);
          expect(mine.length).toBe(ref.length);
          mine.forEach((b, k) => {
            expect(b.m).toBe(k + 1);
            for (const p of b.pulse) expect(p).toMatch(/\(T[1-4]\)$/);
            for (const l of b.level) expect(l).not.toMatch(/\(T[1-4]\)$/);
            expect(sorted(b.level)).toEqual(sorted(ref[k]!.level));
            expect(sorted(b.pulse)).toEqual(sorted(ref[k]!.pulse));
          });
        });
        expect(sorted(last.ended.map(String))).toEqual(sorted(list.map((_, i) => String(i))));
        expect(sorted(last.decoded.map(String))).toEqual(sorted(list.map((_, i) => String(i))));
        expect(t.steps.filter((s) => s.level === 'cycle').length).toBe(last.boxes.length);
        // 要求 7：解题表一个方框一行，指回该方框的 cycle 步
        expect(t.table.rows.length).toBe(last.boxes.length);
        const cycleIds = new Set(t.steps.filter((s) => s.level === 'cycle').map((s) => s.id));
        for (const row of t.table.rows) expect(cycleIds.has(row.step ?? '')).toBe(true);
        // 要求 5：每条指令一步译码菱形、一步「～」，都是 explain
        expect(t.steps.filter((s) => s.level === 'explain').length).toBeGreaterThanOrEqual(2 * list.length);
        // 要求 9：问第一个脉冲在哪一拍（选项里有「整个周期」）、第一条一共几个方框
        const asks = t.steps.flatMap((s) => (s.ask ? [s.ask] : []));
        expect(asks.some((a) => a.kind === 'choice' && (a.options ?? []).includes('整个周期'))).toBe(true);
        expect(asks.some((a) => a.answer === String(refBoxes(list[0]!, names).length))).toBe(true);
      }),
      { numRuns: 120 },
    );
  });

  it('样例五条的方框数 2、3、2、3、2 的类型；空指令表抛错', () => {
    const t = runFlow(sampleFlow());
    expect(validateTrace(t)).toEqual([]);
    expect(() => runFlow({ instructions: [] })).toThrow();
    expect(() => runFlow({ instructions: new Array(8).fill({ op: 'JMP', addr: 1 }) })).toThrow();
  });
});
