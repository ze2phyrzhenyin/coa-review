import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { bandwidth, frameBits, generate, rates, run, validateParams } from './model';

// ---------- 朴素参照实现：只按规格写，不看引擎 ----------
// 帧用字符串拼：编码转二进制、反过来、数 1、补校验和停止位。

interface FrameP {
  task: '串行帧';
  code: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: '无' | '奇' | '偶';
  stopBits: 1 | 2;
  baud?: number;
  charRate?: number;
  char?: string;
}
interface BusP {
  task: '总线带宽';
  widthBits: number;
  freqMHz: number;
  clocksPerCycle: number;
}
type P = FrameP | BusP;

type EP = Parameters<typeof run>[0];
type EFrame = Parameters<typeof frameBits>[0];
type EBus = Parameters<typeof bandwidth>[0];
const asEngine = (p: P): EP => p as unknown as EP;
const asFrame = (p: FrameP): EFrame => p as unknown as EFrame;
const asBus = (p: BusP): EBus => p as unknown as EBus;

function refFrame(p: FrameP): { codeBits: string; parity: string; frame: string } {
  const codeBits = p.code.toString(2).padStart(p.dataBits, '0');
  const sent = codeBits.split('').reverse().join('');
  const ones = codeBits.split('').filter((c) => c === '1').length;
  let parity = '';
  if (p.parity === '奇') parity = ones % 2 === 1 ? '0' : '1';
  if (p.parity === '偶') parity = ones % 2 === 1 ? '1' : '0';
  return { codeBits, parity, frame: '0' + sent + parity + '1'.repeat(p.stopBits) };
}

function refRates(p: FrameP): { frameLength: number; baud: number | null; charRate: number | null; bitTime: number | null; dataRate: number | null } {
  const frameLength = refFrame(p).frame.length;
  let charRate: number | null = null;
  if (p.charRate !== undefined) charRate = p.charRate;
  if (p.baud !== undefined) charRate = p.baud / frameLength;
  if (charRate === null) return { frameLength, baud: null, charRate: null, bitTime: null, dataRate: null };
  const baud = p.baud ?? charRate * frameLength;
  return { frameLength, baud, charRate, bitTime: 1 / baud, dataRate: charRate * p.dataBits };
}

const refBandwidth = (p: BusP): number => ((p.widthBits / 8) * p.freqMHz) / p.clocksPerCycle;

/** 相对误差内相等。 */
function near(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** 位串的几种写法（数组、带空格的串）统一成 0/1 串。 */
function bits(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join('');
  return String(v).replace(/[^01]/g, '');
}

// ---------- 生成合格参数 ----------

const arbFrame: fc.Arbitrary<FrameP> = fc
  .record({
    dataBits: fc.constantFrom<5 | 6 | 7 | 8>(5, 6, 7, 8),
    raw: fc.nat(255),
    parity: fc.constantFrom<FrameP['parity']>('无', '奇', '偶'),
    stopBits: fc.constantFrom<1 | 2>(1, 2),
    rate: fc.oneof(
      fc.constant<null>(null),
      fc.record({ kind: fc.constant<'baud'>('baud'), v: fc.oneof(fc.integer({ min: 1, max: 115200 }), fc.double({ min: 0.5, max: 1e5, noNaN: true })) }),
      fc.record({ kind: fc.constant<'charRate'>('charRate'), v: fc.oneof(fc.integer({ min: 1, max: 10000 }), fc.double({ min: 0.5, max: 1e4, noNaN: true })) }),
    ),
  })
  .map((r) => {
    const p: FrameP = { task: '串行帧', code: r.raw % 2 ** r.dataBits, dataBits: r.dataBits, parity: r.parity, stopBits: r.stopBits };
    if (r.rate?.kind === 'baud') p.baud = r.rate.v;
    if (r.rate?.kind === 'charRate') p.charRate = r.rate.v;
    return p;
  });

const arbBus: fc.Arbitrary<BusP> = fc.record({
  task: fc.constant<'总线带宽'>('总线带宽'),
  widthBits: fc.integer({ min: 1, max: 32 }).map((k) => 8 * k),
  freqMHz: fc.oneof(fc.integer({ min: 1, max: 10000 }), fc.double({ min: 0.1, max: 10000, noNaN: true })),
  clocksPerCycle: fc.integer({ min: 1, max: 16 }),
});

// ---------- 状态的读法（按规格要求 7） ----------

interface FState {
  codeBits: unknown;
  ones: number | null;
  parityBit: unknown;
  line: unknown;
  current: string | null;
  frameLength: number | null;
}
interface BState {
  bytes: unknown;
  cycleNs: unknown;
  bandwidth: unknown;
}

/** 状态里的数或写好的数串，取出数值。 */
function shown(v: unknown): number {
  if (typeof v === 'number') return v;
  return Number(String(v).replace(/[^0-9.e+-]/g, ''));
}
/** 4 位有效数字以内相等。 */
const close4 = (a: number, b: number): boolean => Math.abs(a - b) <= 5e-4 * Math.abs(b) + 1e-12;

// ---------- 与参照对拍 ----------

describe('serial 与朴素参照对拍', () => {
  it('随机帧参数：frameBits、rates 一致', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        expect(frameBits(asFrame(p)).join('')).toBe(refFrame(p).frame);
        const got = rates(asFrame(p));
        const want = refRates(p);
        expect(got.frameLength).toBe(want.frameLength);
        for (const k of ['baud', 'charRate', 'bitTime', 'dataRate'] as const) expect(near(got[k], want[k])).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('随机带宽参数：bandwidth 一致', () => {
    fc.assert(
      fc.property(arbBus, (p) => {
        expect(near(bandwidth(asBus(p)), refBandwidth(p))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('generate(seed) 的参数合格，且与参照一致', () => {
    for (let seed = 0; seed < 80; seed++) {
      for (const task of [undefined, '串行帧', '总线带宽'] as const) {
        const p = (task ? generate(seed, task) : generate(seed)) as unknown as P;
        if (task) expect(p.task).toBe(task);
        expect(validateParams(asEngine(p))).toEqual([]);
        expect(validateTrace(run(asEngine(p)))).toEqual([]);
        if (p.task === '串行帧') {
          expect(frameBits(asFrame(p)).join('')).toBe(refFrame(p).frame);
          const got = rates(asFrame(p));
          const want = refRates(p);
          for (const k of ['baud', 'charRate', 'bitTime', 'dataRate'] as const) expect(near(got[k], want[k])).toBe(true);
        } else {
          expect(near(bandwidth(asBus(p)), refBandwidth(p))).toBe(true);
        }
      }
    }
  });
});

// ---------- 规格里的性质 ----------

describe('serial 性质', () => {
  it('性质 1：帧长公式；第一位 0，最后 stopBits 位是 1', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        const f = frameBits(asFrame(p));
        expect(f.length).toBe(1 + p.dataBits + (p.parity === '无' ? 0 : 1) + p.stopBits);
        expect(f[0]).toBe(0);
        expect(f.slice(f.length - p.stopBits).every((b) => b === 1)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 2：数据位按发送次序从低到高拼回 code', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        const data = frameBits(asFrame(p)).slice(1, 1 + p.dataBits);
        expect(data.reduce<number>((sum, b, i) => sum + b * 2 ** i, 0)).toBe(p.code);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 3：数据位加校验位里 1 的个数，奇校验为奇、偶校验为偶', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        if (p.parity === '无') return;
        const f = frameBits(asFrame(p));
        const ones = f.slice(1, 2 + p.dataBits).filter((b) => b === 1).length;
        expect(ones % 2).toBe(p.parity === '奇' ? 1 : 0);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 4：波特率 = 字符速率 × 帧长，两种给法互逆；有效数据率 < 波特率', () => {
    fc.assert(
      fc.property(arbFrame, fc.integer({ min: 1, max: 20000 }), (base, c) => {
        const { baud: _b, charRate: _c, ...rest } = base;
        const byChar = rates(asFrame({ ...rest, charRate: c }));
        expect(near(byChar.baud, c * byChar.frameLength)).toBe(true);
        const byBaud = rates(asFrame({ ...rest, baud: byChar.baud! }));
        expect(near(byBaud.charRate, c)).toBe(true);
        expect(byChar.dataRate!).toBeLessThan(byChar.baud!);
        expect(near(byChar.bitTime, 1 / byChar.baud!)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('没给速率时各速率为 null', () => {
    fc.assert(
      fc.property(arbFrame, (base) => {
        const { baud: _b, charRate: _c, ...rest } = base;
        const r = rates(asFrame(rest));
        expect([r.baud, r.charRate, r.bitTime, r.dataRate]).toEqual([null, null, null, null]);
      }),
      { numRuns: 50 },
    );
  });

  it('性质 5：带宽与 widthBits、freqMHz 成正比，与 clocksPerCycle 成反比', () => {
    fc.assert(
      fc.property(arbBus, (p) => {
        const b = bandwidth(asBus(p));
        if (p.widthBits <= 128) expect(near(bandwidth(asBus({ ...p, widthBits: p.widthBits * 2 })), 2 * b)).toBe(true);
        if (p.freqMHz <= 5000) expect(near(bandwidth(asBus({ ...p, freqMHz: p.freqMHz * 2 })), 2 * b)).toBe(true);
        if (p.clocksPerCycle <= 8) expect(near(bandwidth(asBus({ ...p, clocksPerCycle: p.clocksPerCycle * 2 })), b / 2)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });

  it('性质 5：同样参数同样 Trace，validateTrace 为空', () => {
    fc.assert(
      fc.property(fc.oneof(arbFrame as fc.Arbitrary<P>, arbBus as fc.Arbitrary<P>), (p) => {
        const a = run(asEngine(p));
        expect(validateTrace(a)).toEqual([]);
        expect(run(asEngine(p))).toEqual(a);
      }),
      { numRuns: 150 },
    );
  });
});

// ---------- Trace 的内容（要求 5–10） ----------

describe('serial Trace 内容', () => {
  it('串行帧步序、逐位的 line、最终状态', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        const trace = run(asEngine(p));
        const { codeBits, parity, frame } = refFrame(p);
        const hasRate = p.baud !== undefined || p.charRate !== undefined;
        const L = frame.length;
        const levels = trace.steps.map((s) => s.level);
        const want = ['explain', ...(p.parity === '无' ? [] : ['explain']), ...Array<string>(L).fill('beat'), 'explain', ...(hasRate ? ['explain', 'explain', 'explain'] : [])];
        expect(levels).toEqual(want);
        const beats = trace.steps.filter((s) => s.level === 'beat');
        beats.forEach((s, k) => expect(bits((s.state as unknown as FState).line)).toBe(frame.slice(0, k + 1)));
        expect((beats[0]!.state as unknown as FState).current).toContain('起始');
        expect((beats[1]!.state as unknown as FState).current).toContain('D0');
        expect((beats[L - 1]!.state as unknown as FState).current).toContain('停止');
        const last = trace.steps[trace.steps.length - 1]!.state as unknown as FState;
        expect(bits(last.codeBits)).toBe(codeBits);
        // 无校验时不求 1 的个数，可以一直是 null
        if (p.parity !== '无' || last.ones !== null) expect(last.ones).toBe(codeBits.split('').filter((c) => c === '1').length);
        expect(last.frameLength).toBe(L);
        if (p.parity === '无') expect(last.parityBit).toBeNull();
        else expect(bits(last.parityBit)).toBe(parity);
        expect(bits((trace.initial as unknown as FState).line)).toBe('');
      }),
      { numRuns: 120 },
    );
  });

  it('串行帧的预测题', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        const trace = run(asEngine(p));
        const { parity, frame } = refFrame(p);
        const d0 = trace.steps.filter((s) => s.level === 'beat')[1]!;
        expect(d0.ask?.options).toEqual(expect.arrayContaining(['最低位', '最高位']));
        expect(d0.ask?.answer).toBe('最低位');
        if (p.parity !== '无') {
          const parityAsk = trace.steps.find((s) => s.ask?.kind === 'bits');
          expect(parityAsk?.ask?.answer).toBe(parity);
        }
        const lengthStep = trace.steps[trace.steps.findIndex((s, i) => i > 0 && trace.steps[i - 1]!.level === 'beat' && s.level === 'explain')]!;
        expect(lengthStep.ask?.kind).toBe('number');
        expect(Number(lengthStep.ask?.answer)).toBe(frame.length);
      }),
      { numRuns: 80 },
    );
  });

  it('带宽：三步 explain，状态里的量', () => {
    fc.assert(
      fc.property(arbBus, (p) => {
        const trace = run(asEngine(p));
        expect(trace.steps.map((s) => s.level)).toEqual(['explain', 'explain', 'explain']);
        const last = trace.steps[2]!.state as unknown as BState;
        // 状态里可以是数，也可以是写好的「≈ 0.5」这类串：按 4 位有效数字比
        expect(shown(last.bytes)).toBe(p.widthBits / 8);
        expect(close4(shown(last.cycleNs), (p.clocksPerCycle * 1000) / p.freqMHz)).toBe(true);
        expect(close4(shown(last.bandwidth), refBandwidth(p))).toBe(true);
        expect(trace.steps[2]!.ask?.kind).toBe('number');
        expect(trace.result).toHaveProperty('带宽');
      }),
      { numRuns: 100 },
    );
  });

  it('table 与 result 的键', () => {
    fc.assert(
      fc.property(arbFrame, (p) => {
        const trace = run(asEngine(p));
        expect(trace.table.columns).toEqual(['项目', '算式', '结果']);
        for (const row of trace.table.rows) expect(row.step).toBeTruthy();
        const hasRate = p.baud !== undefined || p.charRate !== undefined;
        const keys = ['帧', '每帧位数', ...(hasRate ? ['波特率', '字符速率', '每位时间', '有效数据率'] : [])];
        expect(Object.keys(trace.result).sort()).toEqual(keys.sort());
        expect(bits(trace.result['帧'])).toBe(refFrame(p).frame);
        expect(trace.result['每帧位数']).toContain(String(refFrame(p).frame.length));
        // 每位时间一律用 ms
        if (hasRate) {
          expect(trace.result['每位时间']).toContain('ms');
          expect(trace.result['每位时间']).not.toContain('μs');
        }
        // 「发送次序」一行把整帧写在结果栏
        expect(trace.table.rows.some((r) => bits(r.cells[2]) === refFrame(p).frame)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------- 规格里的场景和例题 ----------

describe('serial 场景', () => {
  const s53: FrameP = { task: '串行帧', code: 0x53, dataBits: 7, parity: '偶', stopBits: 1 };

  it('0x53、7 位、偶校验、1 停止：0 1100101 0 1，10 位', () => {
    expect(frameBits(asFrame(s53)).join('')).toBe('0110010101');
    expect(rates(asFrame(s53)).frameLength).toBe(10);
  });

  it('同上改奇校验：校验位变 1，其余不变', () => {
    expect(frameBits(asFrame({ ...s53, parity: '奇' })).join('')).toBe('0110010111');
  });

  it('字符速率 150、帧 11 位：波特率 1650，每位时间 ≈ 0.6061 ms', () => {
    const p: FrameP = { task: '串行帧', code: 0x41, dataBits: 8, parity: '偶', stopBits: 1, charRate: 150 };
    const r = rates(asFrame(p));
    expect(r.frameLength).toBe(11);
    expect(r.baud).toBe(1650);
    const res = run(asEngine(p)).result;
    expect(res['波特率']).toContain('1650');
    expect(res['每位时间']).toContain('≈');
    expect(res['每位时间']).toContain('0.6061');
    expect(res['每位时间']).toContain('ms');
  });

  it('例 6.2：120 字符/秒、10 位 → 1200 波特、≈ 0.8333 ms', () => {
    const p: FrameP = { ...s53, charRate: 120 };
    const res = run(asEngine(p)).result;
    expect(rates(asFrame(p)).baud).toBe(1200);
    expect(res['波特率']).toContain('1200');
    expect(res['每位时间']).toContain('0.8333');
    expect(res['每位时间']).toContain('≈');
    expect(res['每位时间']).toContain('ms');
  });

  it('习题 10：7+1+1+1 位、9600 波特 → 960 字符/秒、≈ 0.1042 ms', () => {
    const p: FrameP = { ...s53, baud: 9600 };
    expect(rates(asFrame(p)).charRate).toBe(960);
    const res = run(asEngine(p)).result;
    expect(res['字符速率']).toContain('960');
    expect(res['每位时间']).toContain('0.1042');
    expect(res['每位时间']).toContain('ms');
  });

  it('整数结果不带 ≈：1000 波特 → 每位时间 1 ms', () => {
    const res = run(asEngine({ ...s53, baud: 1000 })).result;
    expect(res['每位时间']).toContain('1');
    expect(res['每位时间']).toContain('ms');
    expect(res['每位时间']).not.toContain('≈');
    expect(res['字符速率']).not.toContain('≈');
  });

  it('例 6.1：32 位 33 MHz → 132 MB/s；64 位 66 MHz → 528 MB/s', () => {
    expect(bandwidth(asBus({ task: '总线带宽', widthBits: 32, freqMHz: 33, clocksPerCycle: 1 }))).toBeCloseTo(132, 9);
    expect(bandwidth(asBus({ task: '总线带宽', widthBits: 64, freqMHz: 66, clocksPerCycle: 1 }))).toBeCloseTo(528, 9);
  });

  it('64 位、50 MHz、2 个时钟 → 200 MB/s', () => {
    const p: BusP = { task: '总线带宽', widthBits: 64, freqMHz: 50, clocksPerCycle: 2 };
    expect(bandwidth(asBus(p))).toBeCloseTo(200, 9);
    expect(run(asEngine(p)).result['带宽']).toContain('200');
  });
});

// ---------- 非法参数 ----------

describe('serial 非法参数', () => {
  const frame: FrameP = { task: '串行帧', code: 5, dataBits: 7, parity: '无', stopBits: 1 };
  const bus: BusP = { task: '总线带宽', widthBits: 32, freqMHz: 33, clocksPerCycle: 1 };
  const bad: [string, unknown][] = [
    ['task 不认识', { ...frame, task: '并行' }],
    ['dataBits 为 4', { ...frame, dataBits: 4 }],
    ['dataBits 为 9', { ...frame, dataBits: 9 }],
    ['code 超出 7 位', { ...frame, code: 128 }],
    ['code 为负', { ...frame, code: -1 }],
    ['code 不是整数', { ...frame, code: 2.5 }],
    ['校验方式不认识', { ...frame, parity: '标记' }],
    ['stopBits 为 3', { ...frame, stopBits: 3 }],
    ['同时给 baud 和 charRate', { ...frame, baud: 1200, charRate: 120 }],
    ['baud 为 0', { ...frame, baud: 0 }],
    ['charRate 为负', { ...frame, charRate: -5 }],
    ['widthBits 不是 8 的倍数', { ...bus, widthBits: 12 }],
    ['widthBits 超过 256', { ...bus, widthBits: 264 }],
    ['widthBits 为 0', { ...bus, widthBits: 0 }],
    ['freqMHz 为 0', { ...bus, freqMHz: 0 }],
    ['freqMHz 超过 10000', { ...bus, freqMHz: 10001 }],
    ['clocksPerCycle 为 0', { ...bus, clocksPerCycle: 0 }],
    ['clocksPerCycle 为 17', { ...bus, clocksPerCycle: 17 }],
    ['clocksPerCycle 不是整数', { ...bus, clocksPerCycle: 1.5 }],
  ];
  it('合格参数没有问题', () => {
    expect(validateParams(asEngine(frame))).toEqual([]);
    expect(validateParams(asEngine(bus))).toEqual([]);
  });
  for (const [name, p] of bad) {
    it(`${name}：validateParams 报问题，run 抛错`, () => {
      expect(validateParams(p as EP).length).toBeGreaterThan(0);
      expect(() => run(p as EP)).toThrow();
    });
  }
});
