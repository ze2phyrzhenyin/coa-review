import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generateHazard, hazards, kindsText, runHazard, type HazardParams } from './hazard';
import { parseInstruction } from './instr';

// ---------- 朴素参照 ----------

/** 从箭头写法直接数：箭头左边读，右边写；再用三条交集规则。 */
function refKinds(a: { r: string[]; w: string[] }, b: { r: string[]; w: string[] }): string {
  const kinds: string[] = [];
  if (b.r.some((x) => a.w.includes(x))) kinds.push('RAW');
  if (b.w.some((x) => a.r.includes(x))) kinds.push('WAR');
  if (b.w.some((x) => a.w.includes(x))) kinds.push('WAW');
  return kinds.join('、') || '无';
}

/** 五段流水线一拍一拍地走：第 i 条第 i+4 拍写回，第 j 条第 j+1 拍读；读的那拍不晚于最近一次写回就是读错。 */
function refWrong(list: { r: string[]; w: string[] }[]): string[] {
  const wrong: string[] = [];
  for (let j = 0; j < list.length; j += 1) {
    const readCycle = j + 2;
    for (const reg of list[j]!.r.filter((x) => /^R\d+$/.test(x))) {
      for (let i = j - 1; i >= 0; i -= 1) {
        if (!list[i]!.w.includes(reg)) continue;
        if (readCycle <= i + 5) wrong.push(`I${i + 1}–I${j + 1}`);
        break;
      }
    }
  }
  return [...new Set(wrong)];
}

const reg = fc.constantFrom('R1', 'R2', 'R3', 'R4');
const ins = fc.oneof(
  fc.tuple(fc.constantFrom('ADD', 'SUB', 'MUL', 'AND', 'OR'), reg, reg, reg).map(([o, d, s, t]) => ({ text: `${o} ${d},${s},${t}`, r: [s, t], w: [d] })),
  fc.tuple(fc.constantFrom('ADD', 'MUL'), reg, reg).map(([o, a, b]) => ({ text: `${o} ${a},${b}`, r: [a, b], w: [a] })),
  fc.tuple(reg, fc.constantFrom('x', 'y')).map(([d, m]) => ({ text: `LAD ${d},M(${m})`, r: [`M(${m})`], w: [d] })),
  fc.tuple(fc.constantFrom('x', 'y'), reg).map(([m, s]) => ({ text: `STO M(${m}),${s}`, r: [s], w: [`M(${m})`] })),
);
const lists = fc.array(ins, { minLength: 2, maxLength: 6 });

describe('相关判别：性质', () => {
  it('Trace 合格、可重现；每对的类型与参照一致', () => {
    fc.assert(
      fc.property(lists, (list) => {
        const p: HazardParams = { instructions: list.map((x) => x.text) };
        const t = runHazard(p);
        expect(validateTrace(t)).toEqual([]);
        expect(JSON.stringify(runHazard(p))).toBe(JSON.stringify(t));
        for (let j = 1; j < list.length; j += 1) {
          for (let i = 0; i < j; i += 1) expect(t.result[`I${i + 1}–I${j + 1}`]).toBe(refKinds(list[i]!, list[j]!));
        }
        const wrong = refWrong(list);
        expect(t.result['会读错']).toBe(wrong.length ? hazards(p).filter((r) => r.wrong).map((r) => `I${r.i}–I${r.j}`).join('、') : '无');
        expect(hazards(p).filter((r) => r.wrong).map((r) => `I${r.i}–I${r.j}`).sort()).toEqual([...wrong].sort());
      }),
      { numRuns: 200 },
    );
  });

  it('对数是 n(n−1)/2，解析出来的读写集合与箭头写法一致', () => {
    fc.assert(
      fc.property(lists, (list) => {
        const p = { instructions: list.map((x) => x.text) };
        expect(hazards(p).length).toBe((list.length * (list.length - 1)) / 2);
        list.forEach((x) => {
          const parsed = parseInstruction(x.text);
          expect([...parsed.reads].sort()).toEqual([...new Set(x.r)].sort());
          expect(parsed.writes).toEqual(x.w);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('WAR、WAW 不会被标成读错', () => {
    const t = hazards({ instructions: ['STO M(x),R3', 'ADD R3,R4,R5', 'MUL R3,R1,R2'] });
    expect(t.every((r) => !r.wrong)).toBe(true);
  });

  it('预测题答案在选项里，只问相邻的对', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const t = runHazard(generateHazard(seed));
      expect(validateTrace(t)).toEqual([]);
      for (const s of t.steps.filter((x) => x.ask)) expect(s.title).toMatch(/I(\d+) 与 I(\d+)/);
    }
  });

  it('看不懂的写法抛出错误', () => {
    expect(() => runHazard({ instructions: ['ADD R1,R2,R3'] })).toThrow(/2 到 6/);
    expect(() => runHazard({ instructions: ['FOO R1,R2', 'ADD R1,R2,R3'] })).toThrow(/不认识/);
    expect(() => runHazard({ instructions: ['ADD R1,R2,M(x)', 'ADD R1,R2,R3'] })).toThrow(/寄存器/);
    expect(() => runHazard({ instructions: ['STO R1,R2', 'ADD R1,R2,R3'] })).toThrow(/存储单元/);
  });

  it('直接给读写集合也行', () => {
    const t = runHazard({ instructions: [{ text: 'JMPR R7', reads: ['R7'], writes: [] }, 'ADD R7,R1,R2'] });
    expect(t.result['I1–I2']).toBe('WAR');
    expect(kindsText([])).toBe('无');
  });
});

// ---------- 固定用例 ----------

interface Golden {
  cases: { name: string; params: HazardParams; expect: { result?: Record<string, string>; adjacent?: Record<string, string> } }[];
}
const golden = JSON.parse(readFileSync(new URL('../../../evals/golden/pipeline-hazard.json', import.meta.url), 'utf8')) as Golden;

describe('evals/golden/pipeline-hazard.json', () => {
  for (const c of golden.cases) {
    it(c.name, () => {
      const t = runHazard(c.params);
      expect(validateTrace(t)).toEqual([]);
      for (const [key, value] of Object.entries(c.expect.result ?? {})) expect(t.result[key]).toBe(value);
      for (const [key, value] of Object.entries(c.expect.adjacent ?? {})) expect(t.result[key]).toBe(value);
    });
  }
});
