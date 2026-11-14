/**
 * 5-cycle 练习：按种子出一条指令，学生填每个 CPU 周期里各微操作的节拍、操作和控制信号。
 * 标准答案是引擎的 flow()；这里只出题（选指令和操作数）和比对，不算任何结果。
 */
import { GENERAL_REGISTERS, flow, format, meaning } from '../../engines/cpu/model';
import type { FlowCycle, GeneralRegister, Instruction, SignalNames } from '../../engines/cpu/model';

/** 可复现的伪随机数（mulberry32）。 */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPS = ['LAD', 'STO', 'ADD', 'MOV', 'NOT', 'JMP'] as const;

export function makeInstruction(seed: number): Instruction {
  const next = random(seed * 7919 + 17);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const op = OPS[(seed - 1) % OPS.length]!;
  const rx = pick(GENERAL_REGISTERS);
  const ry = pick(GENERAL_REGISTERS.filter((r) => r !== rx)) as GeneralRegister;
  const addr = 4 + Math.floor(next() * 40);
  switch (op) {
    case 'LAD':
      return { op, rx, addr };
    case 'JMP':
      return { op, addr: 40 + Math.floor(next() * 20) };
    default:
      return { op, rx, ry };
  }
}

export interface Row {
  cycle: string;
  beat: string;
  op: string;
  signals: string[];
}

/** 引擎给的标准表，摊成一行一个微操作。译码不占节拍，节拍写「—」。 */
export function answerRows(ins: Instruction, names: SignalNames): Row[] {
  return flow(ins, names).flatMap((cycle: FlowCycle) =>
    cycle.micros.map((micro) => ({
      cycle: cycle.cycle,
      beat: micro.op === '译码' ? '—' : micro.beat,
      op: micro.op,
      signals: [...micro.hold, ...micro.pulse],
    })),
  );
}

export interface Entry {
  beat: string;
  op: string;
  signals: string;
}

/** 控制信号一格的写法：逗号、顿号、空格都算分隔；脉冲后面的 (T3) 写不写都行；大小写不论。 */
export function signalSet(text: string): string[] {
  return text
    .split(/[,，、;；\s]+/)
    .map((item) => item.replace(/\(T[1-4]\)$/i, '').trim().toUpperCase())
    .filter(Boolean)
    .sort();
}

export interface Grade {
  ok: boolean;
  /** 第一处错：第几行、哪一格。 */
  row: number;
  cell: 'beat' | 'op' | 'signals' | null;
  message: string;
}

export function grade(rows: Row[], entries: Entry[]): Grade {
  for (const [i, row] of rows.entries()) {
    const entry = entries[i] ?? { beat: '', op: '', signals: '' };
    if (entry.op !== row.op) {
      const lead = i === 0 || rows[i - 1]!.cycle !== row.cycle ? `${row.cycle}周期的第一个操作是什么` : '上一行之后，数要往哪走';
      return { ok: false, row: i, cell: 'op', message: `第 ${i + 1} 行（${row.cycle}）的操作不对。想一想：${lead}。` };
    }
    if (entry.beat !== row.beat) {
      return {
        ok: false,
        row: i,
        cell: 'beat',
        message: row.beat === '—' ? `第 ${i + 1} 行：译码不占节拍。` : `第 ${i + 1} 行的节拍不对。电位信号从 T1 起有效；DR 和数存写入在 T3，AR、PC、通用寄存器在 T4 打入。`,
      };
    }
    const want = row.signals.map((name) => name.toUpperCase()).sort();
    const got = signalSet(entry.signals);
    if (want.join('|') !== got.join('|')) {
      const missing = want.filter((name) => !got.includes(name));
      const extra = got.filter((name) => !want.includes(name));
      return {
        ok: false,
        row: i,
        cell: 'signals',
        message: `第 ${i + 1} 行的控制信号不对。${missing.length ? `少了 ${missing.length} 个。` : ''}${extra.length ? `${extra.join('、')} 这一步不发。` : ''}${want.length === 0 ? '这一步不发信号，这一格空着。' : ''}`,
      };
    }
  }
  return { ok: true, row: -1, cell: null, message: '全对。' };
}

export const describe = (ins: Instruction): string => `${format(ins)}（${meaning(ins)}）`;
