/**
 * 时空图：k 段线性流水线处理 n 条指令（任务），逐个时钟周期填格，
 * 再代公式求 Tk、Ck、Tp（教材 5.6.1，p183–186，图 5.33、图 5.35；例 5.4 p187）。
 */
import { TraceBuilder, type Condition, type SolutionTable, type Trace } from '../trace';
import { fmt, generator } from './instr';

export const SPACETIME_ENGINE = 'pipeline-spacetime';
export const MAX_STAGES = 8;
export const MAX_TASKS = 24;

export const FOUR_STAGES = ['IF', 'ID', 'EX', 'WB'] as const;
export const FIVE_STAGES = ['IF', 'ID', 'EX', 'MEM', 'WB'] as const;

export type Layout = '段为行' | '指令为行';

export interface SpacetimeParams {
  /** 段数 k，2–8。 */
  k: number;
  /** 指令（任务）条数 n，1–24。 */
  n: number;
  /** 各段名字，长度为 k。缺省：k=4 用 IF ID EX WB，k=5 用 IF ID EX MEM WB，其余 S1…Sk。 */
  stageNames?: string[];
  /** 各段一样长时的时钟周期 Δt（ns）。与 stageTimes 二选一。 */
  dt?: number;
  /** 各段时间 τi（ns），长度为 k。时钟周期取最慢的段加缓冲寄存器延时。 */
  stageTimes?: number[];
  /** 缓冲寄存器延时 τl（ns），只和 stageTimes 一起用，缺省 0。 */
  latch?: number;
  /** 解题表的画法：段为行（图 5.33、图 5.35）或指令为行（表 5.3、图 5.37）。缺省段为行。 */
  layout?: Layout;
}

export interface SpacetimeState {
  /** 时钟周期 τ（ns），定下来之前是 null。 */
  clock: number | null;
  /** 已经走过的时钟周期数。 */
  cycle: number;
  /** grid[段][周期−1]：这一格里是第几条指令；还没画到或空着是 null。 */
  grid: (number | null)[][];
  /** 到当前周期结束一共完成几条。 */
  done: number;
  /** 当前周期属于哪个阶段（图 5.35）：填充、稳定、排空。 */
  phase: '' | '填充' | '稳定' | '排空';
  /** 代公式的结果，算到之前是 null。 */
  figures: { Tk: number | null; Ck: string | null; Tp: string | null };
}

export function stageNamesOf(params: Pick<SpacetimeParams, 'k' | 'stageNames'>): string[] {
  if (params.stageNames) return [...params.stageNames];
  if (params.k === 4) return [...FOUR_STAGES];
  if (params.k === 5) return [...FIVE_STAGES];
  return Array.from({ length: params.k }, (_, i) => `S${i + 1}`);
}

const positive = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x > 0;

export function checkSpacetime(p: SpacetimeParams): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(p.k) || p.k < 2 || p.k > MAX_STAGES) problems.push(`段数 k 要是 2 到 ${MAX_STAGES} 的整数`);
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > MAX_TASKS) problems.push(`指令条数 n 要是 1 到 ${MAX_TASKS} 的整数`);
  if (p.stageNames !== undefined) {
    if (p.stageNames.length !== p.k) problems.push('段名的个数要等于段数 k');
    if (p.stageNames.some((s) => !s.trim())) problems.push('段名不能为空');
    if (new Set(p.stageNames).size !== p.stageNames.length) problems.push('段名不能重复');
  }
  const hasDt = p.dt !== undefined;
  const hasTimes = p.stageTimes !== undefined;
  if (hasDt === hasTimes) problems.push('时钟周期 dt 和各段时间 stageTimes 要给且只给一个');
  if (hasDt && !positive(p.dt)) problems.push('时钟周期 dt 要是正数（ns）');
  if (hasTimes) {
    if (p.stageTimes!.length !== p.k) problems.push('各段时间的个数要等于段数 k');
    if (!p.stageTimes!.every(positive)) problems.push('各段时间都要是正数（ns）');
  }
  if (p.latch !== undefined) {
    if (!hasTimes) problems.push('缓冲寄存器延时只和各段时间一起给');
    if (typeof p.latch !== 'number' || !Number.isFinite(p.latch) || p.latch < 0) problems.push('缓冲寄存器延时要是不小于 0 的数（ns）');
  }
  if (p.layout !== undefined && p.layout !== '段为行' && p.layout !== '指令为行') problems.push('画法只能是「段为行」或「指令为行」');
  return problems;
}

/** 第 i 条指令（从 1 起）在第 t 个周期（从 1 起）位于第几段（从 0 起）；不在流水线里是 null。 */
export function stageAt(i: number, t: number, k: number): number | null {
  const s = t - i;
  return s >= 0 && s < k ? s : null;
}

export interface SpacetimeFigures {
  clock: number;
  Tk: number;
  /** 非流水处理 n 个任务的时间（ns）。 */
  serialTime: number;
  /** 流水处理 n 个任务的时间（ns）。 */
  pipeTime: number;
  speedup: number;
  /** 吞吐率，单位 MIPS（百万条每秒）。 */
  throughputMips: number;
  maxMips: number;
  /** 各段时间不等时，单个任务的非流水时间与时钟周期之比（例 5.4 的口径）。 */
  steadySpeedup: number | null;
}

/** 只算数，不出 Trace。页面判分和对拍用。 */
export function spacetimeFigures(p: SpacetimeParams): SpacetimeFigures {
  const problems = checkSpacetime(p);
  if (problems.length) throw new Error(`时空图参数有问题：${problems.join('；')}`);
  const clock = p.dt ?? Math.max(...p.stageTimes!) + (p.latch ?? 0);
  const Tk = p.k + (p.n - 1);
  const oneTask = p.stageTimes ? p.stageTimes.reduce((a, b) => a + b, 0) : p.k * clock;
  const serialTime = p.n * oneTask;
  const pipeTime = Tk * clock;
  return {
    clock,
    Tk,
    serialTime,
    pipeTime,
    speedup: serialTime / pipeTime,
    throughputMips: (p.n * 1000) / pipeTime,
    maxMips: 1000 / clock,
    steadySpeedup: p.stageTimes ? oneTask / clock : null,
  };
}

const num = (x: number): string => fmt(x, 2);

function phaseOf(t: number, k: number, n: number): SpacetimeState['phase'] {
  if (t > n) return '排空';
  if (t < k) return '填充';
  return '稳定';
}

/** 画时空图并代公式。参数不合法时抛出错误。 */
export function runSpacetime(params: SpacetimeParams): Trace<SpacetimeParams, SpacetimeState> {
  const f = spacetimeFigures(params);
  const { k, n } = params;
  const names = stageNamesOf(params);
  const layout = params.layout ?? '段为行';
  const conditions: Condition[] = [
    { label: '段数 k', value: `${k}（${names.join('、')}）` },
    { label: '指令条数 n', value: String(n) },
  ];
  if (params.dt !== undefined) conditions.push({ label: '时钟周期 Δt', value: `${num(params.dt)} ns，各段都是一个时钟周期` });
  else {
    conditions.push({ label: '各段时间', value: params.stageTimes!.map((t, i) => `${names[i]!} ${num(t)} ns`).join('，') });
    conditions.push({ label: '缓冲寄存器延时 τl', value: `${num(params.latch ?? 0)} ns` });
  }
  const initial: SpacetimeState = {
    clock: null,
    cycle: 0,
    grid: names.map(() => Array.from({ length: f.Tk }, () => null)),
    done: 0,
    phase: '',
    figures: { Tk: null, Ck: null, Tp: null },
  };
  const b = new TraceBuilder<SpacetimeParams, SpacetimeState>(SPACETIME_ENGINE, params, initial, conditions);

  if (params.dt !== undefined) {
    b.step({
      level: 'explain',
      title: `时钟周期 Δt = ${num(f.clock)} ns`,
      why: '各段用时相同，每段占一个时钟周期，指令每过一个时钟周期往上走一段。',
      ref: '教材 p185',
      update: (d) => {
        d.clock = f.clock;
      },
    });
  } else {
    const times = params.stageTimes!;
    const slow = times.indexOf(Math.max(...times));
    b.step({
      level: 'explain',
      title: `时钟周期 τ = ${num(Math.max(...times))} + ${num(params.latch ?? 0)} = ${num(f.clock)} ns`,
      why: `各段时间不同，可所有段要在同一个时钟下一起推进，时钟只能迁就最慢的 ${names[slow]!} 段，再加上缓冲寄存器的延时。其他段做完了也要等。`,
      ref: '教材 p185–187，例 5.4',
      update: (d) => {
        d.clock = f.clock;
      },
    });
  }

  for (let t = 1; t <= f.Tk; t += 1) {
    const inside: string[] = [];
    for (let s = 0; s < k; s += 1) {
      const i = t - s;
      if (i >= 1 && i <= n) inside.push(`${names[s]!} 段 I${i}`);
    }
    const finished = t >= k && t - k + 1 <= n ? t - k + 1 : null;
    const entering = t <= n ? t : null;
    const phase = phaseOf(t, k, n);
    const parts: string[] = [];
    if (entering !== null) parts.push(`I${entering} 进入 ${names[0]!} 段`);
    else parts.push('不再有新指令进入');
    if (finished !== null) parts.push(`I${finished} 走完 ${names[k - 1]!} 段`);
    const phaseWhy =
      phase === '填充'
        ? `流水线还没装满：第 ${t} 个周期只有前 ${t} 段有指令。`
        : phase === '排空'
          ? '指令已经全部进入，后面的段还在把剩下的指令做完。'
          : '每段都有指令在做，每个周期出一条结果。';
    b.step({
      level: 'cycle',
      title: `第 ${t} 个周期：${parts.join('，')}`,
      why: `${phaseWhy}这一列从下往上依次是 ${inside.join('、')}。第 i 条指令在第 t 个周期处在第 t−i+1 段。`,
      ref: t === 1 ? '教材 p183–185，图 5.33、图 5.35' : '教材 p185',
      ...(t === k && n >= 2
        ? {
            ask: {
              prompt: `第 ${k} 个周期结束时，一共完成几条指令`,
              kind: 'number' as const,
              answer: '1',
              hint: `第一条指令要走完全部 ${k} 段才出结果。`,
            },
          }
        : {}),
      update: (d) => {
        d.cycle = t;
        d.phase = phase;
        for (let s = 0; s < k; s += 1) {
          const i = t - s;
          d.grid[s]![t - 1] = i >= 1 && i <= n ? i : null;
        }
        if (finished !== null) d.done = finished;
      },
    });
  }

  b.step({
    level: 'explain',
    title: `Tk = k + (n − 1) = ${k} + ${n - 1} = ${f.Tk} 个时钟周期`,
    why: `第一条指令用 ${k} 个周期走完全部段，此后每个周期再出一条，剩下的 ${n - 1} 条再用 ${n - 1} 个周期。`,
    ref: '教材 p185',
    ask: { prompt: '一共要多少个时钟周期', kind: 'number', answer: String(f.Tk), hint: '数时空图最上面一段最后一格在第几列。' },
    update: (d) => {
      d.figures.Tk = f.Tk;
    },
  });

  let ckText: string;
  let ckWhy: string;
  if (params.dt !== undefined) {
    ckText = `${n * k}/${f.Tk} ≈ ${num(f.speedup)}`;
    ckWhy = `不用流水时每条指令要 ${k} 个周期，n 条共 n·k = ${n * k} 个周期；流水用 ${f.Tk} 个。Ck = n·k/(k+n−1)，n 远大于 k 时趋近 k。`;
  } else {
    const one = params.stageTimes!.reduce((a, c) => a + c, 0);
    ckText = `${num(f.serialTime)}/${num(f.pipeTime)} ≈ ${num(f.speedup)}`;
    ckWhy = `不用流水时一个任务依次走完各段要 ${num(one)} ns，n 个共 ${num(f.serialTime)} ns；流水用 ${f.Tk} × ${num(f.clock)} = ${num(f.pipeTime)} ns。任务很多时比值趋近 ${num(one)}/${num(f.clock)} ≈ ${num(f.steadySpeedup!)}，这就是例 5.4 求的加速比。`;
  }
  b.step({
    level: 'explain',
    title: `加速比 Ck = ${ckText}`,
    why: ckWhy,
    ref: params.dt !== undefined ? '教材 p186' : '教材 p186–187，例 5.4',
    ask: { prompt: '加速比 Ck 是多少（保留两位小数）', kind: 'number', answer: num(f.speedup), hint: '非流水的时间除以流水的时间。' },
    update: (d) => {
      d.figures.Ck = ckText;
    },
  });

  const tpText = `${n}/(${f.Tk} × ${num(f.clock)} ns) ≈ ${num(f.throughputMips)} MIPS`;
  b.step({
    level: 'explain',
    title: `吞吐率 Tp = ${tpText}`,
    why: `单位时间完成的指令条数：${n} 条用了 ${num(f.pipeTime)} ns。最大吞吐率是每个时钟周期一条，1/${num(f.clock)} ns = ${num(f.maxMips)} MIPS，只有 n 很大时才接近。`,
    ref: '教材 p186',
    update: (d) => {
      d.figures.Tp = tpText;
    },
  });

  const result: Record<string, string> = {
    时钟周期: `${num(f.clock)} ns`,
    Tk: `${f.Tk} 个时钟周期`,
    流水用时: `${num(f.pipeTime)} ns`,
    非流水用时: `${num(f.serialTime)} ns`,
    加速比Ck: ckText,
    吞吐率Tp: tpText,
    最大吞吐率: `${num(f.maxMips)} MIPS`,
  };
  if (f.steadySpeedup !== null) result['单个任务的加速比'] = `${num(f.steadySpeedup)}`;

  const cycleStep = (t: number): string => `s${t + 1}`;
  const cols = Array.from({ length: f.Tk }, (_, i) => String(i + 1));
  let table: SolutionTable;
  if (layout === '段为行') {
    const rows = names
      .map((name, s) => ({
        cells: [name, ...cols.map((_, c) => {
          const i = c + 1 - s;
          return i >= 1 && i <= n ? `I${i}` : '';
        })],
        step: cycleStep(s + 1),
      }))
      .reverse();
    table = { columns: ['段＼周期', ...cols], rows };
  } else {
    const rows = Array.from({ length: n }, (_, idx) => {
      const i = idx + 1;
      return {
        cells: [`I${i}`, ...cols.map((_, c) => {
          const s = stageAt(i, c + 1, k);
          return s === null ? '' : names[s]!;
        })],
        step: cycleStep(i),
      };
    });
    table = { columns: ['指令＼周期', ...cols], rows };
  }
  return b.finish(result, table);
}

/** 随机出一道时空图题：一半是各段等长，一半给各段时间和缓冲寄存器延时。 */
export function generateSpacetime(seed: number): SpacetimeParams {
  const r = generator(seed);
  const pick = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const k = pick(3, 6);
  const n = pick(2, 12);
  if (r() < 0.5) return { k, n, dt: pick(1, 10) * 10 };
  const stageTimes = Array.from({ length: k }, () => pick(3, 12) * 10);
  return { k, n, stageTimes, latch: pick(0, 2) * 5 };
}
