import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import type { Instruction, Op } from '../cpu/model';
import {
  ALL_OPS,
  BOOK_OPS,
  equivalent,
  expression,
  generate,
  parseExpression,
  pointsOfExpression,
  pointsOfSignal,
  run,
  runReverse,
  signals,
} from './model';
import { runFlow, sampleFlow } from './flow';

const load = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../../evals/golden/${name}`, import.meta.url), 'utf8')) as T;

// ---------- 朴素参照：直接读 evals/golden/cpu-cycles.json 的教材信号栏，不经过 cpu 引擎 ----------

interface CyclesGolden {
  fetch: { micros: { beat: string; book: string[] }[] };
  execute: Record<string, { cycles: { micros: { beat: string; book: string[] }[] }[] }>;
}
const cpuGolden = load<CyclesGolden>('cpu-cycles.json');

function refExpression(signal: string, ops: readonly Op[]): string {
  const hits = new Map<string, Set<Op>>();
  for (const op of ops) {
    const cycles = [cpuGolden.fetch, ...cpuGolden.execute[op]!.cycles];
    cycles.forEach((c, k) => {
      for (const micro of c.micros) {
        for (const cell of micro.book) {
          if (cell.startsWith('（')) continue;
          const name = cell.replace('{x}', 'Rx').replace('{y}', 'Ry');
          const pulse = /^(.*)\((T\d)\)$/.exec(name);
          const sig = pulse ? pulse[1]! : name;
          if (sig !== signal) continue;
          const key = pulse ? `${k + 1}|${pulse[2]!.slice(1)}` : `${k + 1}|`;
          if (!hits.has(key)) hits.set(key, new Set());
          hits.get(key)!.add(op);
        }
      }
    });
  }
  return [...hits.keys()]
    .sort()
    .map((key) => {
      const [m, t] = key.split('|');
      const who = ops.filter((op) => hits.get(key)!.has(op));
      const parts = [`M${m!}`];
      if (t) parts.push(`T${t}`);
      if (who.length !== ops.length) parts.push(who.length === 1 ? who[0]! : `(${who.join('+')})`);
      return parts.join('·');
    })
    .join('+');
}

const opSet = fc.subarray([...ALL_OPS], { minLength: 1 });

describe('硬布线：性质', () => {
  it('每个信号的表达式与直接读 cpu-cycles.json 的参照相同', () => {
    fc.assert(
      fc.property(opSet, (ops) => {
        for (const s of signals(ops, 'book')) expect(expression(s.name, ops).text).toBe(refExpression(s.name, ops));
      }),
      { numRuns: 60 },
    );
  });

  it('推出的式子反过来求值，有效节拍正好是流程图上发这个信号的节拍', () => {
    fc.assert(
      fc.property(opSet, fc.constantFrom<'book' | 'solutions'>('book', 'solutions'), (ops, names) => {
        for (const s of signals(ops, names)) {
          const ex = expression(s.name, ops, names);
          expect(pointsOfExpression(ex.text, ops)).toEqual(pointsOfSignal(s.name, ops, names));
          if (s.kind === '电位') expect(ex.terms.every((t) => t.t === null)).toBe(true);
          else expect(ex.terms.every((t) => t.t !== null)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('Trace 合格、可重现；反查自己推出的式子判为一致，去掉任一项判为不一致', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const p = generate(seed);
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(JSON.stringify(run(p))).toBe(JSON.stringify(t));
        const ex = expression(p.signal, p.instructions);
        const back = runReverse({ expression: ex.text, signal: p.signal, instructions: p.instructions! });
        expect(validateTrace(back)).toEqual([]);
        expect(back.result['一致']).toBe('是');
        if (ex.terms.length > 1) {
          const fewer = ex.terms.slice(1).map((x) => x.text).join('+');
          expect(runReverse({ expression: fewer, signal: p.signal, instructions: p.instructions! }).result['一致']).toBe('否');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('与对或可分配；与、或的写法 · * × 等价', () => {
    expect(equivalent('M2·T4·(LAD+STO)', 'M2·T4·LAD+M2·T4·STO')).toBe(true);
    expect(equivalent('M2*T4*(LAD+STO)', 'M2×T4×(STO+LAD)')).toBe(true);
    expect(equivalent('M1', 'M1·T1+M1·T2+M1·T3+M1·T4')).toBe(true);
    expect(equivalent('M3·LAD', 'M3')).toBe(false);
  });

  it('看不懂的表达式和参数抛出错误', () => {
    expect(() => parseExpression('M2·(LAD+STO')).toThrow(/括号/);
    expect(() => parseExpression('M4·LAD')).toThrow(/不认识/);
    expect(() => parseExpression('M2··LAD')).toThrow();
    expect(() => run({ signal: 'WE(D)', instructions: ['MOV', 'ADD'] })).toThrow(/没有信号/);
    expect(() => run({ signal: 'LDDR', instructions: [] })).toThrow(/不能为空/);
    expect(() => run({ signal: 'LDDR', instructions: ['MOV', 'MOV'] })).toThrow(/重复/);
  });

  it('同步控制下两周期指令也走 M3（空过），式子在那里为 1 就算多发', () => {
    expect(runReverse({ expression: 'M3·MOV' }).result['有效节拍数']).toBe('4');
    const t = runReverse({ expression: 'M2·T3·(MOV+ADD)+M3·T3', signal: 'LDDR' });
    expect(validateTrace(t)).toEqual([]);
    expect(t.result['有效节拍数']).toBe('7');
    expect(t.result['多出']).toBe('ADD·M3·T3、JMP·M3·T3、MOV·M3·T3、STO·M3·T3');
    expect(t.result['漏掉']).toBe('无');
  });
});

describe('方框图', () => {
  it('每条指令的方框数等于 CPU 周期数；Trace 合格；可重现', () => {
    const ops: Op[] = [...ALL_OPS];
    const instructions: Instruction[] = ops.map((op) =>
      op === 'LAD' ? { op, rx: 'R2', addr: 40 } : op === 'JMP' ? { op, addr: 3 } : ({ op, rx: 'R3', ry: 'R2' } as Instruction),
    );
    const t = runFlow({ instructions });
    expect(validateTrace(t)).toEqual([]);
    expect(JSON.stringify(runFlow({ instructions }))).toBe(JSON.stringify(t));
    const last = t.steps.at(-1)!.state;
    const perIns = instructions.map((_, i) => last.boxes.filter((b) => b.ins === i).length);
    expect(perIns).toEqual([2, 2, 3, 2, 2, 3, 2]);
    expect(last.ended).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(validateTrace(runFlow({ ...sampleFlow(), names: 'solutions' }))).toEqual([]);
  });

  it('脉冲信号都带节拍，电位信号都不带', () => {
    const last = runFlow(sampleFlow()).steps.at(-1)!.state;
    for (const b of last.boxes) {
      for (const p of b.pulse) expect(p).toMatch(/\(T[1-4]\)$/);
      for (const l of b.level) expect(l).not.toMatch(/\(T[1-4]\)$/);
    }
  });

  it('非法参数抛出错误', () => {
    expect(() => runFlow({ instructions: [] })).toThrow(/1 到/);
  });
});

// ---------- 固定用例 ----------

interface Golden {
  derive: { signal: string; kind: string; expression: string }[];
  reverse: { name: string; expression: string; signal: string; same: boolean; missing?: string; extra?: string }[];
  flow: { instructions: Instruction[]; boxes: number[]; ladSignals: { level: string[]; pulse: string[] }[] };
}
const golden = load<Golden>('hardwired-cases.json');

describe('evals/golden/hardwired-cases.json：例 5.3', () => {
  for (const c of golden.derive) {
    it(`${c.signal}=${c.expression}`, () => {
      const t = run({ signal: c.signal });
      expect(validateTrace(t)).toEqual([]);
      expect(t.result['表达式']).toBe(`${c.signal}=${c.expression}`);
      expect(t.result['类型']).toBe(`${c.kind}信号`);
    });
  }
  for (const c of golden.reverse) {
    it(c.name, () => {
      const t = runReverse({ expression: c.expression, signal: c.signal });
      expect(validateTrace(t)).toEqual([]);
      expect(t.result['一致']).toBe(c.same ? '是' : '否');
      if (c.missing) expect(t.result['漏掉']).toBe(c.missing);
      if (c.extra) expect(t.result['多出']).toBe(c.extra);
    });
  }
  it('方框图：方框数与 LAD 各框的信号', () => {
    const last = runFlow({ instructions: golden.flow.instructions }).steps.at(-1)!.state;
    expect(golden.flow.instructions.map((_, i) => last.boxes.filter((b) => b.ins === i).length)).toEqual(golden.flow.boxes);
    expect(last.boxes.filter((b) => b.ins === 1).map((b) => ({ level: b.level, pulse: b.pulse }))).toEqual(golden.flow.ladSignals);
  });
  it('例 5.3 的指令集是五条', () => {
    expect([...BOOK_OPS]).toEqual(['MOV', 'LAD', 'ADD', 'STO', 'JMP']);
  });
});
