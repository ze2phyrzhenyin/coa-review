/**
 * 「弄坏它」：直接映射里把一个块硬放进它映射不到的行，然后演两次访问的后果。
 * 地址怎么切、块号、行号、标记都由引擎的 layout 和 splitAddress 给出；这里只把它们排成一段 Trace。
 * 状态用引擎的 State，所以和讲解用同一张台面。
 */
import { TraceBuilder } from '../../engines/trace';
import type { Trace } from '../../engines/trace';
import { layout, run, splitAddress } from '../../engines/cache/model';
import type { Current, Fields, Op, Params, State } from '../../engines/cache/model';

export interface BreakSetup {
  address: number;
  /** 块按规则该去的行。 */
  home: number;
  /** 可以硬放进去的行（除了 home 以外的各行）。 */
  wrongRows: number[];
  block: number;
}

export function breakSetup(params: Params): BreakSetup {
  const g = layout(params);
  // 例题里第一个落在区 0 以外的块，块号和行号不同，最能看出求余。
  const access = params.accesses.find((a) => splitAddress(g, params.addressBits, a.address).tag > 0) ?? params.accesses[0]!;
  const f = splitAddress(g, params.addressBits, access.address);
  return {
    address: access.address,
    home: f.set,
    wrongRows: Array.from({ length: g.rows }, (_, i) => i).filter((i) => i !== f.set),
    block: f.block,
  };
}

function current(n: number, address: number, op: Op, f: Fields): Current {
  return {
    n,
    address,
    op,
    bits: f.bits,
    tagBits: f.tagBits,
    indexBits: f.indexBits,
    wordBits: f.wordBits,
    tag: f.tag,
    index: f.set,
    word: f.word,
    block: f.block,
    candidates: [],
    result: null,
    action: null,
    row: null,
    evicted: null,
    writeBack: false,
  };
}

/** params 必须是直接映射。into 是学生选的错行。 */
export function breakTrace(params: Params, into: number): Trace<Params, State> {
  const g = layout(params);
  const base = run(params);
  const setup = breakSetup(params);
  const a = setup.address;
  const f = splitAddress(g, params.addressBits, a);
  const i = f.set;
  const j = f.block;
  const r = into;
  // 另一个块：标记和块 j 相同，行号字段正好指向错行 r。
  let other = a;
  for (let x = 0; x < 2 ** params.addressBits; x++) {
    const h = splitAddress(g, params.addressBits, x);
    if (h.tag === f.tag && h.set === r && h.word === 0) {
      other = x;
      break;
    }
  }
  const o = splitAddress(g, params.addressBits, other);

  const conditions = [...base.conditions, { label: '假设', value: `块 ${j} 被硬放进行 ${r}，真实硬件做不到` }];
  const b = new TraceBuilder<Params, State>('cache-break', params, base.initial, conditions);
  const tagText = String(f.tag);

  b.step({
    title: `读地址 ${a}：块 ${j}，切出标记 ${f.tag}、行号 ${i}、字地址 ${f.word}`,
    why: `地址 ${f.bits} 切成 ${f.tagBits} | ${f.indexBits} | ${f.wordBits}。块号 j = ${a} ÷ ${g.blockUnits} 取整 = ${j}。`,
    ref: '教材 p104',
    focus: ['access.tagBits', 'access.indexBits', 'access.wordBits'],
    update: (s) => {
      s.access = current(1, a, '读', f);
    },
  });
  b.step({
    title: `按规则块 ${j} 该进行 ${i}`,
    why: `i = j mod m：${j} mod ${g.rows} = ${i}。地址里的行号字段 ${f.indexBits} 就是这个余数，硬件用它直接选中行 ${i}。`,
    ref: '教材 p103 式(3.7)',
    focus: ['access.index', `rows.${i}`],
    update: (s) => {
      s.access.candidates = [i];
    },
  });
  b.step({
    title: `假设硬把块 ${j} 放进行 ${r}，标记 ${tagText} 照样写上`,
    why: `真实的直接映射 cache 做不到这一步：调入时也只用行号字段选行，没有通往行 ${r} 的路。这里假设它做到了，看后面两次访问。`,
    focus: [`rows.${r}`],
    update: (s) => {
      s.access.result = '缺失';
      s.access.action = '调入';
      s.access.row = r;
      const row = s.rows[r]!;
      row.tag = f.tag;
      row.block = j;
      s.misses += 1;
    },
  });
  b.step({
    title: `再读地址 ${a}，块 ${j} 其实已经在行 ${r}`,
    why: `地址没变，切出来还是标记 ${f.tag}、行号 ${i}。`,
    ref: '教材 p104',
    focus: ['access.indexBits', `rows.${r}`],
    update: (s) => {
      s.access = current(2, a, '读', f);
    },
  });
  b.step({
    title: `硬件只看行 ${i}`,
    why: `行号字段 ${f.indexBits} 只选中行 ${i}，比较器只接这一行的标记。行 ${r} 不参加比较。`,
    ref: '教材 p104',
    focus: ['access.index', `rows.${i}`],
    update: (s) => {
      s.access.candidates = [i];
    },
  });
  b.step({
    title: `行 ${i} 是空的，判为缺失`,
    why: `块 ${j} 就在 cache 里，却找不到。按规则它会再从主存调入一次，放进行 ${i}，cache 里就有了两份块 ${j}；之后写了其中一份，另一份就是旧的。`,
    focus: ['access.tag', `rows.${i}.tag`],
    update: (s) => {
      s.access.result = '缺失';
      s.misses += 1;
    },
  });
  b.step({
    title: `读地址 ${other}：块 ${o.block}，标记 ${o.tag}、行号 ${o.set}`,
    why: `块 ${o.block} 和块 ${j} 在同一个区，标记都是 ${tagText}；块号 ${o.block} mod ${g.rows} = ${o.set}，正好落在行 ${r}。`,
    ref: '教材 p104',
    focus: ['access.tagBits', 'access.indexBits', 'access.wordBits'],
    update: (s) => {
      s.access = current(3, other, '读', o);
    },
  });
  b.step({
    title: `硬件去看行 ${r}`,
    why: `行号字段 ${o.indexBits} 选中行 ${r}。`,
    ref: '教材 p103 式(3.7)',
    focus: ['access.index', `rows.${r}`],
    update: (s) => {
      s.access.candidates = [r];
    },
  });
  b.step({
    title: `行 ${r} 的标记也是 ${tagText}，判为命中，取到的却是块 ${j}`,
    why: `标记相同，硬件就认定行 ${r} 装的是块 ${o.block}。这一行装的其实是块 ${j}，CPU 读走的是块 ${j} 里的字，数据错了，而且没有任何信号报错。`,
    ref: '教材 p104',
    focus: ['access.tag', `rows.${r}.tag`],
    update: (s) => {
      s.access.result = '命中';
      s.access.row = r;
      s.hits += 1;
    },
  });
  b.step({
    title: '行里只存标记，行号由块所在的行来表示',
    why: `标记只是地址的高 ${g.tagBits} 位。地址中间那 ${g.indexBits} 位不存进 cache，靠「块在第几行」来表示。块放错了行，这几位就错了：找它时找不到，找别的块时又会错认它。所以直接映射里块 j 只能放在 j mod m 那一行。`,
    ref: '教材 p103–104',
    focus: [`rows.${r}`, `rows.${i}`],
    update: () => {},
  });
  return b.finish(
    { 结论: '块放错行后，找它会缺失，找同标记的别的块会错命中' },
    {
      columns: ['访问', '块号', '查的行', '判为', '实际'],
      rows: [
        { cells: [String(a), String(j), `行 ${i}`, '缺失', `块 ${j} 在行 ${r}`], step: 's6' },
        { cells: [String(other), String(o.block), `行 ${r}`, '命中', `行 ${r} 装的是块 ${j}`], step: 's9' },
      ],
    },
  );
}
