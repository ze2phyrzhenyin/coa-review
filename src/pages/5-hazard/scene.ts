/**
 * 5-hazard 的台面：远处一块「相关连线」板（一行一条指令，读的、写的寄存器是小牌；写和读之间拉线，RAW 实线、WAR 虚线、WAW 双线），
 * 近处一块五段流水线的时空表（指令为行）：RAW 时从前一条的 WB 格往后一条的 ID 格画箭头，箭头朝回指（ID 不晚于 WB）就是读到了旧值。
 * 台面右边几张答题牌（无、RAW、WAR、WAW），出题时点牌作答。所有类型和读写集合都取自 Trace。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { hazards, kindsText } from '../../engines/pipeline/hazard';
import type { HazardParams, HazardState, PairResult } from '../../engines/pipeline/hazard';
import { parseInstruction } from '../../engines/pipeline/instr';
import { FIVE_STAGES } from '../../engines/pipeline/spacetime';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import type { ChartLink, ChartProps, DepsLink, DepsProps, LinkKind } from '../5-spacetime/part-types';

type State = HazardState;
type T = Trace<HazardParams, State>;

export const kinds = () => import('../5-spacetime/parts');

/** 五段按序流水线里第 i 条（1 起）在第 c 个周期（1 起）所在的段名。 */
const stageOf = (i: number, c: number): string => FIVE_STAGES[c - i] ?? '';

export interface HazardStage {
  scene: SceneSpec;
  bind: Binding<State>;
  frame: (step: Step<State>) => string[] | null;
  askFrame: (ask: Ask) => string[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  /** 答题牌：选项文字 → 部件 id。 */
  stamps: Map<string, string>;
}

/** 全部可能的连线：每一对、每一种、每个寄存器一根。 */
export function allLinks(results: PairResult[]): Omit<DepsLink, 'on'>[] {
  const out: Omit<DepsLink, 'on'>[] = [];
  for (const r of results) {
    for (const reg of r.raw) out.push({ i: r.i, j: r.j, kind: 'RAW', reg });
    for (const reg of r.war) out.push({ i: r.i, j: r.j, kind: 'WAR', reg });
    for (const reg of r.waw) out.push({ i: r.i, j: r.j, kind: 'WAW', reg });
  }
  return out;
}

/** 时空表上这一对的箭头：RAW 从 I_i 的 WB 到 I_j 的 ID；WAR 从 I_i 的 ID 到 I_j 的 WB；WAW 从 WB 到 WB。 */
export function pairArrows(r: { i: number; j: number; raw: string[]; war: string[]; waw: string[]; wrong: boolean }, tone: 'hot' | 'bad' | 'faint' = 'hot'): ChartLink[] {
  const links: ChartLink[] = [];
  const at = (i: number, cycle: number) => `${i - 1}.${cycle - 1}`;
  if (r.raw.some((x) => x.startsWith('R'))) links.push({ from: at(r.i, r.i + 4), to: at(r.j, r.j + 1), style: 'RAW', tone: r.wrong ? 'bad' : tone, bend: 0.35 });
  if (r.war.length) links.push({ from: at(r.i, r.i + 1), to: at(r.j, r.j + 4), style: 'WAR', tone: tone === 'hot' ? '' : tone, bend: -0.3 });
  if (r.waw.length) links.push({ from: at(r.i, r.i + 4), to: at(r.j, r.j + 4), style: 'WAW', tone: tone === 'hot' ? '' : tone, bend: 0.3 });
  return links;
}

export function hazardStage(trace: T, narrow: boolean, options: { regs?: string[] } = {}): HazardStage {
  const params = trace.params;
  const list = params.instructions.map(parseInstruction);
  const n = list.length;
  const results = hazards(params);
  const links = allLinks(results);
  const columns = n + 4;
  const chartH = 0.48 + n * 0.59 + 0.16;
  const depsZ = narrow ? -2.4 : -2.6;
  // 答题牌紧挨着指令板的前沿；时空表再往前，板子立起来不挡住后面的牌。
  // 答题牌：这份 Trace 里出现过的全部选项。
  const options_ = [...new Set(trace.steps.flatMap((step) => step.ask?.options ?? []))];
  const perRow = narrow ? (options_.some((o) => o.length > 4) ? 2 : 3) : 4;
  const stampRows = Math.ceil(options_.length / perRow);
  const stampZ = depsZ + 1.3 + (stampRows - 1) * 0.48;
  const chartZ = stampZ + 1.0 + (stampRows - 1) * 0.48 + chartH / 0.79;

  const stamps = new Map<string, string>();
  options_.forEach((option, k) => stamps.set(option, `opt${k}`));

  const parts: PartSpec[] = [
    {
      id: 'deps',
      kind: '5-spacetime:deps',
      position: [0, depsZ],
      title: '读写集合',
      props: {
        rows: list.map((x, r) => ({ label: `I${r + 1}`, text: x.text, reads: x.reads, writes: x.writes, shown: false })),
        links: links.map((l) => ({ ...l, on: false })),
        compact: narrow,
      } satisfies DepsProps,
      describe: () => '读写集合和相关连线',
    },
    {
      id: 'chart',
      kind: '5-spacetime:chart',
      position: [narrow ? 0 : -0.6, chartZ],
      title: '五段流水线',
      props: {
        name: '五段流水线',
        corner: '指令＼周期',
        columns: Array.from({ length: columns }, (_, c) => String(c + 1)),
        rows: list.map((_, r) => `I${r + 1}`),
        cells: list.map((_, r) => Array.from({ length: columns }, (_, c) => stageOf(r + 1, c + 1))),
        cellWidth: narrow ? 0.78 : 0.8,
      } satisfies ChartProps,
      describe: () => '五段流水线的时空表',
    },
  ];
  // 答题牌：手机上排在时空表下面一排，宽屏放在时空表右边一列。
  const longest = Math.max(...options_.map((option) => option.length), 3);
  const stampW = Math.max(narrow ? 1.55 : 2.0, longest * 0.3 + 0.8);
  options_.forEach((option, k) => {
    const id = stamps.get(option)!;
    // 一排放不下时分两排；牌距按最长的字定。
    const rowsOf = Math.ceil(options_.length / perRow);
    const inRow = Math.min(perRow, options_.length - Math.floor(k / perRow) * perRow);
    const col = k % perRow;
    const row = Math.floor(k / perRow);
    const position: [number, number] = [(col - (inRow - 1) / 2) * stampW + (narrow ? 0 : -0.6), stampZ + (row - (rowsOf - 1) / 2) * 0.95];
    parts.push({ id, kind: 'label', position, title: option, pick: true, props: { text: option, plate: true, size: 0.36, weight: 600, mono: true } });
  });
  if (options.regs) {
    parts.push({
      id: 'regs',
      kind: 'memory',
      position: narrow ? [0, chartZ + 2.9] : [6.4, chartZ - 0.6],
      title: '寄存器',
      props: { name: '寄存器和存储单元', columns: [{ title: '名' }, { title: '内容', width: 2.6 }], rows: options.regs.map((reg) => [reg, '原来的值']) },
    });
  }

  const pairOf = (c: BindContext<State>) => (c.state.current === null ? null : (c.state.pairs[c.state.current] ?? null));
  const final = (c: BindContext<State>) => !!c.step && c.state.current === null && c.state.pairs.length === results.length && c.index === trace.steps.length;
  const table: Record<string, Record<string, unknown>> = {
    deps: {
      rows: from<State>(['instructions'], (c) => list.map((x, r) => ({ label: `I${r + 1}`, text: x.text, reads: x.reads, writes: x.writes, shown: c.state.instructions[r]!.reads !== null }))),
      links: from<State>(['pairs', 'current'], (c) => {
        const seen = new Set(c.state.pairs.map((p) => `${p.i}-${p.j}`));
        const cur = pairOf(c);
        const end = final(c);
        return links.map((l) => {
          const pair = c.state.pairs.find((p) => p.i === l.i && p.j === l.j);
          const on = seen.has(`${l.i}-${l.j}`);
          const tone = cur && cur.i === l.i && cur.j === l.j ? 'hot' : end && pair?.wrong && l.kind === 'RAW' && l.reg.startsWith('R') ? 'bad' : 'faint';
          return { ...l, on, tone };
        });
      }),
      current: from<State>(['current', 'instructions'], (c) => {
        const cur = pairOf(c);
        if (cur) return [cur.i - 1, cur.j - 1];
        const k = c.step ? c.step.focus.map((f) => /^instructions\.(\d+)$/.exec(f)?.[1]).find(Boolean) : undefined;
        return k !== undefined && c.step?.level === 'instruction' ? [Number(k)] : [];
      }),
      hotReads: from<State>(['current'], (c) => {
        const cur = pairOf(c);
        return list.map((_, r) => (cur && r === cur.j - 1 ? cur.raw : cur && r === cur.i - 1 ? cur.war : []));
      }),
      hotWrites: from<State>(['current'], (c) => {
        const cur = pairOf(c);
        return list.map((_, r) => (cur && r === cur.i - 1 ? [...cur.raw, ...cur.waw] : cur && r === cur.j - 1 ? [...cur.war, ...cur.waw] : []));
      }),
    },
    chart: {
      links: from<State>(['current'], (c) => {
        const cur = pairOf(c);
        if (cur) return pairArrows(cur);
        if (final(c)) return c.state.pairs.filter((p) => p.wrong).flatMap((p) => pairArrows({ ...p, war: [], waw: [] }));
        return [];
      }),
      hotCells: from<State>(['current'], (c) => {
        const cur = pairOf(c);
        if (!cur || !cur.raw.some((x) => x.startsWith('R'))) return [];
        return [`${cur.i - 1}.${cur.i + 3}`, `${cur.j - 1}.${cur.j}`];
      }),
      badCells: from<State>(['current'], (c) => (final(c) ? c.state.pairs.filter((p) => p.wrong).map((p) => `${p.j - 1}.${p.j}`) : [])),
    },
  };
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  // 手机上两块板装不下时只看最后一个：判类型时看指令板，最后一步看时空表。
  const frame = (step: Step<State>): string[] | null => {
    if (step.level === 'instruction') return ['deps'];
    if (step.state.current === null) return narrow ? ['chart'] : ['deps', 'chart'];
    return narrow ? ['chart', 'deps'] : ['deps', 'chart'];
  };
  const askFrame = (): string[] => ['deps', ...stamps.values()];
  const names = (path: string): string => {
    const m = /^instructions\.(\d+)\.(reads|writes)/.exec(path);
    if (m) return `I${Number(m[1]) + 1} ${m[2] === 'reads' ? '读' : '写'}`;
    const p = /^pairs\.(\d+)\.(\w+)/.exec(path);
    if (p) {
      const pair = results[Number(p[1])];
      const field: Record<string, string> = { i: '前一条', j: '后一条', raw: '后读∩前写', war: '后写∩前读', waw: '后写∩前写', wrong: '会读错' };
      return `I${pair?.i}–I${pair?.j} ${field[p[2]!] ?? p[2]}`;
    }
    if (path === 'current') return '正在看的一对';
    return path;
  };
  const values = (path: string, value: string): string => {
    if (path === 'current' && /^\d+$/.test(value)) {
      const pair = results[Number(value)];
      return pair ? `I${pair.i}–I${pair.j}` : value;
    }
    if (/\.wrong$/.test(path)) return value === 'true' ? '会' : '不会';
    return value;
  };
  return { scene: { parts, wires: [], kinds }, bind, frame, askFrame, names, values, stamps };
}

/** 答错时按学生选的类型演一遍：那一种线要哪两个集合相交，交集是什么。 */
export function hazardWrong(trace: T, stamps: Map<string, string>) {
  const params = trace.params;
  const list = params.instructions.map(parseInstruction);
  const set = (xs: string[]) => (xs.length ? `{${xs.join(', ')}}` : '∅');
  return (ask: Ask, value: string, _state: State, next: Step<State> | null): Breakage | null => {
    const pair = next?.state.pairs[next.state.pairs.length - 1];
    if (!pair) return null;
    const a = list[pair.i - 1]!;
    const b = list[pair.j - 1]!;
    const said = value.split('、').filter(Boolean) as (LinkKind | '无')[];
    const lines: string[] = [];
    for (const kind of said) {
      if (kind === 'RAW') lines.push(`RAW 要 I${pair.j} 读的和 I${pair.i} 写的有同一个：I${pair.j} 读 ${set(b.reads)}，I${pair.i} 写 ${set(a.writes)}，交集 ${set(pair.raw)}`);
      if (kind === 'WAR') lines.push(`WAR 要 I${pair.j} 写的正是 I${pair.i} 要读的：I${pair.j} 写 ${set(b.writes)}，I${pair.i} 读 ${set(a.reads)}，交集 ${set(pair.war)}`);
      if (kind === 'WAW') lines.push(`WAW 要两条写同一个：I${pair.i} 写 ${set(a.writes)}，I${pair.j} 写 ${set(b.writes)}，交集 ${set(pair.waw)}`);
      if (kind === '无') lines.push(`三个交集里有不空的：后读∩前写 ${set(pair.raw)}，后写∩前读 ${set(pair.war)}，后写∩前写 ${set(pair.waw)}`);
    }
    const missing = (['RAW', 'WAR', 'WAW'] as const).filter((k) => !said.includes(k) && (k === 'RAW' ? pair.raw : k === 'WAR' ? pair.war : pair.waw).length > 0);
    if (missing.length && !said.includes('无')) lines.push(`还漏了 ${missing.join('、')}`);
    const stamp = stamps.get(value);
    const moves: Move[] = [{ value, from: stamp ?? 'deps', to: `deps.${pair.j - 1}.0`, arc: true }];
    return {
      label: '',
      patch: {
        deps: {
          current: [pair.i - 1, pair.j - 1],
          hotWrites: list.map((_, r) => (r === pair.i - 1 ? a.writes : r === pair.j - 1 ? b.writes : [])),
          hotReads: list.map((_, r) => (r === pair.i - 1 ? a.reads : r === pair.j - 1 ? b.reads : [])),
        },
        ...(stamp ? { [stamp]: { changed: true } } : {}),
      },
      moves,
      message: `${lines.join('；')}。`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。 */
export function hazardMistakes(trace: T): Mistake<State>[] {
  const params = trace.params;
  const list = params.instructions.map(parseInstruction);
  const results = hazards(params);
  const steps = trace.steps;
  const links = allLinks(results);
  const out: Mistake<State>[] = [];

  // 1. 目标寄存器的位置看错：把三地址的第一个当成源，最后一个当成目标。
  const three = list.findIndex((x) => /^(ADD|SUB|MUL|DIV|AND|OR) R\d+,R\d+,R\d+$/.test(x.text));
  if (three >= 0) {
    const x = list[three]!;
    const ops = x.text.split(' ')[1]!.split(',');
    const wrongWrites = [ops[2]!];
    const wrongReads = [ops[0]!, ops[1]!];
    out.push({
      text: `容易把 ${x.text} 的目标看成 ${ops[2]}，因为有的书把结果写在最后`,
      at: three + 1,
      act: () => ({
        label: '',
        patch: {
          deps: {
            current: [three],
            badReads: list.map((_, r) => (r === three ? wrongReads : [])),
            rows: list.map((y, r) => ({ label: `I${r + 1}`, text: y.text, reads: r === three ? wrongReads : y.reads, writes: r === three ? wrongWrites : y.writes, shown: r <= three })),
          },
        },
        moves: [{ value: ops[2]!, from: `deps.${three}.0`, to: `deps.${three}.1`, arc: true }],
        message: `教材 5.6 节的三地址写法目标在最前：${x.text} 是 ${x.meaning}，写的是 ${x.writes.join('、')}。读写集合一反，三个交集全跟着错，RAW 会被判成 WAR。`,
      }),
    });
  }

  // 2. RAW 和 WAR 说反。
  const rawPair = results.findIndex((r) => r.raw.length > 0);
  if (rawPair >= 0) {
    const r = results[rawPair]!;
    const reg = r.raw[0]!;
    const stepIndex = steps.findIndex((step) => step.state.current === rawPair);
    out.push({
      text: `容易把 I${r.i}–I${r.j} 的 ${reg} 说成 WAR，因为只看到两条都用了 ${reg}，没看谁先写`,
      at: stepIndex + 1,
      act: () => ({
        label: '',
        patch: { chart: { links: [{ from: `${r.i - 1}.${r.i}`, to: `${r.j - 1}.${r.j + 3}`, style: 'WAR', tone: 'bad', bend: -0.3 }] } },
        moves: [{ value: 'WAR？', from: `deps.${r.i - 1}.1`, to: `deps.${r.j - 1}.0`, arc: true }],
        message: `名字照字面读：RAW 是「写后读」，前一条写、后一条读。这里 I${r.i} 写 ${reg}，I${r.j} 读 ${reg}，就是 RAW。WAR 反过来：前一条读、后一条写，例如 I${r.i} 还要读的寄存器被 I${r.j} 抢先改了。`,
      }),
    });
  }

  // 3. 以为 WAR、WAW 在五段按序流水线里也会读错。
  const other = results.findIndex((r) => r.war.length > 0 || r.waw.length > 0);
  if (other >= 0) {
    const r = results[other]!;
    out.push({
      text: '容易以为 WAR、WAW 在这条五段流水线里也会出错，因为它们也叫数据相关',
      at: steps.length,
      act: () => ({
        label: '',
        patch: { chart: { links: pairArrows({ ...r, raw: [] }, 'hot'), hotCells: [] }, deps: { links: links.map((l) => ({ ...l, on: true, tone: l.i === r.i && l.j === r.j && l.kind !== 'RAW' ? 'hot' : 'faint' })) } },
        moves: [{ value: kindsText(r.kinds.filter((k) => k !== 'RAW')), from: `deps.${r.i - 1}.1`, to: 'chart', arc: true }],
        message: `看时空表上这两根箭头：按序流水线里每条都在 ID 读、在 WB 写，后一条的 WB 总比前一条的 ID、WB 晚，箭头都朝右。所以 I${r.i}–I${r.j} 的 ${kindsText(r.kinds.filter((k) => k !== 'RAW'))} 在这里不出错，要到超标量、乱序执行时才要处理。`,
      }),
    });
  }
  return out;
}

export const HAZARD_QUESTION = { text: '每一对指令，看写的和读的有没有同一个寄存器', at: ['deps'] };
export const HAZARD_CONCLUSION =
  '先写出每条指令的读集合和写集合，再看每一对（I_i 在前）：后读∩前写不空是 RAW，后写∩前读不空是 WAR，后写∩前写不空是 WAW，可以同时有几种。五段按序流水线里只有相隔不到 4 条的寄存器 RAW 会读到旧值，WAR、WAW 不出错。';
export const HAZARD_NEEDS = [{ href: '/5-spacetime', text: '时空图' }];
