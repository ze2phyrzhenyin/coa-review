import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { plan, run, generate, type OpcodeParams } from './model';

// ---------- 朴素参照：只按 specs/4-opcode.md 和 docs/textbook/ch04-05.md「扩展操作码」写 ----------
// 编码一个一个列成二进制字符串：第一类是 opBits 位的全部编码；以后每一类 = 上一类留下的每个码 × 全部「多出位数」的后缀。
// 每类从小到大取，留最大的几个码（表 4.2 的排法，p129–130）。

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const nameOf = (addresses: number): string => `${DIGITS[addresses]}地址`;

interface RefLevel {
  opBits: number;
  available: number;
  used: number | null;
  reserved: number | null;
  usedCodes: string[];
  reservedCodes: string[];
  firstAvailable: string;
}
interface Ref {
  feasible: boolean;
  failAt: number | null;
  maxLevel: number | null;
  maxCount: number | null;
  /** 求最多的那一类正好只剩 0 条：规格没说算不算可行，测试跳过。 */
  ambiguous: boolean;
  levels: RefLevel[];
}

function allStrings(bits: number): string[] {
  let out = [''];
  for (let b = 0; b < bits; b++) out = out.flatMap((s) => [s + '0', s + '1']);
  return out;
}

function reference(p: OpcodeParams): Ref {
  const n = p.levels.length;
  const opBits = p.levels.map((l) => p.wordBits - l.addresses * p.addressBits);
  const extra = opBits.map((b, i) => (i === 0 ? b : b - opBits[i - 1]!));
  const maxLevel = p.levels.findIndex((l) => l.count === undefined);
  // 求最多那一类后面各类要的前缀数，从后往前推（规格 要求 5）。
  const need = new Array<number>(n).fill(0); // need[i] = 第 i 类要给后面留几个码
  for (let i = n - 2; i >= 0; i--) {
    const next = p.levels[i + 1];
    const codesNext = (next!.count ?? 0) + need[i + 1]!;
    need[i] = Math.ceil(codesNext / 2 ** extra[i + 1]!);
  }
  const levels: RefLevel[] = [];
  let prefixes = [''];
  let failAt: number | null = null;
  let maxCount: number | null = null;
  let ambiguous = false;
  for (let i = 0; i < n; i++) {
    const suffixes = allStrings(extra[i]!);
    const codes = prefixes.flatMap((pre) => suffixes.map((s) => pre + s));
    const available = codes.length;
    const last = i === n - 1;
    let used: number;
    let reserved: number;
    if (i === maxLevel) {
      used = available - need[i]!;
      reserved = last ? 0 : need[i]!;
      if (used <= 0) ambiguous = ambiguous || used === 0;
      if (used < 0) {
        levels.push({ opBits: opBits[i]!, available, used: null, reserved: null, usedCodes: [], reservedCodes: [], firstAvailable: codes[0] ?? '' });
        failAt = i;
        break;
      }
      maxCount = used;
    } else {
      const count = p.levels[i]!.count as number;
      if (count > available) {
        levels.push({ opBits: opBits[i]!, available, used: null, reserved: null, usedCodes: [], reservedCodes: [], firstAvailable: codes[0] ?? '' });
        failAt = i;
        break;
      }
      used = count;
      reserved = last ? 0 : available - used;
    }
    const usedCodes = codes.slice(0, used);
    const reservedCodes = reserved > 0 ? codes.slice(available - reserved) : [];
    levels.push({ opBits: opBits[i]!, available, used, reserved: last ? null : reserved, usedCodes, reservedCodes, firstAvailable: codes[0]! });
    prefixes = reservedCodes;
  }
  return { feasible: failAt === null, failAt, maxLevel: maxLevel < 0 ? null : maxLevel, maxCount, ambiguous, levels };
}

/** 「基本操作码,一组,一组」：第一组是第一类的操作码位数，后面每组是地址码位数（表 4.2）。 */
function group(code: string, firstBits: number, groupBits: number): string {
  const parts = [code.slice(0, firstBits)];
  for (let k = firstBits; k < code.length; k += groupBits) parts.push(code.slice(k, k + groupBits));
  return parts.join(',');
}

const plain = (s: string): string => s.replace(/,/g, '');

// ---------- 随机参数：位数小到能把编码逐个列出来 ----------

function paramsArbOf(maxFrac: number, allowMax: boolean, minLevels: number): fc.Arbitrary<OpcodeParams> {
  return fc
    .record({
      addressBits: fc.integer({ min: 1, max: 4 }),
      addrSet: fc.uniqueArray(fc.integer({ min: 0, max: 4 }), { minLength: minLevels, maxLength: 4 }),
      base: fc.integer({ min: 1, max: 4 }),
      fracs: fc.array(fc.double({ min: 0, max: maxFrac, noNaN: true }), { minLength: 4, maxLength: 4 }),
      maxPick: fc.integer({ min: allowMax ? -2 : -1, max: allowMax ? 3 : -1 }),
    })
    .map(({ addressBits, addrSet, base, fracs, maxPick }) => {
      const sorted = [...addrSet].sort((a, b) => b - a);
      const wordBits = Math.max(4, sorted[0]! * addressBits + base);
      // 最后一类的操作码不超过 12 位，参照能把编码逐个列出来。
      const addresses = sorted.filter((a) => wordBits - a * addressBits <= 12 && wordBits - a * addressBits >= 1);
      const levels: { addresses: number; count?: number }[] = addresses.map((a) => ({ addresses: a, count: 1 }));
      const maxLevel = maxPick >= 0 && maxPick < levels.length ? maxPick : -1;
      // 条数按参照算出的可用数取个比例，这样可行和不可行的都有。
      for (let i = 0; i < levels.length; i++) {
        if (i === maxLevel) continue;
        const probe: OpcodeParams = { wordBits, addressBits, levels: levels.slice(0, i + 1).map((l) => ({ addresses: l.addresses, count: l.count ?? 1 })) };
        const avail = reference(probe).levels[i]?.available ?? 1;
        levels[i]!.count = Math.max(1, Math.floor(fracs[i]! * avail));
      }
      if (maxLevel >= 0) delete levels[maxLevel]!.count;
      return { wordBits, addressBits, levels };
    });
}

const paramsArb = paramsArbOf(1.15, true, 1);

// ---------- 教材例题 ----------

describe('opcode 教材例题（手算）', () => {
  it('例 4.1 / 表 4.2（p129–130）：16 位、地址码 4 位、15/14/31/16 条', () => {
    const p: OpcodeParams = { wordBits: 16, addressBits: 4, levels: [{ addresses: 3, count: 15 }, { addresses: 2, count: 14 }, { addresses: 1, count: 31 }, { addresses: 0, count: 16 }] };
    const pl = plan(p);
    expect(pl.feasible).toBe(true);
    expect(pl.opBits).toEqual([4, 8, 12, 16]);
    expect(pl.available).toEqual([16, 16, 32, 16]);
    expect(pl.used).toEqual([15, 14, 31, 16]);
    expect(pl.reserved.slice(0, 3)).toEqual([1, 2, 1]);
    const t = run(p);
    const lv = t.steps[t.steps.length - 1]!.state.levels;
    expect(lv[0]!.range).toEqual(['0000', '1110']);
    expect(lv[0]!.reservedRange?.[0]).toBe('1111');
    expect(lv[1]!.range).toEqual(['1111,0000', '1111,1101']);
    expect(lv[1]!.reservedRange).toEqual(['1111,1110', '1111,1111']);
    expect(lv[2]!.range).toEqual(['1111,1110,0000', '1111,1111,1110']);
    expect(lv[2]!.reservedRange?.[0]).toBe('1111,1111,1111');
    expect(lv[3]!.range).toEqual(['1111,1111,1111,0000', '1111,1111,1111,1111']);
    expect(t.result['可行']).toBe('是');
  });

  it('习题 17（p148）：11/70/150 条，零地址最多 = 16−11=5 → 5×16−70=10 → 10×16−150=10 → 10×16=160', () => {
    const p: OpcodeParams = { wordBits: 16, addressBits: 4, levels: [{ addresses: 3, count: 11 }, { addresses: 2, count: 70 }, { addresses: 1, count: 150 }, { addresses: 0 }] };
    const pl = plan(p);
    expect(pl.available).toEqual([16, 80, 160, 160]);
    expect(pl.maxLevel).toBe(3);
    expect(pl.maxCount).toBe(160);
  });

  it('设9 题型（解析书）：地址码 6 位、二地址 10 条、零地址 200 条，一地址最多 = 6×64 − ⌈200/64⌉ = 384 − 4 = 380', () => {
    const p: OpcodeParams = { wordBits: 16, addressBits: 6, levels: [{ addresses: 2, count: 10 }, { addresses: 1 }, { addresses: 0, count: 200 }] };
    const pl = plan(p);
    expect(pl.available.slice(0, 2)).toEqual([16, 384]);
    expect(pl.maxCount).toBe(380);
    expect(pl.feasible).toBe(true);
  });

  it('二地址要 17 条而操作码只有 4 位：不可行，卡在二地址，不抛错', () => {
    const p: OpcodeParams = { wordBits: 12, addressBits: 4, levels: [{ addresses: 2, count: 17 }, { addresses: 0, count: 3 }] };
    const t = run(p);
    expect(validateTrace(t)).toEqual([]);
    expect(t.result['可行']).toBe('否');
    expect(t.result['卡在']).toContain('二地址');
  });

  it('规格场景：字长 4、地址码 1 位，二地址 1、一地址 1、零地址 11 → 可用 4、(4−1)×2=6、(6−1)×2=10，卡在零地址；一地址或二地址少用 1 条', () => {
    const p: OpcodeParams = { wordBits: 4, addressBits: 1, levels: [{ addresses: 2, count: 1 }, { addresses: 1, count: 1 }, { addresses: 0, count: 11 }] };
    const pl = plan(p);
    expect(pl.available).toEqual([4, 6, 10]);
    const t = run(p);
    expect(t.result['可行']).toBe('否');
    expect(t.result['卡在']).toBe('零地址');
    expect(t.result['要缩减']).toContain('一地址少用 1 条');
    expect(t.result['要缩减']).toContain('二地址少用 1 条');
  });
});

// ---------- 对拍与性质 ----------

describe('opcode 与逐个列编码的参照对拍（性质 1）', () => {
  it('可行与否、每级可用数、第一个和最后一个码、最多条数一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const r = reference(p);
        fc.pre(!r.ambiguous);
        const pl = plan(p);
        expect(pl.feasible).toBe(r.feasible);
        const upto = r.failAt ?? p.levels.length - 1;
        for (let i = 0; i <= upto; i++) {
          expect(pl.opBits[i]).toBe(r.levels[i]!.opBits);
          expect(pl.available[i]).toBe(r.levels[i]!.available);
        }
        if (r.feasible) {
          for (let i = 0; i < p.levels.length; i++) {
            expect(pl.used[i]).toBe(r.levels[i]!.used);
            expect(pl.start[i]).toBe(parseInt(r.levels[i]!.firstAvailable, 2));
            if (i < p.levels.length - 1) expect(pl.reserved[i]).toBe(r.levels[i]!.reserved);
          }
          expect(pl.maxLevel).toBe(r.maxLevel);
          expect(pl.maxCount).toBe(r.maxCount);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('状态里写的编码范围（逗号分组）与参照的第一个、最后一个码一致', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const r = reference(p);
        fc.pre(!r.ambiguous && r.feasible);
        const t = run(p);
        const lv = t.steps[t.steps.length - 1]!.state.levels;
        const first = r.levels[0]!.opBits;
        r.levels.forEach((L, i) => {
          if (L.usedCodes.length === 0) {
            expect(lv[i]!.range).toBeNull();
            return;
          }
          expect(lv[i]!.range?.[0]).toBe(group(L.usedCodes[0]!, first, p.addressBits));
          expect(lv[i]!.range?.[1]).toBe(group(L.usedCodes[L.usedCodes.length - 1]!, first, p.addressBits));
          if (i < r.levels.length - 1 && L.reservedCodes.length > 0) {
            expect(lv[i]!.reservedRange?.[0]).toBe(group(L.reservedCodes[0]!, first, p.addressBits));
            expect(lv[i]!.reservedRange?.[1]).toBe(group(L.reservedCodes[L.reservedCodes.length - 1]!, first, p.addressBits));
          }
        });
        expect(t.result['可行']).toBe('是');
      }),
      { numRuns: 200 },
    );
  });

  it('要求 6：「卡在」是第一个自己要的条数从本级可用编码里分不出来的类（前面各类取完自己的、其余全留作扩展）', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const r = reference(p);
        // 求最多的那一类自己没有条数；它那一级不够扣时怎么算卡在，规格没说，跳过。
        fc.pre(!r.ambiguous && !r.feasible && r.failAt !== r.maxLevel);
        const t = run(p);
        expect(validateTrace(t)).toEqual([]);
        expect(t.result['可行']).toBe('否');
        expect(t.result['卡在']).toBe(nameOf(p.levels[r.failAt as number]!.addresses));
      }),
      { numRuns: 200 },
    );
  });

  it('要求 6：「要缩减」写出前面某一类少用几条：差 d 个码时第 i 类少用 ⌈d / 2^(本级位数−第 i 类位数)⌉ 条（只查各类都给了条数、少用数不超过它要的条数）', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const r = reference(p);
        fc.pre(r.maxLevel === null && !r.feasible && (r.failAt as number) > 0);
        const j = r.failAt as number;
        const short = (p.levels[j]!.count as number) - r.levels[j]!.available;
        const t = run(p);
        const text = t.result['要缩减'] ?? '';
        let checked = 0;
        for (let i = 0; i < j; i++) {
          const k = Math.ceil(short / 2 ** (r.levels[j]!.opBits - r.levels[i]!.opBits));
          if (k <= (p.levels[i]!.count as number)) {
            expect(text, JSON.stringify(p)).toContain(`${nameOf(p.levels[i]!.addresses)}少用 ${k} 条`);
            checked++;
          }
        }
        if (checked === 0) expect(text.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('opcode 性质', () => {
  it('性质 2：可行时引擎写出的全部操作码互不为前缀；条数等于要的条数', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const r = reference(p);
        fc.pre(!r.ambiguous && r.feasible);
        const t = run(p);
        const lv = t.steps[t.steps.length - 1]!.state.levels;
        const all = new Set<string>();
        lv.forEach((L, i) => {
          if (!L.range) return;
          const a = plain(L.range[0]);
          const b = plain(L.range[1]);
          expect(a.length).toBe(L.opBits);
          for (let v = parseInt(a, 2); v <= parseInt(b, 2); v++) all.add(v.toString(2).padStart(L.opBits, '0'));
          const want = p.levels[i]!.count ?? r.maxCount;
          expect(parseInt(b, 2) - parseInt(a, 2) + 1).toBe(want);
        });
        for (const code of all) {
          for (let k = 1; k < code.length; k++) expect(all.has(code.slice(0, k))).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Kraft：各类用掉的码数 × 2^(最长位数−本类位数) 之和不超过 2^最长位数；每类用掉的不超过 2^操作码位数', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        const pl = plan(p);
        fc.pre(pl.feasible && !reference(p).ambiguous);
        const top = Math.max(...pl.opBits);
        let sum = 0;
        pl.used.forEach((u, i) => {
          expect(u).toBeLessThanOrEqual(2 ** pl.opBits[i]!);
          sum += u * 2 ** (top - pl.opBits[i]!);
        });
        expect(sum).toBeLessThanOrEqual(2 ** top);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 3：某一类少用一个码，下一类正好多 2^多出位数 个可用编码', () => {
    fc.assert(
      fc.property(paramsArbOf(0.8, false, 2), fc.nat(), (p, pick) => {
        fc.pre(p.levels.length >= 2);
        const i = pick % (p.levels.length - 1);
        const more: OpcodeParams = { ...p, levels: p.levels.map((l, k) => (k === i ? { ...l, count: (l.count as number) + 1 } : l)) };
        const fewer = plan(p);
        const after = plan(more);
        fc.pre(after.failAt === null || after.failAt > i + 1);
        const extraBits = (p.levels[i]!.addresses - p.levels[i + 1]!.addresses) * p.addressBits;
        expect(fewer.available[i + 1]! - after.available[i + 1]!).toBe(2 ** extraBits);
      }),
      { numRuns: 200 },
    );
  });

  it('性质 4：validateTrace 为空；同参数同 Trace；generate 出的题总可行', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        fc.pre(!reference(p).ambiguous);
        const a = run(p);
        expect(validateTrace(a)).toEqual([]);
        expect(run(p)).toEqual(a);
        // 每类两步 explain
        expect(a.steps.every((s) => s.level === 'explain')).toBe(true);
      }),
      { numRuns: 100 },
    );
    for (let seed = 1; seed <= 40; seed++) {
      const g = generate(seed);
      expect(plan(g).feasible).toBe(true);
      expect(validateTrace(run(g))).toEqual([]);
    }
  });

  it('非法参数抛错：地址数重复、两类都不给条数、字长越界', () => {
    expect(() => run({ wordBits: 16, addressBits: 4, levels: [{ addresses: 2, count: 3 }, { addresses: 2, count: 3 }] })).toThrow();
    expect(() => run({ wordBits: 16, addressBits: 4, levels: [{ addresses: 2 }, { addresses: 0 }] })).toThrow();
    expect(() => run({ wordBits: 40, addressBits: 4, levels: [{ addresses: 2, count: 3 }] })).toThrow();
    expect(() => run({ wordBits: 16, addressBits: 4, levels: [{ addresses: 0, count: 3 }, { addresses: 2, count: 3 }] })).toThrow();
  });
});
