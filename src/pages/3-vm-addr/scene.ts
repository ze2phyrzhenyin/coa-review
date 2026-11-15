/**
 * 台面：最远是虚地址，切开后落成「逻辑页号 | 页内地址」两段；逻辑页号走到页表（在主存中）里那一项，
 * 看有效位，取出物理页号；有快表时先在快表里按内容比一遍。页内地址沿右边那根线原样落到下面，
 * 和物理页号拼成物理地址。部件位置固定；数都取自 Trace 的状态和引擎的解题表。
 */
import type { Step, Trace } from '../../engines/trace';
import type { Params, State } from '../../engines/vm/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec, WireSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import { log2 } from './setup';

export interface VmStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  askFrame: (ask: unknown, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
}

/** 从右往左每 4 位空一格。 */
export function group4(bits: string): string {
  const out: string[] = [];
  for (let end = bits.length; end > 0; end -= 4) out.unshift(bits.slice(Math.max(0, end - 4), end));
  return out.join(' ');
}
const bin = (value: number, width: number): string => (width === 0 ? '' : value.toString(2).padStart(width, '0'));

/** 页表在台面上列哪几页：题目列出的项，加上要访问却没列出的页（有效位按 0），按页号排。 */
export function tablePages(params: Params): number[] {
  const listed = params.table.map((e) => e.page);
  const asked = params.addresses.map((a) => Math.floor(a / params.pageSize));
  return [...new Set([...listed, ...asked])].sort((a, b) => a - b);
}

/** 一份 Trace 对应一张台面。引用要稳定：同一份 Trace 请用 useMemo 缓存。 */
export function vmStage(trace: Trace<Params, State>, narrow: boolean): VmStage {
  const params = trace.params;
  const hasTlb = !!params.tlb;
  const offW = log2(params.pageSize);
  const pageW = log2(params.pages);
  const frameW = log2(params.frames);
  const rows = tablePages(params);
  const entry = (page: number) => params.table.find((e) => e.page === page);
  const at = <T>(wide: T, small: T): T => (narrow ? small : wide);
  const sheet = trace.table;
  const paCol = sheet.columns.length - 1;

  // 两段的宽度按字数定：位串每位约 0.23 宽。
  const bitsWidth = (n: number, extra = 0) => Math.max(2.2, (n + Math.floor((n - 1) / 4) + extra) * 0.235 + 0.5);
  // 虚地址的两段正下方就是物理地址的两段：页内地址竖着落下来，逻辑页号那一段换成物理页号。
  // 页表是一块高板，放在左边（手机上放在最前面），不挡住后面的格子。
  const leftX = at(-2.2, -1.9);
  const rightX = at(1.6, 1.9);
  const midX = (leftX + rightX) / 2;
  const zVa = at(-5.7, -8.1);
  const zVirt = at(-4.1, -6.4);
  const zPhys = at(-1.5, -4.5);
  const zPa = at(0.3, -2.7);
  const ptAt: [number, number] = at([-5.7, -2.0], [-1.55, 1.7]);
  const tlbAt: [number, number] = at([2.6, 3.2], [2.45, 1.7]);
  const cmpAt: [number, number] = at([-1.6, 3.4], [2.45, 3.7]);
  const plateZ = at(2.4, 4.1);

  const parts: PartSpec[] = [
    { id: 'va', kind: 'register', position: [midX, zVa], props: { name: '虚地址', value: '', ink: 'addr', width: 2.6 } },
    { id: 'page', kind: 'register', position: [leftX, zVirt], props: { name: `逻辑页号 ${pageW} 位`, value: '', ink: 'addr', width: bitsWidth(pageW, 4) } },
    { id: 'off', kind: 'register', position: [rightX, zVirt], props: { name: `页内地址 ${offW} 位`, value: '', ink: 'addr', width: bitsWidth(offW) } },
    {
      id: 'pt',
      kind: 'memory',
      position: ptAt,
      title: '页表',
      props: {
        name: '页表（在主存中）',
        columns: [{ title: '有效位', width: 1.15 }, { title: '物理页号', width: 1.5 }],
        rows: rows.map((p) => {
          const e = entry(p);
          return [String(e?.valid ?? 0), e?.valid === 1 ? String(e.frame) : ''];
        }),
        labels: rows.map((p) => `页 ${p}`),
      },
    },
    { id: 'frame', kind: 'register', position: [leftX, zPhys], props: { name: `物理页号 ${frameW} 位`, value: '', ink: 'addr', width: bitsWidth(frameW, 4) } },
    { id: 'poff', kind: 'register', position: [rightX, zPhys], props: { name: '页内地址', value: '', ink: 'addr', width: bitsWidth(offW) } },
    { id: 'pa', kind: 'register', position: [at(midX, rightX), zPa], props: { name: '物理地址', value: '', ink: 'addr', width: 2.6 } },
    { id: 'fault', kind: 'label', position: at([-6.6, plateZ], [-2.5, plateZ]), props: { text: '缺页 0', plate: true, size: 0.34, weight: 600, mono: true }, pick: true, title: '缺页' },
    { id: 'inMem', kind: 'label', position: at([-4.7, plateZ], [-0.5, plateZ]), props: { text: '在主存', plate: true, size: 0.34, weight: 600 }, pick: true, title: '在主存' },
  ];
  if (hasTlb) {
    const tlb = params.tlb ?? [];
    parts.push(
      {
        id: 'tlb',
        kind: 'memory',
        position: tlbAt,
        title: '快表',
        props: { name: '快表', columns: [{ title: at('逻辑页号', '页号'), width: at(1.5, 1.2) }, { title: '物理页号', width: at(1.5, 1.4) }], rows: tlb.map((e) => [String(e.page), String(e.frame)]) },
      },
      { id: 'cmp', kind: 'compare', position: cmpAt, title: '按内容比', props: { left: '', right: '', ...(narrow ? {} : { leftName: '逻辑页号', rightName: '快表' }) } },
    );
  }
  const wires: WireSpec[] = [
    { id: 'va-page', from: 'va', to: 'page', ink: 'addr' },
    { id: 'va-off', from: 'va', to: 'off', ink: 'addr' },
    narrow ? { id: 'page-pt', from: 'page.w', to: 'pt', ink: 'addr', via: [[-3.75, zVirt], [-3.75, ptAt[1] - 1.2]] } : { id: 'page-pt', from: 'page.w', to: 'pt', ink: 'addr' },
    narrow ? { id: 'pt-frame', from: 'pt', to: 'frame.s', ink: 'data' } : { id: 'pt-frame', from: 'pt', to: 'frame.w', ink: 'data' },
    { id: 'off-poff', from: 'off', to: 'poff', ink: 'addr' },
    { id: 'frame-pa', from: 'frame', to: 'pa', ink: 'addr' },
    { id: 'poff-pa', from: 'poff', to: 'pa', ink: 'addr' },
  ];

  const cur = (c: BindContext<State>) => c.state.current;
  const rowOf = (c: BindContext<State>): string[] | null => (cur(c).n > 0 ? (sheet.rows[cur(c).n - 1]?.cells ?? null) : null);
  const tableRow = (c: BindContext<State>): number => (cur(c).page === null ? -1 : rows.indexOf(cur(c).page!));
  const pendingAsk = (c: BindContext<State>) => trace.steps[c.index]?.ask?.prompt;

  const table: Record<string, Record<string, unknown>> = {
    va: { value: from<State>(['current.address'], (c) => rowOf(c)?.[0] ?? '') },
    page: { value: from<State>(['current.pageBits'], (c) => (cur(c).page === null ? '' : `${cur(c).pageBits}（${cur(c).page}）`)) },
    off: { value: from<State>(['current.offsetBits'], (c) => group4(cur(c).offsetBits)) },
    pt: {
      active: from<State>(['current.valid'], (c) => (cur(c).valid === null ? -1 : tableRow(c))),
      cell: (c: BindContext<State>) => (cur(c).valid === null || tableRow(c) < 0 ? '' : `${tableRow(c)}.0`),
    },
    frame: {
      value: from<State>(['current.frame', 'current.result'], (c) => {
        const f = cur(c).frame;
        if (f !== null) return `${bin(f, frameW)}（${f}）`;
        return cur(c).result === '缺页' ? '缺页' : '';
      }),
    },
    poff: { value: from<State>(['current.physicalBits'], (c) => (cur(c).physicalBits ? group4(cur(c).offsetBits) : '')) },
    pa: { value: from<State>(['current.physical', 'current.result'], (c) => (cur(c).result === null ? '' : (rowOf(c)?.[paCol] ?? ''))) },
    fault: { text: from<State>(['faults'], (c) => `缺页 ${c.state.faults}`) },
    inMem: { hidden: (c: BindContext<State>) => pendingAsk(c) !== '这一页在主存吗' },
  };
  if (hasTlb) {
    const tlb = params.tlb ?? [];
    table['tlb'] = {
      active: from<State>(['current.tlb'], (c) => (cur(c).tlb === '命中' ? tlb.findIndex((e) => e.page === cur(c).page) : -1)),
    };
    table['cmp'] = {
      left: from<State>(['current.tlb'], (c) => (cur(c).page === null ? '' : String(cur(c).page))),
      right: from<State>(['current.tlb'], (c) => (cur(c).tlb === '命中' ? String(cur(c).page) : tlb.map((e) => e.page).join('、') || '空')),
      result: from<State>(['current.tlb'], (c) => (cur(c).tlb === '命中' ? 'match' : cur(c).tlb === '未命中' ? 'mismatch' : '')),
      hidden: (c: BindContext<State>) => cur(c).tlb === null || cur(c).valid !== null || cur(c).result !== null,
    };
  }
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  const moves = (step: Step<State>): Move[] => {
    const s = step.state.current;
    const changed = (path: string) => step.changes.some((change) => change.at === path);
    if (changed('current.pageBits') || (changed('current.n') && s.page !== null)) {
      return [
        { value: s.pageBits, from: 'va', to: 'page', via: ['va-page'], ink: 'addr' },
        { value: group4(s.offsetBits), from: 'va', to: 'off', via: ['va-off'], ink: 'addr' },
      ];
    }
    if (changed('current.tlb') && s.tlb === '命中' && s.frame !== null) {
      const r = (params.tlb ?? []).findIndex((e) => e.page === s.page);
      return [{ value: String(s.frame), from: `tlb.${r}.1`, to: 'frame', arc: true }];
    }
    if (changed('current.valid')) {
      const r = rows.indexOf(s.page ?? -1);
      const lookup: Move = { value: `页 ${s.page}`, from: 'page', to: `pt.${r}.0`, via: ['page-pt'], ink: 'addr', phase: 0 };
      if (s.valid === 1 && s.frame !== null) return [lookup, { value: String(s.frame), from: `pt.${r}.1`, to: 'frame', via: ['pt-frame'], phase: 1 }];
      return [lookup];
    }
    if (changed('current.result') && s.result === '物理地址') {
      return [
        { value: group4(s.offsetBits), from: 'off', to: 'poff', via: ['off-poff'], ink: 'addr', phase: 0 },
        { value: `${bin(s.frame ?? 0, frameW)} ${s.offsetBits}`, from: 'poff', to: 'pa', via: ['poff-pa'], ink: 'addr', phase: 1 },
      ];
    }
    return [];
  };

  const labels: Record<string, string> = {
    'current.n': '第几个虚地址',
    'current.address': '虚地址',
    'current.bits': '虚地址的二进制',
    'current.pageBits': '逻辑页号字段',
    'current.offsetBits': '页内地址字段',
    'current.page': '逻辑页号',
    'current.offset': '页内地址',
    'current.tlb': '快表',
    'current.valid': '有效位',
    'current.frame': '物理页号',
    'current.physical': '物理地址',
    'current.physicalBits': '物理地址的二进制',
    'current.result': '结果',
    faults: '缺页次数',
    tlbHits: '快表命中次数',
  };
  const names = (path: string): string => labels[path] ?? path;
  // 虚地址、物理地址的数值按题目的写法显示（十六进制带 H），页内地址同引擎的写法。
  const hex = (params.radix ?? 'hex') === 'hex';
  const vDigits = Math.max(1, Math.ceil((pageW + offW) / 4));
  const pDigits = Math.max(1, Math.ceil((frameW + offW) / 4));
  const values = (path: string, value: string): string => {
    if (!hex || !/^\d+$/.test(value)) return value;
    const n = Number(value);
    if (path === 'current.address') return `${n.toString(16).toUpperCase().padStart(vDigits, '0')}H`;
    if (path === 'current.physical') return `${n.toString(16).toUpperCase().padStart(pDigits, '0')}H`;
    if (path === 'current.offset') return n > 9 ? `${n.toString(16).toUpperCase()}H` : value;
    return value;
  };

  const askFrame = (ask: unknown): string[] => ((ask as { prompt?: string }).prompt === '这一页在主存吗' ? ['pt', 'inMem', 'fault'] : narrow ? ['frame', 'pt'] : ['pt', 'frame', ...(hasTlb ? ['tlb'] : [])]);
  /** 手机上：切地址看上半，查表看页表，拼地址看下半。 */
  const frame = (step: Step<State>): string[] | null => {
    if (!narrow) return null;
    const s = step.state.current;
    if (s.result !== null) return ['page', 'off', 'frame', 'poff', 'pa'];
    if (s.valid !== null) return ['frame', 'pt'];
    if (s.tlb !== null) return ['tlb', 'cmp'];
    return ['va', 'page', 'off', 'frame', 'poff'];
  };
  return { scene: { parts, wires }, bind, moves, names, values, askFrame, frame };
}

/** 页面对 Trace 的加工：最后加一步，把每个虚地址的结果收在一起（取自引擎的 result）。 */
export function polish(trace: Trace<Params, State>): Trace<Params, State> {
  const last = trace.steps[trace.steps.length - 1];
  if (!last) return trace;
  const list = trace.table.rows.map((row) => `${row.cells[0]}：${row.cells[row.cells.length - 1]}`);
  const steps = [
    ...trace.steps,
    {
      id: `s${trace.steps.length + 1}`,
      level: 'explain' as const,
      title: `${trace.params.addresses.length} 个虚地址变换完`,
      why: `${list.join('；')}。缺页 ${trace.result['缺页次数'] ?? ''} 次${trace.result['快表命中次数'] !== undefined ? `，快表命中 ${trace.result['快表命中次数']} 次` : ''}。每一行都可以照解题表的版式写在卷子上。`,
      ref: '教材 p112–114',
      state: last.state,
      changes: [],
      focus: ['faults'],
    },
  ];
  return { ...trace, steps };
}

/** 答错时按学生的答案演后果。 */
export function vmWrong(trace: Trace<Params, State>) {
  const params = trace.params;
  const frameW = log2(params.frames);
  const rows = tablePages(params);
  return (ask: { prompt: string; answer: string }, value: string, state: State, next: Step<State> | null): Breakage | null => {
    const s = next?.state.current ?? state.current;
    const page = s.page;
    if (page === null) return null;
    const r = rows.indexOf(page);
    if (ask.prompt === '这一页在主存吗') {
      if (value === '在主存') {
        return {
          label: '',
          patch: { frame: { value: '？' }, pt: { active: r, cell: `${r}.0` } },
          moves: [{ value: `页 ${page}`, from: 'page', to: `pt.${r}.0`, via: ['page-pt'], ink: 'addr' }],
          message: `页表第 ${page} 项的有效位是 0，这一项的物理页号是空的。硬着头皮拼地址，访问到的是主存里别的页，读出的不是这个程序要的数。`,
        };
      }
      return {
        label: '',
        patch: { fault: { text: `缺页 ${state.faults + 1}` } },
        moves: [{ value: '缺页中断', from: 'pt', to: 'fault', arc: true }],
        message: `页表第 ${page} 项的有效位是 1，这一页已经在主存第 ${s.frame ?? ''} 页。按缺页处理会发出缺页中断，让操作系统再调一次本来就在的页，白费一次辅存访问。`,
      };
    }
    const v = Number(value);
    if (!Number.isInteger(v) || v < 0) return null;
    return {
      label: '',
      patch: { frame: { value: `${v.toString(2).padStart(frameW, '0')}（${v}）` } },
      moves: [{ value: String(v), from: 'pt', to: 'frame', via: ['pt-frame'] }],
      message:
        v === page
          ? `${v} 是逻辑页号。逻辑页号只用来查表，物理页号要从${s.tlb === '命中' ? '快表' : '页表'}里那一项取，两者一般不同。`
          : `物理页号写成 ${v}，拼出来的地址落在主存第 ${v} 页，那里放的是别的页。物理页号看${s.tlb === '命中' ? '快表' : `页表第 ${page} 项`}。`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。 */
export function vmMistakes(trace: Trace<Params, State>): Mistake<State>[] {
  const params = trace.params;
  const steps = trace.steps;
  const out: Mistake<State>[] = [];
  const offW = log2(params.pageSize);
  const radixHex = (params.radix ?? 'hex') === 'hex';
  const pa = trace.table.rows;
  const paCol = trace.table.columns.length - 1;

  // 1. 物理地址算成相加。
  const join = steps.findIndex((step) => step.state.current.result === '物理地址');
  if (join >= 0) {
    const s = steps[join]!.state.current;
    const sum = (s.frame ?? 0) + (s.offset ?? 0);
    const sumText = radixHex ? `${sum.toString(16).toUpperCase()}H` : String(sum);
    const right = pa[s.n - 1]?.cells[paCol] ?? '';
    out.push({
      text: '容易把物理页号和页内地址直接相加，因为和段式的「段起址 + 段内地址」混了',
      at: join + 1,
      act: () => ({
        label: '',
        patch: { pa: { value: sumText } },
        moves: [{ value: sumText, from: 'frame', to: 'pa', via: ['frame-pa'], ink: 'addr' }],
        message: `页式是拼接：物理页号放在高位，页内地址原样放在低位，等于 物理页号 × 页长 + 页内地址，得 ${right}。把 ${s.frame} 和页内地址直接相加得 ${sumText}，落在第 0 页附近，地址全错。`,
      }),
    });
  }
  // 2. 按十六进制位切页号。
  if (radixHex && offW % 4 !== 0) {
    const first = steps.findIndex((step) => step.state.current.page !== null);
    const s = steps[first]?.state.current;
    if (s && s.address !== null) {
      const va = pa[s.n - 1]?.cells[0] ?? '';
      const digits = va.replace(/H$/, '');
      const keep = Math.floor(offW / 4);
      const wrongPage = digits.slice(0, digits.length - keep) || '0';
      const wrongOff = digits.slice(digits.length - keep);
      out.push({
        text: '容易按十六进制位切页号和页内地址，因为没先写成二进制',
        at: first + 1,
        act: () => ({
          label: '',
          patch: { page: { value: `${wrongPage}H？` }, off: { value: `${wrongOff}H？` } },
          moves: [{ value: `${wrongPage}H`, from: 'va', to: 'page', via: ['va-page'], ink: 'addr' }],
          message: `按十六进制位切，会把 ${wrongOff}H 当页内地址、${wrongPage}H 当页号。可页长 ${params.pageSize}，页内地址是 ${offW} 位，不是 ${keep * 4} 位，十六进制的一位被切成两半。先写成二进制，低 ${offW} 位是页内地址，剩下的高位才是逻辑页号 ${s.page}。`,
        }),
      });
    }
  }
  // 3. 快表命中后还去查页表；没有快表时：不看有效位。
  if (params.tlb) {
    const hit = steps.findIndex((step) => step.state.current.tlb === '命中' && step.changes.some((change) => change.at === 'current.tlb'));
    if (hit >= 0) {
      const s = steps[hit]!.state.current;
      const r = tablePages(params).indexOf(s.page ?? -1);
      out.push({
        text: '容易在快表命中后还去查一遍页表，因为以为快表只是提示',
        at: hit + 1,
        act: () => ({
          label: '',
          patch: { pt: { active: r } },
          moves: [{ value: `页 ${s.page}`, from: 'page', to: `pt.${r}.0`, via: ['page-pt'], ink: 'addr' }],
          message: '快表里存的就是页表有效项的副本，命中时直接拿到物理页号。再去主存读页表，多访问一次主存，快表就白设了（教材 p114）。',
        }),
      });
    }
  } else {
    const fault = steps.findIndex((step) => step.state.current.valid === 0);
    if (fault >= 0) {
      const s = steps[fault]!.state.current;
      out.push({
        text: '容易只看页表里有没有这一项，不看有效位',
        at: fault + 1,
        act: () => ({
          label: '',
          patch: { frame: { value: '？' }, pa: { value: '？' } },
          moves: [{ value: '？', from: 'pt', to: 'frame', via: ['pt-frame'] }],
          message: `页表里有第 ${s.page} 项，可它的有效位是 0：这一页还在辅存，表项里没有可用的物理页号。拿空的物理页号去拼地址，访问的是主存里别的页。`,
        }),
      });
    }
  }
  return out;
}

export const VM_QUESTION = { text: '虚地址的哪几位查表，哪几位原样照抄', at: ['va', 'page', 'off'] };
export const VM_CONCLUSION =
  '虚地址按页长切开：低位是页内地址，高位是逻辑页号。逻辑页号去查页表（有快表时先查快表），有效位为 1 就取出物理页号，为 0 就是缺页；物理页号放高位、页内地址原样放低位，拼起来就是物理地址。';
export const VM_NEEDS = [{ href: '/3-cache-addr', text: '把地址按位数切成几段' }];
