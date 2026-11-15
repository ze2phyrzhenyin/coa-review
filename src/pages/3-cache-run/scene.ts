/**
 * 台面：最远一排是地址，切成 标记 | 行号或组号 | 字地址，下面是求块号和求余的算式；
 * 中间左边是按区排开的主存，右边是算式、命中和缺失两块牌（带次数）、换出；「块传送」通路连到最近一排的 cache 各行。
 * 部件位置固定，不随步骤变。所有数都取自 Trace 的状态或引擎的 layout/splitAddress。
 */
import type { Step, Trace } from '../../engines/trace';
import { layout, rowsOf, splitAddress } from '../../engines/cache/model';
import type { Layout, Params, Row, State } from '../../engines/cache/model';
import { bindTable, from } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import type { BindContext, Binding, MemoryColumn, Move, PartSpec, SceneSpec, Vec2, WireSpec } from '../../scene';

/** 主存画成一块 4×4 的板：一行 4 个块。直接映射时一行就是一个区，列号就是区内块号。 */
const PER_LINE = 4;
const X = [-5.6, -1.87, 1.87, 5.6];
const XC = [-6.15, -2.05, 2.05, 6.15];
const Z_ADDR = -6.35;
const Z_MEM = -1.9;
const Z_BUS = 0.25;
const Z_ROWS = 2.75;

export interface CacheStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  frame: (step: Step<State>) => string[] | null;
  askFrame: (trace: Trace<Params, State>) => (ask: unknown, index: number) => string[];
}

/** 两行两列摆 cache：带计数器时一排放不下桌面舞台，手机上四行一排也装不进画面。 */
const GRID_DZ = 2.35;
const SIDE = 4.45;

const rowName = (i: number): string => `行 ${i}`;
const indexTitle = (g: Layout): string => (g.mapping === '直接' ? '行号' : '组号');
const counted = (params: Params): boolean => params.mapping !== '直接' && (params.replacement === 'LRU' || params.replacement === 'LFU');

/** 一行 cache 在台面上的样子：标记（二进制）、修改位、计数器、装的块。 */
function rowCells(params: Params, row: Row): string[] {
  const empty = row.block === null;
  const cells = [row.tag === null ? '' : String(row.tag), empty ? '' : String(row.modified)];
  if (counted(params)) cells.push(empty ? '' : String(row.count));
  cells.push(empty ? '' : `块 ${row.block}`);
  return cells;
}

function rowColumns(params: Params): MemoryColumn[] {
  const columns: MemoryColumn[] = [
    // 列宽按列名的字定：列名 0.33 高，三个字约 1.0 宽。
    { title: '标记', ink: 'addr', width: 0.8 },
    { title: '修改位', width: 1.1 },
  ];
  if (counted(params)) columns.push({ title: '计数器', width: 1.1 });
  columns.push({ title: '数据', width: 1.1 });
  return columns;
}

/** 主存板：行是区（组相联一行含两个区），列是区内块号；全相联没有区。格子里是块号。 */
function memorySpec(g: Layout, params: Params): PartSpec {
  const lines = Math.ceil(g.blocks / PER_LINE);
  const grid = Array.from({ length: lines }, (_, r) => Array.from({ length: PER_LINE }, (_, c) => r * PER_LINE + c));
  const fieldOf = (block: number) => splitAddress(g, params.addressBits, block * g.blockUnits);
  const firstLine = grid[0] ?? [];
  let columns: MemoryColumn[];
  let labels: string[];
  if (g.mapping === '直接') {
    columns = firstLine.map((block) => ({ title: `${fieldOf(block).set}`, width: 1.2 }));
    labels = grid.map((line) => `区 ${fieldOf(line[0] ?? 0).tag}`);
  } else if (g.mapping === '组相联') {
    columns = firstLine.map((block) => ({ title: `组 ${fieldOf(block).set}`, width: 1.2 }));
    labels = grid.map((line) => [...new Set(line.map((block) => fieldOf(block).tag))].map((tag) => `区 ${tag}`).join('、'));
  } else {
    columns = firstLine.map(() => ({ title: '', width: 1.2 }));
    labels = grid.map(() => '');
  }
  return {
    id: 'mem',
    kind: 'memory',
    position: [g.mapping === '直接' ? -3.0 : -3.7, Z_MEM],
    props: { name: g.mapping === '直接' ? '主存（列是区内块号）' : '主存', columns, rows: grid.map((line) => line.map((block) => `块 ${block}`)), labels },
  };
}

/** 一个参数组合对应一张台面。引用要稳定：同样的参数请用 useMemo 缓存。 */
export function cacheStage(params: Params, narrow = false): CacheStage {
  const g = layout(params);
  const full = g.mapping === '全相联';
  const grid = (narrow || counted(params)) && g.rows === 4;
  // 窄屏版式：从后往前是 主存板 → 地址和切出的字段 → 两个算式 → 命中、缺失、换出 → 块传送 → 两行两列的 cache。
  // 主存板最高，放在最后面，不挡别的部件；整张台面宽 8.4，手机上字不小于 14 像素时左右都装得下。
  const compact = narrow && g.rows === 4;
  // 窄屏带计数器时一行太宽，四行排成一列；其余两行两列。
  // 窄屏四行排成一列：两行两列在 360 宽的手机上比画面宽。
  const column = compact;
  const side = compact ? 3.75 : counted(params) ? 5.0 : SIDE;
  const zBus = compact ? -1.2 : Z_BUS;
  const zRows = compact ? 1.3 : Z_ROWS;
  const gx = compact ? 1.8 : counted(params) ? 2.5 : 1.95;
  const xs = column ? [0, 0, 0, 0] : grid ? [-gx, gx, -gx, gx] : counted(params) ? XC : X;
  // 窄屏：每一组（直接映射是每一行）的后面留一格放比标记的两张卡，卡和这一组的行在同一个画面里。
  const groupOf = (i: number) => (g.mapping === '组相联' ? Math.floor(i / g.ways) : g.mapping === '直接' ? i : 0);
  const groups = g.mapping === '组相联' ? g.sets : g.mapping === '直接' ? g.rows : 1;
  const CMP_GAP = 1.9;
  const zRow = (i: number) => (column ? zRows + i * 2.4 + (groupOf(i) + 1) * CMP_GAP : grid && i >= 2 ? zRows + GRID_DZ : zRows);
  const firstRow = (k: number) => Array.from({ length: g.rows }, (_, i) => i).find((i) => groupOf(i) === k) ?? 0;
  const cmpIds = compact ? Array.from({ length: groups }, (_, k) => `cmp-${k}`) : ['cmp'];
  const cmpOf = (candidates: number[]) => (compact ? `cmp-${groupOf(candidates[0] ?? 0)}` : 'cmp');
  const at = (wide: Vec2, small: Vec2): Vec2 => (compact ? small : wide);
  const mem = memorySpec(g, params);
  if (compact) mem.position = [0, -9.6];

  const parts: PartSpec[] = [
    { id: 'addr', kind: 'register', position: at([-4.9, Z_ADDR], [0, -7.4]), props: { name: '主存地址', value: '', ink: 'addr', width: 2.2 } },
    { id: 'tag', kind: 'bits', position: at(full ? [-1.0, Z_ADDR] : [-1.7, Z_ADDR], full ? [-1.2, -6.1] : [g.tagBits >= 3 ? -1.9 : -2.25, -6.1]), props: { name: '标记', bits: '0'.repeat(g.tagBits), ink: 'addr' } },
  ];
  if (!full) parts.push({ id: 'idx', kind: 'bits', position: at([1.5, Z_ADDR], [g.tagBits >= 3 ? 0.85 : 0.55, -6.1]), props: { name: indexTitle(g), bits: '0'.repeat(g.indexBits), ink: 'addr' } });
  parts.push(
    { id: 'word', kind: 'bits', position: at(full ? [3.0, Z_ADDR] : [4.5, Z_ADDR], full ? [2.1, -6.1] : [3.0, -6.1]), props: { name: '字地址', bits: '0'.repeat(g.wordBits), ink: 'addr' } },
    { id: 'calcJ', kind: 'label', position: at([3.3, -4.95], [0, -4.85]), props: { text: '', plate: true, size: 0.31, mono: true } },
    { id: 'calcI', kind: 'label', position: at([3.3, -4.05], [0, -4.1]), props: { text: '', plate: true, size: 0.31, mono: true } },
    mem,
    {
      id: 'cmp',
      kind: 'compare',
      position: at([2.0, -1.35], [-1.0, -3.2]),
      props: { left: '', right: '', ...(compact ? {} : { leftName: '地址', rightName: '候选行' }) },
      title: '比较标记',
    },
    { id: 'hit', kind: 'label', position: at([1.3, -2.95], [-2.6, -2.15]), props: { text: '命中 0', plate: true, size: 0.34, weight: 600 }, pick: true, title: '命中' },
    { id: 'miss', kind: 'label', position: at([3.25, -2.95], [-0.6, -2.15]), props: { text: '缺失 0', plate: true, size: 0.34, weight: 600 }, pick: true, title: '缺失' },
    { id: 'out', kind: 'register', position: at([counted(params) && !grid ? 6.0 : 4.95, -1.25], [2.4, -2.15]), props: { name: '换出', value: '', width: 2.2 } },
    { id: 'bus', kind: 'bus', position: [0, zBus], props: { name: '块传送', length: compact ? side * 2 + 0.1 : counted(params) && !grid ? 16.0 : 12.2, value: '', tileAt: compact ? 0.4 : -2.2, idleText: '' } },
  );
  for (let i = 0; i < g.rows; i++) {
    parts.push({
      id: `r${i}`,
      kind: 'memory',
      position: [xs[i] ?? 0, zRow(i)],
      props: { name: g.mapping === '组相联' ? `${rowName(i)} · 组 ${Math.floor(i / g.ways)}` : rowName(i), columns: rowColumns(params), rows: [rowCells(params, { tag: null, block: null, modified: 0, count: 0 })] },
      pick: true,
      title: rowName(i),
    });
  }

  const wires: WireSpec[] = [
    // 窄屏上主存板在最后面，块从它的左侧绕下来，不压在地址和算式下面。
    compact ? { id: 'mem-bus', from: 'mem.w', to: 'bus', via: [[-side, -9.6], [-side, zBus]] } : { id: 'mem-bus', from: 'mem', to: 'bus' },
    { id: 'bus-out', from: 'bus', to: 'out' },
  ];
  for (let i = 0; i < g.rows; i++) {
    // 两行两列时，后一排从两侧绕过前一排接进来。
    if (column && i >= 1) {
      // 一列时，后面几行从左侧的竖线接进来。
      wires.push({ id: `bus-r${i}`, from: 'bus', to: `r${i}.w`, via: [[-side + 0.25, zBus + 0.3], [-side + 0.25, zRow(i)]] });
    } else if (grid && i >= 2) {
      const x = i === 2 ? -side : side;
      wires.push({ id: `bus-r${i}`, from: 'bus', to: `r${i}.${i === 2 ? 'w' : 'e'}`, via: [[x, zBus + 0.3], [x, zRow(i)]] });
    } else wires.push({ id: `bus-r${i}`, from: 'bus', to: `r${i}` });
  }

  const shown = (c: BindContext<State>): boolean => c.state.access.n > 0;
  const table: Record<string, Record<string, string | ReturnType<typeof from<State>> | ((c: BindContext<State>) => unknown)>> = {
    addr: { value: from(['access.address', 'access.op'], (c) => (shown(c) ? `${c.state.access.op} ${c.state.access.address}` : '')) },
    tag: {
      bits: from(['access.tagBits', 'access.tag'], (c) => c.state.access.tagBits || '0'.repeat(g.tagBits)),
      hidden: (c: BindContext<State>) => !shown(c),
    },
    word: {
      bits: from(['access.wordBits', 'access.word'], (c) => c.state.access.wordBits || '0'.repeat(g.wordBits)),
      hidden: (c: BindContext<State>) => !shown(c) || g.wordBits === 0,
    },
    calcJ: {
      text: from(['access.block'], (c) => (shown(c) ? `块号 j = ${c.state.access.address} ÷ ${g.blockUnits} 取整 = ${c.state.access.block}` : '')),
      hidden: (c: BindContext<State>) => !shown(c),
    },
    calcI: {
      text: from(['access.candidates', 'access.index'], (c) => {
        const a = c.state.access;
        if (a.candidates.length === 0) return '';
        if (g.mapping === '直接') return `行号 i = j mod m = ${a.block} mod ${g.rows} = ${a.index}`;
        if (g.mapping === '组相联') return `组号 q = j mod u = ${a.block} mod ${g.sets} = ${a.index}`;
        return `全相联：块 ${a.block} 可放任意一行`;
      }),
      hidden: (c: BindContext<State>) => c.state.access.candidates.length === 0,
    },
    bus: {
      value: from(['access.action'], (c) => (c.state.access.action === '调入' || c.state.access.action === '替换' ? `块 ${c.state.access.block}` : '')),
      drivers: (c: BindContext<State>) => (c.state.access.action === '调入' || c.state.access.action === '替换' ? '主存' : ''),
    },
    hit: { text: from(['hits'], (c) => `命中 ${c.state.hits}`), changed: (c: BindContext<State>) => c.state.access.result === '命中' },
    miss: { text: from(['misses'], (c) => `缺失 ${c.state.misses}`), changed: (c: BindContext<State>) => c.state.access.result === '缺失' },
    out: {
      value: from(['access.evicted', 'access.writeBack'], (c) =>
        c.state.access.evicted === null ? '' : `块 ${c.state.access.evicted}${c.state.access.writeBack ? ' 写回' : ''}`,
      ),
    },
  };
  if (!full) {
    table['idx'] = {
      bits: from(['access.indexBits', 'access.index'], (c) => c.state.access.indexBits || '0'.repeat(g.indexBits)),
      hidden: (c: BindContext<State>) => !shown(c) || g.indexBits === 0,
    };
  }
  // 主存板上只框出当前访问的那一块。调入、写回的那一步，块所在的那一行像抽屉一样拉出来。
  table['mem'] = {
    cell: (c: BindContext<State>) => {
      const block = c.state.access.block;
      return shown(c) && block !== null ? `${Math.floor(block / PER_LINE)}.${block % PER_LINE}` : '';
    },
    open: (c: BindContext<State>) => {
      const a = c.state.access;
      const moved = a.row !== null && [...c.changed].some((path) => path === `rows.${a.row}.block`);
      if (!moved || a.block === null) return [];
      const lines = [Math.floor(a.block / PER_LINE)];
      if (a.writeBack && a.evicted !== null) lines.push(Math.floor(a.evicted / PER_LINE));
      return [...new Set(lines)];
    },
  };
  // 比标记：地址切出的标记和候选行的标记两张卡并排，一致扣上，不一致弹开。
  // 宽屏一副卡，摆在命中、缺失牌旁边；窄屏每组一副，摆在这一组的行后面，只有正在比的那一组的卡出现。
  if (compact) {
    parts.splice(parts.findIndex((part) => part.id === 'cmp'), 1);
    for (let k = 0; k < groups; k++) parts.push({ id: `cmp-${k}`, kind: 'compare', position: [0, zRow(firstRow(k)) - 2.05], props: { left: '', right: '' }, title: '比较标记' });
  }
  cmpIds.forEach((id, k) => {
    const mine = (c: BindContext<State>) => !compact || groupOf(c.state.access.candidates[0] ?? -1) === k;
    table[id] = {
      left: from(['access.result'], (c) => (c.state.access.tag === null ? '' : String(c.state.access.tag))),
      right: from(['access.result'], (c) => {
        const a = c.state.access;
        if (a.result === '命中' && a.row !== null) return String(c.state.rows[a.row]?.tag ?? '');
        const tags = a.candidates.map((i) => c.state.rows[i]?.tag).filter((tag): tag is number => tag !== null && tag !== undefined);
        return tags.length ? tags.join('、') : '空';
      }),
      result: (c: BindContext<State>) => (!mine(c) ? '' : c.state.access.result === '命中' ? 'match' : c.state.access.result === '缺失' ? 'mismatch' : ''),
      // 只在比标记、记命中的这一段出现；调入以后候选行的标记变了，再摆着就对不上了。
      hidden: (c: BindContext<State>) => !mine(c) || c.state.access.result === null || c.state.access.action !== null,
    };
  });
  const keys = ['tag', 'modified', ...(counted(params) ? ['count'] : []), 'block'];
  for (let i = 0; i < g.rows; i++) {
    table[`r${i}`] = {
      rows: from(`rows.${i}`, (c) => [rowCells(params, c.state.rows[i]!)]),
      changedCells: from(`rows.${i}`, (c) =>
        keys.flatMap((key, column) => (c.changed.has(`rows.${i}.${key}`) ? [`0.${column}`] : [])),
      ),
      active: (c: BindContext<State>) => (c.state.access.row === i && c.state.access.result !== null ? 0 : -1),
    };
  }
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  /** 调入或替换的那一步：新块从主存板经块传送落进这一行，旧块从这一行被顶到「换出」，修改过的写回主存板。 */
  const moves = (step: Step<State>): Move[] => {
    const a = step.state.access;
    const row = a.row;
    if (row === null || a.block === null) return [];
    if (!step.changes.some((change) => change.at === `rows.${row}.block`)) return [];
    // 块从主存板上它自己的格子出发；写回时落回它自己的格子。
    const cellOf = (block: number) => `mem.${Math.floor(block / PER_LINE)}.${block % PER_LINE}`;
    // 先把旧块送走（写回主存，或丢到「换出」），再把新块调进来：两个块不同时在一段线上。
    const load: Move = { value: `块 ${a.block}`, from: cellOf(a.block), to: `r${row}`, via: ['mem-bus', `bus-r${row}`], phase: a.evicted === null ? 0 : 1 };
    if (a.evicted === null) return [load];
    const leave: Move = a.writeBack
      ? { value: `块 ${a.evicted}`, from: `r${row}`, to: cellOf(a.evicted), via: [`bus-r${row}`, 'mem-bus'], phase: 0 }
      : { value: `块 ${a.evicted}`, from: `r${row}`, to: 'out', via: [`bus-r${row}`, 'bus-out'], phase: 0 };
    return [leave, load];
  };

  const fieldNames: Record<string, string> = {
    n: '第几次访问',
    address: '地址',
    op: '读或写',
    bits: '地址的二进制',
    tagBits: '标记字段',
    indexBits: `${indexTitle(g)}字段`,
    wordBits: '字地址字段',
    tag: '标记',
    index: indexTitle(g),
    word: '字地址',
    block: '块号 j',
    result: '结果',
    action: '处理',
    row: '所在行',
    evicted: '换出的块',
    writeBack: '写回',
  };
  const rowFields: Record<string, string> = { tag: '标记', block: '装的块', modified: '修改位', count: '计数器', valid: '有效位' };
  const names = (path: string): string => {
    const parts = path.split('.');
    if (parts[0] === 'hits') return '命中次数';
    if (parts[0] === 'misses') return '缺失次数';
    if (parts[0] === 'rows') return `${rowName(Number(parts[1]))} ${rowFields[parts[2] ?? ''] ?? parts[2]}`;
    if (parts[0] === 'access' && parts[1] === 'candidates') return '候选行';
    if (parts[0] === 'access') return fieldNames[parts[1] ?? ''] ?? path;
    return path;
  };

  // 「处理」一栏：命中时不调块，写成「不调块（命中）」，和「调入」「替换」是同一类说法。
  const values = (path: string, value: string): string =>
    path === 'access.action' && value === '命中' ? '不调块（命中）' : value === 'true' ? '是' : value === 'false' ? '否' : value;
  /** 计数器那一步：镜头看这一组的几行（手机上主存和统计牌在别处，计数器的变化要看得到）。 */
  const frame = (step: Step<State>): string[] | null => {
    // 比标记、命中或缺失、换出、计数器这几步：看这一组（直接映射是这一行）的全部候选行。
    const candidates = step.state.access.candidates.map((i) => `r${i}`);
    const about = step.changes.some((change) => /^rows\.\d+\.(count|tag|block|modified)$/.test(change.at) || change.at === 'access.result' || change.at === 'access.action' || change.at === 'hits' || change.at === 'misses');
    // 找到候选行的那一步：看候选行（算式在标题里也写了）。
    if (candidates.length > 0 && step.changes.some((change) => change.at.startsWith('access.candidates'))) return candidates;
    if (candidates.length === 0 || !about) return null;
    const touched = step.changes.filter((change) => /^rows\.\d+\./.test(change.at)).map((change) => `r${change.at.split('.')[1]}`);
    // 比标记那一步把两张卡也放进来（装不下时看候选行）。
    const compared = step.changes.some((change) => change.at === 'access.result') ? [cmpOf(step.state.access.candidates)] : [];
    return [...new Set([...compared, ...candidates, ...touched])];
  };
  /** 出题时看这一组的候选行（比标记、选换出行都要看它们）。 */
  const askFrame = (trace: Trace<Params, State>) => (_ask: unknown, index: number): string[] => (trace.steps[index]?.state.access.candidates ?? []).map((i) => `r${i}`);

  return { scene: { parts, wires }, bind, moves, names, values, frame, askFrame };
}

/**
 * 在直接映射的定位步前加一道点选题「块 j 放在哪一行」。第一次访问先看引擎讲 i = j mod m，
 * 从第二次访问起，每个第一次出现的块问一次。答案取自这一步之后引擎给出的候选行。
 * （规格的预测题里没有这一种；这里留着：学生自己算 j mod m，比只看地址切出的行号字段更能分清两者是一回事。）
 */
export function withRowAsks(trace: Trace<Params, State>): Trace<Params, State> {
  if (trace.params.mapping !== '直接') return trace;
  const seen = new Set<number>();
  const rows = trace.initial.rows.map((_, i) => rowName(i));
  const steps = trace.steps.map((step) => {
    const a = step.state.access;
    const locate = a.candidates.length > 0 && step.changes.some((change) => change.at.startsWith('access.candidates'));
    if (!locate || step.ask || a.block === null) return step;
    const first = !seen.has(a.block);
    seen.add(a.block);
    const target = a.candidates[0];
    if (!first || target === undefined || a.n <= 1) return step;
    return {
      ...step,
      ask: {
        prompt: `块 ${a.block} 放在哪一行`,
        kind: 'choice' as const,
        options: rows,
        answer: rowName(target),
        hint: `直接映射用 i = j mod m，这里 m = ${rows.length}。地址切出的行号字段就是这个余数。`,
      },
    };
  });
  return { ...trace, steps };
}

/** 引擎文字里容易读岔的几处改一下说法，意思不变（「修改位置 1」读成「修改 位置 1」）。 */
const WORDING: [RegExp, string][] = [
  [/修改位置 1/g, '修改位设为 1'],
  [/没有哪一行的标记等于/g, '要比的行里没有标记等于'],
];
export const reword = (text: string): string => WORDING.reduce((out, [from, to]) => out.replace(from, to), text);

/**
 * 页面对 Trace 的加工：说法改顺，条件里补一句行号字段和 j mod m 的关系，最后加一步「命中率」。
 * h 取自引擎的 result，不在页面里算。
 */
export function polish(trace: Trace<Params, State>): Trace<Params, State> {
  const steps = trace.steps.map((step) => ({ ...step, title: reword(step.title), why: reword(step.why) }));
  const last = steps[steps.length - 1];
  const h = trace.result['h'];
  if (last && h) {
    steps.push({
      id: `s${steps.length + 1}`,
      level: 'explain',
      title: `命中率 h = ${h}`,
      why: `h = 命中次数 / 访问总次数（式 3.4）。这一串访问里命中 ${trace.result['命中次数']} 次、缺失 ${trace.result['缺失次数']} 次。`,
      ref: '教材 p101 式(3.4)',
      state: last.state,
      changes: [],
      focus: ['hit', 'miss'],
    });
  }
  const conditions = trace.conditions.map((item) => ({ ...item, value: reword(item.value) }));
  const g = layout(trace.params);
  conditions.push({
    label: '区',
    value:
      g.mapping === '直接'
        ? `主存按 cache 的行数分区，一区 m = ${g.rows} 块，正好对应 cache 的 ${g.rows} 行。区号就是标记，区内块号就是行号`
        : `组相联按 cache 的组数分区，一区 u = ${g.sets} 块，一块对应一组（不是一行）。区号就是标记，区内块号就是组号（图 3.32(c)）`,
  });
  if (trace.params.mapping === '直接') {
    conditions.push({ label: '行号', value: '地址中间的行号字段就是 j mod m：块号的低几位正好是除以行数的余数' });
    conditions.push({ label: '计数器', value: '直接映射一个块只有一行可放，用不上计数器；它是给组相联、全相联选换出行用的' });
  } else {
    const groups = Array.from({ length: g.sets }, (_, q) => `组 ${q} 是${rowsOf(g, q).map(rowName).join('、')}`).join('；');
    conditions.push({ label: '组', value: `${groups}。u 是组数，v 是每组的行数。块 j 放进第 q 组，q = j mod u，组里哪一行都行。组号字段比直接映射的行号字段少几位，标记就多几位` });
    if (trace.params.replacement === 'LRU') conditions.push({ label: 'LRU 计数器', value: '每次访问后，被访问的那一行计数器清零，同组里其余有块的行加 1。计数器越大，越久没用到；要换出时换计数器最大的那一行' });
  }
  return { ...trace, steps, conditions };
}

/**
 * 答错时按学生的答案演后果。数都取自引擎的状态（块号、候选行、各行装的块）。
 */
export function cacheWrong(params: Params) {
  return (ask: { prompt: string; answer: string }, value: string, state: State, next: Step<State> | null): Breakage | null => {
    const after = next?.state.access ?? state.access;
    const j = after.block;
    if (j === null) return null;
    const cell = `mem.${Math.floor(j / PER_LINE)}.${j % PER_LINE}`;
    if (ask.prompt === '这次访问命中吗') {
      if (value === '缺失') {
        const r = after.row ?? after.candidates[0] ?? 0;
        return {
          label: '',
          patch: {},
          moves: [{ value: `块 ${j}`, from: cell, to: `r${r}`, via: ['mem-bus', `bus-r${r}`] }],
          message: `按缺失处理，块 ${j} 要从主存再调一次进${rowName(r)}。可它已经在${rowName(r)} 里了，这一趟主存白跑。`,
        };
      }
      const r = after.candidates[0] ?? 0;
      const there = state.rows[r]?.block ?? null;
      return {
        label: '',
        patch: { [`r${r}`]: { changedCells: ['0.0'] } },
        moves: [{ value: there === null ? '空' : `块 ${there}`, from: `r${r}`, to: 'addr', arc: true }],
        message: `按命中处理，就从${rowName(r)} 直接取字。${rowName(r)} 里${there === null ? '是空的' : `装的是块 ${there}`}，取出来的不是块 ${j} 的字。`,
      };
    }
    const picked = /^行 (\d+)$/.exec(value);
    if (!picked) return null;
    const k = Number(picked[1]);
    if (ask.prompt === '换出哪一行') {
      const out = state.rows[k]?.block;
      return {
        label: '',
        patch: {},
        moves: out === null || out === undefined ? [] : [{ value: `块 ${out}`, from: `r${k}`, to: 'out', via: [`bus-r${k}`, 'bus-out'] }],
        message: `换出${rowName(k)} 的块 ${out ?? ''}：${params.replacement === 'LFU' ? '它不是用得最少的' : '它不是最久没用的'}，接下来很可能又要用到它，又得调回来。`,
      };
    }
    const i = after.candidates[0];
    if (i === undefined) return null;
    return {
      label: '',
      patch: {},
      moves: [{ value: `块 ${j}`, from: cell, to: `r${k}`, via: ['mem-bus', `bus-r${k}`] }],
      message: `块 ${j} 放进${rowName(k)}。下次再访问块 ${j}，硬件按 i = j mod m 只看${rowName(i)}，在那里找不到它，又要缺失一次。`,
    };
  };
}

/** 第 0 步的问题、最后的结论、需要先会。 */
export const CACHE_QUESTION = { text: '这次访问的块能放进哪几行，放满了换出谁', at: ['r0', 'r1'] };
export const CACHE_CONCLUSION =
  '直接映射时块 j 只能放进行 j mod m；组相联时放进组 j mod u 里的任意一行，组里没有空行才替换。LRU 换出计数器最大的那一行，也就是最久没用到的；换出的块修改位是 1 时，先写回主存再调入新块。';
export const CACHE_NEEDS = [{ href: '/3-cache-addr', text: '地址切成标记、行号（组号）、字地址' }];

/** 计数规则教材有（p108）；本站自己定的只有两点：只加同组的行、调入也算用了一次（docs/DECISIONS.md D16）。 */
export function cacheConvention(step: Step<State>): string | null {
  if (!step.changes.some((change) => /^rows\.\d+\.count$/.test(change.at))) return null;
  return 'LRU 的计数规则教材有，考试要会写：命中的行清零，其他各行加 1，换出计数值最大的行（p108）。本站另定了两点：只给同一组里有块的行加 1；块调入也算用了一次，调入的行清零。';
}

/** 常见错误，每条在场景里演一遍。块号、行号都取自这份 Trace。 */
export function cacheMistakes(trace: Trace<Params, State>): Mistake<State>[] {
  const g = layout(trace.params);
  const steps = trace.steps;
  const out: Mistake<State>[] = [];
  const cellOf = (block: number) => `mem.${Math.floor(block / PER_LINE)}.${block % PER_LINE}`;
  // 1. 组相联按行数取模；直接映射忘了先除以块大小。
  const located = steps.findIndex((step) => step.changes.some((change) => change.at.startsWith('access.candidates')) && step.state.access.block !== null);
  if (located >= 0) {
    const a = steps[located]!.state.access;
    const j = a.block!;
    const wrongRow = j % g.rows;
    if (g.mapping === '组相联' && !a.candidates.includes(wrongRow)) {
      out.push({
        text: '容易把组相联的 j mod 行数 当成行号，因为和直接映射的算法混了',
        at: located + 1,
        act: () => ({
          label: '',
          patch: { [`r${wrongRow}`]: { active: 0 } },
          moves: [{ value: `块 ${j}`, from: cellOf(j), to: `r${wrongRow}`, arc: true }],
          message: `组相联先算组号 q = j mod u：块 ${j} 在组 ${a.index}，只能放进组 ${a.index} 的${a.candidates.map((i) => `行 ${i}`).join('、')}。按 j mod m 算出的行 ${wrongRow} 不在这一组里。`,
        }),
      });
    }
    if (g.mapping === '直接' && g.blockUnits > 1 && a.address !== null && a.address !== j && a.address < g.blocks) {
      const address = a.address;
      out.push({
        text: '容易把地址直接当成块号，因为忘了先除以每块的字数',
        at: located + 1,
        act: () => ({
          label: '',
          patch: { mem: { cell: `${Math.floor(address / PER_LINE)}.${address % PER_LINE}` } },
          moves: [],
          message: `块号 j = 地址 ÷ 每块字数 取整：地址 ${address} 除以 ${g.blockUnits} 得块 ${j}，不是块 ${address}。`,
        }),
      });
    }
  }
  // 块号直接当行号（组号），不取余。
  const modulus = g.mapping === '直接' ? g.rows : g.sets;
  const big = steps.findIndex((step) => step.changes.some((change) => change.at.startsWith('access.candidates')) && (step.state.access.block ?? 0) >= modulus);
  if (g.mapping !== '全相联' && big >= 0) {
    const a = steps[big]!.state.access;
    const what = g.mapping === '直接' ? '行' : '组';
    out.push({
      text: `容易把块号直接当成${what}号，因为忘了取余`,
      at: big + 1,
      act: () => ({
        label: '',
        patch: { calcI: { text: `${what}号 = 块号 = ${a.block}？`, changed: true, hidden: false } },
        moves: [],
        message: `cache 只有 ${modulus} 个${what}，编号 0 到 ${modulus - 1}，没有第 ${a.block} ${what}。块号要对${what}数取余：${a.block} mod ${modulus} = ${a.index}，块 ${a.block} 归第 ${a.index} ${what}。`,
      }),
    });
  }
  // LRU 换出计数器最小的行（弄反了）。
  const swap = steps.findIndex((step, i) => {
    if (trace.params.replacement !== 'LRU' || !step.changes.some((change) => change.at === 'access.action') || step.state.access.action !== '替换') return false;
    const before = (i > 0 ? steps[i - 1]!.state : trace.initial).rows;
    const counts = step.state.access.candidates.map((k) => before[k]?.count ?? 0);
    return step.state.access.candidates.length > 1 && Math.min(...counts) !== Math.max(...counts);
  });
  if (swap >= 0) {
    const a = steps[swap]!.state.access;
    out.push({
      text: '容易换出计数器最小的行，因为把「最少使用」读成了「数最小」',
      at: swap,
      act: (state) => {
        const least = [...a.candidates].sort((x, y) => (state.rows[x]?.count ?? 0) - (state.rows[y]?.count ?? 0))[0]!;
        const kept = state.rows[least]?.block;
        return {
          label: '',
          patch: { out: { value: `块 ${kept}` }, [`r${least}`]: { active: 0 } },
          moves: [{ value: `块 ${kept}`, from: `r${least}`, to: 'out', via: [`bus-r${least}`, 'bus-out'] }],
          message: `行 ${least} 的计数器是 ${state.rows[least]?.count}，最小，说明它刚用过。把它换出，丢掉的是最近在用的块 ${kept}。LRU 换出计数器最大的行：行 ${a.row}，它最久没用到。`,
        };
      },
    });
  }
  // 候选行里还有空行，却去替换。
  const load = steps.findIndex((step, i) => {
    if (!step.changes.some((change) => change.at === 'access.action') || step.state.access.action !== '调入') return false;
    const before = (i > 0 ? steps[i - 1]!.state : trace.initial).rows;
    return step.state.access.candidates.some((k) => before[k]?.block !== null && before[k]?.block !== undefined);
  });
  if (load >= 0) {
    const a = steps[load]!.state.access;
    out.push({
      text: '容易在组里还有空行时就去替换，因为看到缺失就想到换出',
      at: load,
      act: (state) => {
        const full = a.candidates.find((k) => state.rows[k]?.block !== null && state.rows[k]?.block !== undefined)!;
        const kept = state.rows[full]?.block;
        return {
          label: '',
          patch: { out: { value: `块 ${kept}` }, [`r${full}`]: { active: 0 } },
          moves: [{ value: `块 ${kept}`, from: `r${full}`, to: 'out', via: [`bus-r${full}`, 'bus-out'] }],
          message: `行 ${a.row} 还空着，块 ${a.block} 直接放进去就行。这时把行 ${full} 里的块 ${kept} 换出，下次再访问它又要缺失一次。候选行都占满了才替换。`,
        };
      },
    });
  }
  // 换出时忘了写回。
  const back = steps.findIndex((step) => step.state.access.writeBack && step.changes.some((change) => change.at === 'access.writeBack'));
  if (back >= 0) {
    const a = steps[back]!.state.access;
    out.push({
      text: '容易忘了先把修改位为 1 的块写回主存，因为只看了新块调入',
      at: back + 1,
      act: () => ({
        label: '',
        patch: { out: { value: `块 ${a.evicted} 丢掉` } },
        moves: [{ value: `块 ${a.evicted}`, from: `r${a.row}`, to: 'out', via: [`bus-r${a.row}`, 'bus-out'] }],
        message: `块 ${a.evicted} 的修改位是 1，cache 里的这一块比主存新。直接丢掉，主存里留的就是旧数；写回法要先把它写回主存，再调入新块（教材 p109）。`,
      }),
    });
  }
  return out;
}
