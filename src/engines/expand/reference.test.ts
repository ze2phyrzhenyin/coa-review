import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, parseWords, run, validateParams, type Params } from './model';

// 独立参照测试：只按 specs/3-expand.md 写，不看 model.ts。

// ---------- 规格里的参数和状态形状 ----------

type Words = number | string;
interface Spec {
  target: { words: Words; bits: number };
  chip: { words: Words; bits: number };
  probe?: number;
}
const P = (s: Spec): Params => s as unknown as Params;

interface ChipRow {
  group: number;
  index: number;
  data: string;
  select: string;
}
interface RangeRow {
  group: number;
  select: string;
  from: string;
  to: string;
}
interface ExpandState {
  d: unknown;
  perGroup: unknown;
  groups: unknown;
  chipLines: unknown;
  decoderLines: unknown;
  decoder: unknown;
  chips: ChipRow[];
  ranges: RangeRow[];
  probe: unknown;
}

// ---------- 小工具 ----------

function wordsOf(w: Words): number {
  if (typeof w === 'number') return w;
  const m = /^(\d+)([KM]?)$/.exec(w)!;
  const unit = m[2] === 'M' ? 1024 * 1024 : m[2] === 'K' ? 1024 : 1;
  return Number(m[1]!) * unit;
}

/** 数 2 翻倍几次到 x，不用 Math.log2。 */
function bitsFor(x: number): number {
  let n = 0;
  let v = 1;
  while (v < x) {
    v *= 2;
    n += 1;
  }
  return n;
}

const hex = (v: number, n: number): string => `${v.toString(16).toUpperCase().padStart(Math.ceil(n / 4), '0')}H`;

/** 从「A17–A0」「A14、A13」这类写法里读出全部地址线号，从高到低。 */
function lines(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/A(\d+)(?:\s*[–-]\s*A(\d+))?/g)) {
    const hi = Number(m[1]!);
    const lo = m[2] === undefined ? hi : Number(m[2]);
    for (let i = Math.max(hi, lo); i >= Math.min(hi, lo); i -= 1) out.push(i);
  }
  return [...new Set(out)].sort((a, b) => b - a);
}

/** 数据线位段「D7–D4」或「D3」→ [高, 低]。 */
function dataSpan(text: string): [number, number] {
  const range = /^D(\d+)–D(\d+)$/.exec(text);
  if (range) return [Number(range[1]!), Number(range[2]!)];
  const one = /^D(\d+)$/.exec(text)!;
  return [Number(one[1]!), Number(one[1]!)];
}

const lastInt = (text: string): number => Number(/(\d+)(?!.*\d)/s.exec(text)![1]!);

const down = (hi: number, lo: number): number[] => {
  const out: number[] = [];
  for (let i = hi; i >= lo; i -= 1) out.push(i);
  return out;
};

/** 状态里的「地址线」可能是数字、串或数组；统一数出根数。 */
function countLines(v: unknown): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'string') return lines(v).length;
  return 0;
}

// ---------- 朴素参照实现 ----------

interface Ref {
  d: number;
  perGroup: number;
  groups: number;
  n: number;
  k: number;
  mode: string;
  chips: { group: number; index: number; data: string }[];
  ranges: { group: number; select: string; from: string; to: string }[];
  rangeText: string | null;
  probe: { group: number; offset: number } | null;
}

function reference(s: Spec): Ref {
  const tw = wordsOf(s.target.words);
  const cw = wordsOf(s.chip.words);
  const tb = s.target.bits;
  const cb = s.chip.bits;
  const d = (tw * tb) / (cw * cb);
  // 每组片数、组数用逐段累加来数，不做除法。
  let perGroup = 0;
  for (let bit = 0; bit < tb; bit += cb) perGroup += 1;
  let groups = 0;
  for (let a = 0; a < tw; a += cw) groups += 1;
  const mode = perGroup > 1 && groups > 1 ? '字位扩展' : perGroup > 1 ? '位扩展' : '字扩展';
  const n = bitsFor(tw);
  const k = bitsFor(cw);
  const chips: Ref['chips'] = [];
  for (let g = 0; g < groups; g += 1) {
    for (let j = 0; j < perGroup; j += 1) {
      const lo = j * cb;
      const hi = lo + cb - 1;
      chips.push({ group: g, index: j, data: cb === 1 ? `D${j}` : `D${hi}–D${lo}` });
    }
  }
  const ranges: Ref['ranges'] = [];
  if (groups > 1) {
    let start = 0;
    for (let g = 0; g < groups; g += 1) {
      ranges.push({ group: g, select: `Y${g}`, from: hex(start, n), to: hex(start + cw - 1, n) });
      start += cw;
    }
  }
  const rangeText = groups > 1 ? ranges.map((r) => `${r.select}：${r.from}–${r.to}`).join('；') : null;
  let probe: Ref['probe'] = null;
  if (s.probe !== undefined) {
    let g = 0;
    let start = 0;
    while (start + cw <= s.probe) {
      start += cw;
      g += 1;
    }
    probe = { group: g, offset: s.probe - start };
  }
  return { d, perGroup, groups, n, k, mode, chips, ranges, rangeText, probe };
}

// ---------- 生成合格的参数 ----------

type Form = 'num' | 'K' | 'M';
function writeWords(words: number, form: Form): Words {
  if (form === 'M' && words % 2 ** 20 === 0) return `${words / 2 ** 20}M`;
  if (form !== 'num' && words % 2 ** 10 === 0) return `${words / 2 ** 10}K`;
  return words;
}

const arbForm = fc.constantFrom<Form>('num', 'K', 'M');

const arbSpec: fc.Arbitrary<Spec> = fc
  .record({
    h: fc.integer({ min: 0, max: 4 }),
    k: fc.integer({ min: 1, max: 26 }),
    p: fc.integer({ min: 1, max: 16 }),
    bRaw: fc.nat(),
    tForm: arbForm,
    cForm: arbForm,
    probe: fc.option(fc.nat(), { nil: null }),
  })
  .map(({ h, k, p, bRaw, tForm, cForm, probe }) => {
    const kk = Math.min(k, 30 - h);
    const perGroup = h === 0 && p === 1 ? 2 : p; // d ≥ 2
    const b = 1 + (bRaw % Math.floor(64 / perGroup));
    const tw = 2 ** (kk + h);
    const cw = 2 ** kk;
    const spec: Spec = {
      target: { words: writeWords(tw, tForm), bits: b * perGroup },
      chip: { words: writeWords(cw, cForm), bits: b },
    };
    if (probe !== null) spec.probe = probe % tw;
    return spec;
  });

const RUNS = { numRuns: 150 };
const SLOW = 30_000;

const lastState = (s: Spec): ExpandState => {
  const trace = run(P(s));
  return trace.steps[trace.steps.length - 1]!.state as unknown as ExpandState;
};

// ---------- 性质 ----------

describe('expand：Trace 的形状', () => {
  it('validateTrace 为空，两次 run 完全相同，步数和步的层级按规格', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        expect(validateTrace(trace)).toEqual([]);
        expect(run(P(s))).toEqual(trace);
        const ref = reference(s);
        const expected =
          1 + (ref.perGroup > 1 ? 1 : 0) + (ref.groups > 1 ? 1 : 0) + 1 + (ref.groups > 1 ? ref.groups : 0) + (s.probe !== undefined ? 1 : 0);
        expect(trace.steps.length).toBe(expected);
        for (const step of trace.steps) expect(step.level).toBe('explain');
      }),
      RUNS,
    );
  }, SLOW);

  it('解题表：三列，行依次为芯片数、每组片数、组数、片内地址线、片选、各组，每行指回一步', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        const ref = reference(s);
        expect(trace.table.columns).toEqual(['项目', '算式或接法', '结果']);
        const labels = ['芯片数', '每组片数', '组数', '片内地址线'];
        if (ref.groups > 1) {
          labels.push('片选');
          for (let i = 0; i < ref.groups; i += 1) labels.push(`第 ${i} 组`);
        }
        // 规格不清：项目名后面能不能带记号（如「芯片数 d」）没说，只查开头。
        expect(trace.table.rows.length).toBe(labels.length);
        labels.forEach((label, i) => expect(trace.table.rows[i]!.cells[0]!.startsWith(label)).toBe(true));
        for (const row of trace.table.rows) expect(row.step).toBeDefined();
      }),
      RUNS,
    );
  }, SLOW);

  it('预测题：组数 > 1 时地址线步问译码位（含片内位、全部位两个错答），给了 probe 时最后一步问第几组', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        const ref = reference(s);
        // 按题型找，不按位置找：步数对不对由上一条测试管。
        const choices = trace.steps.filter((step) => step.ask?.kind === 'choice');
        expect(choices.length).toBe(ref.groups > 1 ? 1 : 0);
        if (ref.groups > 1) {
          const ask = choices[0]!.ask!;
          expect(ask.kind).toBe('choice');
          expect(lines(ask.answer)).toEqual(down(ref.n - 1, ref.k));
          const parsed = ask.options!.map((o) => lines(o));
          // 规格不清：「把片内位当片选」是整段 A(k−1)–A0 还是其中几位没说；接受全落在片内位里的选项。
          expect(parsed.some((ls) => ls.length > 0 && ls.every((x) => x < ref.k))).toBe(true);
          expect(parsed.map((ls) => JSON.stringify(ls))).toContain(JSON.stringify(down(ref.n - 1, 0)));
        }
        // 规格不清：只有 1 组时查地址步问不问「第几组」没说，只查组数 > 1。
        if (s.probe !== undefined && ref.groups > 1) {
          const ask = trace.steps[trace.steps.length - 1]!.ask!;
          expect(ask.kind).toBe('number');
          expect(ask.answer).toBe(String(ref.probe!.group));
        }
      }),
      RUNS,
    );
  }, SLOW);
});

describe('expand：与参照对拍', () => {
  it('result 的各项与参照一致', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const { result } = run(P(s));
        const ref = reference(s);
        expect(result['扩展方式']).toBe(ref.mode);
        // 规格不清：芯片数、每组片数、组数的写法没定，取串里最后一个整数。
        expect(lastInt(result['芯片数']!)).toBe(ref.d);
        expect(lastInt(result['每组片数']!)).toBe(ref.perGroup);
        expect(lastInt(result['组数']!)).toBe(ref.groups);
        expect(lines(result['片内地址线']!)).toEqual(down(ref.k - 1, 0));
        if (ref.groups > 1) {
          expect(lines(result['译码地址线']!)).toEqual(down(ref.n - 1, ref.k));
          expect(result['地址范围']).toBe(ref.rangeText);
        } else {
          expect(result['译码地址线']).toBe('无');
          expect(result['地址范围']).toBeUndefined();
        }
        if (s.probe === undefined) {
          expect(result['选中']).toBeUndefined();
        } else if (ref.groups === 1) {
          // 规格不清：只有 1 组时「选中」怎么写没说，只比片内地址。
          const m = /片内地址 ([0-9A-F]+)H$/.exec(result['选中']!);
          expect(m).not.toBeNull();
          expect(parseInt(m![1]!, 16)).toBe(ref.probe!.offset);
        } else {
          // 规格不清：片内地址的十六进制位数没定，只比数值。
          const m = /^第 (\d+) 组（Y(\d+)），片内地址 ([0-9A-F]+)H$/.exec(result['选中']!)!;
          expect(m).not.toBeNull();
          expect(Number(m[1]!)).toBe(ref.probe!.group);
          expect(Number(m[2]!)).toBe(ref.probe!.group);
          expect(parseInt(m[3]!, 16)).toBe(ref.probe!.offset);
        }
      }),
      RUNS,
    );
  }, SLOW);

  it('最后状态：chips、ranges、译码器与参照一致', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const st = lastState(s);
        const ref = reference(s);
        const chips = [...st.chips].sort((a, b) => a.group - b.group || a.index - b.index);
        expect(chips.map((c) => ({ group: c.group, index: c.index, data: c.data }))).toEqual(ref.chips);
        if (ref.groups > 1) {
          // 规格不清：片选写成 Yi（按要求 4 和 result 的「Y0：…」推定）。
          for (const c of chips) expect(c.select).toBe(`Y${c.group}`);
          expect(st.ranges).toEqual(ref.ranges);
          expect(String(st.decoder)).toContain(`${ref.n - ref.k}:${2 ** (ref.n - ref.k)}`);
        } else {
          expect(new Set(chips.map((c) => c.select)).size).toBe(1);
          // 规格不清：组数为 1 时 ranges 没有填的步，按空表处理。
          expect(st.ranges).toEqual([]);
          expect(String(st.decoder ?? '')).not.toMatch(/\d:\d/);
        }
      }),
      RUNS,
    );
  }, SLOW);

  it('性质 1–5：片数、范围首尾相接、地址线位数、数据线位段、probe 落在所在组', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        const st = trace.steps[trace.steps.length - 1]!.state as unknown as ExpandState;
        const ref = reference(s);
        const tw = wordsOf(s.target.words);
        // 1
        expect(ref.perGroup * ref.groups).toBe(ref.d);
        expect(st.chips.length).toBe(ref.d);
        // 2
        if (ref.groups > 1) {
          let next = 0;
          for (const r of st.ranges) {
            expect(parseInt(r.from, 16)).toBe(next);
            next = parseInt(r.to, 16) + 1;
          }
          expect(next).toBe(tw);
        }
        // 3（规格不清：chipLines/decoderLines 的类型没定，按数字、串或数组数根数）
        expect(countLines(st.chipLines) + countLines(st.decoderLines)).toBe(bitsFor(tw));
        // 4
        for (let g = 0; g < ref.groups; g += 1) {
          const used = new Set<number>();
          for (const c of st.chips.filter((x) => x.group === g)) {
            const [hi, lo] = dataSpan(c.data);
            for (let bit = lo; bit <= hi; bit += 1) {
              expect(used.has(bit)).toBe(false);
              used.add(bit);
            }
          }
          expect([...used].sort((a, b) => a - b)).toEqual(down(s.target.bits - 1, 0).reverse());
        }
        // 5
        if (s.probe !== undefined && ref.groups > 1) {
          const r = st.ranges.find((x) => x.group === ref.probe!.group)!;
          expect(parseInt(r.from, 16)).toBeLessThanOrEqual(s.probe);
          expect(parseInt(r.to, 16)).toBeGreaterThanOrEqual(s.probe);
        }
      }),
      RUNS,
    );
  }, SLOW);
});

describe('expand：generate 与 parseWords', () => {
  it('generate(seed) 给出合格参数，同一种子同一结果', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(generate(seed)).toEqual(p);
      expect(() => run(p)).not.toThrow();
      expect(validateTrace(run(p))).toEqual([]);
    }
  });

  it('parseWords 认 K 和 M', () => {
    // 规格不清：parseWords 的签名没写，按「串或数 → 字数」理解。
    expect(parseWords('2048K')).toBe(2048 * 1024);
    expect(parseWords('1M')).toBe(2 ** 20);
  });
});

// ---------- 场景 ----------

describe('expand：场景', () => {
  it('1M×4 → 1M×8：d = 2，位扩展，无译码地址线，D7–D4 与 D3–D0 各接一片', () => {
    const s: Spec = { target: { words: '1M', bits: 8 }, chip: { words: '1M', bits: 4 } };
    const trace = run(P(s));
    expect(validateTrace(trace)).toEqual([]);
    expect(lastInt(trace.result['芯片数']!)).toBe(2);
    expect(trace.result['扩展方式']).toBe('位扩展');
    expect(trace.result['译码地址线']).toBe('无');
    const st = lastState(s);
    expect(st.chips.map((c) => c.data).sort()).toEqual(['D3–D0', 'D7–D4']);
  });

  it('256K×8 → 2048K×8：d = 8，字扩展，A17–A0 接每片，A20–A18 进 3:8 译码器，第 7 组 1C0000H–1FFFFFH', () => {
    const s: Spec = { target: { words: '2048K', bits: 8 }, chip: { words: '256K', bits: 8 } };
    const { result } = run(P(s));
    expect(lastInt(result['芯片数']!)).toBe(8);
    expect(result['扩展方式']).toBe('字扩展');
    expect(lines(result['片内地址线']!)).toEqual(down(17, 0));
    expect(lines(result['译码地址线']!)).toEqual([20, 19, 18]);
    const st = lastState(s);
    expect(String(st.decoder)).toContain('3:8');
    expect(st.ranges[7]).toEqual({ group: 7, select: 'Y7', from: '1C0000H', to: '1FFFFFH' });
  });

  it('8K×8 → 32K×16：字位扩展，8 片，4 组每组 2 片，A14、A13 进 2:4 译码器', () => {
    const s: Spec = { target: { words: '32K', bits: 16 }, chip: { words: '8K', bits: 8 } };
    const { result } = run(P(s));
    expect(result['扩展方式']).toBe('字位扩展');
    expect(lastInt(result['芯片数']!)).toBe(8);
    expect(lastInt(result['组数']!)).toBe(4);
    expect(lastInt(result['每组片数']!)).toBe(2);
    expect(lines(result['译码地址线']!)).toEqual([14, 13]);
    expect(String(lastState(s).decoder)).toContain('2:4');
    expect(result['地址范围']).toBe('Y0：0000H–1FFFH；Y1：2000H–3FFFH；Y2：4000H–5FFFH；Y3：6000H–7FFFH');
  });

  it('芯片比目标大、位数不整除时 run 抛错，validateParams 非空', () => {
    const bigger: Spec = { target: { words: '8K', bits: 8 }, chip: { words: '16K', bits: 8 } };
    const notDividing: Spec = { target: { words: '32K', bits: 12 }, chip: { words: '8K', bits: 8 } };
    for (const s of [bigger, notDividing]) {
      expect(() => run(P(s))).toThrow();
      expect(validateParams(P(s)).length).toBeGreaterThan(0);
    }
  });
});
