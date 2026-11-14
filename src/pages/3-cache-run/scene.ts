/**
 * 台面：最远一排是地址，切成 标记 | 行号或组号 | 字地址，下面是求块号和求余的算式；
 * 中间左边是按区排开的主存，右边是算式、命中和缺失两块牌（带次数）、换出；「块传送」通路连到最近一排的 cache 各行。
 * 部件位置固定，不随步骤变。所有数都取自 Trace 的状态或引擎的 layout/splitAddress。
 */
import type { Step, Trace } from '../../engines/trace';
import { layout, splitAddress } from '../../engines/cache/model';
import type { Layout, Params, Row, State } from '../../engines/cache/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, MemoryColumn, Move, PartSpec, SceneSpec, WireSpec } from '../../scene';

/** 主存画成一块 4×4 的板：一行 4 个块。直接映射时一行就是一个区，列号就是区内块号。 */
const PER_LINE = 4;
const X = [-4.62, -1.54, 1.54, 4.62];
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
}

/** 两行两列摆 cache：带计数器时一排放不下桌面舞台，手机上四行一排也装不进画面。 */
const GRID_X = [-2.05, 2.05];
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
    { title: '标记', ink: 'addr', width: 0.64 },
    { title: '修改位', width: 0.8 },
  ];
  if (counted(params)) columns.push({ title: '计数器', width: 0.8 });
  columns.push({ title: '数据', width: 1.0 });
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
    columns = firstLine.map((block) => ({ title: `区内块号 ${fieldOf(block).set}`, width: 1.2 }));
    labels = grid.map((line) => `区 ${fieldOf(line[0] ?? 0).tag}`);
  } else if (g.mapping === '组相联') {
    columns = firstLine.map((block) => ({ title: `组 ${fieldOf(block).set}`, width: 1.0 }));
    labels = grid.map((line) => [...new Set(line.map((block) => fieldOf(block).tag))].map((tag) => `区 ${tag}`).join('、'));
  } else {
    columns = firstLine.map(() => ({ title: '', width: 1.0 }));
    labels = grid.map(() => '');
  }
  return {
    id: 'mem',
    kind: 'memory',
    position: [g.mapping === '直接' ? -3.0 : -3.7, Z_MEM],
    props: { name: '主存', columns, rows: grid.map((line) => line.map((block) => `块 ${block}`)), labels },
  };
}

/** 一个参数组合对应一张台面。引用要稳定：同样的参数请用 useMemo 缓存。 */
export function cacheStage(params: Params, narrow = false): CacheStage {
  const g = layout(params);
  const full = g.mapping === '全相联';
  const grid = (narrow || counted(params)) && g.rows === 4;
  const xs = grid ? [GRID_X[0]!, GRID_X[1]!, GRID_X[0]!, GRID_X[1]!] : counted(params) ? XC : X;
  const zRow = (i: number) => (grid && i >= 2 ? Z_ROWS + GRID_DZ : Z_ROWS);

  const parts: PartSpec[] = [
    { id: 'addr', kind: 'register', position: [-4.9, Z_ADDR], props: { name: '主存地址', value: '', ink: 'addr', width: 2.2 } },
    { id: 'tag', kind: 'bits', position: full ? [-1.0, Z_ADDR] : [-1.7, Z_ADDR], props: { name: '标记', bits: '0'.repeat(g.tagBits), ink: 'addr' } },
  ];
  if (!full) parts.push({ id: 'idx', kind: 'bits', position: [1.5, Z_ADDR], props: { name: indexTitle(g), bits: '0'.repeat(g.indexBits), ink: 'addr' } });
  parts.push(
    { id: 'word', kind: 'bits', position: full ? [3.0, Z_ADDR] : [4.5, Z_ADDR], props: { name: '字地址', bits: '0'.repeat(g.wordBits), ink: 'addr' } },
    { id: 'calcJ', kind: 'label', position: [3.3, -4.95], props: { text: '', plate: true, size: 0.26, mono: true } },
    { id: 'calcI', kind: 'label', position: [3.3, -4.05], props: { text: '', plate: true, size: 0.26, mono: true } },
    memorySpec(g, params),
    { id: 'hit', kind: 'label', position: [1.3, -2.95], props: { text: '命中 0', plate: true, size: 0.34, weight: 600 }, pick: true, title: '命中' },
    { id: 'miss', kind: 'label', position: [3.25, -2.95], props: { text: '缺失 0', plate: true, size: 0.34, weight: 600 }, pick: true, title: '缺失' },
    { id: 'out', kind: 'register', position: [counted(params) && !grid ? 6.0 : 4.95, -1.25], props: { name: '换出', value: '', width: 2.2 } },
    { id: 'bus', kind: 'bus', position: [0, Z_BUS], props: { name: '块传送', length: counted(params) && !grid ? 16.0 : 12.2, value: '', tileAt: -2.2, idleText: '' } },
  );
  for (let i = 0; i < g.rows; i++) {
    parts.push({
      id: `r${i}`,
      kind: 'memory',
      position: [xs[i] ?? 0, zRow(i)],
      props: { name: rowName(i), columns: rowColumns(params), rows: [rowCells(params, { tag: null, block: null, modified: 0, count: 0 })] },
      pick: true,
    });
  }

  const wires: WireSpec[] = [
    { id: 'mem-bus', from: 'mem', to: 'bus' },
    { id: 'bus-out', from: 'bus', to: 'out' },
  ];
  for (let i = 0; i < g.rows; i++) {
    // 两行两列时，后一排从两侧绕过前一排接进来。
    if (grid && i >= 2) {
      const x = i === 2 ? -SIDE : SIDE;
      wires.push({ id: `bus-r${i}`, from: 'bus', to: `r${i}.${i === 2 ? 'w' : 'e'}`, via: [[x, Z_BUS + 0.3], [x, zRow(i)]] });
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
  // 主存板上只框出当前访问的那一块。
  table['mem'] = {
    cell: (c: BindContext<State>) => {
      const block = c.state.access.block;
      return shown(c) && block !== null ? `${Math.floor(block / PER_LINE)}.${block % PER_LINE}` : '';
    },
  };
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
    const out: Move[] = [{ value: `块 ${a.block}`, from: cellOf(a.block), to: `r${row}`, via: ['mem-bus', `bus-r${row}`] }];
    if (a.evicted !== null) {
      out.push(
        a.writeBack
          ? { value: `块 ${a.evicted}`, from: `r${row}`, to: cellOf(a.evicted), via: [`bus-r${row}`, 'mem-bus'] }
          : { value: `块 ${a.evicted}`, from: `r${row}`, to: 'out', via: [`bus-r${row}`, 'bus-out'] },
      );
    }
    return out;
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

  const values = (_path: string, value: string): string => (value === 'true' ? '是' : value === 'false' ? '否' : value);

  return { scene: { parts, wires }, bind, moves, names, values };
}

/**
 * 在直接映射的定位步前加一道点选题「块 j 放在哪一行」。只在这个块第一次出现时问。
 * 答案取自这一步之后引擎给出的候选行。
 */
export function withRowAsks(trace: Trace<Params, State>): Trace<Params, State> {
  if (trace.params.mapping !== '直接') return trace;
  const seen = new Set<number>();
  const rows = trace.initial.rows.map((_, i) => rowName(i));
  const steps = trace.steps.map((step) => {
    const a = step.state.access;
    const locate = step.changes.some((change) => change.at.startsWith('access.candidates'));
    if (!locate || step.ask || a.block === null) return step;
    const first = !seen.has(a.block);
    seen.add(a.block);
    const target = a.candidates[0];
    if (!first || target === undefined) return step;
    return {
      ...step,
      ask: {
        prompt: `块 ${a.block} 放在哪一行`,
        kind: 'choice' as const,
        options: rows,
        answer: rowName(target),
        hint: `直接映射用 i = j mod m，这里 m = ${rows.length}。`,
      },
    };
  });
  return { ...trace, steps };
}
