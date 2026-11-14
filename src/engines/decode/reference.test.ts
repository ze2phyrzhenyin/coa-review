import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, locate, run, validateParams, type Params } from './model';

// 独立参照测试：只按 specs/3-decode.md 写，不看 model.ts。
// 参照的做法：把地址空间按组大小切段，逐段看落进哪一组；查地址时逐组扫描。

// ---------- 规格里的参数形状 ----------

interface Chip {
  words: number | string;
  bits: number;
}
interface Region {
  kind: 'ROM' | 'RAM';
  // 规格不清：start、end 写成数字还是十六进制串没说，这里用数字。
  start: number;
  end: number;
  chip?: Chip;
}
interface Spec {
  addressBits: number;
  dataBits: number;
  regions: Region[];
  groupWords?: number;
  probe?: number;
}
const P = (s: Spec): Params => s as unknown as Params;

// ---------- 小工具 ----------

function wordsOf(w: number | string): number {
  if (typeof w === 'number') return w;
  const m = /^(\d+)([KM]?)$/.exec(w)!;
  return Number(m[1]!) * (m[2] === 'M' ? 2 ** 20 : m[2] === 'K' ? 2 ** 10 : 1);
}

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

/** 名字作为整词出现（RAM1 不算出现在 RAM10 里）。 */
const mentions = (text: string, name: string): boolean => new RegExp(`${name}(?!\\d)`).test(text);

// ---------- 朴素参照实现 ----------

interface Group {
  name: string;
  kind: 'ROM' | 'RAM';
  start: number;
  words: number;
  chips: number;
}

interface Ref {
  k: number;
  g: number;
  inputs: number;
  decoder: '74138' | '74139';
  inputLines: string;
  base: number;
  groups: Group[];
  totalChips: number;
  /** 每个 Y 输出的去向组名，空为 null；gate 为接法。 */
  ys: { group: string | null; gate: 'direct' | 'and' | 'nand' | null; from: number; to: number }[];
}

function reference(s: Spec): Ref {
  // 选片：每个区域按芯片字数切组。
  const raw: Omit<Group, 'name'>[] = [];
  for (const r of s.regions) {
    const len = r.end - r.start + 1;
    const cw = r.chip ? wordsOf(r.chip.words) : len;
    const perGroup = r.chip ? s.dataBits / r.chip.bits : 1;
    for (let a = r.start; a <= r.end; a += cw) raw.push({ kind: r.kind, start: a, words: cw, chips: perGroup });
  }
  const groups: Group[] = [];
  for (const kind of ['ROM', 'RAM'] as const) {
    const mine = raw.filter((x) => x.kind === kind).sort((a, b) => a.start - b.start);
    mine.forEach((x, i) => groups.push({ ...x, name: mine.length === 1 ? kind : `${kind}${i + 1}` }));
  }
  const chipWords = s.regions.filter((r) => r.chip).map((r) => wordsOf(r.chip!.words));
  const g = s.groupWords ?? Math.max(...chipWords);
  const k = bitsFor(g);
  const h = s.addressBits - k;
  const inputs = h === 2 ? 2 : 3;
  const decoder = inputs === 2 ? '74139' : '74138';
  const names: string[] = [];
  for (let i = inputs - 1; i >= 0; i -= 1) names.push(`A${k + i}`);
  // 基址：使能端上的地址线取的值，取任一区域首地址的高位。
  const windowSize = g * 2 ** inputs;
  const base = Math.floor(s.regions[0]!.start / windowSize) * windowSize;
  const ys: Ref['ys'] = [];
  for (let i = 0; i < 2 ** inputs; i += 1) {
    const from = base + i * g;
    const to = from + g - 1;
    const hit = groups.find((x) => x.start <= to && x.start + x.words - 1 >= from);
    ys.push({
      group: hit ? hit.name : null,
      gate: !hit ? null : hit.words === g ? 'direct' : hit.words > g ? 'and' : 'nand',
      from,
      to,
    });
  }
  const totalChips = groups.reduce((sum, x) => sum + x.chips, 0);
  return { k, g, inputs, decoder, inputLines: names.join('、'), base, groups, totalChips, ys };
}

function refLocate(ref: Ref, address: number): { group: string; offset: number; y: number } | null {
  for (const x of ref.groups) {
    if (address >= x.start && address < x.start + x.words) {
      const y = ref.ys.findIndex((seg) => address >= seg.from && address <= seg.to);
      return { group: x.name, offset: address - x.start, y };
    }
  }
  return null;
}

// ---------- 生成合格的参数 ----------
// 先定组大小 g 和译码窗口，再逐段决定放什么：空段、与 g 同大的芯片、大芯片、小芯片、无芯片 ROM。

interface Seg {
  kind: number;
  ram: boolean;
  bRaw: number;
  eRaw: number;
  offRaw: number;
  spanRaw: number;
  str: boolean;
}

const arbSeg: fc.Arbitrary<Seg> = fc.record({
  kind: fc.nat(4),
  ram: fc.boolean(),
  bRaw: fc.nat(),
  eRaw: fc.nat(),
  offRaw: fc.nat(),
  spanRaw: fc.nat(),
  str: fc.boolean(),
});

function divisors(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i += 1) if (n % i === 0) out.push(i);
  return out;
}

const arbSpec: fc.Arbitrary<Spec> = fc
  .record({
    n: fc.integer({ min: 8, max: 24 }),
    h: fc.integer({ min: 2, max: 5 }),
    dataBits: fc.integer({ min: 1, max: 64 }),
    zeroFirst: fc.boolean(),
    extraBit: fc.boolean(),
    segs: fc.array(arbSeg, { minLength: 8, maxLength: 8 }),
    explicitG: fc.boolean(),
    probe: fc.option(fc.nat(), { nil: null }),
  })
  .map(({ n, h, dataBits, zeroFirst, extraBit, segs, explicitG, probe }) => {
    const k = n - h;
    const g = 2 ** k;
    const inputs = h === 2 ? 2 : 3;
    const count = 2 ** inputs;
    const extras = h - inputs;
    // 多出的地址线：两根时一根恒 0、一根恒 1；一根时随意。
    let base = 0;
    if (extras === 2) base = (zeroFirst ? 0b10 : 0b01) * 2 ** (k + inputs);
    if (extras === 1 && extraBit) base = 2 ** (k + inputs);
    const ds = divisors(dataBits);
    const regions: Region[] = [];
    const chipOf = (seg: Seg, words: number): Chip => ({
      words: seg.str && words % 1024 === 0 ? `${words / 1024}K` : words,
      bits: ds[seg.bRaw % ds.length]!,
    });
    let s = 0;
    while (s < count) {
      const seg = segs[s]!;
      const at = base + s * g;
      const kind = seg.ram ? 'RAM' : 'ROM';
      // 大芯片占 2 或 4 段，无芯片 ROM 占 1、2 或 4 段；都要按自身长度对齐。
      const fits = (seg.kind === 2 ? [2, 4] : [1, 2, 4]).filter((m) => s % m === 0 && s + m <= count);
      const mult = fits.length === 0 ? 0 : fits[seg.eRaw % fits.length]!;
      if (seg.kind === 0) {
        s += 1;
      } else if (seg.kind === 1 || (seg.kind === 2 && mult === 0)) {
        const t = 1 + (seg.spanRaw % (count - s));
        regions.push({ kind, start: at, end: at + t * g - 1, chip: chipOf(seg, g) });
        s += t;
      } else if (seg.kind === 2) {
        const c = mult * g;
        const t = 1 + (seg.spanRaw % Math.floor((count - s) / mult));
        regions.push({ kind, start: at, end: at + t * c - 1, chip: chipOf(seg, c) });
        s += t * mult;
      } else if (seg.kind === 3) {
        const e = 1 + (seg.eRaw % 3);
        const c = g / 2 ** e;
        const off = (seg.offRaw % 2 ** e) * c;
        regions.push({ kind, start: at + off, end: at + off + c - 1, chip: chipOf(seg, c) });
        s += 1;
      } else {
        // 无芯片 ROM，按自身长度对齐。
        regions.push({ kind: 'ROM', start: at, end: at + mult * g - 1 });
        s += mult;
      }
    }
    // 全是空段时补一组 RAM；全是无芯片 ROM 时下面会显式给 groupWords。
    if (regions.length === 0) regions.push({ kind: 'RAM', start: base, end: base + g - 1, chip: { words: g, bits: dataBits } });
    const spec: Spec = { addressBits: n, dataBits, regions };
    const chipWords = regions.filter((r) => r.chip).map((r) => wordsOf(r.chip!.words));
    if (chipWords.length === 0 || Math.max(...chipWords) !== g || explicitG) spec.groupWords = g;
    if (probe !== null) spec.probe = probe % 2 ** n;
    return spec;
  });

const RUNS = { numRuns: 150 };
const SLOW = 30_000;

/** 每种情形挑几个地址：各组首尾、各区域外的段首、几个随机数。 */
function sampleAddresses(s: Spec, ref: Ref, seeds: number[]): number[] {
  const out = new Set<number>();
  for (const x of ref.groups) {
    out.add(x.start);
    out.add(x.start + x.words - 1);
  }
  for (const y of ref.ys) out.add(y.from);
  out.add(0);
  out.add(2 ** s.addressBits - 1);
  for (const v of seeds) out.add(v % 2 ** s.addressBits);
  return [...out];
}

// ---------- 性质 ----------

describe('decode：Trace 的形状', () => {
  it('validateTrace 为空，两次 run 完全相同，步数按规格，全是讲解步', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        expect(validateTrace(trace)).toEqual([]);
        expect(run(P(s))).toEqual(trace);
        const ref = reference(s);
        const expected = 1 + s.regions.length + 1 + 1 + ref.ys.length + 1 + (s.probe !== undefined ? 1 : 0);
        expect(trace.steps.length).toBe(expected);
        for (const step of trace.steps) expect(step.level).toBe('explain');
      }),
      RUNS,
    );
  }, SLOW);

  it('解题表：每个 Y 一行，地址范围按 ⌈n/4⌉ 位十六进制带 H，指回该 Y 的步', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        const ref = reference(s);
        expect(trace.table.columns).toEqual(['译码输出', '地址范围', '接到', '门电路']);
        expect(trace.table.rows.length).toBe(ref.ys.length);
        const firstY = 1 + s.regions.length + 2;
        ref.ys.forEach((y, i) => {
          const row = trace.table.rows[i]!;
          expect(row.cells[0]).toBe(`Y${i}`);
          // 规格不清：起止之间用什么连接没写，只查两端都在。
          expect(row.cells[1]).toContain(hex(y.from, s.addressBits));
          expect(row.cells[1]).toContain(hex(y.to, s.addressBits));
          expect(row.step).toBe(trace.steps[firstY + i]!.id);
        });
      }),
      RUNS,
    );
  }, SLOW);

  it('预测题：每个 Y 步问接到哪里，选项是各组名和「空」', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const trace = run(P(s));
        const ref = reference(s);
        const firstY = 1 + s.regions.length + 2;
        const options = [...ref.groups.map((x) => x.name), '空'].sort();
        ref.ys.forEach((y, i) => {
          const ask = trace.steps[firstY + i]!.ask!;
          expect(ask.kind).toBe('choice');
          expect([...ask.options!].sort()).toEqual(options);
          expect(ask.answer).toBe(y.group ?? '空');
        });
        if (s.probe !== undefined) {
          const ask = trace.steps[trace.steps.length - 1]!.ask!;
          const hit = refLocate(ref, s.probe);
          if (hit) expect(mentions(ask.answer, hit.group)).toBe(true);
        }
      }),
      RUNS,
    );
  }, SLOW);
});

describe('decode：与参照对拍', () => {
  it('result：译码器、译码输入、每个 Y 的去向和门电路', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const { result, table } = run(P(s));
        const ref = reference(s);
        // 规格不清：译码器的写法没定（74138 / 74LS138 / 3:8），只查型号尾数。
        expect(result['译码器']).toContain(ref.decoder === '74138' ? '138' : '139');
        expect(result['译码输入']).toBe(ref.inputLines);
        ref.ys.forEach((y, i) => {
          const text = result[`Y${i}`]!;
          if (y.group === null) {
            expect(text).toBe('空');
            return;
          }
          expect(mentions(text, y.group)).toBe(true);
          // 每个 Y 只接一组（性质 2 在译码端的体现）。
          for (const other of ref.groups) if (other.name !== y.group && /\d$/.test(other.name)) expect(mentions(text, other.name)).toBe(false);
          // 规格不清：门电路写在 result 的 Yi 里还是只写在解题表「门电路」列没说；按表列查。
          const gate = table.rows[i]!.cells[3]!;
          expect(table.rows[i]!.cells[2]).toBe(text);
          if (y.gate === 'and') expect(gate).toContain('与门');
          if (y.gate === 'nand') expect(gate).toContain('与非门');
          if (y.gate === 'direct') expect(gate).not.toMatch(/与门|与非门|非门/);
        });
      }),
      RUNS,
    );
  }, SLOW);

  it('性质 3：result「芯片」里各项片数之和 = 各组片数之和', () => {
    fc.assert(
      fc.property(arbSpec, (s) => {
        const { result } = run(P(s));
        const ref = reference(s);
        const text = result['芯片']!;
        const sum = [...text.matchAll(/(\d+)\s*片/g)].reduce((acc, m) => acc + Number(m[1]!), 0);
        expect(sum).toBe(ref.totalChips);
        for (const kind of new Set(ref.groups.map((x) => x.kind))) expect(text).toContain(kind);
      }),
      RUNS,
    );
  }, SLOW);

  it('性质 1、2：probe 选中的组和片内地址与参照一致，区域外没有芯片；locate 与之相同', () => {
    fc.assert(
      fc.property(arbSpec, fc.array(fc.nat(), { minLength: 3, maxLength: 3 }), (s, seeds) => {
        const ref = reference(s);
        const addresses = sampleAddresses(s, ref, seeds);
        // 每种情形只对 4 个地址跑完整 run，其余只调 locate。
        addresses.forEach((address, i) => {
          const hit = refLocate(ref, address);
          if (i % Math.ceil(addresses.length / 4) === 0) {
            const chosen = run(P({ ...s, probe: address })).result['选中']!;
            if (hit === null) {
              expect(chosen).toBe('没有芯片');
            } else {
              const m = /^(\S+?)（Y(\d+)），片内地址 ([0-9A-F]+)H$/.exec(chosen);
              expect(m).not.toBeNull();
              expect(m![1]).toBe(hit.group);
              expect(Number(m![2]!)).toBe(hit.y);
              // 规格不清：片内地址的位数没定，只比数值。
              expect(parseInt(m![3]!, 16)).toBe(hit.offset);
            }
          }
          // 规格不清：locate 的返回形状没写，只查它说出的组名。
          const text = JSON.stringify(locate(P(s), address) ?? null);
          // 不带编号的名字（ROM、RAM）可能作为 kind 出现，反向只查带编号的。
          if (hit) expect(mentions(text, hit.group)).toBe(true);
          for (const x of ref.groups) if (x.name !== hit?.group && /\d$/.test(x.name)) expect(mentions(text, x.name)).toBe(false);
        });
      }),
      { numRuns: 80 },
    );
  }, SLOW);
});

describe('decode：generate', () => {
  it('generate(seed) 给出合格参数，同一种子同一结果', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(generate(seed)).toEqual(p);
      expect(() => run(p)).not.toThrow();
      expect(validateTrace(run(p))).toEqual([]);
    }
  });
});

// ---------- 场景 ----------

const book: Spec = {
  addressBits: 16,
  dataBits: 16,
  regions: [
    { kind: 'ROM', start: 0x0000, end: 0x3fff },
    { kind: 'RAM', start: 0x6000, end: 0xffff, chip: { words: '8K', bits: 8 } },
  ],
};

describe('decode：场景', () => {
  it('ROM 0000H–3FFFH + RAM 6000H–FFFFH（8K×8）：RAM 10 片，74138 输入 A15、A14、A13', () => {
    const trace = run(P(book));
    expect(validateTrace(trace)).toEqual([]);
    const { result } = trace;
    expect(result['芯片']).toMatch(/RAM：8K×8 位 10 片/);
    expect(result['译码器']).toContain('138');
    expect(result['译码输入']).toBe('A15、A14、A13');
    for (const [i, y] of ['Y0', 'Y1'].entries()) {
      expect(mentions(result[y]!, 'ROM')).toBe(true);
      expect(trace.table.rows[i]!.cells[3]).toContain('与门');
    }
    expect(result['Y2']).toBe('空');
    for (let i = 3; i <= 7; i += 1) expect(mentions(result[`Y${i}`]!, `RAM${i - 2}`)).toBe(true);
  });

  it('最高 2K 用 2K×16 位芯片、组大小 8K：经 Y7、非门、与非门（A12、A11）选中', () => {
    const s: Spec = {
      addressBits: 16,
      dataBits: 16,
      groupWords: 8192,
      regions: [
        { kind: 'ROM', start: 0x0000, end: 0x3fff },
        { kind: 'RAM', start: 0x6000, end: 0xdfff, chip: { words: '8K', bits: 8 } },
        { kind: 'RAM', start: 0xf800, end: 0xffff, chip: { words: '2K', bits: 16 } },
      ],
      probe: 0xf805,
    };
    const { result, table } = run(P(s));
    expect(mentions(result['Y7']!, 'RAM5')).toBe(true);
    const y7 = table.rows[7]!.cells[3]!;
    expect(y7).toContain('非门');
    expect(y7).toContain('与非门');
    expect(y7).toMatch(/A12(?!\d)/);
    expect(y7).toMatch(/A11(?!\d)/);
    expect(result['Y2']).toBe('空');
    expect(mentions(result['Y6']!, 'RAM4')).toBe(true);
    expect(result['选中']).toMatch(/^RAM5（Y7），片内地址 0*5H$/);
  });

  it('区域重叠、多出的地址线在区域间取值不同时 run 抛错，validateParams 非空', () => {
    const overlap: Spec = {
      addressBits: 16,
      dataBits: 16,
      regions: [
        { kind: 'ROM', start: 0x0000, end: 0x3fff },
        { kind: 'RAM', start: 0x2000, end: 0x5fff, chip: { words: '8K', bits: 8 } },
      ],
    };
    // 组大小 4K：A14–A12 进 74138，A15 多出来，两个区域里 A15 一个 0 一个 1。
    const spread: Spec = {
      addressBits: 16,
      dataBits: 8,
      groupWords: 4096,
      regions: [
        { kind: 'ROM', start: 0x0000, end: 0x0fff },
        { kind: 'RAM', start: 0x8000, end: 0x8fff, chip: { words: '4K', bits: 8 } },
      ],
    };
    for (const s of [overlap, spread]) {
      expect(() => run(P(s))).toThrow();
      expect(validateParams(P(s)).length).toBeGreaterThan(0);
    }
  });
});
