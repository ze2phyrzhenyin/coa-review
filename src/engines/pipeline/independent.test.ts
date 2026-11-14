import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { runSpacetime, spacetimeFigures, generateSpacetime, type SpacetimeParams } from './spacetime';
import { hazards, runHazard, generateHazard } from './hazard';
import { runStall, schedule, generateStall, type StallParams } from './stall';

// ---------- 朴素参照：只按 specs/5-spacetime.md、5-hazard.md、5-stall.md 和 docs/textbook/ch04-05.md「流水线」写 ----------

// ===== 时空图：逐周期挪动 =====

function refGrid(k: number, n: number): (number | null)[][] {
  // 第 i 条（1 起）在第 t 个周期处在第 t−i+1 段（规格 5-spacetime 要求 4）。逐周期往后挪一格。
  const where = new Array<number>(n + 1).fill(0); // 0 还没进，1..k 在第几段，k+1 已离开
  const grid: (number | null)[][] = Array.from({ length: k }, () => []);
  for (let t = 1; where[n] !== k; t++) {
    for (let i = 1; i <= n; i++) if (where[i]! >= 1 && where[i]! <= k) where[i]!++;
    if (t <= n) where[t] = 1;
    for (let s = 0; s < k; s++) grid[s]!.push(null);
    for (let i = 1; i <= n; i++) if (where[i]! >= 1 && where[i]! <= k) grid[where[i]! - 1]![t - 1] = i;
  }
  return grid;
}

function refFigures(p: SpacetimeParams) {
  const k = p.k;
  const n = p.n;
  const clock = p.dt ?? Math.max(...(p.stageTimes as number[])) + (p.latch ?? 0);
  const Tk = k + (n - 1);
  const serial = p.dt !== undefined ? n * k * p.dt : n * (p.stageTimes as number[]).reduce((a, b) => a + b, 0);
  const pipe = Tk * clock;
  return {
    clock,
    Tk,
    serialTime: serial,
    pipeTime: pipe,
    speedup: serial / pipe,
    throughputMips: (n / pipe) * 1000,
    maxMips: 1000 / clock,
    steadySpeedup: p.dt !== undefined ? null : (p.stageTimes as number[]).reduce((a, b) => a + b, 0) / clock,
  };
}

const spacetimeArb: fc.Arbitrary<SpacetimeParams> = fc
  .record({
    k: fc.integer({ min: 2, max: 8 }),
    n: fc.integer({ min: 1, max: 24 }),
    useDt: fc.boolean(),
    dt: fc.integer({ min: 1, max: 500 }),
    times: fc.array(fc.integer({ min: 10, max: 200 }), { minLength: 8, maxLength: 8 }),
    latch: fc.integer({ min: 0, max: 20 }),
    layout: fc.constantFrom<'段为行' | '指令为行'>('段为行', '指令为行'),
  })
  .map(({ k, n, useDt, dt, times, latch, layout }) =>
    useDt ? { k, n, dt, layout } : { k, n, stageTimes: times.slice(0, k), latch, layout },
  );

describe('spacetime 教材例题（手算）', () => {
  it('习题 13（p202）：k=5、n=8、Δt=100 ns → Tk=5+7=12，Ck=40/12≈3.33，Tp=8/(12×100 ns)≈6.67 MIPS', () => {
    const f = spacetimeFigures({ k: 5, n: 8, dt: 100 });
    expect(f.Tk).toBe(12);
    expect(f.speedup).toBeCloseTo(40 / 12, 6);
    expect(f.throughputMips).toBeCloseTo(6.6667, 3);
    const t = runSpacetime({ k: 5, n: 8, dt: 100 });
    expect(validateTrace(t)).toEqual([]);
    expect(t.steps[t.steps.length - 1]!.state.figures.Ck).toBe('40/12 ≈ 3.33');
  });

  it('例 5.4（p186–187）：70/60/90/80 ns、τl=10 ns → τ=90+10=100 ns，单个任务加速比 300/100=3', () => {
    const f = spacetimeFigures({ k: 4, n: 1, stageTimes: [70, 60, 90, 80], latch: 10 });
    expect(f.clock).toBe(100);
    expect(f.steadySpeedup).toBe(3);
  });

  it('k=3、n=5 的七个周期：填充、填充、稳定、稳定、稳定、排空、排空（图 5.35）', () => {
    const t = runSpacetime({ k: 3, n: 5, dt: 10 });
    const phases = t.steps.filter((s) => s.level === 'cycle').map((s) => s.state.phase);
    expect(phases).toEqual(['填充', '填充', '稳定', '稳定', '稳定', '排空', '排空']);
  });

  it('同时给 dt 和 stageTimes：抛错', () => {
    expect(() => runSpacetime({ k: 4, n: 3, dt: 10, stageTimes: [1, 2, 3, 4] })).toThrow();
    expect(() => runSpacetime({ k: 4, n: 3 })).toThrow();
  });
});

describe('spacetime 对拍与性质', () => {
  it('性质 1、2：Tk=k+n−1；每一格与逐周期挪动的参照相同；每条在每段恰好一次；最后 done=n', () => {
    fc.assert(
      fc.property(spacetimeArb, (p) => {
        const t = runSpacetime(p);
        const last = t.steps[t.steps.length - 1]!.state;
        const ref = refGrid(p.k, p.n);
        expect(ref[0]!.length).toBe(p.k + p.n - 1);
        expect(last.grid).toEqual(ref);
        expect(last.done).toBe(p.n);
        expect(t.steps.filter((s) => s.level === 'cycle').length).toBe(p.k + p.n - 1);
        for (let s = 0; s < p.k; s++) {
          const seen = last.grid[s]!.filter((x) => x !== null).sort((a, b) => (a as number) - (b as number));
          expect(seen).toEqual(Array.from({ length: p.n }, (_, i) => i + 1));
        }
        // 每个周期结束时完成的条数
        t.steps
          .filter((s) => s.level === 'cycle')
          .forEach((s, idx) => expect(s.state.done).toBe(Math.max(0, Math.min(p.n, idx + 1 - p.k + 1))));
      }),
      { numRuns: 150 },
    );
  });

  it('指标与参照一致：时钟周期、Tk、非流水和流水用时、Ck、Tp、最大吞吐率、单个任务加速比', () => {
    fc.assert(
      fc.property(spacetimeArb, (p) => {
        const f = spacetimeFigures(p);
        const r = refFigures(p);
        expect(f.clock).toBeCloseTo(r.clock, 9);
        expect(f.Tk).toBe(r.Tk);
        expect(f.serialTime).toBeCloseTo(r.serialTime, 6);
        expect(f.pipeTime).toBeCloseTo(r.pipeTime, 6);
        expect(f.speedup).toBeCloseTo(r.speedup, 6);
        expect(f.throughputMips).toBeCloseTo(r.throughputMips, 6);
        expect(f.maxMips).toBeCloseTo(r.maxMips, 6);
        if (r.steadySpeedup === null) expect(f.steadySpeedup).toBeNull();
        else expect(f.steadySpeedup).toBeCloseTo(r.steadySpeedup, 6);
      }),
      { numRuns: 300 },
    );
  });

  it('性质 3：等长时 Ck<k（n=1 时 Ck=1），n 增大 Ck 严格增大', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 1, max: 23 }), fc.integer({ min: 1, max: 300 }), (k, n, dt) => {
        const a = spacetimeFigures({ k, n, dt }).speedup;
        const b = spacetimeFigures({ k, n: n + 1, dt }).speedup;
        expect(a).toBeLessThan(k);
        expect(b).toBeGreaterThan(a);
        if (n === 1) expect(a).toBeCloseTo(1, 9);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 4：validateTrace 为空；同参数同 Trace；阶段划分（n≥k 时）；generate 能跑', () => {
    fc.assert(
      fc.property(spacetimeArb, (p) => {
        const t = runSpacetime(p);
        expect(validateTrace(t)).toEqual([]);
        expect(runSpacetime(p)).toEqual(t);
        if (p.n >= p.k) {
          const phases = t.steps.filter((s) => s.level === 'cycle').map((s) => s.state.phase);
          phases.forEach((ph, i) => {
            const c = i + 1;
            expect(ph).toBe(c < p.k ? '填充' : c <= p.n ? '稳定' : '排空');
          });
        }
      }),
      { numRuns: 100 },
    );
    for (let seed = 1; seed <= 30; seed++) expect(validateTrace(runSpacetime(generateSpacetime(seed)))).toEqual([]);
  });
});

// ===== 相关判别 =====

interface RefIns {
  text: string;
  op: string;
  reads: string[];
  writes: string[];
}

/** 5.6 节写法：三地址目标在前；两地址结果回第一个；LAD R,A 读 M(A)；STO M(x),R 写 M(x)。 */
function parseIns(text: string): RefIns {
  const [op0, rest] = text.split(/\s+/, 2);
  const op = op0!;
  const args = rest!.split(',') as [string, string, string];
  const mem = (a: string): string => (/^M\(.+\)$/.test(a) ? a : `M(${a})`);
  if (op === 'LAD') return { text, op, reads: [mem(args[1])], writes: [args[0]] };
  if (op === 'STO') return { text, op, reads: [args[1]], writes: [mem(args[0])] };
  if (args.length === 3) return { text, op, reads: [...new Set([args[1], args[2]])], writes: [args[0]] };
  return { text, op, reads: [...new Set([args[0], args[1]])], writes: [args[0]] };
}

const isReg = (x: string): boolean => /^R\d+$/.test(x);
const inter = (a: string[], b: string[]): string[] => a.filter((x) => b.includes(x)).sort();

function refHazards(list: string[]) {
  const ins = list.map(parseIns);
  const out: { i: number; j: number; raw: string[]; war: string[]; waw: string[]; wrong: boolean }[] = [];
  for (let j = 0; j < ins.length; j++) {
    for (let i = 0; i < j; i++) {
      const raw = inter(ins[j]!.reads, ins[i]!.writes);
      const war = inter(ins[j]!.writes, ins[i]!.reads);
      const waw = inter(ins[j]!.writes, ins[i]!.writes);
      // 逐拍：五段按序、不停，第 i 条（1 起）第 i+4 拍写回，第 j 条第 j+1 拍读；写回的下一拍才读得到。
      let wrong = false;
      for (const r of raw.filter(isReg)) {
        let latest = -1;
        for (let k = 0; k < j; k++) if (ins[k]!.writes.includes(r)) latest = k;
        if (latest !== i) continue;
        const writeAt = i + 1 + 4;
        const readAt = j + 1 + 1;
        if (readAt <= writeAt) wrong = true;
      }
      out.push({ i: i + 1, j: j + 1, raw, war, waw, wrong });
    }
  }
  return out.sort((a, b) => a.i - b.i || a.j - b.j);
}

const REG = fc.constantFrom('R1', 'R2', 'R3', 'R4', 'R5');
const textInsArb: fc.Arbitrary<string> = fc.oneof(
  fc.tuple(fc.constantFrom('ADD', 'SUB', 'MUL', 'AND'), REG, REG, REG).map(([o, a, b, c]) => `${o} ${a},${b},${c}`),
  fc.tuple(fc.constantFrom('ADD', 'MUL'), REG, REG).map(([o, a, b]) => `${o} ${a},${b}`),
  fc.tuple(REG, fc.constantFrom('A', 'B', 'x')).map(([r, m]) => `LAD ${r},${m}`),
  fc.tuple(fc.constantFrom('x', 'y', 'A'), REG).map(([m, r]) => `STO M(${m}),${r}`),
);

describe('hazard 教材例题（手算）', () => {
  it('例 5.6 三组（p191–192）：RAW 会读错；STO 后 ADD 是 WAR 不读错；MUL 后 ADD 是 WAW', () => {
    const a = hazards({ instructions: ['ADD R1,R2,R3', 'SUB R4,R1,R5'] });
    expect(a[0]!.kinds).toEqual(['RAW']);
    expect(a[0]!.wrong).toBe(true);
    const b = hazards({ instructions: ['STO M(x),R3', 'ADD R3,R4,R5'] });
    expect(b[0]!.kinds).toEqual(['WAR']);
    expect(b[0]!.wrong).toBe(false);
    const c = hazards({ instructions: ['MUL R3,R1,R2', 'ADD R3,R4,R5'] });
    expect(c[0]!.kinds).toEqual(['WAW']);
  });

  it('表 5.4（p190–191）：ADD 第 5 拍写 R1，SUB 第 3 拍、AND 第 4 拍读 → I1–I2、I1–I3 都读错', () => {
    const r = hazards({ instructions: ['ADD R1,R2,R3', 'SUB R4,R1,R5', 'AND R6,R1,R7'] });
    expect(r.filter((x) => x.wrong).map((x) => `${x.i}-${x.j}`)).toEqual(['1-2', '1-3']);
  });

  it('例 5.7（p192）两地址：LAD R6,B 后 MUL R6,R7 → RAW、WAW', () => {
    const r = hazards({ instructions: ['LAD R6,B', 'MUL R6,R7'] });
    expect(r[0]!.kinds).toEqual(['RAW', 'WAW']);
    expect(() => hazards({ instructions: ['FOO R1', 'ADD R1,R2,R3'] })).toThrow();
  });
});

describe('hazard 对拍与性质', () => {
  it('性质 1–3：每对的三个交集、类型、会读错与参照一致；对数 n(n−1)/2；WAR、WAW 不标读错', () => {
    fc.assert(
      fc.property(fc.array(textInsArb, { minLength: 2, maxLength: 6 }), (list) => {
        const got = hazards({ instructions: list }).slice().sort((a, b) => a.i - b.i || a.j - b.j);
        const ref = refHazards(list);
        expect(got.length).toBe((list.length * (list.length - 1)) / 2);
        got.forEach((g, k) => {
          const r = ref[k];
          expect([g.i, g.j]).toEqual([r!.i, r!.j]);
          expect([...g.raw].sort()).toEqual(r!.raw);
          expect([...g.war].sort()).toEqual(r!.war);
          expect([...g.waw].sort()).toEqual(r!.waw);
          const kinds = [r!.raw.length ? 'RAW' : '', r!.war.length ? 'WAR' : '', r!.waw.length ? 'WAW' : ''].filter(Boolean);
          expect(g.kinds).toEqual(kinds);
          expect(g.wrong, `${list.join(' ; ')} I${g.i}-I${g.j}`).toBe(r!.wrong);
          if (g.wrong) expect(g.raw.some(isReg)).toBe(true);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('性质 4：validateTrace 为空；同参数同 Trace；generate 能跑', () => {
    fc.assert(
      fc.property(fc.array(textInsArb, { minLength: 2, maxLength: 6 }), (list) => {
        const t = runHazard({ instructions: list });
        expect(validateTrace(t)).toEqual([]);
        expect(runHazard({ instructions: list })).toEqual(t);
      }),
      { numRuns: 100 },
    );
    for (let seed = 1; seed <= 30; seed++) expect(validateTrace(runHazard(generateHazard(seed)))).toEqual([]);
  });
});

// ===== 停顿 =====

interface RefTiming {
  enter: number[][];
  total: number;
  wrong: { ins: number; reg: string }[];
}

/** 逐条按约束排：按序、每段一条、读在最后一个 ID 周期、写回的下一周期才读得到（p202 习题 12、析15）。 */
function refSchedule(p: StallParams): RefTiming {
  const k = p.stages;
  const ins = (p.instructions as string[]).map(parseIns);
  const EX = 2;
  const MEM = 3;
  const WB = k - 1;
  const enter: number[][] = [];
  const memCycles: number[] = []; // LAD、STO 在 MEM 的周期
  const wrong: { ins: number; reg: string }[] = [];
  for (let j = 0; j < ins.length; j++) {
    const prev = enter[j - 1];
    const e: number[] = [];
    // IF：上一条离开 IF 才能进；单端口存储器时不能和 LAD/STO 的 MEM 同一周期。
    let f: number = j === 0 ? 1 : prev![1]!;
    if (p.sharedMemory && k === 5) while (memCycles.includes(f)) f++;
    e.push(f);
    for (let s = 1; s < k; s++) {
      let c = e[s - 1]! + 1;
      if (j > 0) c = Math.max(c, s < WB ? prev![s + 1]! : prev![s]! + 1);
      if (s === EX && p.mode !== '不处理') {
        for (const r of ins[j]!.reads.filter(isReg)) {
          let w = -1;
          for (let i = 0; i < j; i++) if (ins[i]!.writes.includes(r)) w = i;
          if (w < 0) continue;
          if (p.mode === '后推') c = Math.max(c, enter[w]![WB]! + 2);
          else {
            const produced = k === 5 && ins[w]!.op === 'LAD' ? enter[w]![MEM] : enter[w]![EX];
            c = Math.max(c, produced! + 1);
          }
        }
      }
      e.push(c);
    }
    if (p.mode === '不处理') {
      for (const r of ins[j]!.reads.filter(isReg)) {
        let w = -1;
        for (let i = 0; i < j; i++) if (ins[i]!.writes.includes(r)) w = i;
        if (w >= 0 && e[EX]! - 1 <= enter[w]![WB]!) wrong.push({ ins: j + 1, reg: r });
      }
    }
    if (k === 5 && (ins[j]!.op === 'LAD' || ins[j]!.op === 'STO')) memCycles.push(e[MEM]!);
    enter.push(e);
  }
  return { enter, total: enter[enter.length - 1]![WB]!, wrong };
}

const stallInsArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(fc.constantFrom('ADD', 'SUB', 'MUL', 'AND'), REG, REG, REG).map(([o, a, b, c]) => `${o} ${a},${b},${c}`) },
  { weight: 2, arbitrary: fc.tuple(REG, fc.constantFrom('x', 'y')).map(([r, m]) => `LAD ${r},M(${m})`) },
  { weight: 1, arbitrary: fc.tuple(fc.constantFrom('x', 'y'), REG).map(([m, r]) => `STO M(${m}),${r}`) },
);
const stallArb: fc.Arbitrary<StallParams> = fc
  .record({
    stages: fc.constantFrom<4 | 5>(4, 5),
    instructions: fc.array(stallInsArb, { minLength: 1, maxLength: 8 }),
    mode: fc.constantFrom<StallParams['mode']>('不处理', '后推', '定向'),
    shared: fc.boolean(),
  })
  .map(({ stages, instructions, mode, shared }) => ({ stages, instructions, mode, sharedMemory: shared && stages === 5 }));

const xi15 = ['SUB R2,R1,R3', 'ADD R12,R2,R5', 'OR R13,R6,R2', 'AND R14,R5,R2', 'ADD R15,R3,R2'];

describe('stall 教材例题（手算）', () => {
  it('析15（解析书 p82–83，表 5.4(b)）五段后推：SUB 第 5 拍写回，ADD 的 ID 排到第 6 拍，共 12 个周期', () => {
    const s = schedule({ stages: 5, mode: '后推', instructions: xi15 });
    expect(s.total).toBe(12);
    expect(s.enter[1]).toEqual([2, 3, 7, 8, 9]);
    expect(s.enter[4]![4]).toBe(12);
  });

  it('析15 不处理：9 个周期，I2、I3、I4 读错 R2（I2 第 3、I3 第 4、I4 第 5 拍读，都不晚于第 5 拍写回）', () => {
    const s = schedule({ stages: 5, mode: '不处理', instructions: xi15 });
    expect(s.total).toBe(9);
    expect(s.wrongReads.map((w) => `${w.ins}${w.reg}`).sort()).toEqual(['2R2', '3R2', '4R2']);
  });

  it('习题 12（p202）四段相邻 RAW：后推 7 个周期（停 2 拍），定向 5 个周期', () => {
    expect(schedule({ stages: 4, mode: '后推', instructions: ['ADD R1,R2,R3', 'SUB R4,R1,R5'] }).total).toBe(7);
    expect(schedule({ stages: 4, mode: '定向', instructions: ['ADD R1,R2,R3', 'SUB R4,R1,R5'] }).total).toBe(5);
  });

  it('五段 LAD R1,M(y) 后紧跟 ADD R2,R1,R3、定向：7 个周期；表 5.3 单端口存储器：I4 第 5 拍才取指', () => {
    expect(schedule({ stages: 5, mode: '定向', instructions: ['LAD R1,M(y)', 'ADD R2,R1,R3'] }).total).toBe(7);
    const s = schedule({ stages: 5, mode: '后推', sharedMemory: true, instructions: ['LAD R1,M(x)', 'ADD R5,R6,R7', 'SUB R8,R9,R10', 'AND R11,R12,R13'] });
    expect(s.enter[3]![0]).toBe(5);
  });
});

describe('stall 对拍与性质', () => {
  it('性质 1：各指令进入各段的周期、总周期、读错与逐拍参照一致', () => {
    fc.assert(
      fc.property(stallArb, (p) => {
        const r = refSchedule(p);
        const s = schedule(p);
        expect(s.enter, `${p.stages} ${p.mode} ${p.sharedMemory} ${p.instructions.join(' ; ')}`).toEqual(r.enter);
        expect(s.total).toBe(r.total);
        expect(s.ideal).toBe(p.stages + p.instructions.length - 1);
        if (p.mode === '不处理') expect(s.wrongReads.map((w) => `${w.ins}:${w.reg}`).sort()).toEqual(r.wrong.map((w) => `${w.ins}:${w.reg}`).sort());
        else expect(s.wrongReads).toEqual([]);
      }),
      { numRuns: 400 },
    );
  });

  it('性质 2：不争用存储器时 不处理 = k+n−1 ≤ 定向 ≤ 后推', () => {
    fc.assert(
      fc.property(stallArb, (p0) => {
        const p = { ...p0, sharedMemory: false };
        const none = schedule({ ...p, mode: '不处理' }).total;
        const fwd = schedule({ ...p, mode: '定向' }).total;
        const back = schedule({ ...p, mode: '后推' }).total;
        expect(none).toBe(p.stages + p.instructions.length - 1);
        expect(none).toBeLessThanOrEqual(fwd);
        expect(fwd).toBeLessThanOrEqual(back);
      }),
      { numRuns: 300 },
    );
  });

  it('性质 3、4：后推时读寄存器的周期总在最近一次写回之后；按序进每一段；每段每周期至多一条；停顿不为负', () => {
    fc.assert(
      fc.property(stallArb, (p) => {
        const s = schedule(p);
        const ins = p.instructions.map((x) => parseIns(x as string));
        const k = p.stages;
        s.enter.forEach((e, j) => {
          for (let st = 1; st < k; st++) expect(e[st]).toBeGreaterThan(e[st - 1]!);
          if (j > 0) for (let st = 0; st < k; st++) expect(e[st]).toBeGreaterThan(s.enter[j - 1]![st]!);
          // 占用区间 [进入, 进入下一段−1] 互不重叠
          if (j > 0) for (let st = 0; st < k - 1; st++) expect(e[st]).toBeGreaterThanOrEqual(s.enter[j - 1]![st + 1]!);
          if (p.mode === '后推') {
            for (const r of ins[j]!.reads.filter(isReg)) {
              let w = -1;
              for (let i = 0; i < j; i++) if (ins[i]!.writes.includes(r)) w = i;
              if (w >= 0) expect(e[2]! - 1).toBeGreaterThan(s.enter[w]![k - 1]!);
            }
          }
        });
        expect(s.total).toBeGreaterThanOrEqual(s.ideal);
      }),
      { numRuns: 300 },
    );
  });

  it('Trace：validateTrace 为空、同参数同 Trace、周期步数 = 总周期、表格每行一条指令；generate 能跑', () => {
    fc.assert(
      fc.property(stallArb, (p) => {
        const t = runStall(p);
        expect(validateTrace(t)).toEqual([]);
        expect(runStall(p)).toEqual(t);
        expect(t.steps.filter((x) => x.level === 'cycle').length).toBe(schedule(p).total);
        expect(t.table.rows.length).toBe(p.instructions.length);
      }),
      { numRuns: 100 },
    );
    for (let seed = 1; seed <= 30; seed++) expect(validateTrace(runStall(generateStall(seed)))).toEqual([]);
  });
});
