/**
 * 相关之后停几拍：四段（IF ID EX WB）或五段（IF ID EX MEM WB）按序流水线，
 * 三种处理方式：不处理、后推（流水线互锁）、定向（旁路）。
 * 教材的口径：前一条写回寄存器之后的下一个周期，后一条才能读到（习题 12，p202；表 5.4，p191；解析书 析15）。
 * 教材 5.6.3，p189–191。
 */
import { TraceBuilder, type Ask, type Trace } from '../trace';
import { generator, parseInstruction, registersOf, touchesMemory, type InstructionInput, type PipeInstruction } from './instr';
import { FIVE_STAGES, FOUR_STAGES } from './spacetime';

export const STALL_ENGINE = 'pipeline-stall';
export const MAX_STALL_INSTRUCTIONS = 8;

export type Mode = '不处理' | '后推' | '定向';
export const MODES: readonly Mode[] = ['不处理', '后推', '定向'];

export interface StallParams {
  /** 四段或五段。 */
  stages: 4 | 5;
  /** 1–8 条指令，写法同 5.6 节（目标在前）。 */
  instructions: InstructionInput[];
  mode: Mode;
  /** 指令和数据放在同一个单端口存储器里（表 5.3 的资源相关）。只用于五段。 */
  sharedMemory?: boolean;
  /** 时钟周期（ns），给了就多算一个总时间。 */
  dt?: number;
}

/** 一条指令在某段为什么多待了：等数据、前一条还占着下一段、取指让给访存。 */
export type HoldReason =
  | { kind: 'data'; reg: string; from: number; ready: number }
  | { kind: 'busy'; other: number; stage: string }
  | { kind: 'memory'; other: number };

export interface Timing {
  /** enter[j][s]：第 j 条（0 起）进入第 s 段的周期（1 起）。 */
  enter: number[][];
  /** reason[j][s]：进入第 s 段比紧接上一段晚的原因；没晚是 null。 */
  reason: (HoldReason | null)[][];
  total: number;
  ideal: number;
  /** 不处理时读到旧值的：第几条（1 起）、哪个寄存器、本该等哪一条。 */
  wrongReads: { ins: number; reg: string; from: number; readAt: number; writeAt: number }[];
}

export interface StallState {
  cycle: number;
  /** grid[指令][周期−1]：段名、「停」或空串。 */
  grid: string[][];
  /** 这个周期每段里是哪条指令。 */
  stages: Record<string, string | null>;
  /** 这个周期在等的指令和原因。 */
  waiting: string[];
  /** 不处理时，到这个周期为止读错的。 */
  wrong: string[];
  total: number | null;
}

function stageNames(k: 4 | 5): string[] {
  return k === 4 ? [...FOUR_STAGES] : [...FIVE_STAGES];
}

export function checkStall(p: StallParams): string[] {
  const problems: string[] = [];
  if (p.stages !== 4 && p.stages !== 5) problems.push('段数只能是 4 或 5');
  if (!Array.isArray(p.instructions) || p.instructions.length < 1 || p.instructions.length > MAX_STALL_INSTRUCTIONS) {
    problems.push(`指令要有 1 到 ${MAX_STALL_INSTRUCTIONS} 条`);
  }
  if (!MODES.includes(p.mode)) problems.push('处理方式只能是 不处理、后推、定向');
  if (p.sharedMemory && p.stages !== 5) problems.push('取指和访存争用存储器只出现在有 MEM 段的五段流水线');
  if (p.dt !== undefined && !(typeof p.dt === 'number' && Number.isFinite(p.dt) && p.dt > 0)) problems.push('时钟周期要是正数（ns）');
  return problems;
}

/** 结果在哪一段末尾产生：五段里 LAD 在 MEM，其余在 EX；四段都在 EX。 */
function producedIn(ins: PipeInstruction, k: 4 | 5): number {
  return k === 5 && ins.op === 'LAD' ? 3 : 2;
}

/** 只排时间，不出 Trace。 */
export function schedule(params: StallParams): Timing {
  const problems = checkStall(params);
  if (problems.length) throw new Error(`流水线参数有问题：${problems.join('；')}`);
  const list = params.instructions.map(parseInstruction);
  const k = params.stages;
  const names = stageNames(k);
  const WB = k - 1;
  const enter: number[][] = [];
  const reason: (HoldReason | null)[][] = [];
  const memoryCycles = new Map<number, number>();
  for (let j = 0; j < list.length; j += 1) {
    const e: number[] = [];
    const why: (HoldReason | null)[] = [];
    for (let s = 0; s < k; s += 1) {
      let at = s === 0 ? (j > 0 ? enter[j - 1]![0]! + 1 : 1) : e[s - 1]! + 1;
      const natural = at;
      let cause: HoldReason | null = null;
      if (j > 0) {
        const prev = enter[j - 1]!;
        const free = s < WB ? prev[s + 1]! : prev[s]! + 1;
        if (free > at) {
          at = free;
          cause = { kind: 'busy', other: j, stage: names[s]! };
        }
      }
      if (s === 2 && params.mode !== '不处理') {
        for (const reg of registersOf(list[j]!.reads)) {
          let from = -1;
          for (let i = j - 1; i >= 0; i -= 1) {
            if (list[i]!.writes.includes(reg)) {
              from = i;
              break;
            }
          }
          if (from < 0) continue;
          const ready = params.mode === '后推' ? enter[from]![WB]! + 1 : enter[from]![producedIn(list[from]!, k)]! + 1;
          // 后推：最后一个 ID 周期读寄存器，要不早于写回的下一个周期，EX 再晚一拍。定向：EX 开始时结果已经产生。
          const need = params.mode === '后推' ? ready + 1 : ready;
          if (need > at) {
            at = need;
            cause = { kind: 'data', reg, from: from + 1, ready };
          }
        }
      }
      if (s === 0 && params.sharedMemory) {
        while (memoryCycles.has(at)) {
          cause = { kind: 'memory', other: memoryCycles.get(at)! };
          at += 1;
        }
      }
      e.push(at);
      why.push(at > natural ? cause : null);
    }
    if (k === 5 && touchesMemory(list[j]!)) memoryCycles.set(e[3]!, j + 1);
    enter.push(e);
    reason.push(why);
  }
  const wrongReads: Timing['wrongReads'] = [];
  if (params.mode === '不处理') {
    list.forEach((ins, j) => {
      const readAt = enter[j]![2]! - 1;
      for (const reg of registersOf(ins.reads)) {
        for (let i = j - 1; i >= 0; i -= 1) {
          if (!list[i]!.writes.includes(reg)) continue;
          const writeAt = enter[i]![WB]!;
          if (readAt <= writeAt) wrongReads.push({ ins: j + 1, reg, from: i + 1, readAt, writeAt });
          break;
        }
      }
    });
  }
  return { enter, reason, total: enter[list.length - 1]![WB]!, ideal: k + list.length - 1, wrongReads };
}

/** 第 j 条在第 t 个周期那一格写什么。 */
function cellOf(enter: number[], t: number, names: string[]): string {
  const k = names.length;
  if (t < enter[0]! || t > enter[k - 1]!) return '';
  let s = 0;
  while (s + 1 < k && enter[s + 1]! <= t) s += 1;
  if (t === enter[s]!) return names[s]!;
  // 在 ID 段多待了几拍：最后一拍真正读寄存器，照表 5.4(b) 再写一次 ID。
  if (s === 1 && t === enter[2]! - 1) return names[1]!;
  return '停';
}

function holdText(r: HoldReason, j: number, stage: string): string {
  switch (r.kind) {
    case 'data':
      return `I${j} 停在 ${stage}：要用 I${r.from} 写的 ${r.reg}，第 ${r.ready} 个周期起才拿得到`;
    case 'busy':
      return `I${j} 停在 ${stage}：前面的 I${r.other} 还没让出下一段`;
    case 'memory':
      return `I${j} 推迟取指：I${r.other} 正在 MEM 段访存，存储器只有一个端口`;
  }
}

/** 逐个周期推进流水线，标出停顿和读错。参数不合法时抛出错误。 */
export function runStall(params: StallParams): Trace<StallParams, StallState> {
  const timing = schedule(params);
  const list = params.instructions.map(parseInstruction);
  const k = params.stages;
  const names = stageNames(k);
  const n = list.length;
  const T = timing.total;
  const { enter, reason } = timing;

  const modeText: Record<Mode, string> = {
    不处理: '不处理：指令照常流动，后一条在 ID 段按时读寄存器，前一条还没写回就读到旧值。',
    后推: '后推（流水线互锁）：后一条停在 ID 段，等前一条写回之后的下一个周期再读寄存器，后面的指令依次顺延。',
    定向: `定向（旁路）：结果一产生就由专用通路送到要用它的 EX 段，不必等写回。${k === 5 ? '五段里 LAD 的数在 MEM 段末尾才取到，紧跟它的指令还要停一拍。' : ''}`,
  };
  const conditions = [
    { label: '流水线', value: `${k} 段：${names.join('、')}${k === 4 ? '（取指、译码并取数、运算、送结果）' : '（取指、译码并读寄存器、执行、访存、写回）'}` },
    { label: '指令', value: list.map((x, i) => `I${i + 1} ${x.text}（${x.meaning}）`).join('；') },
    { label: '读写约定', value: '写回寄存器的下一个周期才能读到新值' },
    { label: '处理方式', value: params.mode },
  ];
  if (params.sharedMemory) conditions.push({ label: '存储器', value: '指令和数据同在一个单端口存储器' });

  const initial: StallState = {
    cycle: 0,
    grid: list.map(() => Array.from({ length: T }, () => '')),
    stages: Object.fromEntries(names.map((s) => [s, null])),
    waiting: [],
    wrong: [],
    total: null,
  };
  const b = new TraceBuilder<StallParams, StallState>(STALL_ENGINE, params, initial, conditions);
  b.step({
    level: 'explain',
    title: `${k} 段流水线，${params.mode}`,
    why: modeText[params.mode],
    ref: '教材 p189–191',
    update: () => {},
  });

  let askedHold = false;
  for (let t = 1; t <= T; t += 1) {
    const events: string[] = [];
    const waiting: string[] = [];
    const occupants: Record<string, string | null> = Object.fromEntries(names.map((s) => [s, null]));
    let firstDataHold: { j: number; len: number } | null = null;
    for (let j = 0; j < n; j += 1) {
      const e = enter[j]!;
      for (let s = 0; s < k; s += 1) {
        const leave = s + 1 < k ? e[s + 1]! : e[s]! + 1;
        if (t >= e[s]! && t < leave) occupants[names[s]!] = `I${j + 1}`;
        if (t === e[s]!) {
          if (s === 0) events.push(`I${j + 1} 取指`);
          if (s === k - 1) events.push(`I${j + 1} 写回 ${registersOf(list[j]!.writes).join('、') || '（不写寄存器）'}`);
        }
        if (t > e[s]! && t < leave && s + 1 < k) {
          const r = reason[j]![s + 1];
          if (r && r.kind === 'data' && t === leave - 1) {
            waiting.push(
              params.mode === '后推'
                ? `I${j + 1} 这一拍在 ID 读 ${r.reg}，I${r.from} 上一个周期已经写回`
                : `I${j + 1} 还在 ID，${r.reg} 这一拍末尾由 I${r.from} 算出，下一拍经专用通路送进 EX`,
            );
          } else if (r) {
            waiting.push(holdText(r, j + 1, names[s]!));
            if (r.kind === 'data' && t === e[s]! + 1 && !askedHold) firstDataHold = { j: j + 1, len: leave - e[s]! - 1 };
          }
        }
      }
      if (s0Delayed(reason[j]![0], e[0]!, t)) waiting.push(holdText(reason[j]![0]!, j + 1, names[0]!));
    }
    const wrongNow = timing.wrongReads.filter((w) => w.readAt === t);
    const wrongText = wrongNow.map((w) => `I${w.ins} 在第 ${t} 个周期读 ${w.reg}，I${w.from} 第 ${w.writeAt} 个周期才写回，读到的是旧值`);
    let ask: Ask | undefined;
    if (firstDataHold) {
      askedHold = true;
      ask = {
        prompt: `I${firstDataHold.j} 在 ID 段要多等几个周期`,
        kind: 'number',
        answer: String(firstDataHold.len),
        hint: params.mode === '后推' ? '找到它要读的寄存器在哪个周期写回，再往后数一个周期才能读。' : '找到结果在哪一段末尾产生，下一个周期就能送进 EX。',
      };
    }
    const whyParts = [...waiting, ...wrongText];
    b.step({
      level: 'cycle',
      title: `第 ${t} 个周期${events.length ? `：${events.join('，')}` : ''}`,
      why: whyParts.length ? `${whyParts.join('；')}。` : '没有指令在等，各段照常往前走一段。',
      ref: '教材 p190–191，表 5.4',
      ...(ask ? { ask } : {}),
      update: (d) => {
        d.cycle = t;
        for (let j = 0; j < n; j += 1) d.grid[j]![t - 1] = cellOf(enter[j]!, t, names);
        d.stages = occupants;
        d.waiting = waiting;
        d.wrong.push(...wrongNow.map((w) => `I${w.ins} 读 ${w.reg}`));
      },
    });
  }

  const extra = T - timing.ideal;
  const perIns = enter.map((e, j) => (j === 0 ? e[k - 1]! - k : e[k - 1]! - enter[j - 1]![k - 1]! - 1));
  const stalled = perIns.map((d, j) => (d > 0 ? `I${j + 1} 多等 ${d} 个周期` : '')).filter(Boolean);
  b.step({
    level: 'explain',
    title: `共 ${T} 个时钟周期，比没有相关多 ${extra} 个`,
    why: `没有停顿时 ${n} 条指令要 k+(n−1) = ${timing.ideal} 个周期。${stalled.length ? `${stalled.join('，')}。` : '这次没有停顿。'}${params.mode === '不处理' && timing.wrongReads.length ? '不处理时周期数不增加，代价是结果算错。' : ''}`,
    ref: '教材 p185，p191',
    ask: { prompt: '这串指令一共要多少个时钟周期', kind: 'number', answer: String(T), hint: '看最后一条指令的写回在第几个周期。' },
    update: (d) => {
      d.total = T;
      d.waiting = [];
      d.stages = Object.fromEntries(names.map((s) => [s, null]));
    },
  });

  const result: Record<string, string> = {
    总周期数: String(T),
    无相关时: String(timing.ideal),
    多用的周期: String(extra),
  };
  if (params.mode === '不处理') {
    result['读错'] = timing.wrongReads.length ? timing.wrongReads.map((w) => `I${w.ins}（${w.reg}）`).join('、') : '无';
  }
  if (params.dt !== undefined) result['用时'] = `${T * params.dt} ns`;
  const cols = Array.from({ length: T }, (_, i) => String(i + 1));
  return b.finish(result, {
    columns: ['指令＼周期', ...cols],
    rows: list.map((x, j) => ({
      cells: [`I${j + 1} ${x.text}`, ...cols.map((_, c) => cellOf(enter[j]!, c + 1, names))],
      step: `s${enter[j]![0]! + 1}`,
    })),
  });
}

/** 取指被推迟的那几个周期里（指令还没进流水线），在等待列表里说一句。 */
function s0Delayed(r: HoldReason | null | undefined, entry: number, t: number): boolean {
  return !!r && r.kind === 'memory' && t === entry - 1;
}

/** 随机出一道题：几条指令里放进一两处相关。 */
export function generateStall(seed: number): StallParams {
  const r = generator(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const regs = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'];
  const n = 3 + Math.floor(r() * 4);
  const instructions: string[] = [];
  let last = pick(regs);
  for (let i = 0; i < n; i += 1) {
    const d = pick(regs);
    const a = r() < 0.5 ? last : pick(regs);
    if (r() < 0.2) instructions.push(`LAD ${d},M(${pick(['x', 'y', 'z'])})`);
    else instructions.push(`${pick(['ADD', 'SUB', 'AND', 'OR'])} ${d},${a},${pick(regs)}`);
    last = d;
  }
  const stages = r() < 0.5 ? 4 : 5;
  return { stages, instructions, mode: pick(MODES) };
}
