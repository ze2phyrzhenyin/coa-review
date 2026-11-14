import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { MODES, generateStall, runStall, schedule, type Mode, type StallParams } from './stall';

// ---------- 朴素参照：逐拍模拟，每段一个槽，从后往前挪 ----------

interface RefIns {
  text: string;
  r: string[];
  w: string[];
  load: boolean;
  mem: boolean;
}

function naive(k: 4 | 5, list: RefIns[], mode: Mode, shared: boolean): { enter: number[][]; total: number; wrong: string[] } {
  const EX = 2;
  const WB = k - 1;
  const gen = (x: RefIns): number => (k === 5 && x.load ? 3 : 2);
  const slot: (number | null)[] = Array.from({ length: k }, () => null);
  const enter: number[][] = list.map(() => []);
  let next = 0;
  let t = 0;
  const producer = (j: number, reg: string): number => {
    for (let i = j - 1; i >= 0; i -= 1) if (list[i]!.w.includes(reg)) return i;
    return -1;
  };
  const mayEnterEx = (j: number, cycle: number): boolean => {
    if (mode === '不处理') return true;
    for (const reg of list[j]!.r.filter((x) => /^R\d+$/.test(x))) {
      const i = producer(j, reg);
      if (i < 0) continue;
      if (mode === '后推') {
        // 上一拍（最后一个 ID 拍）读寄存器，必须在写回的下一拍或更晚。
        const wb = enter[i]![WB];
        if (wb === undefined || cycle - 1 < wb + 1) return false;
      } else {
        const g = enter[i]![gen(list[i]!)];
        if (g === undefined || g > cycle - 1) return false;
      }
    }
    return true;
  };
  while (enter.some((e) => e.length < k)) {
    t += 1;
    if (t > 500) throw new Error('参照跑不完');
    // 写回段的指令走掉。
    slot[WB] = null;
    for (let s = WB - 1; s >= 0; s -= 1) {
      const j = slot[s];
      if (j === null || j === undefined) continue;
      if (slot[s + 1] !== null) continue;
      if (s + 1 === EX && !mayEnterEx(j, t)) continue;
      slot[s + 1] = j;
      slot[s] = null;
      enter[j]![s + 1] = t;
    }
    if (next < list.length && slot[0] === null) {
      const memBusy = shared && slot[3] !== null && slot[3] !== undefined && list[slot[3]]!.mem && enter[slot[3]]![3] === t;
      if (!memBusy) {
        slot[0] = next;
        enter[next]![0] = t;
        next += 1;
      }
    }
  }
  const wrong: string[] = [];
  if (mode === '不处理') {
    list.forEach((x, j) => {
      const readAt = enter[j]![EX]! - 1;
      for (const reg of [...new Set(x.r)].filter((y) => /^R\d+$/.test(y))) {
        const i = producer(j, reg);
        if (i >= 0 && readAt <= enter[i]![WB]!) wrong.push(`I${j + 1}（${reg}）`);
      }
    });
  }
  return { enter, total: enter[list.length - 1]![WB]!, wrong };
}

const reg = fc.constantFrom('R1', 'R2', 'R3', 'R4');
const insArb: fc.Arbitrary<RefIns> = fc.oneof(
  fc.tuple(fc.constantFrom('ADD', 'SUB', 'AND', 'OR'), reg, reg, reg).map(([o, d, s, t]) => ({ text: `${o} ${d},${s},${t}`, r: [s, t], w: [d], load: false, mem: false })),
  fc.tuple(reg, fc.constantFrom('x', 'y')).map(([d, m]) => ({ text: `LAD ${d},M(${m})`, r: [`M(${m})`], w: [d], load: true, mem: true })),
  fc.tuple(fc.constantFrom('x', 'y'), reg).map(([m, s]) => ({ text: `STO M(${m}),${s}`, r: [s], w: [`M(${m})`], load: false, mem: true })),
);
const caseArb = fc.record({
  stages: fc.constantFrom(4 as const, 5 as const),
  list: fc.array(insArb, { minLength: 1, maxLength: 8 }),
  mode: fc.constantFrom(...MODES),
  shared: fc.boolean(),
});
const toParams = (c: { stages: 4 | 5; list: RefIns[]; mode: Mode; shared: boolean }): StallParams => ({
  stages: c.stages,
  instructions: c.list.map((x) => x.text),
  mode: c.mode,
  ...(c.shared && c.stages === 5 ? { sharedMemory: true } : {}),
});

describe('停顿：性质', () => {
  it('与逐拍模拟的参照逐条一致：进入各段的周期、总周期、读错', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const p = toParams(c);
        const got = schedule(p);
        const ref = naive(c.stages, c.list, c.mode, p.sharedMemory === true);
        expect(got.enter).toEqual(ref.enter);
        expect(got.total).toBe(ref.total);
        const t = runStall(p);
        if (c.mode === '不处理') expect(t.result['读错']).toBe(ref.wrong.length ? ref.wrong.join('、') : '无');
      }),
      { numRuns: 300 },
    );
  });

  it('Trace 合格、可重现；每个周期每段至多一条指令', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const p = toParams(c);
        const t = runStall(p);
        expect(validateTrace(t)).toEqual([]);
        expect(JSON.stringify(runStall(p))).toBe(JSON.stringify(t));
        for (let col = 1; col < t.table.columns.length; col += 1) {
          const working = t.table.rows.map((r) => r.cells[col]!).filter((x) => x && x !== '停');
          expect(new Set(working).size).toBe(working.length);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('后推 ≥ 定向 ≥ 不处理 = k+n−1（不争用存储器时）', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const base = { stages: c.stages, instructions: c.list.map((x) => x.text) };
        const none = schedule({ ...base, mode: '不处理' }).total;
        const fwd = schedule({ ...base, mode: '定向' }).total;
        const stall = schedule({ ...base, mode: '后推' }).total;
        expect(none).toBe(c.stages + c.list.length - 1);
        expect(fwd).toBeGreaterThanOrEqual(none);
        expect(stall).toBeGreaterThanOrEqual(fwd);
      }),
      { numRuns: 200 },
    );
  });

  it('后推时，读寄存器的那一拍总在写回之后；指令按序进入每一段', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const p = { ...toParams(c), mode: '后推' as const };
        const { enter } = schedule(p);
        const WB = c.stages - 1;
        c.list.forEach((x, j) => {
          for (let s = 0; s < c.stages; s += 1) if (j > 0) expect(enter[j]![s]!).toBeGreaterThan(enter[j - 1]![s]!);
          for (const r of x.r.filter((y) => /^R\d+$/.test(y))) {
            for (let i = j - 1; i >= 0; i -= 1) {
              if (!c.list[i]!.w.includes(r)) continue;
              expect(enter[j]![2]! - 1).toBeGreaterThan(enter[i]![WB]!);
              break;
            }
          }
        });
      }),
      { numRuns: 150 },
    );
  });

  it('四段定向从不停顿；没有寄存器相关时三种方式一样', () => {
    fc.assert(
      fc.property(fc.array(insArb, { minLength: 1, maxLength: 8 }), (list) => {
        expect(schedule({ stages: 4, instructions: list.map((x) => x.text), mode: '定向' }).total).toBe(4 + list.length - 1);
      }),
    );
    const independent = ['ADD R1,R2,R3', 'SUB R4,R5,R6', 'OR R7,R8,R9'];
    for (const mode of MODES) expect(schedule({ stages: 5, instructions: independent, mode }).total).toBe(7);
  });

  it('出题器给出的参数都能跑通', () => {
    for (let seed = 0; seed < 150; seed += 1) {
      const p = generateStall(seed);
      expect(validateTrace(runStall(p))).toEqual([]);
    }
  });

  it('只在第一次因数据而停的地方问停几拍，答案就是多待的周期数', () => {
    const t = runStall({ stages: 5, mode: '后推', instructions: ['ADD R1,R2,R3', 'SUB R4,R1,R5'] });
    const asks = t.steps.filter((s) => s.ask && s.level === 'cycle');
    expect(asks.length).toBe(1);
    expect(asks[0]!.ask!.answer).toBe('3');
    expect(t.result['用时']).toBeUndefined();
    expect(runStall({ stages: 4, mode: '后推', instructions: ['ADD R1,R2,R3'], dt: 50 }).result['用时']).toBe('200 ns');
  });

  it('非法参数抛出错误', () => {
    expect(() => runStall({ stages: 6 as 5, mode: '后推', instructions: ['ADD R1,R2,R3'] })).toThrow(/4 或 5/);
    expect(() => runStall({ stages: 4, mode: '后推', instructions: [] })).toThrow(/1 到/);
    expect(() => runStall({ stages: 4, mode: '后推', instructions: ['ADD R1,R2,R3'], sharedMemory: true })).toThrow(/MEM/);
    expect(() => runStall({ stages: 5, mode: '等' as Mode, instructions: ['ADD R1,R2,R3'] })).toThrow(/处理方式/);
  });
});

// ---------- 固定用例 ----------

interface Golden {
  cases: { name: string; params: StallParams; expect: { total: number; table?: string[][]; wrong?: string; fetch?: number[] } }[];
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/pipeline-stall.json', import.meta.url), 'utf8')) as Golden;

describe('evals/golden/pipeline-stall.json', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const t = runStall(c.params);
      expect(validateTrace(t)).toEqual([]);
      expect(t.result['总周期数']).toBe(String(c.expect.total));
      if (c.expect.table) expect(t.table.rows.map((r) => r.cells)).toEqual(c.expect.table);
      if (c.expect.wrong) expect(t.result['读错']).toBe(c.expect.wrong);
      if (c.expect.fetch) expect(schedule(c.params).enter.map((e) => e[0])).toEqual(c.expect.fetch);
    });
  }
});
