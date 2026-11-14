import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateTrace } from '../trace';
import { generate, run, translate, validateParams, type Params } from './model';

// ---------- 朴素参照：只按规格写，用除法和取余，不看引擎 ----------

interface Entry {
  page: number;
  valid: 0 | 1;
  frame: number;
}

interface Ref {
  page: number;
  offset: number;
  frame: number | null;
  physical: number | null;
  fault: boolean;
  tlbHit: boolean;
}

function refTranslate(p: Params, address: number): Ref {
  const page = Math.floor(address / p.pageSize);
  const offset = address % p.pageSize;
  const inTlb = (p.tlb ?? []).find((e) => e.page === page);
  if (inTlb) return { page, offset, frame: inTlb.frame, physical: inTlb.frame * p.pageSize + offset, fault: false, tlbHit: true };
  const row = p.table.find((e) => e.page === page && e.valid === 1);
  if (!row) return { page, offset, frame: null, physical: null, fault: true, tlbHit: false };
  return { page, offset, frame: row.frame!, physical: row.frame! * p.pageSize + offset, fault: false, tlbHit: false };
}

const log2 = (n: number): number => Math.round(Math.log2(n));

/** 十六进制带 H、位数 ⌈位数/4⌉；十进制原样。 */
function written(p: Params, value: number, bits: number): string {
  if (p.radix === 'dec') return String(value);
  return `${value.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`;
}

const vBits = (p: Params): number => log2(p.pages * p.pageSize);
const pBits = (p: Params): number => log2(p.frames * p.pageSize);

// ---------- 状态的读法（字段名照规格要求 5） ----------

interface Current {
  n: number;
  address: unknown;
  page: unknown;
  offset: unknown;
  tlb: '命中' | '未命中' | null;
  valid: unknown;
  frame: unknown;
  physical: unknown;
  result: '物理地址' | '缺页' | null;
}
interface VmState {
  current: Current;
  faults: number;
  tlbHits: number;
}

type VmTrace = ReturnType<typeof run>;
const stateOf = (s: VmTrace['steps'][number]): VmState => s.state as unknown as VmState;

/** 按 access 步把步骤切成每个地址一组。 */
function groups(trace: VmTrace): VmTrace['steps'][] {
  const out: VmTrace['steps'][] = [];
  let cur: VmTrace['steps'] = [];
  for (const s of trace.steps) {
    cur.push(s);
    if (s.level === 'access') {
      out.push(cur);
      cur = [];
    }
  }
  return out;
}

// ---------- 合格参数的生成 ----------

const withoutTlb = (p: Params): Params => {
  const { tlb: _drop, ...rest } = p;
  return rest as Params;
};

const arbParams: fc.Arbitrary<Params> = fc
  .integer({ min: 1, max: 20 })
  .chain((off) =>
    fc.record({
      off: fc.constant(off),
      pg: fc.integer({ min: 1, max: Math.min(20, 32 - off) }),
      fr: fc.integer({ min: 0, max: Math.min(20, 32 - off) }), // 物理地址也不超过 32 位
      radix: fc.constantFrom<'hex' | 'dec' | null>('hex', 'dec', null),
      useTlb: fc.boolean(),
    }),
  )
  .chain((s) => {
    const pageSize = 2 ** s.off;
    const pages = 2 ** s.pg;
    const frames = 2 ** s.fr;
    return fc
      .record({
        entries: fc.uniqueArray(
          fc.record({ page: fc.nat(pages - 1), valid: fc.constantFrom<0 | 1>(0, 1, 1), frame: fc.nat(frames - 1) }),
          { selector: (e) => e.page, maxLength: 10 },
        ),
        picks: fc.array(fc.record({ which: fc.nat(14), page: fc.nat(pages - 1), offset: fc.nat(pageSize - 1) }), {
          minLength: 1,
          maxLength: 8,
        }),
        mask: fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
      })
      .map(({ entries, picks, mask }) => {
        // 多数地址落在页表列出的页上，这样有效、无效、没列出三种都常见。
        const addresses = picks.map((k) => (k.which < entries.length ? entries[k.which]!.page : k.page) * pageSize + k.offset);
        const table: Entry[] = entries;
        const tlb = entries.filter((e, i) => e.valid === 1 && mask[i]).map((e) => ({ page: e.page, frame: e.frame }));
        const p = {
          pageSize,
          pages,
          frames,
          table,
          addresses,
          ...(s.radix === null ? {} : { radix: s.radix }),
          ...(s.useTlb && tlb.length > 0 ? { tlb } : {}),
        };
        return p as Params;
      });
  });

const RUNS = { numRuns: 150 };

// ---------- 通用 ----------

describe('任意合格参数', () => {
  it('validateParams 为空，validateTrace 为空，两次 run 完全相同', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        expect(validateParams(p)).toEqual([]);
        const trace = run(p);
        expect(validateTrace(trace)).toEqual([]);
        expect(run(p)).toEqual(trace);
      }),
      RUNS,
    );
  });

  it('translate 与参照逐个地址一致', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        for (const a of p.addresses) {
          const want = refTranslate(p, a);
          const got = translate(p, a);
          expect(got.page).toBe(want.page);
          expect(got.offset).toBe(want.offset);
          expect(got.fault).toBe(want.fault);
          if (p.tlb) expect(got.tlbHit).toBe(want.tlbHit);
          // 规格不清：没有快表时 tlbHit 是 false 还是 null 没写，只要求不为真。
          else expect(got.tlbHit).toBeFalsy();
          // 规格不清：缺页时 frame、physical 的值没写，只在不缺页时核对。
          if (!want.fault) {
            expect(got.frame).toBe(want.frame);
            expect(got.physical).toBe(want.physical);
          }
        }
      }),
      RUNS,
    );
  });

  it('result：键是虚地址的写法，值是物理地址写法或「缺页」，另有次数', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const { result } = run(p);
        const want: Record<string, string> = {};
        let faults = 0;
        let hits = 0;
        for (const a of p.addresses) {
          const r = refTranslate(p, a);
          if (r.fault) faults += 1;
          if (r.tlbHit) hits += 1;
          // 规格不清：物理地址的写法按虚地址同一规则，十六进制位数取 ⌈物理地址位数/4⌉。
          want[written(p, a, vBits(p))] = r.fault ? '缺页' : written(p, r.physical!, pBits(p));
        }
        const keys = [...Object.keys(want), '缺页次数', ...(p.tlb ? ['快表命中次数'] : [])].sort();
        expect(Object.keys(result).sort()).toEqual(keys);
        for (const [k, v] of Object.entries(want)) expect(result[k], k).toBe(v);
        expect(Number.parseInt(result.缺页次数!, 10)).toBe(faults);
        if (p.tlb) expect(Number.parseInt(result.快表命中次数!, 10)).toBe(hits);
      }),
      RUNS,
    );
  });

  it('步骤：每个地址最后一步是 access，其余是 explain；状态与参照一致', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(p);
        const gs = groups(trace);
        expect(gs.length).toBe(p.addresses.length);
        expect(trace.steps.at(-1)!.level).toBe('access');
        let faults = 0;
        let hits = 0;
        gs.forEach((g, k) => {
          for (const s of g.slice(0, -1)) expect(s.level).toBe('explain');
          const r = refTranslate(p, p.addresses[k]!);
          if (r.fault) faults += 1;
          if (r.tlbHit) hits += 1;
          const st = stateOf(g.at(-1)!);
          // 规格不清：状态里 page、offset、frame 的类型没写，按数字比较。
          expect(st.current.page).toBe(r.page);
          expect(st.current.offset).toBe(r.offset);
          expect(st.current.result).toBe(r.fault ? '缺页' : '物理地址');
          if (!r.fault) expect(st.current.frame).toBe(r.frame);
          expect(st.current.tlb).toBe(p.tlb ? (r.tlbHit ? '命中' : '未命中') : null);
          // 快表命中不查页表：有效位一直没被看过。
          // 规格不清：用「access 步状态里 valid 为 null」判定没出现查页表的步。
          if (r.tlbHit) expect(st.current.valid).toBeNull();
          expect(st.faults).toBe(faults);
          expect(st.tlbHits).toBe(hits);
        });
      }),
      RUNS,
    );
  });

  it('解题表：列、每地址一行指回 access 步、缺页和快表命中的写法', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const trace = run(p);
        const cols = ['虚地址', '逻辑页号', '页内地址', ...(p.tlb ? ['快表'] : []), '有效位', '物理页号', '物理地址'];
        expect(trace.table.columns).toEqual(cols);
        const access = trace.steps.filter((s) => s.level === 'access');
        expect(trace.table.rows.length).toBe(p.addresses.length);
        trace.table.rows.forEach((row, k) => {
          const a = p.addresses[k]!;
          const r = refTranslate(p, a);
          expect(row.step).toBe(access[k]!.id);
          expect(row.cells[0]).toBe(written(p, a, vBits(p)));
          if (r.fault) {
            expect(row.cells[cols.indexOf('物理页号')]).toBe('缺页');
            expect(row.cells[cols.indexOf('物理地址')]).toBe('缺页');
          } else {
            expect(row.cells[cols.indexOf('物理地址')]).toBe(written(p, r.physical!, pBits(p)));
          }
          if (r.tlbHit) expect(row.cells[cols.indexOf('有效位')]).toBe('—');
        });
      }),
      RUNS,
    );
  });

  it('条件里列出虚地址格式和物理地址格式', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const labels = run(p).conditions.map((c) => c.label);
        expect(labels.some((l) => l.includes('虚地址格式'))).toBe(true);
        expect(labels.some((l) => l.includes('物理地址格式'))).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('预测题：有无效项时问「这一页在主存吗」；拼接时问物理页号', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        const hasInvalid = p.table.some((e) => e.valid === 0);
        groups(run(p)).forEach((g, k) => {
          const r = refTranslate(p, p.addresses[k]!);
          const asks = g.flatMap((s) => (s.ask ? [s.ask] : []));
          const inMemory = asks.find((a) => a.kind === 'choice' && (a.options ?? []).includes('在主存'));
          if (hasInvalid && !r.tlbHit) {
            expect(inMemory, `地址 ${k}`).toBeDefined();
            expect(inMemory!.options).toContain('缺页');
          }
          if (inMemory) expect(inMemory.answer).toBe(r.fault ? '缺页' : '在主存');
          const frameAsk = asks.find((a) => a.kind === 'number');
          // 规格不清：「页表里有有效位为 0 的项时」按只管前半句（在主存吗）理解；物理页号每个不缺页的地址都问，答案按十进制数比较。
          if (!r.fault) {
            expect(frameAsk, `地址 ${k}`).toBeDefined();
            expect(Number(frameAsk!.answer)).toBe(r.frame);
          }
        });
      }),
      RUNS,
    );
  });
});

// ---------- 规格「性质」 ----------

describe('性质', () => {
  it('1. 页内地址不变：物理地址 mod pageSize = 虚地址 mod pageSize', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        for (const a of p.addresses) {
          const t = translate(p, a);
          if (!t.fault) expect((t.physical as number) % p.pageSize).toBe(a % p.pageSize);
        }
      }),
      RUNS,
    );
  });

  it('2. 有快表和没快表：物理地址、缺页判断相同', () => {
    fc.assert(
      fc.property(
        arbParams.filter((p) => p.tlb !== undefined),
        (p) => {
          const bare = withoutTlb(p);
          for (const a of p.addresses) {
            const x = translate(p, a);
            const y = translate(bare, a);
            expect(x.fault).toBe(y.fault);
            if (!x.fault) expect(x.physical).toBe(y.physical);
          }
          const rx = run(p).result;
          const ry = run(bare).result;
          for (const a of p.addresses) {
            const key = written(p, a, vBits(p));
            expect(rx[key]).toBe(ry[key]);
          }
          expect(rx.缺页次数).toBe(ry.缺页次数);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('3. 缺页当且仅当页表里该页没有有效项', () => {
    fc.assert(
      fc.property(arbParams, (p) => {
        for (const a of p.addresses) {
          const page = Math.floor(a / p.pageSize);
          const listed = p.table.some((e) => e.page === page && e.valid === 1);
          expect(translate(p, a).fault).toBe(!listed);
        }
      }),
      RUNS,
    );
  });
});

// ---------- 规格「场景」 ----------

describe('场景', () => {
  const small: Params = {
    pageSize: 1024,
    pages: 16,
    frames: 8,
    table: [{ page: 3, valid: 1, frame: 5 }],
    addresses: [0x0db4],
  };

  it('页长 1K、虚页 3 在主存页 5、0DB4H → 页号 3、页内 1B4H、15B4H', () => {
    const t = translate(small, 0x0db4);
    expect(t.page).toBe(3);
    expect(t.offset).toBe(0x1b4);
    expect(t.physical).toBe(0x15b4);
    expect(run(small).result['0DB4H']).toBe('15B4H');
  });

  it('32 页、页长 1K、主存 16 页：0AC5H → 12C5H，1AC5H → 缺页', () => {
    const p: Params = {
      pageSize: 1024,
      pages: 32,
      frames: 16,
      table: [
        { page: 0, valid: 1, frame: 8 },
        { page: 1, valid: 1, frame: 7 },
        { page: 2, valid: 1, frame: 4 },
        { page: 3, valid: 1, frame: 10 },
      ],
      addresses: [0x0ac5, 0x1ac5],
    };
    const { result } = run(p);
    expect(result['0AC5H']).toBe('12C5H');
    expect(result['1AC5H']).toBe('缺页');
    expect(Number.parseInt(result.缺页次数!, 10)).toBe(1);
  });

  it('十进制 8644、页长 4K、页 2 在主存页 8 → 33220', () => {
    const p: Params = {
      pageSize: 4096,
      pages: 16,
      frames: 16,
      table: [{ page: 2, valid: 1, frame: 8 }],
      addresses: [8644],
      radix: 'dec',
    };
    expect(translate(p, 8644).physical).toBe(33220);
    expect(run(p).result['8644']).toBe('33220');
  });

  it('快表里有该页：不查页表，结果与没快表相同', () => {
    const p: Params = { ...small, tlb: [{ page: 3, frame: 5 }] };
    const trace = run(p);
    expect(trace.result['0DB4H']).toBe(run(small).result['0DB4H']);
    expect(translate(p, 0x0db4).tlbHit).toBe(true);
    const last = stateOf(trace.steps.at(-1)!);
    expect(last.current.tlb).toBe('命中');
    expect(last.current.valid).toBeNull();
    expect(last.tlbHits).toBe(1);
  });

  it('非法参数：run 抛错', () => {
    const bad: Params[] = [
      { ...small, tlb: [{ page: 3, frame: 6 }] }, // 快表与页表不一致（场景）
      { ...small, tlb: [{ page: 4, frame: 5 }] }, // 快表项在页表里不是有效项
      { ...small, addresses: [16 * 1024] }, // 超出虚存空间（场景）
      { ...small, pageSize: 1000 },
      { ...small, pages: 12 },
      { ...small, frames: 6 },
      { ...small, table: [{ page: 3, valid: 1, frame: 8 }] }, // frame ≥ frames
      { ...small, table: [{ page: 3, valid: 1, frame: 5 }, { page: 3, valid: 1, frame: 2 }] }, // 同一页列两次
      { ...small, addresses: [] },
      { ...small, pageSize: 2 ** 20, pages: 2 ** 13 }, // 虚地址 33 位
    ];
    for (const p of bad) {
      expect(() => run(p), JSON.stringify(p)).toThrow();
      expect(validateParams(p).length, JSON.stringify(p)).toBeGreaterThan(0);
    }
  });
});

// ---------- generate ----------

describe('generate', () => {
  it('几个种子：参数合格、run 不抛错、同种子同参数', () => {
    for (const seed of [0, 1, 2, 7, 42, 2026, 123_456, 2 ** 31 - 1]) {
      const p = generate(seed);
      expect(validateParams(p)).toEqual([]);
      expect(() => run(p)).not.toThrow();
      expect(validateTrace(run(p))).toEqual([]);
      expect(generate(seed)).toEqual(p);
    }
  });
});
