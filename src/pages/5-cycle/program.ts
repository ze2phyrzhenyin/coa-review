/**
 * 试一试的输入：学生写的程序、寄存器和数存的初值。只做读写（文字 ⇄ 参数），检查和运行交给引擎。
 * 程序一行一条，写法跟教材：MOV R2,R1 / NOT R1,R0 / ADD R0,R1 / LAD R0,9 / STO R1,(R3) / JMP 37。
 */
import type { GeneralRegister, Instruction, Params, SignalNames } from '../../engines/cpu/model';

export const START = 32;
const REG = '(R[0-3])';

export function parseLine(line: string): Instruction | string {
  const text = line.trim().toUpperCase().replace(/，/g, ',').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
  let m = new RegExp(`^(MOV|NOT|ADD) ${REG},${REG}$`).exec(text);
  if (m) return { op: m[1] as 'MOV' | 'NOT' | 'ADD', rx: m[2] as GeneralRegister, ry: m[3] as GeneralRegister };
  m = new RegExp(`^LAD ${REG},(\\d+)$`).exec(text);
  if (m) return { op: 'LAD', rx: m[1] as GeneralRegister, addr: Number(m[2]) };
  m = new RegExp(`^STO ${REG},\\(${REG}\\)$`).exec(text);
  if (m) return { op: 'STO', rx: m[1] as GeneralRegister, ry: m[2] as GeneralRegister };
  m = /^JMP (\d+)$/.exec(text);
  if (m) return { op: 'JMP', addr: Number(m[1]) };
  return `「${line.trim()}」看不懂。写法例如 LAD R0,9、ADD R0,R1、STO R1,(R3)、JMP 37`;
}

export interface TryInput {
  /** 程序，一行一条（网址里用分号隔开）。 */
  program: string;
  /** R0–R3 的初值，逗号隔开。 */
  registers: string;
  /** 数存初值，例如 9:48 10:7。 */
  memory: string;
}

export const TRY_DEFAULT: TryInput = { program: 'LAD R0,9;ADD R0,R1;STO R1,(R3)', registers: '5,25,3,14', memory: '9:48 10:7 14:60' };

/** 文字 → 引擎参数。读不懂的地方逐条列出；数的范围、地址重复这些由引擎的 checkParams 判。 */
export function toParams(input: TryInput, names: SignalNames): { params: Params | null; problems: string[] } {
  const problems: string[] = [];
  const lines = input.program
    .split(/[;\n]/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) problems.push('程序是空的，至少写一条指令。');
  if (lines.length > 6) problems.push('程序最多写 6 条。');
  const program = lines.slice(0, 6).map((line, i) => ({ addr: START + i, ins: parseLine(line) }));
  for (const line of program) if (typeof line.ins === 'string') problems.push(line.ins);
  const values = input.registers.split(/[,，\s]+/).filter(Boolean).map(Number);
  if (values.length !== 4 || values.some((v) => !Number.isInteger(v))) problems.push('寄存器初值要写 4 个整数，依次是 R0、R1、R2、R3。');
  const memory: { addr: number; value: number }[] = [];
  for (const item of input.memory.split(/[\s,，;；]+/).filter(Boolean)) {
    const m = /^(\d+)[:：](\d+)$/.exec(item);
    if (!m) problems.push(`数存「${item}」看不懂，写成 单元号:数，例如 9:48。`);
    else memory.push({ addr: Number(m[1]), value: Number(m[2]) });
  }
  if (problems.length) return { params: null, problems };
  const [R0 = 0, R1 = 0, R2 = 0, R3 = 0] = values;
  return {
    params: {
      program: program.map((line) => ({ addr: line.addr, ins: line.ins as Instruction })),
      registers: { PC: START, R0, R1, R2, R3 },
      memory,
      names,
      limit: 8,
    },
    problems: [],
  };
}
