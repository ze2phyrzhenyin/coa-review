import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { flatten, validateTrace, type Step, type Trace } from '../trace';
import {
  CYCLES,
  GENERAL_REGISTERS,
  LIMIT_DEFAULT,
  OPS,
  PART_LABEL,
  checkParams,
  checkTransfer,
  flow,
  format,
  meaning,
  run,
  sampleParams,
  type GeneralRegister,
  type Instruction,
  type Op,
  type Params,
  type PartId,
  type SignalNames,
  type State,
} from './model';

// ---------- 固定用例 ----------

interface GoldenMicro {
  beat: string;
  level: 'beat' | 'explain';
  op: string;
  book: string[];
  solutions: string[];
}
interface GoldenCycle {
  name: string;
  micros: GoldenMicro[];
}
interface GoldenCycles {
  cycles: Record<Op, number>;
  fetch: GoldenCycle;
  execute: Record<Op, { form: string; meaning: string; cycles: GoldenCycle[] }>;
}
interface GoldenProgram {
  params: Params;
  expect: {
    registers: Record<'PC' | GeneralRegister, number>;
    AR: number;
    DR: number;
    memory: Record<string, number>;
    cyclesPerInstruction: number[];
    pcAfterEachFetch: number[];
    afterEachInstruction: Record<string, number | string>[];
  };
}

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../../../evals/golden/${name}`, import.meta.url), 'utf8')) as T;
const golden = load<GoldenCycles>('cpu-cycles.json');
const bookProgram = load<GoldenProgram>('cpu-book-program.json');

const VOCABULARIES: SignalNames[] = ['book', 'solutions'];

function make(op: Op, x: GeneralRegister, y: GeneralRegister, a: number): Instruction {
  if (op === 'LAD') return { op, rx: x, addr: a };
  if (op === 'JMP') return { op, addr: a };
  return { op, rx: x, ry: y };
}

const fill = (text: string, x: string, y: string, a: number): string =>
  text.replaceAll('{x}', x).replaceAll('{y}', y).replaceAll('{a}', String(a));

/** 只含一条指令的程序。 */
function single(ins: Instruction, names: SignalNames): Params {
  return {
    program: [{ addr: 60, ins }],
    registers: { PC: 60, R0: 17, R1: 201, R2: 66, R3: 140 },
    memory: [
      { addr: 140, value: 9 },
      { addr: 77, value: 123 },
    ],
    names,
    limit: 1,
  };
}

const micros = (trace: Trace<Params, State>): Step<State>[] =>
  trace.steps.filter((s) => s.level === 'beat' || s.level === 'explain');

/** 每条被执行的指令各占几个 CPU 周期。 */
function cyclesPerInstruction(trace: Trace<Params, State>): number[] {
  const counts: number[] = [];
  for (const step of trace.steps) {
    if (step.level === 'instruction' && !step.state.halted) counts.push(0);
    if (step.level === 'cycle') counts[counts.length - 1]! += 1;
  }
  return counts;
}

// ---------- 朴素参照实现：只算结果，不管总线和节拍 ----------

interface Outcome {
  pc: number;
  regs: Record<GeneralRegister, number>;
  memory: Record<string, number>;
  executed: number;
  cpuCycles: number;
  carry: number | null;
}

function reference(params: Params): Outcome {
  const regs = { R0: params.registers.R0, R1: params.registers.R1, R2: params.registers.R2, R3: params.registers.R3 };
  const memory = new Map<number, number>(params.memory.map((c) => [c.addr, c.value]));
  const program = new Map<number, Instruction>(params.program.map((l) => [l.addr, l.ins]));
  let pc = params.registers.PC;
  let executed = 0;
  let cpuCycles = 0;
  let carry: number | null = null;
  const limit = params.limit ?? LIMIT_DEFAULT;
  while (executed < limit) {
    const ins = program.get(pc);
    if (!ins) break;
    executed += 1;
    pc = (pc + 1) % 256;
    switch (ins.op) {
      case 'MOV':
        regs[ins.rx] = regs[ins.ry];
        cpuCycles += 2;
        break;
      case 'NOT':
        regs[ins.rx] = 255 - regs[ins.ry];
        cpuCycles += 2;
        break;
      case 'LAD':
        regs[ins.rx] = memory.get(ins.addr) ?? 0;
        cpuCycles += 3;
        break;
      case 'ADD': {
        const sum = regs[ins.rx] + regs[ins.ry];
        carry = sum >= 256 ? 1 : 0;
        regs[ins.ry] = sum % 256;
        cpuCycles += 2;
        break;
      }
      case 'AND': {
        let out = 0;
        for (let bit = 1; bit < 256; bit *= 2) {
          if (Math.floor(regs[ins.rx] / bit) % 2 === 1 && Math.floor(regs[ins.ry] / bit) % 2 === 1) out += bit;
        }
        carry = 0;
        regs[ins.ry] = out;
        cpuCycles += 2;
        break;
      }
      case 'STO':
        memory.set(regs[ins.ry], regs[ins.rx]);
        cpuCycles += 3;
        break;
      case 'JMP':
        pc = ins.addr;
        cpuCycles += 2;
        break;
    }
  }
  const sorted = [...memory.entries()].sort((a, b) => a[0] - b[0]);
  return { pc, regs, memory: Object.fromEntries(sorted.map(([k, v]) => [String(k), v])), executed, cpuCycles, carry };
}

// ---------- 随机程序 ----------

const register = fc.constantFrom<GeneralRegister>(...GENERAL_REGISTERS);
const byte = fc.integer({ min: 0, max: 255 });

const paramsArb: fc.Arbitrary<Params> = fc
  .record({
    base: fc.integer({ min: 0, max: 255 }),
    length: fc.integer({ min: 1, max: 6 }),
    names: fc.constantFrom<SignalNames>('book', 'solutions'),
    limit: fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined, freq: 12 }),
    regs: fc.tuple(byte, byte, byte, byte),
    cells: fc.uniqueArray(fc.record({ addr: fc.integer({ min: 0, max: 24 }), value: byte }), {
      maxLength: 8,
      selector: (c) => c.addr,
    }),
  })
  .chain((shape) => {
    const first = Math.min(shape.base, 256 - shape.length);
    const instruction: fc.Arbitrary<Instruction> = fc.oneof(
      fc.record({ op: fc.constantFrom<'MOV' | 'NOT'>('MOV', 'NOT'), rx: register, ry: register }),
      fc.record({ op: fc.constant<'LAD'>('LAD'), rx: register, addr: fc.integer({ min: 0, max: 30 }) }),
      fc.record({ op: fc.constantFrom<'ADD' | 'AND'>('ADD', 'AND'), rx: register, ry: register }),
      fc.record({ op: fc.constant<'STO'>('STO'), rx: register, ry: register }),
      // 转移目标落在程序附近：可能往回转（靠 limit 停），也可能转到没有指令的单元（停机）。
      fc.record({
        op: fc.constant<'JMP'>('JMP'),
        addr: fc.integer({ min: Math.max(0, first - 1), max: Math.min(255, first + shape.length) }),
      }),
    );
    return fc.array(instruction, { minLength: shape.length, maxLength: shape.length }).map((list): Params => {
      const params: Params = {
        program: list.map((ins, i) => ({ addr: first + i, ins })),
        registers: { PC: first, R0: shape.regs[0], R1: shape.regs[1], R2: shape.regs[2], R3: shape.regs[3] },
        memory: shape.cells,
        names: shape.names,
      };
      if (shape.limit !== undefined) params.limit = shape.limit;
      return params;
    });
  });

// ---------- 测试 ----------

describe('CPU 周期数（教材 p161）', () => {
  it('MOV、NOT、ADD、JMP 两个，LAD、STO 三个', () => {
    expect(CYCLES).toEqual(golden.cycles);
    expect(CYCLES).toMatchObject({ MOV: 2, NOT: 2, ADD: 2, JMP: 2, LAD: 3, STO: 3 });
  });

  it.each(OPS)('%s 单独运行时的 CPU 周期数与固定用例一致，第一个都是取指', (op) => {
    const trace = run(single(make(op, 'R1', 'R2', 77), 'book'));
    expect(cyclesPerInstruction(trace)).toEqual([golden.cycles[op]]);
    const names = trace.steps.filter((s) => s.level === 'cycle').map((s) => s.state.timing.cycle);
    expect(names[0]).toBe('取指');
    expect(names).toEqual(['取指', ...golden.execute[op].cycles.map((c) => c.name)]);
    expect(trace.result['CPU 周期数']).toBe(String(golden.cycles[op]));
  });
});

describe('微操作序列与 evals/golden/cpu-cycles.json 一致', () => {
  const combos: [GeneralRegister, GeneralRegister, number][] = [
    ['R1', 'R2', 77],
    ['R3', 'R0', 140],
    ['R0', 'R3', 5],
  ];
  for (const op of OPS) {
    for (const names of VOCABULARIES) {
      it.each(combos)(`${op}（${names}）：%s、%s、%i`, (x, y, a) => {
        const ins = make(op, x, y, a);
        const entry = golden.execute[op];
        expect(format(ins)).toBe(fill(entry.form, x, y, a));
        expect(meaning(ins)).toBe(fill(entry.meaning, x, y, a));

        const expectedCycles = [golden.fetch, ...entry.cycles];
        const expectedRows = expectedCycles.flatMap((cycle) =>
          cycle.micros.map((m) => [cycle.name, m.beat, fill(m.op, x, y, a), m[names].map((s) => fill(s, x, y, a)).join('，')]),
        );
        const trace = run(single(ins, names));
        const steps = micros(trace);
        // 解题表：指令行、各微操作行、停机行。
        const rows = trace.table.rows;
        expect(trace.table.columns).toEqual(['CPU 周期', '节拍', '操作', '控制信号']);
        expect(rows.slice(1, -1).map((r) => r.cells)).toEqual(expectedRows);
        expect(rows.slice(1, -1).map((r) => r.step)).toEqual(steps.map((s) => s.id));
        expect(rows[0]!.cells[0]).toBe(format(ins));
        // 每一步的层级和所在节拍。
        const expectedMicros = expectedCycles.flatMap((cycle) => cycle.micros.map((m) => ({ ...m, cycle: cycle.name })));
        expect(steps.map((s) => s.level)).toEqual(expectedMicros.map((m) => m.level));
        expect(steps.map((s) => s.state.timing.cycle)).toEqual(expectedMicros.map((m) => m.cycle));
        expect(steps.map((s) => s.state.timing.beat)).toEqual(expectedMicros.map((m) => (m.op === '译码' ? 'T4' : m.beat)));
        // 状态里有效的信号 = 本周期到此为止的电位信号 + 本节拍的脉冲信号。
        let cycle = '';
        let beat = '';
        let hold: string[] = [];
        let pulse: string[] = [];
        steps.forEach((step, i) => {
          const m = expectedMicros[i]!;
          if (m.cycle !== cycle) hold = [];
          const at = m.op === '译码' ? 'T4' : m.beat;
          if (m.cycle !== cycle || at !== beat) pulse = [];
          cycle = m.cycle;
          beat = at;
          for (const raw of m[names]) {
            const name = fill(raw, x, y, a);
            const timed = /^(.*)\(T[1-4]\)$/.exec(name);
            if (timed) pulse.push(timed[1]!);
            else hold.push(name);
          }
          expect(step.state.signals).toEqual({ level: hold, pulse });
        });
        // flow() 给出同一张表，不依赖寄存器里的数。
        expect(
          flow(ins, names).flatMap((c) =>
            c.micros.map((m) => [c.cycle, m.level, m.op, [...m.hold, ...m.pulse.map((p) => `${p}(${m.beat})`)].join('，')]),
          ),
        ).toEqual(expectedMicros.map((m) => [m.cycle, m.level, fill(m.op, x, y, a), m[names].map((s) => fill(s, x, y, a)).join('，')]));
      });
    }
  }

  it('取指周期对所有指令相同', () => {
    for (const names of VOCABULARIES) {
      const fetches = OPS.map((op) => JSON.stringify(flow(make(op, 'R2', 'R1', 9), names)[0]));
      expect(new Set(fetches).size).toBe(1);
    }
  });

  it('两套信号名下机器的行为相同，只有信号名不同', () => {
    const strip = (trace: Trace<Params, State>) =>
      trace.steps.map((s) => ({ ...s.state, signals: null, title: s.title, level: s.level }));
    expect(strip(run(sampleParams('book')))).toEqual(strip(run(sampleParams('solutions'))));
  });
});

describe('教材表 5.1 的程序（evals/golden/cpu-book-program.json）', () => {
  const trace = run(bookProgram.params);
  const final = trace.steps[trace.steps.length - 1]!.state;
  const want = bookProgram.expect;

  it('最终的寄存器和数存与教材图 5.13 一致', () => {
    expect(validateTrace(trace)).toEqual([]);
    expect({ PC: final.reg.PC, R0: final.reg.R0, R1: final.reg.R1, R2: final.reg.R2, R3: final.reg.R3 }).toEqual(want.registers);
    expect(final.reg.AR).toBe(want.AR);
    expect(final.reg.DR).toBe(want.DR);
    expect(final.dmem).toEqual(want.memory);
    expect(cyclesPerInstruction(trace)).toEqual(want.cyclesPerInstruction);
  });

  it('每次取指后 PC 加 1，每条指令结束时的值与对应的图一致', () => {
    const afterFetch = trace.steps.filter((s) => s.title === 'PC + 1').map((s) => s.state.reg.PC);
    expect(afterFetch).toEqual(want.pcAfterEachFetch);
    // 每条指令结束时的状态 = 下一个 instruction 步之前那一步的状态。
    const ends: State[] = [];
    trace.steps.forEach((step, i) => {
      if (step.level === 'instruction' && i > 0) ends.push(trace.steps[i - 1]!.state);
    });
    expect(ends.length).toBe(want.afterEachInstruction.length);
    want.afterEachInstruction.forEach((check, i) => {
      const state = ends[i]!;
      for (const [key, value] of Object.entries(check)) {
        if (key === 'ref') continue;
        if (key === 'memory30') expect(state.dmem['30']).toBe(value);
        else expect(state.reg[key as 'PC' | 'AR' | 'DR' | GeneralRegister]).toBe(value);
      }
    });
  });

  it('106 号的 AND 没有被执行', () => {
    expect(trace.steps.some((s) => s.state.reg.IR.op === 'AND')).toBe(false);
  });
});

describe('样例程序', () => {
  const trace = run(sampleParams());

  it('手算结果：48 + 25 = 73 存回 14 号单元，JMP 跳过 36 号，停在 38', () => {
    expect(validateTrace(trace)).toEqual([]);
    expect(trace.result).toMatchObject({
      PC: '38',
      R0: '48',
      R1: '73',
      R2: '73',
      R3: '14',
      '数存 14 号单元': '73',
      执行的指令数: '5',
      'CPU 周期数': '12',
    });
    expect(cyclesPerInstruction(trace)).toEqual([3, 2, 3, 2, 2]);
    expect(trace.steps.some((s) => s.state.timing.addr === 36)).toBe(false);
  });

  it('地址和数与教材表 5.1 不同', () => {
    const book = bookProgram.params;
    const sample = sampleParams();
    const bookAddrs = new Set(book.program.map((l) => l.addr));
    expect(sample.program.some((l) => bookAddrs.has(l.addr))).toBe(false);
    expect(sample.program.map((l) => format(l.ins))).not.toEqual(book.program.map((l) => format(l.ins)));
    expect(sample.registers).not.toEqual(book.registers);
  });

  it('LAD 的第三个 CPU 周期之前问数据由谁接收，答案是 DR', () => {
    const step = trace.steps.find((s) => s.level === 'cycle' && s.state.timing.cycle === '执行二' && s.state.reg.IR.op === 'LAD')!;
    expect(step.ask).toMatchObject({ kind: 'choice', answer: 'DR' });
    expect(step.ask!.options).toContain('R0');
    // 答案与引擎随后的动作一致：T3 那一步改的是 reg.DR。
    const next = trace.steps.slice(trace.steps.indexOf(step)).find((s) => s.state.timing.beat === 'T3')!;
    expect(next.changes.some((c) => c.at === 'reg.DR')).toBe(true);
  });

  it('预测题只放在少数步骤上，选项都是部件或信号的名字', () => {
    const asks = trace.steps.filter((s) => s.ask);
    expect(asks.length).toBeGreaterThanOrEqual(6);
    expect(asks.length).toBeLessThanOrEqual(trace.steps.length / 4);
    const labels = new Set<string>(Object.values(PART_LABEL));
    for (const step of asks) {
      for (const option of step.ask!.options ?? []) expect(labels.has(option)).toBe(true);
    }
    // 同一种预测题在循环里不重复问。
    const loop = run({ ...sampleParams(), program: [{ addr: 32, ins: { op: 'JMP', addr: 32 } }], limit: 4 });
    expect(loop.steps.filter((s) => s.ask).map((s) => s.ask!.answer)).toEqual(['IBUS', 'PC']);
  });

  it('选择题的答案就是这一步接收数据的部件', () => {
    let checked = 0;
    for (const step of trace.steps) {
      if (!step.ask || step.ask.kind !== 'choice' || step.level === 'cycle') continue;
      const { reg, bus, dmem } = step.state;
      const answer = step.ask.answer;
      if (answer === 'DR' || answer === 'AR' || answer === 'PC') expect(reg[answer]).toBe(bus.DBUS.value);
      else if (answer === '数存') expect(dmem[String(reg.AR)]).toBe(bus.DBUS.value);
      else if ((GENERAL_REGISTERS as readonly string[]).includes(answer)) expect(reg[answer as GeneralRegister]).toBe(reg.DR);
      else if (answer === 'IBUS') expect(bus.IBUS.driver).toBe('IMEM');
      else if (answer === 'C2') expect(step.state.gate).toEqual({ C1: false, C2: true, C3: false });
      else throw new Error(`没有核对的答案：${answer}`);
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(6);
  });
});

describe('对任意程序', () => {
  type Check = (trace: Trace<Params, State>, params: Params) => void;

  const checks: Record<string, Check> = {
    '最终的寄存器、PC、数存与朴素参照实现一致': (trace, params) => {
      const final = trace.steps[trace.steps.length - 1]!.state;
      const want = reference(params);
      expect(final.reg.PC).toBe(want.pc);
      expect({ R0: final.reg.R0, R1: final.reg.R1, R2: final.reg.R2, R3: final.reg.R3 }).toEqual(want.regs);
      expect(final.dmem).toEqual(want.memory);
      expect(final.reg.PSWR.C).toBe(want.carry);
      expect(final.halted).toBe(true);
      expect(trace.result['执行的指令数']).toBe(String(want.executed));
      expect(trace.result['CPU 周期数']).toBe(String(want.cpuCycles));
      expect(trace.steps.filter((s) => s.level === 'cycle').length).toBe(want.cpuCycles);
      expect(trace.result.PC).toBe(String(want.pc));
      for (const r of GENERAL_REGISTERS) expect(trace.result[r]).toBe(String(want.regs[r]));
    },

    'Trace 合格，params 原样带回': (trace, params) => {
      expect(validateTrace(trace)).toEqual([]);
      expect(trace.params).toEqual(params);
      expect(trace.engine).toBe('cpu');
    },

    '每条总线至多一个驱动者；DBUS 的出口同一时刻至多开一个，且与驱动者对得上': (trace, params) => {
      const read = params.names === 'book' ? 'RD(D)' : 'DR/W̄=1';
      const outlets: PartId[] = ['ALU', 'R0', 'R1', 'R2', 'R3', 'IR', 'DMEM'];
      for (const state of [trace.initial, ...trace.steps.map((s) => s.state)]) {
        const reading = state.signals.level.includes(read);
        expect([state.gate.C1, state.gate.C2, state.gate.C3, reading].filter(Boolean).length).toBeLessThanOrEqual(1);
        const driver = state.bus.DBUS.driver;
        expect(driver === 'ALU').toBe(state.gate.C1);
        expect(driver !== null && (GENERAL_REGISTERS as readonly string[]).includes(driver)).toBe(state.gate.C2);
        expect(driver === 'IR').toBe(state.gate.C3);
        expect(driver === 'DMEM').toBe(reading);
        for (const bus of Object.values(state.bus)) expect(bus.driver === null).toBe(bus.value === null);
        expect([null, 'PC']).toContain(state.bus.ABUS_I.driver);
        expect([null, 'IMEM']).toContain(state.bus.IBUS.driver);
        expect([null, 'AR']).toContain(state.bus.ABUS_D.driver);
        // 「弄坏它」：这时再让任何别的部件上 DBUS 都会冲突。
        if (driver !== null) {
          for (const other of outlets) {
            expect(checkTransfer(state, { bus: 'DBUS', driver: other }).verdict).toBe(other === driver ? 'ok' : 'conflict');
          }
        }
      }
    },

    '一个 CPU 周期里 DBUS 只送一个数；取指周期不占 DBUS': (trace) => {
      const perCycle = new Map<string, Set<string>>();
      for (const step of trace.steps) {
        const { timing, bus } = step.state;
        if (timing.cycle === null || timing.cycle === '取指') {
          expect(bus.DBUS.driver).toBeNull();
          continue;
        }
        const key = `${String(timing.instruction)}/${String(timing.cycleNo)}`;
        const seen = perCycle.get(key) ?? new Set<string>();
        if (bus.DBUS.driver !== null) seen.add(`${bus.DBUS.driver}=${String(bus.DBUS.value)}`);
        perCycle.set(key, seen);
      }
      // 每个执行 CPU 周期 DBUS 恰好送一个数。
      for (const seen of perCycle.values()) expect(seen.size).toBe(1);
    },

    '层级如实：节拍只往后走，explain 步不换节拍，focus 含全部变化的位置': (trace) => {
      const order = [null, 'T1', 'T2', 'T3', 'T4'];
      let previous = trace.initial;
      for (const step of trace.steps) {
        const before = order.indexOf(previous.timing.beat);
        const after = order.indexOf(step.state.timing.beat);
        if (step.level === 'explain') expect(after).toBe(before);
        if (step.level === 'beat') expect(after).toBeGreaterThan(before);
        if (step.level === 'cycle' || step.level === 'instruction') expect(step.state.timing.beat).toBeNull();
        for (const change of step.changes) expect(step.focus).toContain(change.at);
        expect(step.ref).toMatch(/^教材 p\d+/);
        previous = step.state;
      }
    },

    '指存不变；通用寄存器只在 T4 从 DR 接收；AR、DR、PC 只从各自的来源接收': (trace) => {
      let previous = trace.initial;
      for (const step of trace.steps) {
        const { reg, bus, timing, sel } = step.state;
        expect(step.state.imem).toEqual(trace.initial.imem);
        for (const r of GENERAL_REGISTERS) {
          if (reg[r] === previous.reg[r]) continue;
          expect(timing.beat).toBe('T4');
          expect(reg[r]).toBe(reg.DR);
          expect(sel.write).toBe(r);
        }
        if (reg.DR !== previous.reg.DR) {
          expect(timing.beat).toBe('T3');
          expect(reg.DR).toBe(bus.DBUS.value);
        }
        if (reg.AR !== previous.reg.AR) {
          expect(timing.beat).toBe('T4');
          expect(reg.AR).toBe(bus.DBUS.value);
        }
        if (reg.PC !== previous.reg.PC) {
          expect(timing.beat).toBe('T4');
          if (timing.cycle === '取指') expect(reg.PC).toBe((previous.reg.PC + 1) % 256);
          else expect(reg.PC).toBe(bus.DBUS.value);
        }
        if (JSON.stringify(step.state.dmem) !== JSON.stringify(previous.dmem)) {
          expect(timing.beat).toBe('T3');
          expect(step.state.dmem[String(reg.AR)]).toBe(bus.DBUS.value);
          expect(bus.ABUS_D).toEqual({ value: reg.AR, driver: 'AR' });
        }
        previous = step.state;
      }
    },

    '回放 changes 能还原每一步的状态': (trace) => {
      let flat = flatten(trace.initial);
      for (const step of trace.steps) {
        flat = { ...flat };
        for (const c of step.changes) {
          if (c.to === '') delete flat[c.at];
          else flat[c.at] = c.to;
        }
        expect(flat).toEqual(flatten(step.state));
      }
    },
  };

  it(`性质：${Object.keys(checks).join('；')}`, () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const trace = run(params);
        for (const [name, check] of Object.entries(checks)) {
          try {
            check(trace, params);
          } catch (error) {
            throw new Error(`${name}：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }),
      { numRuns: 120 },
    );
  }, 60_000);

  it('同样的参数得到完全相同的 Trace', () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const copy = JSON.parse(JSON.stringify(params)) as Params;
        expect(JSON.stringify(run(copy))).toBe(JSON.stringify(run(params)));
        expect(copy).toEqual(params);
      }),
      { numRuns: 30 },
    );
    expect(JSON.stringify(run(sampleParams()))).toBe(JSON.stringify(run(sampleParams())));
  }, 60_000);
});

describe('ALU 与标志', () => {
  const add = (a: number, b: number) => {
    const params = single({ op: 'ADD', rx: 'R0', ry: 'R1' }, 'book');
    params.registers = { ...params.registers, R0: a, R1: b };
    const trace = run(params);
    return trace.steps[trace.steps.length - 1]!.state.reg;
  };

  it('8 位加法的边界值：和取低 8 位，进位进 PSWR 的 C，V、Z、N 按定义', () => {
    const values = [0, 1, 2, 85, 100, 127, 128, 129, 170, 200, 254, 255];
    for (const a of values) {
      for (const b of values) {
        const reg = add(a, b);
        expect(reg.R1).toBe((a + b) % 256);
        expect(reg.PSWR.C).toBe(a + b > 255 ? 1 : 0);
        expect(reg.PSWR.Z).toBe((a + b) % 256 === 0 ? 1 : 0);
        expect(reg.PSWR.N).toBe((a + b) % 256 >= 128 ? 1 : 0);
        const signed = (v: number) => (v >= 128 ? v - 256 : v);
        const exact = signed(a) + signed(b);
        expect(reg.PSWR.V).toBe(exact > 127 || exact < -128 ? 1 : 0);
      }
    }
  }, 30_000);

  it('NOT 按 8 位取反（教材的数：10 得 245），MOV、NOT 不动 PSWR', () => {
    const params = single({ op: 'NOT', rx: 'R0', ry: 'R1' }, 'book');
    params.registers = { ...params.registers, R1: 10 };
    const reg = run(params).steps.at(-1)!.state.reg;
    expect(reg.R0).toBe(245);
    expect(reg.PSWR).toEqual({ C: null, V: null, Z: null, N: null });
  });
});

describe('非法参数', () => {
  const base = sampleParams();
  const cases: [string, Params][] = [
    ['指存为空', { ...base, program: [] }],
    ['PC 指着空单元', { ...base, registers: { ...base.registers, PC: 99 } }],
    ['寄存器超出 8 位', { ...base, registers: { ...base.registers, R2: 256 } }],
    ['地址重复', { ...base, program: [...base.program, base.program[0]!] }],
    ['指令不在指令表里', { ...base, program: [{ addr: 32, ins: { op: 'SUB', rx: 'R0', ry: 'R1' } as unknown as Instruction }] }],
    ['寄存器名不对', { ...base, program: [{ addr: 32, ins: { op: 'MOV', rx: 'R4', ry: 'R1' } as unknown as Instruction }] }],
    ['地址码不是整数', { ...base, program: [{ addr: 32, ins: { op: 'LAD', rx: 'R0', addr: 1.5 } }] }],
    ['数存的数为负', { ...base, memory: [{ addr: 3, value: -1 }] }],
    ['数存单元重复', { ...base, memory: [{ addr: 3, value: 1 }, { addr: 3, value: 2 }] }],
    ['limit 为 0', { ...base, limit: 0 }],
    ['信号名不认识', { ...base, names: 'other' as SignalNames }],
  ];
  it.each(cases)('%s：checkParams 报出问题，run 抛出错误', (_name, params) => {
    expect(checkParams(params).length).toBeGreaterThan(0);
    expect(() => run(params)).toThrow(/模型机参数有问题/);
  });

  it('样例程序没有问题', () => {
    expect(checkParams(base)).toEqual([]);
  });
});

describe('checkTransfer', () => {
  const trace = run(sampleParams());
  const onBus = (driver: string) => trace.steps.find((s) => s.state.bus.DBUS.driver === driver)!.state;

  it('ALU 的结果在 DBUS 上时再打开 C2：冲突，说出两个驱动者和后果', () => {
    const state = onBus('ALU');
    const check = checkTransfer(state, { bus: 'DBUS', driver: 'R3' });
    expect(check).toMatchObject({ verdict: 'conflict', bus: 'DBUS', drivers: ['ALU', 'R3'], values: [73, 14], gate: 'C2' });
    expect(check.message).toContain('C2');
    expect(check.message).toContain('4 位不同');
    expect(check.message.match(/。/g)?.length).toBe(1);
  });

  it('数存正在读出时打开 C3、C1 都冲突', () => {
    const state = onBus('DMEM');
    expect(checkTransfer(state, { bus: 'DBUS', driver: 'IR' }).verdict).toBe('conflict');
    expect(checkTransfer(state, { bus: 'DBUS', driver: 'ALU' }).verdict).toBe('conflict');
  });

  it('两个数相同也算冲突，说明里指出只是碰巧', () => {
    const state = onBus('ALU');
    state.reg.R3 = 73;
    const check = checkTransfer(state, { bus: 'DBUS', driver: 'R3' });
    expect(check.verdict).toBe('conflict');
    expect(check.message).toContain('碰巧');
  });

  it('总线空着，或同一个部件已经在送：不冲突', () => {
    expect(checkTransfer(trace.initial, { bus: 'DBUS', driver: 'R1' })).toMatchObject({ verdict: 'ok', drivers: ['R1'], values: [25] });
    expect(checkTransfer(onBus('ALU'), { bus: 'DBUS', driver: 'ALU' }).verdict).toBe('ok');
    expect(checkTransfer(trace.initial, { bus: 'ABUS_I', driver: 'PC' })).toMatchObject({ verdict: 'ok', values: [32], gate: null });
  });

  it('没有出口的部件上不了那条总线', () => {
    expect(checkTransfer(trace.initial, { bus: 'DBUS', driver: 'PC' }).verdict).toBe('no-path');
    expect(checkTransfer(trace.initial, { bus: 'IBUS', driver: 'DMEM' }).verdict).toBe('no-path');
    expect(checkTransfer(trace.initial, { bus: 'ABUS_D', driver: 'DR' }).verdict).toBe('no-path');
  });

  it('不改传入的状态', () => {
    const state = onBus('ALU');
    const copy = JSON.stringify(state);
    checkTransfer(state, { bus: 'DBUS', driver: 'R0' });
    expect(JSON.stringify(state)).toBe(copy);
  });
});
