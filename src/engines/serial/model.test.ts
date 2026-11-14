import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { bandwidth, frameBits, generate, rates, run, validateParams, type BusParams, type FrameParams, type FrameState, type Params } from './model';

// 朴素参照：把编码写成二进制串再反转，校验位用字符串里数 1。
function naiveFrame(p: FrameParams): string {
  const data = p.code.toString(2).padStart(p.dataBits, '0').split('').reverse().join('');
  const count = data.split('').filter((c) => c === '1').length;
  const parity = p.parity === '无' ? '' : p.parity === '偶' ? String(count % 2) : String(1 - (count % 2));
  return '0' + data + parity + '1'.repeat(p.stopBits);
}

const frameArb: fc.Arbitrary<FrameParams> = fc
  .record({
    dataBits: fc.constantFrom(5 as const, 6 as const, 7 as const, 8 as const),
    parity: fc.constantFrom('无' as const, '奇' as const, '偶' as const),
    stopBits: fc.constantFrom(1 as const, 2 as const),
    raw: fc.nat(255),
    rate: fc.oneof(
      fc.constant(null),
      fc.record({ kind: fc.constant('baud' as const), v: fc.integer({ min: 50, max: 115200 }) }),
      fc.record({ kind: fc.constant('char' as const), v: fc.integer({ min: 1, max: 2000 }) }),
    ),
  })
  .map(({ dataBits, parity, stopBits, raw, rate }) => {
    const p: FrameParams = { task: '串行帧', code: raw % 2 ** dataBits, dataBits, parity, stopBits };
    if (rate?.kind === 'baud') p.baud = rate.v;
    if (rate?.kind === 'char') p.charRate = rate.v;
    return p;
  });

const busArb: fc.Arbitrary<BusParams> = fc.record({
  task: fc.constant('总线带宽' as const),
  widthBits: fc.integer({ min: 1, max: 32 }).map((k) => k * 8),
  freqMHz: fc.integer({ min: 1, max: 1000 }),
  clocksPerCycle: fc.integer({ min: 1, max: 16 }),
});

describe('serial 引擎的 Trace', () => {
  it('任意参数 validateTrace 为空，且同样参数同样 Trace', () => {
    fc.assert(
      fc.property(fc.oneof(frameArb as fc.Arbitrary<Params>, busArb as fc.Arbitrary<Params>), (p) => {
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(run(p)).toEqual(t);
      }),
      { numRuns: 150 },
    );
  });

  it('帧与朴素参照一致，线上电平逐位时间推出', () => {
    fc.assert(
      fc.property(frameArb, (p) => {
        const expected = naiveFrame(p);
        expect(frameBits(p).join('')).toBe(expected);
        const t = run(p);
        expect(t.result['帧']).toBe(expected);
        expect((t.steps.at(-1)!.state as FrameState).line.join('')).toBe(expected);
        const beats = t.steps.filter((s) => s.level === 'beat');
        expect(beats.length).toBe(expected.length);
        beats.forEach((s, i) => expect((s.state as FrameState).line.length).toBe(i + 1));
      }),
      { numRuns: 200 },
    );
  });

  it('波特率与字符速率互逆，有效数据率小于波特率', () => {
    fc.assert(
      fc.property(frameArb, (p) => {
        const r = rates(p);
        if (r.baud === null || r.charRate === null || r.dataRate === null || r.bitTime === null) return;
        expect(r.baud).toBeCloseTo(r.charRate * r.frameLength, 6);
        expect(r.bitTime * r.baud).toBeCloseTo(1, 9);
        expect(r.dataRate).toBeLessThan(r.baud);
      }),
    );
  });

  it('带宽与位宽、频率成正比，与每周期时钟数成反比', () => {
    fc.assert(
      fc.property(busArb, (p) => {
        const v = bandwidth(p);
        expect(bandwidth({ ...p, freqMHz: p.freqMHz * 2 })).toBeCloseTo(2 * v, 6);
        if (p.clocksPerCycle <= 8) expect(bandwidth({ ...p, clocksPerCycle: p.clocksPerCycle * 2 })).toBeCloseTo(v / 2, 6);
        if (p.widthBits <= 128) expect(bandwidth({ ...p, widthBits: p.widthBits * 2 })).toBeCloseTo(2 * v, 6);
      }),
    );
  });

  it('表的每行指回一步，结果有题目要的每个量', () => {
    const t = run({ task: '串行帧', code: 65, dataBits: 7, parity: '偶', stopBits: 1, baud: 9600 });
    expect(t.table.columns).toEqual(['项目', '算式', '结果']);
    expect(t.table.rows.every((r) => r.step)).toBe(true);
    expect(Object.keys(t.result).sort()).toEqual(['字符速率', '帧', '每位时间', '每帧位数', '有效数据率', '波特率'].sort());
    const parityStep = t.steps.find((s) => s.ask?.kind === 'bits');
    expect(parityStep?.ask?.answer).toBe('0');
  });

  it('规格里的场景', () => {
    const even = run({ task: '串行帧', code: 0x53, dataBits: 7, parity: '偶', stopBits: 1 });
    expect(even.result['帧']).toBe('0110010101');
    expect(even.result['每帧位数']).toBe('10');
    const odd = run({ task: '串行帧', code: 0x53, dataBits: 7, parity: '奇', stopBits: 1 });
    expect(odd.result['帧']).toBe('0110010111');
    const r = run({ task: '串行帧', code: 1, dataBits: 7, parity: '奇', stopBits: 2, charRate: 150 });
    expect(r.result['波特率']).toBe('1650 波特');
    expect(r.result['每位时间']).toBe('≈ 0.6061 ms');
    expect(run({ task: '总线带宽', widthBits: 64, freqMHz: 50, clocksPerCycle: 2 }).result['带宽']).toBe('200 MB/s');
  });

  it('不合格的参数抛出错误', () => {
    const bad: Params[] = [
      { task: '串行帧', code: 128, dataBits: 7, parity: '无', stopBits: 1 },
      { task: '串行帧', code: 3, dataBits: 7, parity: '无', stopBits: 1, baud: 1200, charRate: 120 },
      { task: '串行帧', code: 3, dataBits: 7, parity: '无', stopBits: 3 as 1 },
      { task: '总线带宽', widthBits: 12, freqMHz: 33, clocksPerCycle: 1 },
      { task: '总线带宽', widthBits: 32, freqMHz: 0, clocksPerCycle: 1 },
    ];
    for (const p of bad) {
      expect(validateParams(p).length).toBeGreaterThan(0);
      expect(() => run(p)).toThrow(validateParams(p)[0]!);
    }
  });

  it('generate 按种子出合格且固定的题', () => {
    for (let seed = 0; seed < 200; seed++) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(generate(seed)).toEqual(p);
      expect(validateTrace(run(p))).toEqual([]);
    }
    expect(generate(7, '总线带宽').task).toBe('总线带宽');
    expect(generate(7, '串行帧').task).toBe('串行帧');
  });
});

interface GoldenCase {
  name: string;
  params: Params;
  expect: Record<string, string>;
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/serial-cases.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/serial-cases.json', () => {
  for (const item of golden.cases) {
    it(item.name, () => {
      const t = run(item.params);
      expect(validateTrace(t)).toEqual([]);
      expect(t.result).toEqual(item.expect);
    });
  }
});
