/**
 * 5-spacetime 的台面：远处一块时空图（行是段，自下而上 IF…WB；列是时钟周期），近处一条装配线（指令是盒子，一个时钟周期往前走一个工位）。
 * 每个周期装配线先动，时空图这一列再一格格翻出来。最近一排是三块读数牌：T_k、C_k、T_p。
 * 部件位置固定；所有数都取自 Trace 的状态，页面不自己算答案。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { stageAt, stageNamesOf } from '../../engines/pipeline/spacetime';
import type { SpacetimeParams, SpacetimeState } from '../../engines/pipeline/spacetime';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import type { ChartProps, LineProps } from './part-types';

type State = SpacetimeState;
type T = Trace<SpacetimeParams, State>;

export const kinds = () => import('./parts');

const JOBS: Record<string, string> = { IF: '取指', ID: '译码', EX: '执行', MEM: '访存', WB: '写回' };

/** 工位名旁的小字：段的活（取指、译码…），各段时间不等时写这一段的用时。 */
export function stationNotes(params: SpacetimeParams, narrow: boolean): string[] {
  const names = stageNamesOf(params);
  // 窄屏上工位太窄，名牌旁不再写字（各段时间在条件里）。
  if (narrow) return names.map(() => '');
  if (params.stageTimes) return params.stageTimes.map((t) => `${t} ns`);
  return names.map((name) => JOBS[name] ?? '');
}

export interface SpaceStage {
  scene: SceneSpec;
  bind: Binding<State>;
  frame: (step: Step<State>) => string[] | null;
  askFrame: (ask: Ask, index: number) => string[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
}

/** 时空图的行：段为行时从上到下 WB…IF（纵轴自下而上，教材图 5.33）；指令为行时 I1…In。 */
export function chartRows(params: SpacetimeParams): string[] {
  const names = stageNamesOf(params);
  return (params.layout ?? '段为行') === '段为行' ? [...names].reverse() : Array.from({ length: params.n }, (_, i) => `I${i + 1}`);
}

/** 某个周期之后的时空图：只画到 cycle 列（不含），后面空着。多留一列空列。 */
export function chartCells(params: SpacetimeParams, grid: (number | null)[][], cycle: number, columns: number): string[][] {
  const names = stageNamesOf(params);
  const k = names.length;
  if ((params.layout ?? '段为行') === '段为行') {
    return names
      .map((_, s) => Array.from({ length: columns }, (_, c) => (c < cycle && grid[s]?.[c] ? `I${grid[s]![c]}` : '')))
      .reverse();
  }
  return Array.from({ length: params.n }, (_, i) =>
    Array.from({ length: columns }, (_, c) => {
      if (c >= cycle) return '';
      for (let s = 0; s < k; s++) if (grid[s]?.[c] === i + 1) return names[s]!;
      return '';
    }),
  );
}

/** 某个周期之后装配线上每个工位里是第几条。 */
export function lineItems(params: SpacetimeParams, grid: (number | null)[][], cycle: number): string[] {
  const k = stageNamesOf(params).length;
  return Array.from({ length: k }, (_, s) => (cycle > 0 && grid[s]?.[cycle - 1] ? `I${grid[s]![cycle - 1]}` : ''));
}

export function lineQueue(params: SpacetimeParams, cycle: number): string[] {
  return Array.from({ length: Math.max(0, params.n - cycle) }, (_, i) => `I${cycle + i + 1}`);
}

/** 一份 Trace 对应一张台面。引用要稳定。 */
export function spaceStage(trace: T, narrow: boolean): SpaceStage {
  const params = trace.params;
  const names = stageNamesOf(params);
  const k = names.length;
  const Tk = trace.initial.grid[0]!.length;
  const columns = Tk + 1;
  const byStage = (params.layout ?? '段为行') === '段为行';
  const rows = chartRows(params);
  const longest = Math.max(...names.map((name) => name.length), String(params.n).length + 1);
  const cellWidth = narrow ? Math.max(0.66, 0.24 + longest * 0.2) : Math.max(0.7, 0.26 + longest * 0.21);
  const chartH = 0.48 + rows.length * 0.59 + 0.16;
  const sw = narrow ? (k > 4 ? 0.9 : 0.98) : k > 6 ? 1.5 : 1.8;
  const chartZ = narrow ? -1.0 - chartH * 0.3 : -1.4 - chartH * 0.45;
  const lineZ = chartZ + (narrow ? 1.95 : 3.3);

  const parts: PartSpec[] = [
    {
      id: 'chart',
      kind: '5-spacetime:chart',
      position: [0, chartZ],
      title: '时空图',
      props: {
        // 窄屏不立名牌：板子顶上省出一行，整块板装得进画面。
        ...(narrow ? {} : { name: '时空图' }),
        corner: byStage ? '段＼周期' : '指令＼周期',
        columns: Array.from({ length: columns }, (_, c) => String(c + 1)),
        rows,
        cells: rows.map(() => Array.from({ length: columns }, () => '')),
        cellWidth,
        window: narrow ? 5 : 15,
        slide: narrow,
        lag: 380,
      } satisfies ChartProps,
      describe: (p) => `时空图，填到第 ${(p.current as number) + 1 || 0} 列`,
    },
    {
      id: 'line',
      kind: '5-spacetime:line',
      position: [0, lineZ],
      title: '装配线',
      props: {
        stations: names,
        notes: stationNotes(params, narrow),
        items: names.map(() => ''),
        queue: lineQueue(params, 0),
        done: 0,
        stationWidth: sw,
        padWidth: narrow ? 0.7 : 1.5,
        compact: narrow,
      } satisfies LineProps,
      describe: (p) => `装配线：${(p.items as string[]).map((item, s) => `${names[s]} ${item || '空'}`).join('，')}；完成 ${p.done as number} 条`,
    },
    { id: 'clock', kind: 'label', position: narrow ? [0, lineZ + 1.95] : [-2.4, lineZ + 2.05], props: { text: '时钟周期 τ = ?', plate: true, size: 0.34, weight: 600 }, title: '时钟周期' },
    { id: 'Tk', kind: 'label', position: narrow ? [-1.8, lineZ + 2.75] : [2.4, lineZ + 2.05], props: { text: 'T_k = ?', plate: true, size: 0.34, weight: 600, mono: true }, title: 'T_k' },
    { id: 'Ck', kind: 'label', position: narrow ? [1.6, lineZ + 2.75] : [-2.4, lineZ + 2.95], props: { text: 'C_k = ?', plate: true, size: 0.34, weight: 600, mono: true }, title: 'C_k' },
    { id: 'Tp', kind: 'label', position: narrow ? [0, lineZ + 3.55] : [2.4, lineZ + 2.95], props: { text: 'T_p = ?', plate: true, size: 0.34, weight: 600, mono: true }, title: 'T_p' },
    { id: 'phase', kind: 'label', position: [0, chartZ + (narrow ? 0.8 : 1.05)], props: { text: '', size: 0.32, tone: 'muted', weight: 600 }, title: '阶段' },
  ];

  const cycleOf = (c: BindContext<State>) => c.state.cycle;
  const isCycle = (c: BindContext<State>) => c.step?.level === 'beat';
  const table: Record<string, Record<string, unknown>> = {
    chart: {
      cells: from<State>(['grid', 'cycle'], (c) => chartCells(params, c.state.grid, cycleOf(c), columns)),
      current: from<State>(['cycle'], (c) => (isCycle(c) ? cycleOf(c) - 1 : c.state.figures.Tk !== null && c.state.figures.Ck === null ? Tk - 1 : -1)),
      changedCells: from<State>(['grid'], (c) => {
        if (!isCycle(c)) return [];
        const col = cycleOf(c) - 1;
        return chartCells(params, c.state.grid, cycleOf(c), columns)
          .map((line, r) => (line[col] ? `${r}.${col}` : ''))
          .filter(Boolean);
      }),
      hotCells: from<State>(['figures.Tk'], (c) => {
        if (c.state.figures.Tk === null || c.state.figures.Ck !== null) return [];
        // T_k 那一步：最后一条指令走完最后一段的那一格。
        const r = byStage ? 0 : params.n - 1;
        return [`${r}.${Tk - 1}`];
      }),
    },
    line: {
      // 画完以后线上空了，盒子都进了完成筐。
      items: from<State>(['grid', 'cycle', 'figures.Tk'], (c) => (c.state.figures.Tk !== null ? names.map(() => '') : lineItems(params, c.state.grid, cycleOf(c)))),
      queue: from<State>(['cycle'], (c) => lineQueue(params, cycleOf(c))),
      done: 'done',
    },
    clock: { text: from<State>(['clock'], (c) => (c.state.clock === null ? '时钟周期 τ = ?' : `时钟周期 τ = ${c.state.clock} ns`)) },
    Tk: { text: from<State>(['figures.Tk'], (c) => (c.state.figures.Tk === null ? 'T_k = ?' : `T_k = ${c.state.figures.Tk}`)) },
    Ck: { text: from<State>(['figures.Ck'], (c) => (c.state.figures.Ck === null ? 'C_k = ?' : `C_k = ${c.state.figures.Ck}`)) },
    Tp: { text: from<State>(['figures.Tp'], (c) => (c.state.figures.Tp === null ? 'T_p = ?' : `T_p ${c.state.figures.Tp.replace(/^.*≈ /, '≈ ')}`)) },
    phase: {
      text: from<State>(['phase', 'cycle'], (c) => (c.state.cycle === 0 ? '' : isCycle(c) ? `第 ${c.state.cycle} 个周期 · ${c.state.phase}` : `${Tk} 个周期画完`)),
    },
  };
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  const frame = (step: Step<State>): string[] | null => {
    if (step.level === 'beat') return ['chart', 'line'];
    if (step.state.clock !== null && step.state.cycle === 0) return ['clock', 'line'];
    if (step.state.figures.Tp !== null) return ['Tp', 'Ck', 'Tk'];
    if (step.state.figures.Ck !== null) return ['Ck', 'Tk'];
    // 窄屏上读数牌离时空图远，装不进一屏：这一步数的是图上的列，只看图。
    if (step.state.figures.Tk !== null) return narrow ? ['chart'] : ['chart', 'Tk'];
    return null;
  };
  const askFrame = (ask: Ask): string[] => (ask.prompt.includes('完成') ? ['chart', 'line'] : ask.prompt.includes('C_k') || ask.prompt.includes('加速比') ? ['Tk', 'Ck'] : narrow ? ['chart'] : ['chart', 'Tk']);
  const names_ = (path: string): string => {
    const [head, a, b] = path.split('.');
    if (head === 'grid') return `第 ${Number(b) + 1} 个周期 ${names[Number(a)] ?? ''} 段`;
    const fixed: Record<string, string> = { clock: '时钟周期 τ', cycle: '周期', done: '完成的条数', phase: '阶段', 'figures.Tk': 'T_k', 'figures.Ck': 'C_k', 'figures.Tp': 'T_p' };
    return fixed[path] ?? path;
  };
  const values = (path: string, value: string): string => {
    if (path.startsWith('grid.') && /^\d+$/.test(value)) return `I${value}`;
    if (path === 'clock' && /^[\d.]+$/.test(value)) return `${value} ns`;
    return value;
  };
  return { scene: { parts, wires: [], kinds }, bind, frame, askFrame, names: names_, values };
}

/** 答错时按学生的答案演后果。 */
export function spaceWrong(trace: T) {
  const params = trace.params;
  const names = stageNamesOf(params);
  const k = names.length;
  const Tk = trace.initial.grid[0]!.length;
  const columns = Tk + 1;
  const byStage = (params.layout ?? '段为行') === '段为行';
  return (ask: Ask, value: string, state: State, next: Step<State> | null): Breakage | null => {
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    if (ask.prompt.includes('完成几条')) {
      const after = next?.state ?? state;
      const wbRow = byStage ? 0 : 0;
      return {
        label: '',
        patch: {
          line: { items: lineItems(params, after.grid, after.cycle), queue: lineQueue(params, after.cycle), done: Math.max(0, Math.round(v)) },
          chart: { cells: chartCells(params, after.grid, after.cycle, columns), current: after.cycle - 1, hotCells: [`${wbRow}.${after.cycle - 1}`] },
        },
        moves: [{ value: v > 1 ? `${Math.round(v)} 条？` : 'I1', from: `line.0.${k - 1}`, to: `line.0.${k}`, arc: true }],
        message:
          v > 1
            ? `按 ${v} 条算，完成筐里该有 ${v} 个盒子。可到第 ${k} 个周期，${names[k - 1]} 段只做过 I1 一条；I2 还在 ${names[k - 2]} 段，下一个周期才做完。`
            : `第 ${k} 个周期里 I1 正好走完最后的 ${names[k - 1]} 段，完成筐里已经有它了。`,
      };
    }
    if (ask.prompt.includes('多少个时钟周期')) {
      const n = params.n;
      if (v > Tk) {
        return {
          label: '',
          patch: { chart: { current: Tk, badCells: chartRows(params).map((_, r) => `${r}.${Tk}`) } },
          moves: [{ value: `第 ${Math.round(v)} 列`, from: 'Tk', to: `chart.0.${Tk}`, arc: true }],
          message: `第 ${Math.round(v)} 列是空的：I${n} 在第 ${Tk} 个周期已经走完 ${names[k - 1]} 段。第一条要 ${k} 个周期，之后每个周期出一条，剩下的 ${n - 1} 条再加 ${n - 1} 个。`,
        };
      }
      const col = Math.max(1, Math.round(v));
      const s = stageAt(n, col, k);
      const r = s === null ? -1 : byStage ? k - 1 - s : n - 1;
      return {
        label: '',
        patch: { chart: { current: col - 1, badCells: r >= 0 ? [`${r}.${col - 1}`] : [] } },
        moves: [{ value: `第 ${col} 列`, from: 'Tk', to: r >= 0 ? `chart.${r}.${col - 1}` : 'chart', arc: true }],
        message: s === null ? `到第 ${col} 个周期，I${n} 还没进流水线。` : `到第 ${col} 个周期，I${n} 才走到 ${names[s]} 段，还没做完。`,
      };
    }
    // 加速比
    const close = Math.abs(v - k) < 0.005;
    return {
      label: '',
      patch: { Ck: { text: `C_k = ${value}？`, changed: true } },
      moves: [{ value: `${value}`, from: 'Tk', to: 'Ck', arc: true }],
      message: close
        ? `${k} 是指令条数远大于段数时加速比的极限，这里只有 ${params.n} 条，填充和排空的周期占得不少。`
        : `加速比 = 不用流水的时间 ÷ 用流水的时间。不用流水时每条都要依次走完 ${k} 段${params.stageTimes ? '，时间是各段之和' : ''}。`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。 */
export function spaceMistakes(trace: T): Mistake<State>[] {
  const params = trace.params;
  const names = stageNamesOf(params);
  const k = names.length;
  const n = params.n;
  const Tk = trace.initial.grid[0]!.length;
  const columns = Tk + 1;
  const steps = trace.steps;
  const byStage = (params.layout ?? '段为行') === '段为行';
  const out: Mistake<State>[] = [];
  const tkStep = steps.findIndex((step) => step.state.figures.Tk !== null);
  if (tkStep >= 0) {
    out.push({
      text: '容易把 T_k 数成 k + n，因为把第一条的 k 个周期和全部 n 条都算了一遍',
      at: tkStep + 1,
      act: () => ({
        label: '',
        patch: { chart: { current: Tk, badCells: chartRows(params).map((_, r) => `${r}.${Tk}`) }, Tk: { text: `T_k = ${k} + ${n}？`, changed: true } },
        moves: [{ value: `${k} + ${n}`, from: 'Tk', to: `chart.0.${Tk}`, arc: true }],
        message: `第 ${Tk + 1} 列一格都没有：I${n} 在第 ${Tk} 个周期已经走完。第一条占满 ${k} 个周期，后面的 ${n - 1} 条每条只多一个周期，所以是 k + (n − 1)。`,
      }),
    });
  }
  const lastCycle = steps.map((step) => step.level).lastIndexOf('beat');
  if (byStage && lastCycle >= 0) {
    out.push({
      text: '容易把纵轴画反，IF 写在最上面，因为习惯按指令的先后从上往下排',
      at: lastCycle + 1,
      act: (s) => {
        const cells = chartCells(params, s.grid, s.cycle, columns).reverse();
        return {
          label: '',
          patch: { chart: { rows: [...names], cells, current: -1, badCells: names.map((_, r) => `${r}.0`) } },
          moves: [{ value: names[0]!, from: `chart.${k - 1}.0`, to: 'chart.0.0', arc: true }],
          message: '教材图 5.33 的纵轴是空间，自下而上依次是 IF、ID、EX、WB，每条指令的格子沿斜线往右上走。把 IF 写在顶上，阶梯就朝右下走，和教材的图对不上。',
        };
      },
    });
  }
  if (params.stageTimes) {
    const times = params.stageTimes;
    const slow = times.indexOf(Math.max(...times));
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const clockStep = steps.findIndex((step) => step.state.clock !== null);
    const busy = steps.findIndex((step) => step.level === 'beat' && step.state.grid[slow]?.[step.state.cycle - 1]);
    if (clockStep >= 0 && busy >= 0) {
      out.push({
        text: '容易把时钟周期取成各段的平均值，因为想让每段一样长',
        at: busy + 2,
        act: (s) => {
          const tags = names.map(() => '');
          const tones = names.map(() => '' as const);
          const items = lineItems(params, s.grid, s.cycle);
          const target = Math.min(k - 1, slow + 1);
          tags[target] = `${names[slow]} 没做完`;
          return {
            label: '',
            patch: { line: { tags, tones: tones.map((_, i) => (i === target ? 'bad' : '')), crash: target, items }, clock: { text: `时钟周期 τ = ${Number(avg.toFixed(2))} ns？`, changed: true } },
            moves: [{ value: `${Number(avg.toFixed(2))} ns`, from: 'clock', to: `line.0.${slow}`, arc: true }],
            message: `平均 ${Number(avg.toFixed(2))} ns，可 ${names[slow]} 段要 ${times[slow]} ns。时钟一到，${names[slow]} 段的结果还没算完就被打进下一段的缓冲寄存器，下一段拿到的是半成品。时钟周期只能取最慢的段再加 τₗ。`,
          };
        },
      });
    }
  } else {
    const ckStep = steps.findIndex((step) => step.state.figures.Ck !== null);
    if (ckStep >= 0) {
      out.push({
        text: '容易把不用流水的时间写成 n 个周期，C_k 算成 n / T_k，因为忘了每条指令要走 k 段',
        at: ckStep + 1,
        act: () => ({
          label: '',
          patch: { Ck: { text: `C_k = ${n}/${Tk}？`, changed: true }, line: { items: names.map((_, s) => (s === 0 ? 'I1' : '')), queue: lineQueue(params, 1), done: 0 } },
          moves: [{ value: `${n} 个周期`, from: 'line.0.0', to: 'Ck', arc: true }],
          message: `不用流水时，I1 要走完 ${names.join('、')} 共 ${k} 段，I2 才能开始。n 条就是 n·k 个周期，不是 n 个。`,
        }),
      });
    }
  }
  return out;
}

/** 各段时间不等时，非流水时间按例 5.4 只取各段之和、不含缓冲寄存器：标「本站约定」。 */
export function spaceConvention(params: SpacetimeParams) {
  return (step: Step<State>): string | null => {
    if (params.stageTimes && step.state.figures.Ck !== null && step.state.figures.Tp === null) {
      return '不用流水时的时间取各段时间之和，不加缓冲寄存器的延时，照例 5.4 的算法。';
    }
    return null;
  };
}

export const SPACE_QUESTION = { text: '时空图一格一格怎么填，T_k 个周期从哪里数出来', at: ['chart', 'line'] };
export const SPACE_CONCLUSION =
  '时空图横轴是时钟周期，纵轴自下而上是各段；第 i 条指令在第 t 个周期处在第 t − i + 1 段，画出来是一级级的阶梯。k 段流水线做 n 条要 T_k = k + (n − 1) 个周期；各段一样长时加速比 C_k = n·k / T_k，各段不等长时用时间直接比（n 个任务各段时间之和 ÷ T_k·τ）；吞吐率 T_p = n / (T_k·τ)。';
export const SPACE_NEEDS: { href: string; text: string }[] = [{ href: '/5-cycle', text: '指令周期和时钟周期' }];
