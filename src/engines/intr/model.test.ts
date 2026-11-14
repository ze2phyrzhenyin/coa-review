import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, validateParams, type Device, type Params } from './model';

// 朴素参照：直接按图 8.6 写出应有的框序、谁做、断点和栈的最大内容。
function naive(p: Params) {
  const chosen = p.devices.findIndex((d) => d.rd === 1 && d.ei === 1);
  const boxes = ['设备就绪', '发出请求', '执行指令', '中断？'];
  if (chosen < 0) return { boxes, chosen: null, breakpoint: null };
  boxes.push('响应条件');
  if (p.im === 1) boxes.push('开中断指令', '中断？', '响应条件');
  boxes.push('响应中断', '关中断', '找出中断源', '保存断点', '转移', '保存现场', '设备服务', '恢复现场', '开中断', '中断返回');
  const others = p.devices.filter((d, i) => i > chosen && d.rd === 1 && d.ei === 1);
  if (others.length) boxes.push('还有请求');
  return { boxes, chosen, breakpoint: p.pc + 1 + p.im };
}

const deviceArb: fc.Arbitrary<Device> = fc.record({
  name: fc.constant('x'),
  ei: fc.constantFrom(0 as const, 1 as const),
  rd: fc.constantFrom(0 as const, 1 as const),
  vector: fc.integer({ min: 0, max: 0xffff }),
  entry: fc.integer({ min: 0, max: 0xffff }),
});
const paramsArb: fc.Arbitrary<Params> = fc
  .record({
    devices: fc.array(deviceArb, { minLength: 1, maxLength: 4 }),
    im: fc.constantFrom(0 as const, 1 as const),
    pc: fc.integer({ min: 0, max: 0xfffd }),
    regs: fc.array(fc.integer({ min: 0, max: 0xffff }), { minLength: 1, maxLength: 3 }),
    data: fc.integer({ min: 0, max: 255 }),
    force: fc.nat(3),
  })
  .map(({ devices, im, pc, regs, data, force }) => {
    const ds = devices.map((d, i) => ({ ...d, name: `设备${i}` }));
    if (!ds.some((d) => d.rd)) ds[force % ds.length]!.rd = 1;
    return { devices: ds, im, pc, regs: regs.map((value, i) => ({ name: `R${i}`, value })), data };
  });

describe('intr 引擎', () => {
  it('validateTrace 为空，同样参数同样 Trace', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(run(p)).toEqual(t);
      }),
      { numRuns: 200 },
    );
  });

  it('框序、被响应的设备、断点与朴素参照一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        const ref = naive(p);
        expect(t.steps.map((s) => s.state.box)).toEqual(ref.boxes);
        if (ref.chosen === null) {
          expect(t.result['响应的设备']).toBe('无');
          return;
        }
        expect(t.result['响应的设备']).toBe(p.devices[ref.chosen]!.name);
        expect(t.steps.find((s) => s.state.box === '保存断点')!.state.stack).toEqual([{ what: '断点', value: ref.breakpoint }]);
      }),
      { numRuns: 200 },
    );
  });

  it('返回后栈空、PC = 断点、IM = 0、现场恢复', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        if (t.result['响应的设备'] === '无') return;
        const end = t.steps.find((s) => s.state.box === '中断返回')!.state;
        expect(end.stack).toEqual([]);
        expect(end.pc).toBe(p.pc + 1 + p.im);
        expect(end.im).toBe(0);
        expect(end.phase).toBe('主程序');
        for (const r of p.regs) expect(end.regs[r.name]).toBe(r.value);
      }),
      { numRuns: 200 },
    );
  });

  it('硬件步都在软件步之前；关中断、保存断点、转移、保存现场、恢复现场、开中断、返回依次出现', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const t = run(p);
        if (t.result['响应的设备'] === '无') return;
        const at = (box: string) => t.steps.findIndex((s) => s.state.box === box);
        const seq = ['响应中断', '关中断', '找出中断源', '保存断点', '转移', '保存现场', '设备服务', '恢复现场', '开中断', '中断返回'].map(at);
        expect([...seq].sort((a, b) => a - b)).toEqual(seq);
        const levels = t.steps.slice(seq[0], seq[4]! + 1).map((s) => s.level);
        expect(levels).toEqual(['explain', 'explain', 'explain', 'explain', 'cycle']);
        expect(t.steps.slice(seq[5], seq[9]! + 1).every((s) => s.level === 'instruction')).toBe(true);
        // 服务期间 IM 一直是 1，直到开中断
        expect(t.steps.slice(at('关中断'), at('开中断')).every((s) => s.state.im === 1)).toBe(true);
        // 保存现场进栈的次序与恢复时相反
        const saved = t.steps[at('保存现场')]!.state.stack.slice(1).map((e) => e.what);
        expect(saved).toEqual(p.regs.map((r) => r.name));
      }),
      { numRuns: 150 },
    );
  });

  it('预测题：谁做的答案对，INTA 只在多台请求时问', () => {
    const t = run(generate(11));
    for (const s of t.steps) {
      if (s.ask?.prompt === '这一步由谁完成？') expect(s.ask.answer).toBe(s.state.box === '保存现场' ? '软件' : '硬件');
    }
    const one = run({ devices: [{ name: 'a', ei: 1, rd: 1, vector: 1, entry: 2 }], im: 0, pc: 0, regs: [{ name: 'R0', value: 0 }], data: 0 });
    expect(one.steps.some((s) => s.ask?.prompt === '哪个接口截住 INTA？')).toBe(false);
  });

  it('不合格的参数抛出错误', () => {
    const ok: Params = { devices: [{ name: 'a', ei: 1, rd: 1, vector: 1, entry: 2 }], im: 0, pc: 0, regs: [{ name: 'R0', value: 0 }], data: 0 };
    const bad: Params[] = [
      { ...ok, devices: [] },
      { ...ok, pc: 0xffff },
      { ...ok, regs: [] },
      { ...ok, data: 256 },
      { ...ok, devices: [ok.devices[0]!, ok.devices[0]!] },
    ];
    for (const p of bad) {
      expect(validateParams(p).length).toBeGreaterThan(0);
      expect(() => run(p)).toThrow();
    }
  });

  it('generate 按种子出合格且固定的题', () => {
    for (let seed = 0; seed < 150; seed++) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(generate(seed)).toEqual(p);
      expect(run(p).result['响应的设备']).not.toBe('无');
    }
  });
});

interface GoldenCase {
  name: string;
  params: Params;
  expect: { boxes: string[]; table: string[][]; result: Record<string, string> };
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/intr-cases.json', import.meta.url), 'utf8')) as { cases: GoldenCase[] };

describe('evals/golden/intr-cases.json', () => {
  for (const item of golden.cases) {
    it(item.name, () => {
      const t = run(item.params);
      expect(validateTrace(t)).toEqual([]);
      expect(t.steps.map((s) => s.state.box)).toEqual(item.expect.boxes);
      expect(t.table.rows.map((r) => r.cells)).toEqual(item.expect.table);
      expect(t.result).toEqual(item.expect.result);
    });
  }
});
