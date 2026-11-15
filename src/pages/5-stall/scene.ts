/**
 * 5-stall 的台面：远处一张时空表（指令为行，照表 5.4(b) 的写法：进某段写段名，等待写「停」，等完读寄存器那一格再写一次 ID），
 * 近处一条装配线：指令是盒子，后面的盒子在 ID 等数时，前面空出来的工位里塞进一个空泡，空泡跟着往前走。
 * 时空表上从前一条结果所在的格子往后一条用它的格子画箭头：后推时从 WB 指到下一拍的 ID，定向时从 EX（LAD 是 MEM）直接指到 EX，不处理时箭头朝回指——读到了旧值。
 * 所有周期、停顿、读错都取自引擎（runStall 的状态、schedule 的进段周期），页面只负责摆。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { parseInstruction, registersOf } from '../../engines/pipeline/instr';
import { FIVE_STAGES, FOUR_STAGES } from '../../engines/pipeline/spacetime';
import { schedule } from '../../engines/pipeline/stall';
import type { StallParams, StallState, Timing } from '../../engines/pipeline/stall';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import type { ChartLink, ChartProps, LineProps, LinkTone } from '../5-spacetime/part-types';

type State = StallState;
type T = Trace<StallParams, State>;

export const kinds = () => import('../5-spacetime/parts');

const JOBS: Record<string, string> = { IF: '取指', ID: '译码读数', EX: '执行', MEM: '访存', WB: '写回' };

export const stageNames = (k: 4 | 5): string[] => (k === 4 ? [...FOUR_STAGES] : [...FIVE_STAGES]);

/** 一条指令在时空表里的一行：照表 5.4(b) 的写法。entered[s] 是进第 s 段的周期。和引擎画格子的规则相同，只用来画学生填的数。 */
export function drawRow(entered: (number | null)[], columns: number, names: string[]): string[] {
  const k = names.length;
  return Array.from({ length: columns }, (_, c) => {
    const t = c + 1;
    let s = -1;
    for (let i = 0; i < k; i++) if (entered[i] != null && entered[i]! <= t) s = i;
    if (s < 0) return '';
    if (s === k - 1) return t === entered[s] ? names[s]! : '';
    if (t === entered[s]) return names[s]!;
    const nextAt = entered[s + 1];
    if (nextAt == null) return '';
    if (s === 1 && t === nextAt - 1) return names[1]!;
    return t < nextAt ? '停' : '';
  });
}

/** 第 t 个周期每个工位里的东西：指令盒子，或者一个空泡（~ 加编号，空泡每周期前进一段，编号 t − s 不变）。 */
export function lineAt(timing: Timing, names: string[], t: number): { items: string[]; queue: string[]; done: number } {
  const k = names.length;
  const n = timing.enter.length;
  const items = names.map(() => '');
  const leaveOf = (j: number, s: number) => (s + 1 < k ? timing.enter[j]![s + 1]! : timing.enter[j]![s]! + 1);
  for (let j = 0; j < n; j++) for (let s = 0; s < k; s++) if (t >= timing.enter[j]![s]! && t < leaveOf(j, s)) items[s] = `I${j + 1}`;
  const queue = Array.from({ length: n }, (_, j) => j).filter((j) => timing.enter[j]![0]! > t).map((j) => `I${j + 1}`);
  const done = timing.enter.filter((e) => e[k - 1]! < t).length;
  if (t > 0) {
    for (let s = 0; s < k; s++) {
      if (items[s]) continue;
      const passed = timing.enter.some((e) => e[s]! < t);
      const behind = queue.length > 0 || items.slice(0, s).some(Boolean);
      if (passed && behind) items[s] = `~${t - s}`;
    }
  }
  return { items, queue, done };
}

/** 第 t 个周期，哪条指令的哪个寄存器要从前一条拿：后推时在 ID 读，定向时进 EX 时直接拿。 */
interface Need {
  j: number;
  i: number;
  reg: string;
}

/** 每条指令读的寄存器，最近一次是哪条写的。 */
function needs(params: StallParams): Need[] {
  const list = params.instructions.map(parseInstruction);
  const out: Need[] = [];
  list.forEach((ins, j) => {
    for (const reg of registersOf(ins.reads)) {
      for (let i = j - 1; i >= 0; i--) {
        if (list[i]!.writes.includes(reg)) {
          out.push({ j, i, reg });
          break;
        }
      }
    }
  });
  return out;
}

export interface StallStage {
  scene: SceneSpec;
  bind: Binding<State>;
  frame: (step: Step<State>) => string[] | null;
  askFrame: (ask: Ask) => string[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  timing: Timing;
}

/** 时空表上的箭头：这一对的结果从哪一格来，到哪一格去。只画到第 cycle 列为止都已经画出来的。 */
export function arrowsAt(params: StallParams, timing: Timing, cycle: number): ChartLink[] {
  const k = params.stages;
  const WB = k - 1;
  const list = params.instructions.map(parseInstruction);
  const links: ChartLink[] = [];
  for (const need of needs(params)) {
    const ei = timing.enter[need.i]!;
    const ej = timing.enter[need.j]!;
    const readAt = ej[2]! - 1; // 最后一个 ID 周期
    const writeAt = ei[WB]!;
    if (readAt > writeAt + 1 && params.mode !== '定向') continue; // 隔得远，早写回了，不画
    if (params.mode === '定向') {
      const made = k === 5 && list[need.i]!.op === 'LAD' ? 3 : 2;
      const madeAt = ei[made]!;
      if (readAt > writeAt) continue; // 寄存器里已经有新值，不用定向
      if (madeAt > cycle || ej[2]! > cycle) continue;
      links.push({ from: `${need.i}.${madeAt - 1}`, to: `${need.j}.${ej[2]! - 1}`, style: 'RAW', tone: 'hot', bend: 0.3 });
      continue;
    }
    const end = Math.max(writeAt, readAt);
    if (end > cycle) continue;
    const wrong = readAt <= writeAt;
    links.push({ from: `${need.i}.${writeAt - 1}`, to: `${need.j}.${readAt - 1}`, style: 'RAW', tone: wrong ? 'bad' : 'hot', bend: 0.3 });
  }
  return links;
}

export function stallStage(trace: T, narrow: boolean): StallStage {
  const params = trace.params;
  const names = stageNames(params.stages);
  const k = names.length;
  const list = params.instructions.map(parseInstruction);
  const n = list.length;
  const timing = schedule(params);
  const T_ = timing.total;
  const columns = T_ + 1;
  const chartH = 0.48 + n * 0.59 + 0.16;
  const chartZ = narrow ? -1.0 - chartH * 0.3 : -1.4 - chartH * 0.45;
  const lineZ = chartZ + (narrow ? 2.25 : 3.3);
  const rows = list.map((x, j) => (narrow ? `I${j + 1}` : `I${j + 1} ${x.text}`));
  const sw = narrow ? (k === 5 ? 1.08 : 1.25) : 1.8;

  const parts: PartSpec[] = [
    {
      id: 'chart',
      kind: '5-spacetime:chart',
      position: [0, chartZ],
      title: '时空表',
      props: {
        name: '时空表',
        corner: '指令＼周期',
        columns: Array.from({ length: columns }, (_, c) => String(c + 1)),
        rows,
        cells: rows.map(() => Array.from({ length: columns }, () => '')),
        cellWidth: narrow ? (k === 5 ? 0.82 : 0.74) : 0.8,
        window: narrow ? 6 : 15,
        lag: 380,
      } satisfies ChartProps,
      describe: () => '时空表',
    },
    {
      id: 'line',
      kind: '5-spacetime:line',
      position: [0, lineZ],
      title: '装配线',
      props: {
        stations: names,
        notes: narrow ? names.map(() => '') : names.map((s) => JOBS[s] ?? ''),
        items: names.map(() => ''),
        queue: list.map((_, j) => `I${j + 1}`),
        done: 0,
        stationWidth: sw,
        padWidth: narrow ? 0.95 : 1.5,
        compact: narrow,
      } satisfies LineProps,
      describe: (p) => `装配线：${(p.items as string[]).map((item, s) => `${names[s]} ${item.startsWith('~') ? '空泡' : item || '空'}`).join('，')}`,
    },
    { id: 'sum', kind: 'label', position: [0, lineZ + (narrow ? 1.95 : 2.05)], props: { text: '', plate: true, size: 0.34, weight: 600 }, title: '周期数' },
  ];

  const tagsAt = (t: number): { tags: string[]; tones: LinkTone[]; hot: number[]; bad: number[]; pass: LineProps['pass'] } => {
    const tags = names.map(() => '');
    const tones = names.map(() => '' as LinkTone);
    const hot: number[] = [];
    const bad: number[] = [];
    let pass: LineProps['pass'] = null;
    if (t <= 0) return { tags, tones, hot, bad, pass };
    const at = lineAt(timing, names, t);
    for (let j = 0; j < n; j++) {
      const s = at.items.indexOf(`I${j + 1}`);
      if (s < 0) continue;
      const nextAt = s + 1 < k ? timing.enter[j]![s + 1]! : null;
      const why = s + 1 < k ? timing.reason[j]![s + 1] : null;
      if (why && nextAt !== null && t < nextAt) {
        if (why.kind === 'data') {
          const last = t === nextAt - 1;
          tags[s] = last ? (params.mode === '后推' ? `读 ${why.reg}` : `${why.reg} 将到`) : `等 ${why.reg}`;
          tones[s] = last ? '' : 'hot';
          if (!last) hot.push(s);
        } else if (why.kind === 'busy' && t > timing.enter[j]![s]!) {
          tags[s] = '停';
        }
      }
    }
    for (const w of timing.wrongReads.filter((x) => x.readAt === t)) {
      const s = at.items.indexOf(`I${w.ins}`);
      if (s >= 0) {
        tags[s] = `${w.reg} 旧值`;
        tones[s] = 'bad';
        bad.push(s);
      }
    }
    if (params.mode === '定向') {
      for (const need of needs(params)) {
        const ej = timing.enter[need.j]!;
        const ei = timing.enter[need.i]!;
        if (ej[2] !== t || ej[2]! - 1 > ei[k - 1]!) continue;
        const where = at.items.indexOf(`I${need.i + 1}`);
        pass = { from: where >= 0 ? where : k - 1, to: 2, text: need.reg };
      }
    }
    return { tags, tones, hot, bad, pass };
  };

  const cycleOf = (c: BindContext<State>) => c.state.cycle;
  const ended = (c: BindContext<State>) => c.state.total !== null;
  const table: Record<string, Record<string, unknown>> = {
    chart: {
      cells: from<State>(['grid', 'cycle'], (c) => c.state.grid.map((line) => [...line, ''])),
      current: from<State>(['cycle'], (c) => (c.step?.level === 'beat' ? cycleOf(c) - 1 : -1)),
      changedCells: from<State>(['grid'], (c) => {
        if (c.step?.level !== 'beat') return [];
        const col = cycleOf(c) - 1;
        return c.state.grid.map((line, j) => (line[col] ? `${j}.${col}` : '')).filter(Boolean);
      }),
      badCells: from<State>(['wrong', 'cycle'], (c) => timing.wrongReads.filter((w) => w.readAt <= cycleOf(c)).map((w) => `${w.ins - 1}.${w.readAt - 1}`)),
      links: from<State>(['cycle'], (c) => arrowsAt(params, timing, ended(c) ? T_ : cycleOf(c))),
    },
    line: {
      items: from<State>(['stages', 'cycle'], (c) => (ended(c) ? names.map(() => '') : lineAt(timing, names, cycleOf(c)).items)),
      queue: from<State>(['cycle'], (c) => lineAt(timing, names, cycleOf(c)).queue),
      done: from<State>(['cycle'], (c) => (ended(c) ? n : timing.enter.filter((e) => e[k - 1]! < cycleOf(c)).length)),
      tags: from<State>(['waiting', 'cycle'], (c) => (ended(c) ? [] : tagsAt(cycleOf(c)).tags)),
      tones: from<State>(['waiting', 'cycle'], (c) => (ended(c) ? [] : tagsAt(cycleOf(c)).tones)),
      hot: from<State>(['waiting'], (c) => (ended(c) ? [] : tagsAt(cycleOf(c)).hot)),
      bad: from<State>(['wrong'], (c) => (ended(c) ? [] : tagsAt(cycleOf(c)).bad)),
      pass: from<State>(['cycle'], (c) => (ended(c) ? null : tagsAt(cycleOf(c)).pass)),
      crash: from<State>(['wrong'], (c) => (ended(c) ? -1 : (tagsAt(cycleOf(c)).bad[0] ?? -1))),
    },
    sum: {
      text: from<State>(['total', 'cycle'], (c) =>
        c.state.total !== null
          ? `共 ${c.state.total} 个周期，k + (n − 1) = ${trace.result['无相关时']}`
          : c.state.cycle === 0
            ? `${params.mode}`
            : `第 ${c.state.cycle} 个周期`,
      ),
    },
  };
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);
  const frame = (step: Step<State>): string[] | null => {
    if (step.level === 'beat') return ['chart', 'line'];
    if (step.state.total !== null) return ['chart', 'sum'];
    return ['line', 'sum'];
  };
  const askFrame = (ask: Ask): string[] => (ask.prompt.includes('多等') ? ['line', 'chart'] : ['chart']);
  const names_ = (path: string): string => {
    const g = /^grid\.(\d+)\.(\d+)$/.exec(path);
    if (g) return `I${Number(g[1]) + 1} 第 ${Number(g[2]) + 1} 个周期`;
    const st = /^stages\.(\w+)$/.exec(path);
    if (st) return `${st[1]} 段`;
    if (/^waiting/.test(path)) return '在等';
    if (/^wrong/.test(path)) return '读错';
    const fixed: Record<string, string> = { cycle: '周期', total: '总周期数' };
    return fixed[path] ?? path;
  };
  const values = (_path: string, value: string): string => value;
  return { scene: { parts, wires: [], kinds }, bind, frame, askFrame, names: names_, values, timing };
}

/** 答错时按学生的答案演后果。 */
export function stallWrong(trace: T, timing: Timing) {
  const params = trace.params;
  const names = stageNames(params.stages);
  const k = names.length;
  const n = params.instructions.length;
  return (ask: Ask, value: string, state: State): Breakage | null => {
    const v = Math.round(Number(value));
    if (!Number.isFinite(v)) return null;
    if (ask.prompt.includes('多等')) {
      const j = Number(/I(\d+)/.exec(ask.prompt)?.[1] ?? '0') - 1;
      const why = timing.reason[j]?.[2];
      if (!why || why.kind !== 'data') return null;
      const want = Number(ask.answer);
      const idAt = timing.enter[j]![1]!;
      const readAt = idAt + v; // 学生说的最后一个 ID 周期
      const at = lineAt(timing, names, state.cycle);
      const s = at.items.indexOf(`I${j + 1}`);
      if (v < want) {
        const tags = names.map(() => '');
        const moved = at.items.slice();
        if (s >= 0 && s + 1 < k) {
          moved[s + 1] = `I${j + 1}`;
          moved[s] = '';
          tags[s + 1] = `${why.reg} 旧值`;
        }
        return {
          label: '',
          patch: { line: { items: moved, tags, tones: names.map((_, i) => (i === s + 1 ? 'bad' : '')), crash: s + 1, bad: [s + 1] } },
          moves: [{ value: `${why.reg} 旧值`, from: `line.0.${Math.max(0, s)}`, to: `line.0.${Math.min(k - 1, s + 1)}`, arc: true }],
          message:
            params.mode === '后推'
              ? `只等 ${v} 拍，I${j + 1} 在第 ${readAt} 个周期读 ${why.reg}，可 I${why.from} 第 ${why.ready - 1} 个周期才写回，下一个周期才读得到。它带着旧值进了 EX。`
              : `只等 ${v} 拍，I${j + 1} 在第 ${readAt + 1} 个周期进 EX，可 ${why.reg} 要到第 ${why.ready - 1} 个周期末尾才算出来，专用通路上还没有它。`,
        };
      }
      return {
        label: '',
        patch: { line: { tags: names.map((_, i) => (i === s ? `多等 ${v - want} 拍` : '')), tones: names.map((_, i) => (i === s ? 'hot' : '')) } },
        moves: [{ value: `${v} 拍`, from: 'sum', to: `line.0.${Math.max(0, s)}`, arc: true }],
        message: `${why.reg} 从第 ${why.ready} 个周期起就拿得到，等 ${want} 拍正好；多等 ${v - want} 拍，线上就多 ${v - want} 个空泡，总周期数也跟着多。`,
      };
    }
    // 总周期数
    const T_ = timing.total;
    const col = Math.max(1, Math.min(T_ + 1, v));
    const lastRow = n - 1;
    return {
      label: '',
      patch: { chart: { current: col - 1, badCells: [`${lastRow}.${col - 1}`] } },
      moves: [{ value: `第 ${v} 列`, from: 'sum', to: `chart.${lastRow}.${col - 1}`, arc: true }],
      message:
        v > T_
          ? `第 ${v} 列已经空了：I${n} 在第 ${T_} 个周期写回。`
          : `第 ${v} 个周期 I${n} 还在 ${trace.steps[trace.steps.length - 2]?.state.grid[lastRow]?.[v - 1] || '流水线外'}，没写回。数最后一条指令的 WB 在第几列。`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。 */
export function stallMistakes(trace: T, timing: Timing): Mistake<State>[] {
  const params = trace.params;
  const names = stageNames(params.stages);
  const k = names.length;
  const n = params.instructions.length;
  const list = params.instructions.map(parseInstruction);
  const steps = trace.steps;
  const out: Mistake<State>[] = [];
  const holder = timing.reason.findIndex((r) => r[2]?.kind === 'data');
  const cycleStep = (t: number) => steps.findIndex((step) => step.level === 'beat' && step.state.cycle === t);

  // 1. 只推迟紧跟的那一条，后面的照常走：两条挤进同一段。
  if (params.mode !== '不处理' && holder >= 0 && holder + 1 < n) {
    const j = holder;
    const idAt = timing.enter[j + 1]![1]!;
    const natural = timing.enter[j + 1]![0]! + 1;
    if (idAt > natural) {
      const col = natural - 1;
      out.push({
        text: '容易只推迟有相关的那一条，后面的指令照常往前走，因为忘了按序流水线后面的也要顺延',
        at: cycleStep(natural) + 1,
        act: (s) => {
          const grid = s.grid.map((line) => [...line, '']);
          grid[j + 1]![col] = 'ID';
          return {
            label: '',
            patch: { chart: { cells: grid, badCells: [`${j}.${col}`, `${j + 1}.${col}`], current: col } },
            moves: [{ value: `I${j + 2}`, from: 'line.0.0', to: 'line.0.1', arc: true }],
            message: `第 ${natural} 个周期 I${j + 1} 还在 ID 等数，I${j + 2} 也挤进 ID：一段一个周期只能放一条，两条撞在一起。后一条只能在 IF 里跟着等，后面的依次顺延。`,
          };
        },
      });
    }
  }

  // 2. 以为写回的那个周期就能读到（前半周期写、后半周期读）。
  if (params.mode === '后推' && holder >= 0) {
    const why = timing.reason[holder]![2]!;
    if (why.kind === 'data') {
      const writeAt = why.ready - 1;
      out.push({
        text: '容易少停一拍，以为写回的那个周期就能读到，因为别的书按「前半周期写、后半周期读」算',
        at: cycleStep(writeAt) + 1,
        act: () => ({
          label: '',
          patch: { chart: { links: [{ from: `${why.from - 1}.${writeAt - 1}`, to: `${holder}.${writeAt - 1}`, style: 'RAW', tone: 'bad', bend: 0.4 }], badCells: [`${holder}.${writeAt - 1}`] } },
          moves: [{ value: why.reg, from: `chart.${why.from - 1}.${writeAt - 1}`, to: `chart.${holder}.${writeAt - 1}`, arc: true }],
          message: `教材的口径（习题 12、表 5.4）是写回寄存器的下一个周期才读得到：I${why.from} 第 ${writeAt} 个周期写回 ${why.reg}，I${holder + 1} 最早第 ${why.ready} 个周期读。按「同一周期前半写后半读」会少停一拍，和书上的答案对不上。`,
        }),
      });
    }
  }

  // 3. 定向以后以为 LAD 后面也不用停。
  const ladNeed = params.mode === '定向' && params.stages === 5 ? timing.reason.findIndex((r) => r[2]?.kind === 'data' && list[(r[2] as { from: number }).from - 1]?.op === 'LAD') : -1;
  if (ladNeed >= 0) {
    const why = timing.reason[ladNeed]![2] as { reg: string; from: number; ready: number };
    const exAt = timing.enter[ladNeed]![2]!;
    out.push({
      text: '定向以后容易以为 LAD 后面也不用停，因为运算指令的结果在 EX 末尾就有了',
      at: cycleStep(exAt - 1) + 1,
      act: () => ({
        label: '',
        patch: { line: { tags: names.map((_, s) => (s === 2 ? `${why.reg} 还没取到` : '')), tones: names.map((_, s) => (s === 2 ? 'bad' : '')), crash: 2, bad: [2] } },
        moves: [{ value: why.reg, from: 'line.0.3', to: 'line.0.2', arc: true }],
        message: `LAD 的数要在 MEM 段从存储器里读出来，第 ${why.ready - 1} 个周期末尾才有。紧跟的 I${ladNeed + 1} 若不停，进 EX 时专用通路上还没有 ${why.reg}，只能再等一拍。`,
      }),
    });
  } else if (params.mode !== '定向' && holder >= 0) {
    const why = timing.reason[holder]![2] as { reg: string; from: number; ready: number };
    out.push({
      text: '容易以为相关就一定要停，因为没想到结果可以不经寄存器直接送过去（定向）',
      at: cycleStep(timing.enter[holder]![1]! + 1) + 1,
      act: () => ({
        label: '',
        patch: { line: { pass: { from: 3, to: 2, text: why.reg }, tags: names.map((_, s) => (s === 1 ? `${why.reg} 走旁路` : '')), tones: names.map(() => 'hot' as const) } },
        moves: [{ value: why.reg, from: `line.0.${Math.min(k - 1, 3)}`, to: 'line.0.2', arc: true }],
        message: `I${why.from} 的 ${why.reg} 在 EX 末尾就算出来了，只是要等 WB 才写进寄存器。加一条专用通路（定向，也叫旁路）把它直接送到 EX 的入口，I${holder + 1} 就不用在 ID 干等。切到「定向」看一遍。`,
      }),
    });
  }
  return out;
}

/** 本站约定：五段定向时 LAD 的数算在 MEM 末尾产生；STO 要存的寄存器算在 EX 用到。教材没给这两种的例子。 */
export function stallConvention(params: StallParams, timing: Timing) {
  const list = params.instructions.map(parseInstruction);
  return (step: Step<State>): string | null => {
    if (step.level !== 'beat') return null;
    const t = step.state.cycle;
    for (const [j, reasons] of timing.reason.entries()) {
      const why = reasons[2];
      if (!why || why.kind !== 'data') continue;
      const holdFrom = timing.enter[j]![1]! + 1;
      const holdTo = timing.enter[j]![2]! - 1;
      if (t < holdFrom || t > holdTo) continue;
      if (params.mode === '定向' && params.stages === 5 && list[why.from - 1]?.op === 'LAD') return 'LAD 的数在 MEM 段末尾才取到，紧跟它的指令要停一拍。教材没有五段定向的例子，这是按「结果在哪里产生就从哪里送」推出来的。';
      if (list[j]!.op === 'STO') return 'STO 要存进内存的寄存器，按在 EX 段用到算，和运算指令相同。';
    }
    return null;
  };
}

export const STALL_QUESTION = { text: '后一条要用前一条的结果时，在 ID 停几拍，定向以后还停不停', at: ['line', 'chart'] };
export const STALL_CONCLUSION =
  '按教材的口径，前一条写回寄存器之后的下一个周期才读得到：不处理就读到旧值；后推时后一条停在 ID，相邻相关四段停 2 拍、五段停 3 拍，后面的指令依次顺延；定向时结果一产生就送进 EX，四段不停，五段只有紧跟 LAD 的停 1 拍。总周期数看最后一条的 WB 在第几列。';
export const STALL_NEEDS = [
  { href: '/5-spacetime', text: '时空图' },
  { href: '/5-hazard', text: 'RAW 的判断' },
];
