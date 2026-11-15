/**
 * 硬布线控制器的台面：图 5.30 的指令周期流程摊成一张「节拍 × 指令」的格子表，
 * 每格写那一拍做的事；推一个信号时，发出它的格子一格格亮起，再按 M·T 收成几块项牌，拼成表达式。
 * 格子里的操作取自 src/engines/cpu 的 flow()，亮哪几格、怎么合并都取自 src/engines/hardwired 的 Trace。
 *
 * 台面布局（x 向右，z 朝向观看的人）：左边格子表（行 M1·T1…M3·T4，列是指令）；
 * 右边从上往下：信号牌、类型牌、几块项牌、表达式牌；出选择题时表达式牌下面摆几块候选牌。
 */
import { flow } from '../../engines/cpu/model';
import type { Op, SignalNames } from '../../engines/cpu/model';
import { canonical, equivalent, pointsOfExpression, pointsOfSignal } from '../../engines/hardwired/model';
import type { DeriveParams, DeriveState, Term } from '../../engines/hardwired/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import { bindTable } from '../../scene';
import type { BindContext, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

type Ctx = BindContext<DeriveState>;
export const ROWS = ['M1·T1', 'M1·T2', 'M1·T3', 'M1·T4', 'M2·T1', 'M2·T2', 'M2·T3', 'M2·T4', 'M3·T1', 'M3·T2', 'M3·T3', 'M3·T4'];
const rowOf = (m: number, t: number): number => (m - 1) * 4 + (t - 1);

const opsOf = (p: DeriveParams): Op[] => p.instructions ?? ['MOV', 'LAD', 'ADD', 'STO', 'JMP'];

/** 一拍里做的事，写进格子：去掉拆开讲的小步，R0、R1 换成 Rx、Ry（图 5.30 的记法）。 */
export function flowCells(ops: readonly Op[], names: SignalNames): string[][] {
  const cells = ROWS.map(() => ops.map(() => ''));
  ops.forEach((op, c) => {
    flow(canonical(op), names).forEach((cycle, k) => {
      for (let t = 1; t <= 4; t++) {
        const micros = cycle.micros.filter((m) => m.beat === `T${t}` && m.op !== '译码' && !/^选 /.test(m.op) && !/^ALU /.test(m.op));
        const last = micros[micros.length - 1];
        if (last) cells[rowOf(k + 1, t)]![c] = generic(last.op.split('，')[0]!);
      }
    });
  });
  return cells;
}

const generic = (text: string): string => text.replace(/R0/g, 'Rx').replace(/R1/g, 'Ry').replace('IR(地址码)', 'IR');

/** 一个点「LAD·M3·T3」落在哪一格。 */
export function cellOf(point: string, ops: readonly Op[]): string {
  const [op, m, t] = point.split('·');
  return `${rowOf(Number(m!.slice(1)), Number(t!.slice(1)))}.${ops.indexOf(op as Op)}`;
}

/**
 * 格子表的摆法：宽屏一张表（部件 G，列是指令）；手机上每条指令一张窄表（G0、G1……），一排往右摆，
 * 每张都带行名 M·T，镜头跟着正在看的那条指令走。
 */
export interface GridView {
  narrow: boolean;
  ops: readonly Op[];
  ids: string[];
}

export const gridView = (ops: readonly Op[], narrow: boolean): GridView => ({ narrow, ops, ids: narrow ? ops.map((_, c) => `G${c}`) : ['G'] });
const NARROW_DX = 4.7;
const NARROW_DZ = 12.6;
/** 手机上几排格子表一共多深（台面单位），后面的部件接着往下摆。 */
export const gridDepth = (view: GridView): number => (view.narrow ? NARROW_DZ : 0);

export function gridParts(view: GridView, cells: string[][], origin: [number, number], name = '图 5.30 的流程'): PartSpec[] {
  const widest = Math.max(...cells.flat().map((t) => t.length), 4);
  const cellWidth = Math.min(2.6, 0.22 * widest + 0.5);
  if (!view.narrow) {
    return [{ id: 'G', kind: 'grid', position: origin, title: '指令周期流程', props: { name, columns: [...view.ops], rows: ROWS, cells, cellWidth } }];
  }
  return view.ops.map((op, c): PartSpec => ({
    id: `G${c}`,
    kind: 'grid',
    // 一排往右摆，不往纵深摆：台面太深时靠前的部件会跑到镜头后面。
    position: [origin[0] + (c - (view.ops.length - 1) / 2) * NARROW_DX, origin[1]],
    title: `${op} 的流程`,
    props: { name: op, columns: [op], rows: ROWS, cells: cells.map((row) => [row[c]!]), cellWidth },
  }));
}

/** 'r.c' 这一格在台面上的写法（移动的起落点）。 */
export const cellRef = (view: GridView, key: string): string => {
  const [r, c] = key.split('.');
  return view.narrow ? `G${c}.${r}.0` : `G.${r}.${c}`;
};
/** 第 c 列（指令）在哪个部件上。 */
export const gridOf = (view: GridView, c: number): string => (view.narrow ? `G${c}` : 'G');

/** 整张表的属性 → 各部件的属性。 */
export function gridPatch(view: GridView, cells: string[][], tones: string[], changed: string[], current: number): Record<string, Record<string, unknown>> {
  if (!view.narrow) return { G: { cells, tones: Object.fromEntries(tones.map((k) => [k, 'accent'])), changedCells: changed, current } };
  const out: Record<string, Record<string, unknown>> = {};
  view.ops.forEach((_, c) => {
    const mine = (list: string[]) => list.filter((k) => k.split('.')[1] === String(c)).map((k) => `${k.split('.')[0]}.0`);
    out[`G${c}`] = { cells: cells.map((row) => [row[c]!]), tones: Object.fromEntries(mine(tones).map((k) => [k, 'accent'])), changedCells: mine(changed), current: current === c ? 0 : -1 };
  });
  return out;
}

/** 亮着的格子空着时写「保持」：电位信号整个 CPU 周期都有效，这一拍没有新的操作。 */
function lit(base: string[][], keys: string[]): string[][] {
  const out = base.map((row) => [...row]);
  for (const key of keys) {
    const [r, c] = key.split('.').map(Number);
    if (out[r!]![c!] === '') out[r!]![c!] = '保持';
  }
  return out;
}

function marksToCells(marks: DeriveState['marks'], ops: readonly Op[]): string[] {
  const out: string[] = [];
  for (const mark of marks) for (const t of mark.t === null ? [1, 2, 3, 4] : [mark.t]) out.push(`${rowOf(mark.m, t)}.${ops.indexOf(mark.op)}`);
  return out;
}

/** 选择题的候选：正确的式子，加上几种常见写错的式子（去掉 T、少一条指令、M3 不写指令）。等价的不要。 */
export function candidates(terms: Term[], kind: string, ops: readonly Op[]): string[] {
  const text = (list: { m: number; t: number | null; ops: Op[] }[]) =>
    list
      .map((x) => [`M${x.m}`, ...(x.t === null ? [] : [`T${x.t}`]), ...(x.ops.length === 1 ? [x.ops[0]!] : x.ops.length > 1 ? [`(${x.ops.join('+')})`] : [])].join('·'))
      .join('+');
  const right = text(terms);
  const wrong: string[] = [];
  if (kind === '脉冲') wrong.push(text(terms.map((x) => ({ ...x, t: null }))));
  else wrong.push(text(terms.map((x) => ({ ...x, t: 1 }))));
  const lastOps = terms.map((x, i) => (x.ops.length ? i : -1)).filter((i) => i >= 0).pop();
  if (lastOps !== undefined) wrong.push(text(terms.map((x, i) => (i === lastOps ? { ...x, ops: [] } : x))));
  const multi = terms.findIndex((x) => x.ops.length > 1);
  if (multi >= 0) wrong.push(text(terms.map((x, i) => (i === multi ? { ...x, ops: x.ops.slice(1) } : x))));
  else if (terms.length > 1) wrong.push(text(terms.slice(1)));
  else if (terms[0]!.t !== null) wrong.push(text([{ ...terms[0]!, t: terms[0]!.t === 4 ? 3 : terms[0]!.t + 1 }]));
  const seen: string[] = [];
  for (const w of wrong) if (w && w !== right && !seen.includes(w) && !equivalent(w, right, ops)) seen.push(w);
  const list = [right, ...seen.slice(0, 3)];
  // 固定的次序（按字典序），答案不总在第一个。
  return list.sort();
}

/** 把最后一步「写出表达式」的填空换成在台面上挑候选牌。 */
export function polish(trace: Trace<DeriveParams, DeriveState>): Trace<DeriveParams, DeriveState> {
  const last = trace.steps[trace.steps.length - 1]!;
  const ops = opsOf(trace.params);
  const options = candidates(last.state.terms, last.state.kind ?? '脉冲', ops);
  const ask: Ask = {
    prompt: `${trace.params.signal} 的逻辑表达式是哪一块`,
    kind: 'choice',
    options,
    answer: last.state.expression!,
    hint: '对照亮着的格子：每一格都要被式子盖住，没亮的格子式子要为 0。',
  };
  return { ...trace, steps: trace.steps.map((step, i) => (i === trace.steps.length - 1 ? { ...step, ask } : step)) };
}

interface Layout {
  grid: [number, number];
  sig: [number, number];
  kind: [number, number];
  term: (i: number) => [number, number];
  expr: [number, number];
  cand: (i: number) => [number, number];
}

function layout(narrow: boolean, terms: number, depth: number): Layout {
  if (narrow) {
    const z = depth - 2.6;
    return {
      grid: [0, 0],
      sig: [-1.6, -12.4],
      kind: [1.7, -12.4],
      term: (i) => [0, z + i * 1.0],
      expr: [0, z + 0.3 + terms * 1.0],
      cand: (i) => [0, z + 1.5 + terms * 1.0 + i * 1.0],
    };
  }
  return {
    grid: [-4.4, 0],
    sig: [5.6, -5.4],
    kind: [9.0, -5.4],
    term: (i) => [7.3, -3.4 + i * 1.65],
    expr: [7.3, -3.0 + terms * 1.65],
    cand: (i) => [-8.6 + (i % 2) * 6.2, 5.6 + Math.floor(i / 2) * 1.6],
  };
}

export function hardScene(trace: Trace<DeriveParams, DeriveState>, narrow: boolean): SceneSpec {
  const p = trace.params;
  const ops = opsOf(p);
  const final = trace.steps[trace.steps.length - 1]!.state;
  const nTerms = final.terms.length;
  const view = gridView(ops, narrow);
  const L = layout(narrow, nTerms, gridDepth(view));
  const options = trace.steps[trace.steps.length - 1]!.ask?.options ?? [];
  const cells = flowCells(ops, p.names ?? 'book');
  const parts: PartSpec[] = [
    ...gridParts(view, cells, L.grid),
    { id: 'SIG', kind: 'register', position: L.sig, props: { name: '信号', value: p.signal, width: 2.4, ink: 'ctrl' } },
    { id: 'KIND', kind: 'register', position: L.kind, props: { name: '类型', value: '', width: 2.6 } },
    // 手机上项牌、表达式牌、候选牌用小一号的字牌（一行写得下，不缩字）；宽屏是带名牌的块。
    ...final.terms.map(
      (_, i): PartSpec =>
        narrow
          ? { id: `TERM_${i}`, kind: 'label', position: L.term(i), title: `第 ${i + 1} 项`, props: { text: '', size: 0.31, plate: true, mono: true, hidden: true } }
          : { id: `TERM_${i}`, kind: 'register', position: L.term(i), props: { name: `第 ${i + 1} 项`, value: '', width: 4.2, ink: 'ctrl' } },
    ),
    narrow
      ? { id: 'EXPR', kind: 'label', position: L.expr, title: '表达式', props: { text: '', size: 0.31, plate: true, mono: true, hidden: true } }
      : { id: 'EXPR', kind: 'register', position: L.expr, props: { name: `${p.signal} =`, value: '', width: 5.6, ink: 'ctrl' } },
    ...options.map(
      (option, i): PartSpec =>
        narrow
          ? { id: `CAND_${i}`, kind: 'label', position: L.cand(i), title: option, props: { text: option, size: 0.31, plate: true, mono: true, hidden: true }, pick: true }
          : { id: `CAND_${i}`, kind: 'register', position: L.cand(i), title: option, props: { name: `候选 ${String.fromCharCode(65 + i)}`, value: option, width: 5.6, hidden: true }, pick: true },
    ),
  ];
  return { parts, wires: [] };
}

export function hardBind(trace: Trace<DeriveParams, DeriveState>, narrow: boolean) {
  const p = trace.params;
  const ops = opsOf(p);
  const view = gridView(ops, narrow);
  const base = flowCells(ops, p.names ?? 'book');
  const total = trace.steps.length;
  const final = trace.steps[total - 1]!.state;
  const memo = new WeakMap<object, Record<string, Record<string, unknown>>>();
  const grid = (c: Ctx) => {
    let hit = memo.get(c);
    if (!hit) {
      const before = c.step ? (c.index > 1 ? trace.steps[c.index - 2]!.state.marks.length : 0) : 0;
      const on = marksToCells(c.state.marks, ops);
      hit = gridPatch(view, lit(base, on), on, marksToCells(c.state.marks.slice(before), ops), c.state.scanning ? ops.indexOf(c.state.scanning) : -1);
      memo.set(c, hit);
    }
    return hit;
  };
  const table: Record<string, Record<string, unknown>> = {};
  for (const id of view.ids) {
    table[id] = {
      cells: { at: 'marks', as: (c: Ctx) => grid(c)[id]!.cells },
      tones: (c: Ctx) => grid(c)[id]!.tones,
      changedCells: (c: Ctx) => grid(c)[id]!.changedCells,
      current: (c: Ctx) => grid(c)[id]!.current,
    };
  }
  Object.assign(table, {
    KIND: { value: { at: 'kind', as: (c: Ctx) => (c.state.kind === null ? '' : c.state.kind === '电位' ? '电位：只与 M' : '脉冲：与 M·T') } },
    EXPR: narrow
      ? { text: { at: 'expression', as: (c: Ctx) => exprText(p.signal, c.state.expression ?? '', true) }, hidden: (c: Ctx) => !c.state.expression }
      : { value: { at: 'expression', as: (c: Ctx) => c.state.expression ?? '' } },
  });
  final.terms.forEach((_, i) => {
    table[`TERM_${i}`] = narrow
      ? { text: { at: `terms.${i}.text`, as: (c: Ctx) => c.state.terms[i]?.text ?? '' }, hidden: (c: Ctx) => !c.state.terms[i] }
      : { value: { at: `terms.${i}.text`, as: (c: Ctx) => c.state.terms[i]?.text ?? '' } };
  });
  const options = trace.steps[total - 1]!.ask?.options ?? [];
  options.forEach((_, i) => {
    // 候选牌只在出题的那一步摆出来。
    table[`CAND_${i}`] = { hidden: (c: Ctx) => c.index !== total - 1 };
  });
  return bindTable<DeriveState>(table as never);
}

/** 手机上的字牌写 text，宽屏的块写 value；手机的表达式牌把信号名写在前面。 */
const plate = (text: string, narrow: boolean): Record<string, unknown> => (narrow ? { text, hidden: text === '' } : { value: text });
const exprText = (signal: string, text: string, narrow: boolean): string => (narrow && text ? `${signal} = ${text}` : text);

/** 合并那一步：亮着的格子按项飞到项牌上；最后一步：项牌拼进表达式牌。 */
export function hardMoves(trace: Trace<DeriveParams, DeriveState>, narrow: boolean) {
  const ops = opsOf(trace.params);
  const view = gridView(ops, narrow);
  return (step: Step<DeriveState>): Move[] => {
    const s = step.state;
    if (step.changes.some((c) => c.at.startsWith('terms.'))) {
      return s.terms.map((term, i) => {
        const mark = s.marks.find((m) => m.m === term.m && m.t === term.t)!;
        const r = rowOf(mark.m, mark.t ?? 1);
        return { value: term.text, from: cellRef(view, `${r}.${ops.indexOf(mark.op)}`), to: `TERM_${i}`, arc: true, ink: 'ctrl' as const };
      });
    }
    if (step.changes.some((c) => c.at === 'expression')) {
      return s.terms.map((term, i) => ({ value: term.text, from: `TERM_${i}`, to: 'EXPR', arc: true, ink: 'ctrl' as const }));
    }
    if (step.changes.some((c) => c.at === 'kind')) return [{ value: s.kind ?? '', from: 'SIG', to: 'KIND', arc: true, ink: 'ctrl' }];
    return [];
  };
}

/** 手机上一条指令一张表：逐条找格子的步看那条指令的表，合并的步看项牌，最后看表达式。 */
export function hardFrame(trace: Trace<DeriveParams, DeriveState>, narrow: boolean) {
  const ops = opsOf(trace.params);
  const view = gridView(ops, narrow);
  return (step: Step<DeriveState>): string[] | null => {
    if (!narrow) return null;
    if (step.state.scanning) return [gridOf(view, ops.indexOf(step.state.scanning))];
    if (step.changes.some((c) => c.at.startsWith('terms.'))) return step.state.terms.map((_, i) => `TERM_${i}`);
    if (step.changes.some((c) => c.at === 'expression')) return ['EXPR'];
    // 判断电位还是脉冲的那一步：手机看信号牌和类型牌。
    return ['SIG', 'KIND'];
  };
}

export function hardNames(path: string): string {
  if (path === 'kind') return '类型';
  if (path === 'scanning') return '正在看的指令';
  if (path === 'expression') return '表达式';
  const m = /^marks\.(\d+)\.(\w+)$/.exec(path);
  const words: Record<string, string> = { op: '指令', m: '节拍电位', t: '节拍脉冲', what: '操作' };
  if (m) return `第 ${Number(m[1]) + 1} 处的${words[m[2] ?? ''] ?? m[2]}`;
  const t = /^terms\.(\d+)\.(\w+)(?:\.\d+)?$/.exec(path);
  const tails: Record<string, string> = { text: '', m: '的 M', t: '的 T', ops: '的指令' };
  if (t) return `第 ${Number(t[1]) + 1} 项${tails[t[2] ?? ''] ?? ''}`;
  return path;
}

export function hardValues(path: string, value: string): string {
  if (/^marks\.\d+\.m$/.test(path) || /^terms\.\d+\.m$/.test(path)) return `M${value}`;
  if (/^marks\.\d+\.t$/.test(path) || /^terms\.\d+\.t$/.test(path)) return value === 'null' ? '整个周期' : `T${value}`;
  return value;
}

/** 一个式子在格子上的样子：它为 1 的格子亮起；和流程图对不上的格子标强调色。 */
function showExpression(text: string, trace: Trace<DeriveParams, DeriveState>, narrow: boolean): { patch: Record<string, Record<string, unknown>>; missing: string[]; extra: string[] } {
  const p = trace.params;
  const ops = opsOf(p);
  const got = pointsOfExpression(text, ops);
  const want = pointsOfSignal(p.signal, ops, p.names ?? 'book');
  const missing = want.filter((x) => !got.includes(x));
  const extra = got.filter((x) => !want.includes(x));
  const base = flowCells(ops, p.names ?? 'book');
  const keys = got.map((x) => cellOf(x, ops));
  const cells = lit(base, keys);
  for (const x of extra) {
    const [r, c] = cellOf(x, ops).split('.').map(Number);
    if (cells[r!]![c!] === '' || cells[r!]![c!] === '保持') cells[r!]![c!] = '多发';
  }
  for (const x of missing) {
    const [r, c] = cellOf(x, ops).split('.').map(Number);
    cells[r!]![c!] = `漏：${cells[r!]![c!] || '保持'}`;
  }
  return {
    patch: { ...gridPatch(gridView(ops, narrow), cells, keys, [...missing, ...extra].map((x) => cellOf(x, ops)), -1), EXPR: plate(exprText(trace.params.signal, text, narrow), narrow) },
    missing,
    extra,
  };
}

const list = (points: string[], n = 3): string => (points.length > n ? `${points.slice(0, n).join('、')} 等 ${points.length} 拍` : points.join('、'));

function consequence(signal: string, missing: string[], extra: string[]): string {
  const parts: string[] = [];
  if (missing.length) parts.push(`${list(missing)} 本该发 ${signal}，式子在那里是 0，这一拍要做的事做不成`);
  if (extra.length) parts.push(`${list(extra)} 不该发 ${signal}，式子在那里却是 1，会在别的指令或空过的节拍里多发一次`);
  return `${parts.join('；')}。`;
}

/** 选错候选时：把学生选的式子摆到格子上，亮出漏掉和多出的节拍。 */
export function hardWrong(trace: Trace<DeriveParams, DeriveState>, narrow: boolean) {
  return (ask: Ask, value: string): Breakage | null => {
    if (ask.kind !== 'choice') return null;
    const shown = showExpression(value, trace, narrow);
    return { label: '', patch: shown.patch, moves: [], message: `按 ${value}：${consequence(trace.params.signal, shown.missing, shown.extra)}` };
  };
}

/** 弄坏它：从做好的式子里删掉一项，看哪几拍不发了。 */
export function hardBreak(trace: Trace<DeriveParams, DeriveState>, narrow: boolean) {
  return (state: DeriveState, part: string | null): Breakage | null => {
    if (!state.expression) return null;
    if (part !== null && !part.startsWith('TERM_') && part !== 'EXPR') return null;
    if (state.terms.length < 2) {
      const only = state.terms[0]!;
      if (only.ops.length === 0) return null;
      const bare = [`M${only.m}`, ...(only.t === null ? [] : [`T${only.t}`])].join('·');
      const shown = showExpression(bare, trace, narrow);
      return {
        label: '弄坏它：去掉指令名',
        patch: { ...shown.patch, TERM_0: plate(bare, narrow) },
        moves: [{ value: bare, from: 'TERM_0', to: 'EXPR', arc: true, ink: 'ctrl' }],
        message: `只写 ${bare}：${consequence(trace.params.signal, shown.missing, shown.extra)}`,
      };
    }
    const drop = part?.startsWith('TERM_') ? Number(part.slice(5)) : state.terms.length - 1;
    const kept = state.terms.filter((_, i) => i !== drop).map((t) => t.text).join('+');
    const shown = showExpression(kept, trace, narrow);
    return {
      label: `弄坏它：去掉第 ${drop + 1} 项`,
      patch: { ...shown.patch, [`TERM_${drop}`]: narrow ? { hidden: true } : { value: '' } },
      moves: [{ value: state.terms[drop]!.text, from: `TERM_${drop}`, to: 'SIG', arc: true, ink: 'ctrl' }],
      message: `去掉 ${state.terms[drop]!.text} 以后：${consequence(trace.params.signal, shown.missing, shown.extra)}`,
    };
  };
}

/** 常见错误：用引擎的结果改出几个错的式子，在格子上演它们哪几拍不对。 */
export function hardMistakes(trace: Trace<DeriveParams, DeriveState>, narrow: boolean): Mistake<DeriveState>[] {
  const total = trace.steps.length;
  const final = trace.steps[total - 1]!.state;
  const ops = opsOf(trace.params);
  const text = (list: { m: number; t: number | null; ops: Op[] }[]) =>
    list.map((x) => [`M${x.m}`, ...(x.t === null ? [] : [`T${x.t}`]), ...(x.ops.length === 1 ? [x.ops[0]!] : x.ops.length > 1 ? [`(${x.ops.join('+')})`] : [])].join('·')).join('+');
  const out: Mistake<DeriveState>[] = [];
  const act = (wrong: string) => () => {
    const shown = showExpression(wrong, trace, narrow);
    return { label: '', patch: shown.patch, moves: [], message: `写成 ${wrong}：${consequence(trace.params.signal, shown.missing, shown.extra)}` };
  };
  if (final.kind === '脉冲') {
    const wrong = text(final.terms.map((x) => ({ ...x, t: null })));
    out.push({ text: '容易把脉冲信号写成只与 M，因为电位信号就是这么写的', at: total, act: act(wrong) });
  } else {
    const wrong = text(final.terms.map((x) => ({ ...x, t: 1 })));
    out.push({ text: '容易给电位信号也与上 T，因为打入信号都要注节拍', at: total, act: act(wrong) });
  }
  const lastOps = final.terms.map((x, i) => (x.ops.length ? i : -1)).filter((i) => i >= 0).pop();
  if (lastOps !== undefined) {
    const wrong = text(final.terms.map((x, i) => (i === lastOps ? { ...x, ops: [] } : x)));
    if (!equivalent(wrong, final.expression!, ops)) out.push({ text: `容易在 M${final.terms[lastOps]!.m} 这一项漏写指令，因为以为只有 ${final.terms[lastOps]!.ops.join('、')} 走到这一拍`, at: total, act: act(wrong) });
  }
  const multi = final.terms.findIndex((x) => x.ops.length > 1);
  if (multi >= 0) {
    const wrong = text(final.terms.map((x, i) => (i === multi ? { ...x, ops: x.ops.slice(1) } : x)));
    out.push({ text: `容易漏掉 ${final.terms[multi]!.ops[0]}，因为同一拍有好几条指令都发这个信号`, at: total, act: act(wrong) });
  }
  return out.slice(0, 3);
}

/** 第 0 步的问题、结论、需要先会。 */
export const hardQuestion = (narrow: boolean) => ({ text: '这个信号在流程图的哪几格出现，每一格写成哪一项', at: narrow ? ['SIG', 'KIND'] : ['G', 'SIG'] });
export const HARD_CONCLUSION =
  '在指令周期流程图里找出发这个信号的每一处，写成 M·T·指令：脉冲信号与上节拍电位 M 和节拍脉冲 T，电位信号只与 M；同一个 M·T 的几条指令相或写进括号，所有指令都有的项不写指令，各项再相或。';
export const HARD_NEEDS = [
  { href: '/5-cycle', text: '模型机的指令周期' },
  { href: '/5-flow', text: '方框图与控制信号' },
];

/** 用到本站约定的步：C1–C3 的式子书上没给，按同样的规则推。 */
export function hardConvention(step: Step<DeriveState>): string | null {
  if (!/^C[123]$/.test(step.state.signal)) return null;
  return step.changes.some((c) => c.at === 'kind') ? '例 5.3 只写了十个信号的式子，C1–C3 是本站按同样的规则从图 5.30 推出来的。' : null;
}
