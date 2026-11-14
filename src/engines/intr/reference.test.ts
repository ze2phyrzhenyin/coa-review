import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, validateParams } from './model';

// ---------- 朴素参照实现：只按规格写，不看引擎 ----------
// 直接列出应有的框名序列，以及每个框之后栈里应有的值。

interface Dev {
  name: string;
  ei: 0 | 1;
  rd: 0 | 1;
  vector: number;
  entry: number;
}
interface P {
  devices: Dev[];
  im: 0 | 1;
  pc: number;
  regs: { name: string; value: number }[];
  data: number;
}

type EP = Parameters<typeof run>[0];
const asEngine = (p: P): EP => p as unknown as EP;

const MAIN = ['设备就绪', '发出请求', '执行指令', '中断？', '响应条件'];
const HARD = ['响应中断', '关中断', '找出中断源', '保存断点', '转移'];
const SOFT = ['保存现场', '设备服务', '恢复现场', '开中断', '中断返回'];

interface Expect {
  selected: number;
  breakpoint: number;
  boxes: string[];
  /** 每个框之后栈里的值，底在前；保存现场之后寄存器那几项不管先后。 */
  stack: number[][];
  others: number[];
}

function reference(p: P): Expect | null {
  const requesting = p.devices.flatMap((d, i) => (d.rd === 1 && d.ei === 1 ? [i] : []));
  if (requesting.length === 0) return null;
  const selected = requesting[0]!;
  const others = requesting.slice(1);
  const breakpoint = p.pc + 1 + p.im; // IM=1 时多执行一条开中断指令
  const boxes = [...MAIN];
  if (p.im === 1) boxes.push('开中断指令', '中断？', '响应条件');
  boxes.push(...HARD, ...SOFT);
  if (others.length > 0) boxes.push('还有请求');
  const regs = p.regs.map((r) => r.value);
  const stack = boxes.map((box, k) => {
    const before = boxes.slice(0, k + 1);
    if (before.includes('中断返回')) return [];
    if (before.includes('恢复现场')) return [breakpoint];
    if (before.includes('保存现场')) return [breakpoint, ...regs];
    if (before.includes('保存断点')) return [breakpoint];
    void box;
    return [];
  });
  return { selected, breakpoint, boxes, stack, others };
}

// ---------- 状态的读法（按规格要求 8） ----------

interface IState {
  phase: string;
  pc: unknown;
  im: unknown;
  ir: unknown;
  line: unknown;
  inta: unknown;
  devices: { bs: unknown; rd: unknown; ei: unknown; chain: unknown }[];
  selected: unknown;
  vector: unknown;
  regs: Record<string, unknown>;
  stack: { what: string; value: unknown }[];
  box: string;
}
const st = (s: unknown): IState => s as IState;
const bit = (v: unknown): number => (v === true || v === 1 || v === '1' ? 1 : 0);
/** 数，或写成十六进制加 H 的串。 */
function num(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  return /H$/i.test(s) ? parseInt(s.slice(0, -1), 16) : Number(s);
}
const hexH = (s: string | undefined): number => {
  const m = /([0-9A-F]+)H/.exec(s ?? '');
  return m ? parseInt(m[1]!, 16) : NaN;
};

// ---------- 生成合格参数 ----------

const NAMES = ['键盘', '打印机', '磁盘', '网卡'];
const REGS = ['R0', 'R1', 'R2'];

const arbParams: fc.Arbitrary<P> = fc.integer({ min: 1, max: 4 }).chain((n) =>
  fc.record({
    devices: fc
      .tuple(
        fc.shuffledSubarray(NAMES, { minLength: n, maxLength: n }),
        fc.array(
          fc.record({
            ei: fc.constantFrom<0 | 1>(0, 1, 1),
            rd: fc.constantFrom<0 | 1>(0, 1, 1),
            vector: fc.nat(0xffff),
            entry: fc.nat(0xffff),
          }),
          { minLength: n, maxLength: n },
        ),
      )
      .map(([names, rest]) => rest.map((d, i) => ({ name: names[i]!, ...d })))
      // 全都 rd=0 的情形单独测（见「全部未就绪」），这里至少一台就绪，免得挡住别的检查
      .filter((ds) => ds.some((d) => d.rd === 1)),
    im: fc.constantFrom<0 | 1>(0, 1),
    // IM=1 时断点是 pc+2，避开 FFFFH 以上
    pc: fc.nat(0xfffd),
    regs: fc.integer({ min: 1, max: 3 }).chain((k) =>
      fc.array(fc.nat(0xffff), { minLength: k, maxLength: k }).map((vs) => vs.map((value, i) => ({ name: REGS[i]!, value }))),
    ),
    data: fc.nat(255),
  }),
);

// ---------- 与参照对拍 ----------

function compare(p: P): void {
  const trace = run(asEngine(p));
  expect(validateTrace(trace)).toEqual([]);
  const want = reference(p);
  const states = trace.steps.map((s) => st(s.state));
  const last = states[states.length - 1]!;
  if (!want) {
    expect(states.some((s) => s.box === '响应中断')).toBe(false);
    for (const s of states) expect(s.phase).toBe('主程序');
    expect(num(last.pc)).toBe(p.pc + 1);
    expect(Object.keys(trace.result).sort()).toEqual(['PC', '响应的设备'].sort());
    expect(trace.result['响应的设备']).toBe('无');
    expect(hexH(trace.result['PC'])).toBe(p.pc + 1);
    return;
  }
  // 步序（框名）完全一致
  expect(states.map((s) => s.box)).toEqual(want.boxes);
  // 每个框之后的栈
  states.forEach((s, k) => {
    const values = s.stack.map((e) => num(e.value));
    const exp = want.stack[k]!;
    expect(values.length).toBe(exp.length);
    if (exp.length > 0) expect(values[0]).toBe(exp[0]);
    expect(values.slice(1).sort((a, b) => a - b)).toEqual(exp.slice(1).sort((a, b) => a - b));
  });
  const at = (box: string): IState => states[want.boxes.lastIndexOf(box)]!;
  const dev = p.devices[want.selected]!;
  expect(num(at('转移').pc)).toBe(dev.entry);
  expect(num(at('中断返回').pc)).toBe(want.breakpoint);
  expect(num(at('保存断点').stack[0]!.value)).toBe(want.breakpoint);
  expect([want.selected, dev.name]).toContain(at('找出中断源').selected);
  expect(num(at('找出中断源').vector)).toBe(dev.vector);
  // result
  const r = trace.result;
  for (const key of ['响应的设备', '断点', '向量地址', '入口地址', '硬件完成', '软件完成', '返回后 PC', '返回后 IM']) expect(r).toHaveProperty(key);
  expect(r['响应的设备']).toContain(dev.name);
  expect(hexH(r['断点'])).toBe(want.breakpoint);
  expect(hexH(r['向量地址'])).toBe(dev.vector);
  expect(hexH(r['入口地址'])).toBe(dev.entry);
  expect(hexH(r['返回后 PC'])).toBe(want.breakpoint);
  expect(r['返回后 IM']).toContain('0');
  expect('仍在请求' in r).toBe(want.others.length > 0);
  for (const i of want.others) expect(r['仍在请求']).toContain(p.devices[i]!.name);
  // 地址写成大写十六进制加 H
  for (const key of ['断点', '向量地址', '入口地址', '返回后 PC']) expect(r[key]).toMatch(/^[0-9A-F]+H$/);
}

describe('intr 与朴素参照对拍', () => {
  it('随机参数：步序、栈、断点、入口一致', () => {
    fc.assert(fc.property(arbParams, (p) => compare(p)), { numRuns: 200 });
  });

  it('generate(seed) 的参数合格，且与参照一致', () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = generate(seed) as unknown as P;
      expect(validateParams(asEngine(p))).toEqual([]);
      compare(p);
    }
  });
});

// ---------- 规格里的性质 ----------

describe('intr 性质', () => {
  it('性质 1：返回后栈空、PC = 断点、IM = 0、寄存器恢复为初值', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const want = reference(p);
        if (!want) return;
        const trace = run(asEngine(p));
        const s = st(trace.steps.find((x) => st(x.state).box === '中断返回')!.state);
        expect(s.stack).toEqual([]);
        expect(num(s.pc)).toBe(want.breakpoint);
        expect(bit(s.im)).toBe(0);
        for (const r of p.regs) expect(num(s.regs[r.name])).toBe(r.value);
      }),
      { numRuns: 150 },
    );
  });

  it('性质 2：被响应的是链上第一个 RD=1 且 EI=1 的设备', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const want = reference(p);
        const trace = run(asEngine(p));
        if (!want) return;
        const found = st(trace.steps.find((x) => st(x.state).box === '找出中断源')!.state);
        expect([want.selected, p.devices[want.selected]!.name]).toContain(found.selected);
        // INTA 沿链传到截住它的接口为止
        found.devices.forEach((d, i) => expect(bit(d.chain)).toBe(i <= want.selected ? 1 : 0));
      }),
      { numRuns: 150 },
    );
  });

  it('性质 3：硬件步在前；关中断 < 保存断点 < 转移 < 保存现场；恢复现场 < 开中断 < 返回', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        if (!reference(p)) return;
        const trace = run(asEngine(p));
        const boxes = trace.steps.map((s) => st(s.state).box);
        const pos = (b: string): number => boxes.indexOf(b);
        expect(pos('关中断')).toBeLessThan(pos('保存断点'));
        expect(pos('保存断点')).toBeLessThan(pos('转移'));
        expect(pos('转移')).toBeLessThan(pos('保存现场'));
        expect(pos('恢复现场')).toBeLessThan(pos('开中断'));
        expect(pos('开中断')).toBeLessThan(pos('中断返回'));
        // 保存现场之后、恢复现场之前没有开中断（单级）
        expect(boxes.slice(pos('保存现场'), pos('恢复现场'))).not.toContain('开中断');
        const lastHard = Math.max(...HARD.map(pos));
        const firstSoft = Math.min(...SOFT.map(pos));
        expect(lastHard).toBeLessThan(firstSoft);
        // 层级：前四个硬件步 explain，转移 cycle，软件步 instruction
        for (const s of trace.steps) {
          const b = st(s.state).box;
          if (HARD.slice(0, 4).includes(b)) expect(s.level).toBe('explain');
          if (b === '转移') expect(s.level).toBe('cycle');
          if (SOFT.includes(b)) expect(s.level).toBe('instruction');
        }
      }),
      { numRuns: 150 },
    );
  });

  it('性质 4：保存现场压进的就是那几个寄存器，恢复后栈只剩断点', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        if (!reference(p)) return;
        const trace = run(asEngine(p));
        const saved = st(trace.steps.find((x) => st(x.state).box === '保存现场')!.state).stack;
        expect(saved.length).toBe(1 + p.regs.length);
        for (const r of p.regs) expect(saved.slice(1).some((e) => e.what.includes(r.name))).toBe(true);
        const restored = st(trace.steps.find((x) => st(x.state).box === '恢复现场')!.state);
        expect(restored.stack.length).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('性质 5：同样参数同样 Trace，validateTrace 为空', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const a = run(asEngine(p));
        expect(validateTrace(a)).toEqual([]);
        expect(run(asEngine(p))).toEqual(a);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- 各框之后的状态（要求 1、2、5、7、8） ----------

describe('intr 各框的状态', () => {
  it('初始、请求线、IR、INTA、IM、设备服务', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const want = reference(p);
        const trace = run(asEngine(p));
        const init = st(trace.initial);
        expect(bit(init.ir)).toBe(0);
        expect(bit(init.im)).toBe(p.im);
        expect(num(init.pc)).toBe(p.pc);
        p.devices.forEach((d, i) => {
          if (d.rd === 1) {
            expect(bit(init.devices[i]!.bs)).toBe(1);
            expect(bit(init.devices[i]!.rd)).toBe(0);
          }
        });
        if (!want) {
          for (const s of trace.steps) expect(bit(st(s.state).line)).toBe(0);
          return;
        }
        const states = trace.steps.map((s) => st(s.state));
        const at = (box: string, nth = 0): IState => states.filter((s) => s.box === box)[nth]!;
        p.devices.forEach((d, i) => {
          if (d.rd === 1) expect(bit(at('设备就绪').devices[i]!.rd)).toBe(1);
        });
        expect(bit(at('发出请求').line)).toBe(1);
        expect(num(at('执行指令').pc)).toBe(p.pc + 1);
        expect(bit(at('中断？').ir)).toBe(1);
        if (p.im === 1) {
          expect(num(at('开中断指令').pc)).toBe(p.pc + 2);
          expect(bit(at('开中断指令').im)).toBe(0);
        }
        expect(bit(at('响应中断').ir)).toBe(0);
        expect(bit(at('响应中断').inta)).toBe(1);
        expect(bit(at('关中断').im)).toBe(1);
        for (const b of ['保存现场', '设备服务', '恢复现场']) expect(bit(at(b).im)).toBe(1);
        expect(bit(at('开中断').im)).toBe(0);
        const served = at('设备服务');
        expect(num(served.regs[p.regs[0]!.name])).toBe(p.data);
        expect(bit(served.devices[want.selected]!.bs)).toBe(0);
        expect(bit(served.devices[want.selected]!.rd)).toBe(0);
        // 阶段
        for (const s of states) {
          if ([...MAIN, '开中断指令'].includes(s.box)) expect(s.phase).toBe('主程序');
          if (HARD.slice(0, 4).includes(s.box)) expect(s.phase).toBe('中断周期');
          if (SOFT.slice(0, 4).includes(s.box)) expect(s.phase).toBe('服务程序');
        }
      }),
      { numRuns: 150 },
    );
  });

  it('预测题', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const want = reference(p);
        if (!want) return;
        const trace = run(asEngine(p));
        const of = (box: string) => trace.steps.filter((s) => st(s.state).box === box);
        for (const s of of('响应条件')) expect(s.ask).toBeDefined();
        expect(of('关中断')[0]!.ask?.answer).toBe('硬件');
        expect(of('保存断点')[0]!.ask?.answer).toBe('硬件');
        expect(of('保存现场')[0]!.ask?.answer).toBe('软件');
        const many = 1 + want.others.length >= 2;
        expect(of('找出中断源')[0]!.ask !== undefined).toBe(many);
      }),
      { numRuns: 100 },
    );
  });

  it('table：列名，从执行完当前指令起每步一行', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(asEngine(p));
        expect(trace.table.columns).toEqual(['次序', '操作', '谁做', 'IM', 'PC', '栈顶']);
        if (!reference(p)) return;
        const from = trace.steps.findIndex((s) => st(s.state).box === '执行指令');
        expect(trace.table.rows.length).toBe(trace.steps.length - from);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- 规格里的场景 ----------

describe('intr 场景', () => {
  const base: P = {
    devices: [
      { name: '键盘', ei: 1, rd: 1, vector: 0x40, entry: 0x2000 },
      { name: '打印机', ei: 1, rd: 1, vector: 0x44, entry: 0x3000 },
    ],
    im: 0,
    pc: 0x1000,
    regs: [
      { name: 'R0', value: 7 },
      { name: 'R1', value: 9 },
    ],
    data: 0x5a,
  };

  it('全部未就绪（rd 都为 0）是合格参数：请求线一直为 0，没有中断', () => {
    // 规格的 rd 取 0 或 1，要求 6 说没有设备同时 RD=1、EI=1 时执行完当前指令结束
    const p: P = { ...base, devices: base.devices.map((d) => ({ ...d, rd: 0 as const })) };
    expect(validateParams(asEngine(p))).toEqual([]);
    compare(p);
  });

  it('两台都就绪、都 EI=1：近的被响应，另一台仍在请求', () => {
    const r = run(asEngine(base)).result;
    expect(r['响应的设备']).toContain('键盘');
    expect(r['仍在请求']).toContain('打印机');
    expect(hexH(r['断点'])).toBe(0x1001);
  });

  it('IM=1：先执行开中断指令，断点大 1', () => {
    const r = run(asEngine({ ...base, im: 1 })).result;
    expect(hexH(r['断点'])).toBe(0x1002);
  });

  it('唯一就绪的设备 EI=0：没有中断周期', () => {
    const p: P = { ...base, devices: [{ name: '键盘', ei: 0, rd: 1, vector: 0x40, entry: 0x2000 }] };
    const trace = run(asEngine(p));
    expect(trace.steps.some((s) => st(s.state).phase === '中断周期')).toBe(false);
    expect(trace.result['响应的设备']).toBe('无');
  });

  it('中断返回之后栈空、寄存器还原、IM=0', () => {
    const trace = run(asEngine(base));
    const s = st(trace.steps.find((x) => st(x.state).box === '中断返回')!.state);
    expect(s.stack).toEqual([]);
    expect(num(s.regs['R0'])).toBe(7);
    expect(num(s.regs['R1'])).toBe(9);
    expect(bit(s.im)).toBe(0);
  });
});

// ---------- 非法参数 ----------

describe('intr 非法参数', () => {
  const good: P = {
    devices: [{ name: '键盘', ei: 1, rd: 1, vector: 0x40, entry: 0x2000 }],
    im: 0,
    pc: 0x100,
    regs: [{ name: 'R0', value: 1 }],
    data: 3,
  };
  const dev = good.devices[0]!;
  const bad: [string, unknown][] = [
    ['没有设备', { ...good, devices: [] }],
    ['5 台设备', { ...good, devices: NAMES.concat('鼠标').map((name) => ({ ...dev, name })) }],
    ['ei 为 2', { ...good, devices: [{ ...dev, ei: 2 }] }],
    ['rd 为 -1', { ...good, devices: [{ ...dev, rd: -1 }] }],
    ['向量地址超过 FFFFH', { ...good, devices: [{ ...dev, vector: 0x10000 }] }],
    ['入口地址为负', { ...good, devices: [{ ...dev, entry: -1 }] }],
    ['im 为 2', { ...good, im: 2 }],
    ['pc 为 FFFFH', { ...good, pc: 0xffff }],
    ['pc 为负', { ...good, pc: -1 }],
    ['没有寄存器', { ...good, regs: [] }],
    ['4 个寄存器', { ...good, regs: ['A', 'B', 'C', 'D'].map((name) => ({ name, value: 0 })) }],
    ['data 为 256', { ...good, data: 256 }],
    ['data 为负', { ...good, data: -1 }],
  ];
  it('合格参数没有问题', () => {
    expect(validateParams(asEngine(good))).toEqual([]);
  });
  for (const [name, p] of bad) {
    it(`${name}：validateParams 报问题，run 抛错`, () => {
      expect(validateParams(p as EP).length).toBeGreaterThan(0);
      expect(() => run(p as EP)).toThrow();
    });
  }
});
