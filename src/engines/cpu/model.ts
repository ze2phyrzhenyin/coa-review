/**
 * 图 5.1 模型机的指令周期引擎（教材 5.1–5.2 节，p150–162；节拍取自 p178 图 5.30、p179 例 5.3）。
 *
 * 机器：多周期，以总线为中心。指存和数存分开；取指走 PC → ABUS(I) → 指存 → IBUS → IR，不占 DBUS；
 * 其余传送共用一条 DBUS，上总线的出口只有三态门 C1（ALU 输出）、C2（通用寄存器输出）、C3（IR 地址码）
 * 和数存的读出端。运算结果和读出的数经 DR 进通用寄存器，访存地址经 AR。一个 CPU 周期含 T1–T4 四个节拍。
 *
 * 口径（规格见 specs/5-cycle.md）：
 * - 字长按 8 位（教材没有明说，由「10 取反得 245」推出），地址也是 0–255，PC 每次加 1。
 * - 指令写法跟教材：Rx、Ry 是地址码里的第一个、第二个寄存器。
 *   MOV Rx,Ry：Ry → Rx；NOT Rx,Ry：Ry 取反 → Rx；LAD Rx,A：数存 A 号单元 → Rx；
 *   ADD Rx,Ry：Rx + Ry → Ry；STO Rx,(Ry)：Rx → 数存 (Ry) 号单元；JMP A：A → PC。
 * - 教材 5.2.2 把第一条指令叫 NOT，图 5.1、图 5.15、图 5.30 叫 MOV。两个助记符都收，微操作序列相同，
 *   只有 ALU 的功能不同（取反 / 传送）。
 * - AND 在教材的程序表里（p153 表 5.1），但教材没有跟踪它。这里比照同为 RR 型的 ADD。
 * - CPU 周期数按教材：MOV、NOT、ADD、JMP 两个，LAD、STO 三个。解析书把 ADD 的执行拆成两个 CPU 周期，这里不采用。
 */
import { TraceBuilder, diffStates, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

// ---------- 指令 ----------

export type GeneralRegister = 'R0' | 'R1' | 'R2' | 'R3';
export type Op = 'MOV' | 'NOT' | 'LAD' | 'ADD' | 'AND' | 'STO' | 'JMP';

export type Instruction =
  | { op: 'MOV' | 'NOT'; rx: GeneralRegister; ry: GeneralRegister }
  | { op: 'LAD'; rx: GeneralRegister; addr: number }
  | { op: 'ADD' | 'AND'; rx: GeneralRegister; ry: GeneralRegister }
  | { op: 'STO'; rx: GeneralRegister; ry: GeneralRegister }
  | { op: 'JMP'; addr: number };

export const GENERAL_REGISTERS: readonly GeneralRegister[] = ['R0', 'R1', 'R2', 'R3'];
export const OPS: readonly Op[] = ['MOV', 'NOT', 'LAD', 'ADD', 'AND', 'STO', 'JMP'];

/** 每条指令的指令周期含几个 CPU 周期（教材 p161）。 */
export const CYCLES: Readonly<Record<Op, number>> = { MOV: 2, NOT: 2, LAD: 3, ADD: 2, AND: 2, STO: 3, JMP: 2 };

/** 字长 8 位。 */
export const WORD_BITS = 8;
const MASK = 0xff;
/** 一次最多执行的指令条数的上限和默认值。 */
export const LIMIT_MAX = 64;
export const LIMIT_DEFAULT = 16;

/** 指令的地址码字段，例如「R0,9」「R1,(R3)」「37」。 */
export function operandsOf(ins: Instruction): string {
  switch (ins.op) {
    case 'LAD':
      return `${ins.rx},${ins.addr}`;
    case 'STO':
      return `${ins.rx},(${ins.ry})`;
    case 'JMP':
      return String(ins.addr);
    default:
      return `${ins.rx},${ins.ry}`;
  }
}

/** 指令的写法，例如「LAD R0,9」。 */
export function format(ins: Instruction): string {
  return `${ins.op} ${operandsOf(ins)}`;
}

/** 指令的含义，写成「源 → 目的」。操作数的先后每条指令不同，页面上要和指令一起显示。 */
export function meaning(ins: Instruction): string {
  switch (ins.op) {
    case 'MOV':
      return `${ins.ry} → ${ins.rx}`;
    case 'NOT':
      return `${ins.ry} 取反 → ${ins.rx}`;
    case 'LAD':
      return `数存 ${ins.addr} 号单元 → ${ins.rx}`;
    case 'ADD':
      return `${ins.rx} + ${ins.ry} → ${ins.ry}`;
    case 'AND':
      return `${ins.rx} AND ${ins.ry} → ${ins.ry}`;
    case 'STO':
      return `${ins.rx} → 数存 (${ins.ry}) 号单元`;
    case 'JMP':
      return `${ins.addr} → PC`;
  }
}

// ---------- 参数 ----------

export type SignalNames = 'book' | 'solutions';

export interface ProgramLine {
  /** 指存地址。 */
  addr: number;
  ins: Instruction;
}

export interface MemoryCell {
  /** 数存地址。 */
  addr: number;
  value: number;
}

export interface Params {
  /** 指存里的程序。 */
  program: ProgramLine[];
  /** 开始前的 PC（第一条指令的地址）和通用寄存器。 */
  registers: { PC: number } & Record<GeneralRegister, number>;
  /** 数存的初始内容。没列出的单元读出 0。 */
  memory: MemoryCell[];
  /** 控制信号用哪一套名字：教材（LDIR、LDAR、RD(D)…）或解析书（SIR、SAR、DR/W̄=1…）。 */
  names: SignalNames;
  /** 最多执行几条指令，默认 16，上限 64。JMP 往回转时程序不会自己停。 */
  limit?: number;
}

// ---------- 状态 ----------

export type Beat = 'T1' | 'T2' | 'T3' | 'T4';
export type CycleName = '取指' | '执行' | '执行一' | '执行二';
export type AluFn = '取反' | '传送' | '加' | '逻辑乘';
export type Bit = 0 | 1;
export type BusId = 'ABUS_I' | 'IBUS' | 'DBUS' | 'ABUS_D';
export type GateId = 'C1' | 'C2' | 'C3';
/** 部件 id。场景里的部件、focus 里的部件、总线的驱动者都用它。 */
export type PartId =
  | 'PC'
  | 'IR'
  | 'AR'
  | 'DR'
  | GeneralRegister
  | 'PSWR'
  | 'ALU'
  | 'DECODER'
  | 'OC'
  | 'IMEM'
  | 'DMEM'
  | BusId
  | GateId;

/** 部件的显示名。预测题的选项用这里的名字。 */
export const PART_LABEL: Readonly<Record<PartId, string>> = {
  PC: 'PC',
  IR: 'IR',
  AR: 'AR',
  DR: 'DR',
  R0: 'R0',
  R1: 'R1',
  R2: 'R2',
  R3: 'R3',
  PSWR: 'PSWR',
  ALU: 'ALU',
  DECODER: '指令译码器',
  OC: '操作控制器',
  IMEM: '指存',
  DMEM: '数存',
  ABUS_I: 'ABUS(I)',
  IBUS: 'IBUS',
  DBUS: 'DBUS',
  ABUS_D: 'ABUS(D)',
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
};

export interface Bus<V> {
  /** 总线上的值；没有部件送数时为 null。 */
  value: V | null;
  /** 正在往这条总线送数的部件；总线空着时为 null。 */
  driver: PartId | null;
}

export interface State {
  reg: {
    PC: number;
    /** 指令寄存器，分操作码和地址码两段；还没取到指令时两段都是 null。 */
    IR: { op: Op | null; operands: string | null };
    /** 还没装入过为 null。 */
    AR: number | null;
    DR: number | null;
    R0: number;
    R1: number;
    R2: number;
    R3: number;
    /** 四个标志；还没有运算结果存入时为 null。 */
    PSWR: { C: Bit | null; V: Bit | null; Z: Bit | null; N: Bit | null };
  };
  /** 指令译码器认出的指令；本条指令还没译码时为 null。 */
  decoder: Op | null;
  /** 通用寄存器的选择，由 IR 的寄存器字段决定（图 5.1 里省略的两个 4 选 1 多路开关和 2-4 线译码器）。 */
  sel: {
    /** 送到 ALU 左输入端的寄存器。 */
    left: GeneralRegister | null;
    /** 送到 ALU 右输入端的寄存器；三态门 C2 也从这一路取数。 */
    right: GeneralRegister | null;
    /** 接收 DR 的目标寄存器。 */
    write: GeneralRegister | null;
  };
  alu: {
    fn: AluFn | null;
    /** ALU 输出端的值；没有运算时为 null。 */
    out: number | null;
  };
  bus: {
    ABUS_I: Bus<number>;
    /** IBUS 上是一条指令，值是它的写法。 */
    IBUS: Bus<string>;
    DBUS: Bus<number>;
    ABUS_D: Bus<number>;
  };
  /** 三态门是否打开。 */
  gate: Record<GateId, boolean>;
  /** 指存：地址 → 指令的两段。 */
  imem: Record<string, { op: Op; operands: string }>;
  /** 数存：地址 → 数。 */
  dmem: Record<string, number>;
  /** 当前有效的控制信号，名字随 params.names。level 是电位信号（保持到 CPU 周期结束），pulse 是当前节拍的脉冲信号。 */
  signals: { level: string[]; pulse: string[] };
  timing: {
    /** 第几条被执行的指令，从 1 起；0 表示还没开始。 */
    instruction: number;
    /** 这条指令在指存里的地址。 */
    addr: number | null;
    /** 当前 CPU 周期的名字；不在任何 CPU 周期里时为 null。 */
    cycle: CycleName | null;
    /** 本条指令的第几个 CPU 周期，从 1 起。 */
    cycleNo: number;
    /** 本条指令共几个 CPU 周期。 */
    cycles: number;
    beat: Beat | null;
  };
  halted: boolean;
}

// ---------- 控制信号 ----------

/** 一个控制信号在两套名字里的写法；某一套里没有名字时为 null。 */
interface Sig {
  book: string | null;
  solutions: string | null;
}

const SIG = {
  RD_I: { book: 'RD(I)', solutions: 'IR/W̄=1' },
  LDIR: { book: 'LDIR', solutions: 'SIR' },
  PC_INC: { book: 'PC+1', solutions: 'PC+1' },
  /** 例 5.3 里 LDPC 在取指的 T4 也有效；解析书的取指只写 PC+1。 */
  LDPC_FETCH: { book: 'LDPC', solutions: null },
  LDPC: { book: 'LDPC', solutions: 'SPC' },
  C1: { book: 'C1', solutions: 'C1' },
  C2: { book: 'C2', solutions: 'C2' },
  C3: { book: 'C3', solutions: 'C3' },
  LDDR: { book: 'LDDR', solutions: 'SDR' },
  LDAR: { book: 'LDAR', solutions: 'SAR' },
  RD_D: { book: 'RD(D)', solutions: 'DR/W̄=1' },
  /** 教材的数存写命令是 T3 的脉冲。 */
  WE_D: { book: 'WE(D)', solutions: null },
  /** 解析书写成电位 DR/W̄=0，不注节拍。 */
  WRITE_D: { book: null, solutions: 'DR/W̄=0' },
  ADD_FN: { book: null, solutions: '+' },
  SPSW: { book: null, solutions: 'SPSW' },
} satisfies Record<string, Sig>;

/** 打入通用寄存器：教材 LDRx、LDRy（这里写出具体寄存器），解析书 SR0–SR3。 */
const ldr = (r: GeneralRegister): Sig => ({ book: `LD${r}`, solutions: `S${r}` });
/** 读出通用寄存器：教材没有给名字，解析书 LR0–LR3。 */
const lr = (r: GeneralRegister): Sig => ({ book: null, solutions: `L${r}` });

/** 两套信号名的对照，页面的图例用。 */
export const SIGNAL_GLOSSARY: readonly { does: string; book: string | null; solutions: string | null }[] = [
  { does: '指存读命令', ...SIG.RD_I },
  { does: '打入 IR', ...SIG.LDIR },
  { does: 'PC 加 1', ...SIG.PC_INC },
  { does: '打入 PC', ...SIG.LDPC },
  { does: '打开 ALU 输出三态门', ...SIG.C1 },
  { does: '打开通用寄存器输出三态门', ...SIG.C2 },
  { does: '打开 IR 地址码输出三态门', ...SIG.C3 },
  { does: '打入 DR', ...SIG.LDDR },
  { does: '打入 AR', ...SIG.LDAR },
  { does: '数存读命令', ...SIG.RD_D },
  { does: '数存写命令', book: SIG.WE_D.book, solutions: SIG.WRITE_D.solutions },
  { does: '打入通用寄存器 Ri', book: 'LDRi', solutions: 'SRi' },
  { does: '读出通用寄存器 Ri', book: null, solutions: 'LRi' },
  { does: 'ALU 做加法', ...SIG.ADD_FN },
  { does: '标志存入 PSWR', ...SIG.SPSW },
];

// ---------- 小工具 ----------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function free<V>(): Bus<V> {
  return { value: null, driver: null };
}

/** 一个 CPU 周期结束：电位信号撤掉，三态门关上，总线空出来。寄存器和存储器里的内容不变。 */
function release(s: State): void {
  s.bus.ABUS_I = free();
  s.bus.IBUS = free();
  s.bus.DBUS = free();
  s.bus.ABUS_D = free();
  s.gate = { C1: false, C2: false, C3: false };
  s.sel = { left: null, right: null, write: null };
  s.alu = { fn: null, out: null };
  s.signals = { level: [], pulse: [] };
}

function instructionAt(program: ProgramLine[], addr: number): Instruction | null {
  return program.find((line) => line.addr === addr)?.ins ?? null;
}

/** IR 地址码字段里的直接地址或转移地址；RR 型指令没有，返回 null。 */
export function irAddress(ir: State['reg']['IR']): number | null {
  const match = /(?:^|,)(\d+)$/.exec(ir.operands ?? '');
  return match ? Number(match[1]) : null;
}

function readCell(s: State, addr: number): number {
  return s.dmem[String(addr)] ?? 0;
}

function isByte(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MASK;
}

function isRegister(r: unknown): r is GeneralRegister {
  return typeof r === 'string' && (GENERAL_REGISTERS as readonly string[]).includes(r);
}

/** ALU 的组合逻辑：输出和四个标志。 */
function aluCompute(fn: AluFn, a: number, b: number): { out: number; flags: Record<'C' | 'V' | 'Z' | 'N', Bit> } {
  let out: number;
  let carry: Bit = 0;
  let overflow: Bit = 0;
  if (fn === '加') {
    const sum = a + b;
    out = sum & MASK;
    carry = sum > MASK ? 1 : 0;
    overflow = (~(a ^ b) & (a ^ out) & 0x80) !== 0 ? 1 : 0;
  } else if (fn === '逻辑乘') {
    out = a & b;
  } else if (fn === '取反') {
    out = ~a & MASK;
  } else {
    out = a;
  }
  return { out, flags: { C: carry, V: overflow, Z: out === 0 ? 1 : 0, N: (out & 0x80) !== 0 ? 1 : 0 } };
}

// ---------- 参数检查 ----------

/** 检查参数，返回问题列表；空表示可以运行。 */
export function checkParams(params: Params): string[] {
  const problems: string[] = [];
  if (params.names !== 'book' && params.names !== 'solutions') problems.push('names 只能是 book 或 solutions');
  if (!Array.isArray(params.program) || params.program.length === 0) {
    problems.push('指存里没有指令');
    return problems;
  }
  const seen = new Set<number>();
  for (const line of params.program) {
    const where = `指存 ${String(line.addr)} 号单元`;
    if (!isByte(line.addr)) {
      problems.push(`指存地址必须是 0–255 的整数：${String(line.addr)}`);
      continue;
    }
    if (seen.has(line.addr)) problems.push(`${where}放了不止一条指令`);
    seen.add(line.addr);
    const ins = line.ins as { op?: unknown; rx?: unknown; ry?: unknown; addr?: unknown };
    if (typeof ins !== 'object' || ins === null || !(OPS as readonly unknown[]).includes(ins.op)) {
      problems.push(`${where}的指令不在指令表里（MOV、NOT、LAD、ADD、AND、STO、JMP）`);
      continue;
    }
    const op = ins.op as Op;
    if (op !== 'JMP' && !isRegister(ins.rx)) problems.push(`${where}的 ${op} 缺第一个寄存器（R0–R3）`);
    if (op !== 'JMP' && op !== 'LAD' && !isRegister(ins.ry)) problems.push(`${where}的 ${op} 缺第二个寄存器（R0–R3）`);
    if ((op === 'JMP' || op === 'LAD') && !isByte(ins.addr)) problems.push(`${where}的 ${op} 地址码必须是 0–255 的整数`);
  }
  const regs = params.registers as Record<string, unknown> | undefined;
  for (const name of ['PC', ...GENERAL_REGISTERS]) {
    if (!isByte(regs?.[name])) problems.push(`${name} 的初值必须是 0–255 的整数`);
  }
  if (isByte(regs?.PC) && !seen.has(regs.PC)) problems.push(`PC 指着指存 ${String(regs.PC)} 号单元，那里没有指令`);
  const cells = new Set<number>();
  for (const cell of Array.isArray(params.memory) ? params.memory : []) {
    if (!isByte(cell.addr)) problems.push(`数存地址必须是 0–255 的整数：${String(cell.addr)}`);
    else if (cells.has(cell.addr)) problems.push(`数存 ${String(cell.addr)} 号单元给了不止一个初值`);
    if (!isByte(cell.value)) problems.push(`数存 ${String(cell.addr)} 号单元的数必须是 0–255 的整数`);
    cells.add(cell.addr);
  }
  if (!Array.isArray(params.memory)) problems.push('memory 必须是数存单元的列表');
  if (params.limit !== undefined && !(Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= LIMIT_MAX)) {
    problems.push(`limit 必须是 1–${String(LIMIT_MAX)} 的整数`);
  }
  return problems;
}

// ---------- 微操作表 ----------

interface AskSpec {
  /** 同一个 id 的预测题在一份 Trace 里只出现一次。 */
  id: string;
  make: (before: State) => Ask;
}

interface Micro {
  beat: Beat;
  /** 同一节拍里的第一步是 beat，其余是 explain。 */
  level: 'beat' | 'explain';
  /** 解题表「操作」一栏的写法。 */
  op: string;
  title: string;
  /** 这一步起有效的电位信号。 */
  hold: Sig[];
  /** 这个节拍的脉冲信号。 */
  pulse: Sig[];
  /** 这一套名字里没有信号时，解题表「控制信号」一栏写的说明（带全角括号）。 */
  note?: Partial<Record<SignalNames, string>>;
  /** 通路上的部件，按数据走的顺序。 */
  path: PartId[];
  ref: string;
  why: (before: State) => string;
  update: (draft: State) => void;
  ask?: AskSpec;
}

interface CyclePlan {
  name: CycleName;
  title: string;
  ref: string;
  why: string;
  micros: Micro[];
  ask?: AskSpec;
}

const REF = {
  fetch: '教材 p154 图 5.5，节拍见 p178 图 5.30',
  decode: '教材 p154，译码不占 CPU 周期见 p161',
  MOV: '教材 p178 图 5.30，通路同 p155 图 5.6',
  NOT: '教材 p154–156 图 5.6',
  LAD: '教材 p156–157 图 5.8',
  ADD: '教材 p157–158 图 5.9',
  AND: '教材 p153 表 5.1；教材没有跟踪 AND，比照 p157 的 ADD',
  STO: '教材 p158–159 图 5.11',
  JMP: '教材 p159–160 图 5.13',
} as const;

const INSTRUCTION_REF: Readonly<Record<Op, string>> = {
  MOV: '教材 p154 图 5.4，p162 图 5.15',
  NOT: '教材 p154 图 5.4',
  LAD: '教材 p156 图 5.7',
  ADD: '教材 p157，p161',
  AND: REF.AND,
  STO: '教材 p158 图 5.10',
  JMP: '教材 p160 图 5.12',
};

/** 三个三态门各接在哪个输出端上（图 5.1）。 */
const GATE_ROLE: Readonly<Record<GateId, string>> = { C1: 'ALU 输出', C2: '通用寄存器输出', C3: 'IR 地址码' };

/** 选通用寄存器时解题表里的说明：教材不为它单列信号。 */
const SELECT_NOTE: Partial<Record<SignalNames, string>> = { book: '（由 IR 的寄存器字段选中）' };

/** 一条指令的全部 CPU 周期和微操作。run、flow、解题表都从这里来。 */
function plan(ins: Instruction, names: SignalNames): CyclePlan[] {
  const nm = (sig: Sig): string | null => sig[names];
  /** 「发 X 和 Y」里的信号名；这一套名字里没有就返回空串。 */
  const list = (...sigs: Sig[]): string =>
    sigs
      .map(nm)
      .filter((name): name is string => name !== null)
      .join(' 和 ');
  /** 附在句末的信号名，例如「，信号 LR1」。 */
  const tag = (...sigs: Sig[]): string => (list(...sigs) ? `，信号 ${list(...sigs)}` : '');
  /** 选通用寄存器这一步为什么在教材的表里没有信号。 */
  const selectNote = (...regs: GeneralRegister[]): string => {
    const read = [...new Set(regs)].map((r) => `L${r}`).join(' 和 ');
    return names === 'book'
      ? `选哪个寄存器由 IR 的寄存器字段直接决定，教材不为它单列控制信号，表里注明「由 IR 的寄存器字段选中」；解析书把它写成读出信号 ${read}。`
      : `选哪个寄存器由 IR 的寄存器字段直接决定，教材不为它单列控制信号；解析书写成读出信号 ${read}，电位信号，保持到这个 CPU 周期结束。`;
  };
  const others = (keep: GateId): string =>
    (['C1', 'C2', 'C3'] as const)
      .filter((g) => g !== keep)
      .map((g) => `${g}（${GATE_ROLE[g]}）`)
      .join('、');

  const fetch: CyclePlan = {
    name: '取指',
    title: '取指周期',
    ref: REF.fetch,
    why: '每条指令的第一个 CPU 周期都相同：按 PC 从指存取出指令装入 IR，PC 加 1，对操作码译码。这条通路走 ABUS(I) 和 IBUS，不占 DBUS。一个 CPU 周期有 T1 到 T4 四个节拍。',
    micros: [
      {
        beat: 'T1',
        level: 'beat',
        op: 'PC→ABUS(I)',
        title: 'PC → ABUS(I) → 指存',
        hold: [SIG.RD_I],
        pulse: [],
        path: ['PC', 'ABUS_I', 'IMEM'],
        ref: REF.fetch,
        why: (s) =>
          `PC 的内容 ${String(s.reg.PC)} 直通 ABUS(I)，指存按这个地址译码。${list(SIG.RD_I)} 是指存读命令，电位信号，整个取指周期保持有效。`,
        update: (d) => {
          d.bus.ABUS_I = { value: d.reg.PC, driver: 'PC' };
        },
      },
      {
        beat: 'T3',
        level: 'beat',
        op: 'IBUS→IR',
        title: '指存 → IBUS → IR',
        hold: [],
        pulse: [SIG.LDIR],
        path: ['IMEM', 'IBUS', 'IR'],
        ref: REF.fetch,
        why: (s) => {
          const cell = s.imem[String(s.reg.PC)];
          const text = cell ? `${cell.op} ${cell.operands}` : '';
          return `指存 ${String(s.reg.PC)} 号单元读出的 ${text} 已在 IBUS 上稳定，T3 发 ${list(SIG.LDIR)} 把它打入 IR。取指令走 IBUS，DBUS 空着。`;
        },
        update: (d) => {
          const cell = d.imem[String(d.reg.PC)];
          if (!cell) throw new Error(`指存 ${String(d.reg.PC)} 号单元没有指令`);
          d.bus.IBUS = { value: `${cell.op} ${cell.operands}`, driver: 'IMEM' };
          d.reg.IR = { op: cell.op, operands: cell.operands };
        },
        ask: {
          id: 'fetch-bus',
          make: () => ({
            prompt: '指存读出的指令经哪条总线进 IR',
            kind: 'choice',
            options: [PART_LABEL.DBUS, PART_LABEL.IBUS, PART_LABEL.ABUS_I],
            answer: PART_LABEL.IBUS,
            hint: '看指存的数据端接在哪条总线上，它和数存是分开的。',
          }),
        },
      },
      {
        beat: 'T4',
        level: 'beat',
        op: 'PC+1',
        title: 'PC + 1',
        hold: [],
        pulse: [SIG.PC_INC, SIG.LDPC_FETCH],
        path: ['PC'],
        ref: REF.fetch,
        why: (s) =>
          `T4 发 ${list(SIG.PC_INC, SIG.LDPC_FETCH)}，PC 由 ${String(s.reg.PC)} 变成 ${String((s.reg.PC + 1) & MASK)}，指向下一条指令。PC 自带加 1 功能，这一步不经过 ALU 和 DBUS。`,
        update: (d) => {
          d.reg.PC = (d.reg.PC + 1) & MASK;
        },
      },
      {
        beat: 'T4',
        level: 'explain',
        op: '译码',
        title: 'IR 的操作码 → 指令译码器',
        hold: [],
        pulse: [],
        path: ['IR', 'DECODER', 'OC'],
        ref: REF.decode,
        why: (s) => {
          const op = s.reg.IR.op;
          const execute = op === null ? 0 : CYCLES[op] - 1;
          return `指令译码器认出这是 ${String(op)}，操作控制器据此决定后面发哪些控制信号。译码依附在取指周期的末尾，不另占 CPU 周期。${String(op)} 的执行周期有 ${String(execute)} 个 CPU 周期。`;
        },
        update: (d) => {
          d.decoder = d.reg.IR.op;
        },
      },
    ],
  };

  /** ALU 输出 → C1 → DBUS。 */
  const aluToBus = (ref: string): Micro => ({
    beat: 'T1',
    level: 'explain',
    op: 'ALU→DBUS',
    title: 'ALU → C1 → DBUS',
    hold: [SIG.C1],
    pulse: [],
    path: ['ALU', 'C1', 'DBUS'],
    ref,
    why: (s) =>
      `打开 ALU 输出端的三态门 C1，${String(s.alu.out)} 上了 DBUS。DBUS 上同一时刻只能有一个数，${others('C1')}和数存的读出端都关着。`,
    update: (d) => {
      d.gate.C1 = true;
      d.bus.DBUS = { value: d.alu.out, driver: 'ALU' };
    },
  });

  /** DR → 通用寄存器，T4。 */
  const drToRegister = (target: GeneralRegister, ref: string, note: string): Micro => ({
    beat: 'T4',
    level: 'beat',
    op: `DR→${target}`,
    title: `DR → ${target}`,
    hold: [],
    pulse: [ldr(target)],
    path: ['DR', target],
    ref,
    why: (s) =>
      `${note}操作控制器按 IR 的寄存器字段选中 ${target} 作目标，T4 发 ${list(ldr(target))}，DR 里的 ${String(s.reg.DR)} 打入 ${target}，原来的 ${String(s.reg[target])} 被盖掉。`,
    update: (d) => {
      d.sel.write = target;
      if (d.reg.DR !== null) d.reg[target] = d.reg.DR;
    },
  });

  /** IR 地址码 → C3 → DBUS。 */
  const irToBus = (ref: string, what: string, tail: string): Micro => ({
    beat: 'T1',
    level: 'beat',
    op: 'IR(地址码)→DBUS',
    title: 'IR 的地址码 → C3 → DBUS',
    hold: [SIG.C3],
    pulse: [],
    path: ['IR', 'C3', 'DBUS'],
    ref,
    why: (s) =>
      `打开 IR 输出端的三态门 C3，地址码字段里的${what} ${String(irAddress(s.reg.IR))} 上了 DBUS。${others('C3')}和数存的读出端都关着。${tail}`,
    update: (d) => {
      d.gate.C3 = true;
      d.bus.DBUS = { value: irAddress(d.reg.IR), driver: 'IR' };
    },
  });

  switch (ins.op) {
    case 'MOV':
    case 'NOT': {
      const { rx, ry, op } = ins;
      const fn: AluFn = op === 'NOT' ? '取反' : '传送';
      const ref = REF[op];
      const execute: CyclePlan = {
        name: '执行',
        title: `执行周期：${meaning(ins)}`,
        ref,
        why: `译码认出 ${op}。源和目标都是通用寄存器，可寄存器之间没有直接的连线，数要经 ALU、三态门 C1、DBUS、DR 绕一圈回来。DBUS 只用一次，一个 CPU 周期够。`,
        micros: [
          {
            beat: 'T1',
            level: 'beat',
            op: `${ry}→ALU`,
            title: `${ry} → ALU`,
            hold: [lr(ry)],
            pulse: [],
            note: SELECT_NOTE,
            path: [ry, 'ALU'],
            ref,
            why: (s) =>
              `操作控制器按 IR 的源寄存器字段选中 ${ry}（${String(s.reg[ry])}），送到 ALU 的输入端。${selectNote(ry)}`,
            update: (d) => {
              d.sel.left = ry;
            },
          },
          {
            beat: 'T1',
            level: 'explain',
            op: `ALU ${fn}`,
            title: `ALU ${fn}`,
            hold: [],
            pulse: [],
            path: ['ALU'],
            ref,
            why: (s) => {
              const a = s.reg[ry];
              const out = aluCompute(fn, a, 0).out;
              return op === 'NOT'
                ? `操作控制器指定 ALU 做取反：${String(a)} 按 8 位取反得 ${String(out)}。ALU 是组合逻辑，结果随即出现在输出端。`
                : `操作控制器指定 ALU 原样传送 ${String(a)}。寄存器之间传数也走 ALU 这条路，因为通用寄存器只能从 DR 接收。`;
            },
            update: (d) => {
              d.alu = { fn, out: aluCompute(fn, d.reg[ry], 0).out };
            },
          },
          aluToBus(ref),
          {
            beat: 'T3',
            level: 'beat',
            op: 'DBUS→DR',
            title: 'DBUS → DR',
            hold: [],
            pulse: [SIG.LDDR],
            path: ['DBUS', 'DR'],
            ref,
            why: (s) =>
              `DBUS 上的 ${String(s.bus.DBUS.value)} 已稳定，T3 发 ${list(SIG.LDDR)} 打入 DR。ALU 的结果不能直接进通用寄存器，DR 在中间作缓冲。`,
            update: (d) => {
              d.reg.DR = d.bus.DBUS.value;
            },
            ask: {
              id: 'alu-result-to',
              make: (s) => ({
                prompt: `ALU 的结果 ${String(s.bus.DBUS.value)} 在 DBUS 上，T3 把它打入哪个部件`,
                kind: 'choice',
                options: [rx, 'DR', 'AR', 'PC'],
                answer: PART_LABEL.DR,
                hint: '看 DBUS 和通用寄存器之间隔着哪个寄存器。',
              }),
            },
          },
          drToRegister(rx, ref, ''),
        ],
      };
      return [fetch, execute];
    }

    case 'ADD':
    case 'AND': {
      const { rx, ry, op } = ins;
      const fn: AluFn = op === 'ADD' ? '加' : '逻辑乘';
      const ref = REF[op];
      const reads = rx === ry ? [lr(rx)] : [lr(rx), lr(ry)];
      const derived = op === 'AND' ? '教材的程序表里有 AND，但没有逐步跟踪它，这里比照同为 RR 型的 ADD。' : '';
      const execute: CyclePlan = {
        name: '执行',
        title: `执行周期：${meaning(ins)}`,
        ref,
        why: `译码认出 ${op}。两个操作数都在通用寄存器里，不访问数存。ALU 的结果经 C1 上 DBUS，进 DR，回到 ${ry}。DBUS 只送这一个数，一个 CPU 周期够。${derived}`,
        micros: [
          {
            beat: 'T1',
            level: 'beat',
            op: `${rx}、${ry}→ALU`,
            title: `${rx}、${ry} → ALU`,
            hold: reads,
            pulse: [],
            note: SELECT_NOTE,
            path: rx === ry ? [rx, 'ALU'] : [rx, ry, 'ALU'],
            ref,
            why: (s) =>
              `操作控制器按 IR 的两个寄存器字段选中 ${rx}（${String(s.reg[rx])}）和 ${ry}（${String(s.reg[ry])}），分别送到 ALU 的两个输入端。${selectNote(rx, ry)}`,
            update: (d) => {
              d.sel.left = rx;
              d.sel.right = ry;
            },
          },
          {
            beat: 'T1',
            level: 'explain',
            op: `ALU ${fn}`,
            title: `ALU ${fn}`,
            hold: op === 'ADD' ? [SIG.ADD_FN] : [],
            pulse: [],
            path: ['ALU'],
            ref,
            why: (s) => {
              const a = s.reg[rx];
              const b = s.reg[ry];
              const { out, flags } = aluCompute(fn, a, b);
              if (op === 'AND') return `操作控制器指定 ALU 做逻辑乘：${String(a)} AND ${String(b)} = ${String(out)}，按位相与。${derived}`;
              const carry = flags.C === 1 ? `，8 位装不下 ${String(a + b)}，输出端是 ${String(out)}，最高位有进位` : '';
              return `操作控制器指定 ALU 做加法${tag(SIG.ADD_FN)}：${String(a)} + ${String(b)} = ${String(a + b)}${carry}。ALU 是组合逻辑，结果随即出现在输出端。`;
            },
            update: (d) => {
              d.alu = { fn, out: aluCompute(fn, d.reg[rx], d.reg[ry]).out };
            },
          },
          aluToBus(ref),
          {
            beat: 'T3',
            level: 'beat',
            op: op === 'ADD' ? 'DBUS→DR，进位→PSWR' : 'DBUS→DR，标志→PSWR',
            title: op === 'ADD' ? 'DBUS → DR，进位 → PSWR' : 'DBUS → DR，标志 → PSWR',
            hold: [],
            pulse: [SIG.LDDR, SIG.SPSW],
            path: ['DBUS', 'DR', 'ALU', 'PSWR'],
            ref,
            why: (s) => {
              const { flags } = aluCompute(fn, s.reg[rx], s.reg[ry]);
              const saved =
                op === 'ADD'
                  ? `同一拍，ALU 的进位（C=${String(flags.C)}）连同 V、Z、N 存入 PSWR${tag(SIG.SPSW)}。`
                  : `同一拍，ALU 的标志（Z=${String(flags.Z)}，N=${String(flags.N)}）存入 PSWR${tag(SIG.SPSW)}。`;
              return `T3 发 ${list(SIG.LDDR)}，DBUS 上的 ${String(s.bus.DBUS.value)} 打入 DR。${saved}`;
            },
            update: (d) => {
              d.reg.DR = d.bus.DBUS.value;
              d.reg.PSWR = aluCompute(fn, d.reg[rx], d.reg[ry]).flags;
            },
          },
          {
            ...drToRegister(ry, ref, `${op} ${rx},${ry} 的结果放进第二个寄存器。`),
            ...(rx !== ry
              ? {
                  ask: {
                    id: `${op}-target`,
                    make: (s: State): Ask => ({
                      prompt: `结果 ${String(s.reg.DR)} 已在 DR 里。${format(ins)} 在 T4 把它打入哪个寄存器`,
                      kind: 'choice',
                      options: [rx, ry].sort(),
                      answer: ry,
                      hint: '看这条指令旁边标的箭头含义。这本教材里操作数的先后每条指令不一样。',
                    }),
                  },
                }
              : {}),
          },
        ],
      };
      return [fetch, execute];
    }

    case 'LAD': {
      const { rx, addr } = ins;
      const ref = REF.LAD;
      const toAr: Micro = {
        beat: 'T4',
        level: 'beat',
        op: 'DBUS→AR',
        title: 'DBUS → AR',
        hold: [],
        pulse: [SIG.LDAR],
        path: ['DBUS', 'AR'],
        ref,
        why: (s) =>
          `T4 发 ${list(SIG.LDAR)}，DBUS 上的地址 ${String(s.bus.DBUS.value)} 打入 AR。AR 把地址保持住，下一个 CPU 周期 DBUS 才能腾出来送数据。`,
        update: (d) => {
          d.reg.AR = d.bus.DBUS.value;
        },
        ask: {
          id: 'LAD-address-to',
          make: (s) => ({
            prompt: `地址码 ${String(s.bus.DBUS.value)} 在 DBUS 上，T4 把它打入哪个寄存器`,
            kind: 'choice',
            options: ['AR', 'DR', 'PC', rx],
            answer: PART_LABEL.AR,
            hint: '看访问数存时地址由哪个寄存器保持。',
          }),
        },
      };
      const address: CyclePlan = {
        name: '执行一',
        title: '执行周期的第 1 个 CPU 周期：送操作数地址',
        ref,
        why: `译码认出 LAD。读数存要给出地址，地址 ${String(addr)} 在 IR 的地址码字段里，要经 DBUS 送进 AR。DBUS 同一时刻只能有一个数，这个 CPU 周期它被地址占着，数据只能等下一个 CPU 周期。`,
        micros: [irToBus(ref, '直接地址', '这时 DBUS 上是地址，数存的数还不能上来。'), toAr],
      };
      const data: CyclePlan = {
        name: '执行二',
        title: '执行周期的第 2 个 CPU 周期：取出操作数',
        ref,
        why: `上一个 CPU 周期的 C3 已经撤掉，DBUS 空出来了。AR 里有地址，数存读出的数可以上 DBUS，经 DR 装入 ${rx}。`,
        ask: {
          id: 'LAD-data-to',
          make: (s) => ({
            prompt: `地址 ${String(s.reg.AR)} 已经在 AR 里。下一个 CPU 周期数存读出的数上了 DBUS，由哪个部件接收`,
            kind: 'choice',
            options: [rx, 'DR', 'AR', 'PC'],
            answer: PART_LABEL.DR,
            hint: '看 DBUS 和通用寄存器之间有没有直接的连线。',
          }),
        },
        micros: [
          {
            beat: 'T1',
            level: 'beat',
            op: 'AR→ABUS(D)，数存→DBUS',
            title: 'AR → ABUS(D) → 数存 → DBUS',
            hold: [SIG.RD_D],
            pulse: [],
            path: ['AR', 'ABUS_D', 'DMEM', 'DBUS'],
            ref,
            why: (s) => {
              const a = s.reg.AR ?? 0;
              return `AR 的地址 ${String(a)} 经 ABUS(D) 送到数存。${list(SIG.RD_D)} 是数存读命令，电位信号，整个 CPU 周期有效，${String(a)} 号单元的 ${String(readCell(s, a))} 读出到 DBUS。C1、C2、C3 都关着，DBUS 上只有数存一个来源。`;
            },
            update: (d) => {
              const a = d.reg.AR ?? 0;
              d.bus.ABUS_D = { value: a, driver: 'AR' };
              d.bus.DBUS = { value: readCell(d, a), driver: 'DMEM' };
            },
          },
          {
            beat: 'T3',
            level: 'beat',
            op: 'DBUS→DR',
            title: 'DBUS → DR',
            hold: [],
            pulse: [SIG.LDDR],
            path: ['DBUS', 'DR'],
            ref,
            why: (s) =>
              `T3 发 ${list(SIG.LDDR)}，DBUS 上的 ${String(s.bus.DBUS.value)} 打入 DR。数存读出的数和 ALU 的结果一样，要过 DR 才能进通用寄存器。`,
            update: (d) => {
              d.reg.DR = d.bus.DBUS.value;
            },
          },
          drToRegister(rx, ref, ''),
        ],
      };
      return [fetch, address, data];
    }

    case 'STO': {
      const { rx, ry } = ins;
      const ref = REF.STO;
      const address: CyclePlan = {
        name: '执行一',
        title: '执行周期的第 1 个 CPU 周期：送操作数地址',
        ref,
        why: `译码认出 STO。写数存要给出地址，地址在 ${ry} 里，要经 DBUS 送进 AR。DBUS 这个 CPU 周期被地址占着，要写的数等下一个 CPU 周期。`,
        micros: [
          {
            beat: 'T1',
            level: 'beat',
            op: `选 ${ry}`,
            title: `选中 ${ry}`,
            hold: [lr(ry)],
            pulse: [],
            note: SELECT_NOTE,
            path: [ry, 'C2'],
            ref,
            why: (s) =>
              `操作控制器按 IR 的寄存器字段选中 ${ry}，它存着要写的数存单元的地址 ${String(s.reg[ry])}。${selectNote(ry)}DBUS 的出口有三个三态门：C1 接 ALU 的输出，C2 接通用寄存器的输出，C3 接 IR 的地址码，开哪一个，哪一路的数就上 DBUS。`,
            update: (d) => {
              d.sel.right = ry;
            },
          },
          {
            beat: 'T1',
            level: 'explain',
            op: `${ry}→DBUS`,
            title: `${ry} → C2 → DBUS`,
            hold: [SIG.C2],
            pulse: [],
            path: [ry, 'C2', 'DBUS'],
            ref,
            why: (s) =>
              `打开通用寄存器输出端的三态门 C2，地址 ${String(s.reg[ry])} 不经 ALU 直接上 DBUS，省掉 ALU 的延迟。${others('C2')}和数存的读出端都关着。`,
            update: (d) => {
              d.gate.C2 = true;
              d.bus.DBUS = { value: d.reg[ry], driver: ry };
            },
            ask: {
              id: 'STO-gate',
              make: () => ({
                prompt: `${ry} 里的地址要不经 ALU 直接上 DBUS，打开哪个三态门`,
                kind: 'choice',
                options: ['C1', 'C2', 'C3'],
                answer: PART_LABEL.C2,
                hint: '三个三态门各接在一个输出端上：ALU、通用寄存器、IR 的地址码。',
              }),
            },
          },
          {
            beat: 'T4',
            level: 'beat',
            op: 'DBUS→AR',
            title: 'DBUS → AR',
            hold: [],
            pulse: [SIG.LDAR],
            path: ['DBUS', 'AR'],
            ref,
            why: (s) =>
              `T4 发 ${list(SIG.LDAR)}，地址 ${String(s.bus.DBUS.value)} 打入 AR。DBUS 是单总线，地址送完，下一个 CPU 周期才能送要写的数。`,
            update: (d) => {
              d.reg.AR = d.bus.DBUS.value;
            },
          },
        ],
      };
      const data: CyclePlan = {
        name: '执行二',
        title: '执行周期的第 2 个 CPU 周期：送操作数，写数存',
        ref,
        why: `上一个 CPU 周期 C2 送的是地址，已经撤掉，AR 保持着地址。这个 CPU 周期一开始地址就经 ABUS(D) 送到数存，再改选 ${rx}，同一个三态门 C2 送要写的数。`,
        micros: [
          {
            beat: 'T1',
            level: 'beat',
            op: 'AR→ABUS(D)',
            title: 'AR → ABUS(D) → 数存',
            hold: [SIG.WRITE_D],
            pulse: [],
            note: { book: '（AR 直通 ABUS(D)）' },
            path: ['AR', 'ABUS_D', 'DMEM'],
            ref,
            why: (s) => {
              const mode = nm(SIG.WRITE_D) ? `解析书在这个 CPU 周期给出 ${list(SIG.WRITE_D)}，表示对数存是写。` : '';
              return `AR 和 ABUS(D) 之间是直通线，AR 在上一个 CPU 周期 T4 打入 ${String(s.reg.AR)} 之后，地址就一直在 ABUS(D) 上，数存从这个 CPU 周期开始就选中 ${String(s.reg.AR)} 号单元。${mode}LAD 读数存时也一样，地址写在访存 CPU 周期的 T1。`;
            },
            update: (d) => {
              d.bus.ABUS_D = { value: d.reg.AR ?? 0, driver: 'AR' };
            },
          },
          {
            beat: 'T1',
            level: 'explain',
            op: `选 ${rx}`,
            title: `选中 ${rx}`,
            hold: [lr(rx)],
            pulse: [],
            note: SELECT_NOTE,
            path: [rx, 'C2'],
            ref,
            why: (s) => `操作控制器改选 ${rx}，它存着要写进数存的数 ${String(s.reg[rx])}。${selectNote(rx)}`,
            update: (d) => {
              d.sel.right = rx;
            },
          },
          {
            beat: 'T1',
            level: 'explain',
            op: `${rx}→DBUS`,
            title: `${rx} → C2 → DBUS`,
            hold: [SIG.C2],
            pulse: [],
            path: [rx, 'C2', 'DBUS'],
            ref,
            why: (s) => `再次打开 C2，这回 DBUS 上是数据 ${String(s.reg[rx])}。${others('C2')}和数存的读出端都关着。`,
            update: (d) => {
              d.gate.C2 = true;
              d.bus.DBUS = { value: d.reg[rx], driver: rx };
            },
          },
          {
            beat: 'T3',
            level: 'beat',
            op: 'DBUS→数存',
            title: 'DBUS → 数存（AR 指定的单元）',
            hold: [],
            pulse: [SIG.WE_D],
            note: { solutions: '（DR/W̄=0 已在本周期给出，不注节拍）' },
            path: ['DBUS', 'DMEM'],
            ref,
            why: (s) => {
              const a = s.reg.AR ?? 0;
              const old = s.dmem[String(a)];
              const command = nm(SIG.WE_D)
                ? `T3 发数存写命令 ${list(SIG.WE_D)}。它是脉冲信号（例 5.3 写成 M3·T3·STO）：地址和要写的数先在线上稳定，T3 才写，读命令 RD(D) 则从周期开始就有效，好让数存有时间读出。`
                : `解析书的 ${list(SIG.WRITE_D)} 不注节拍；这里和教材一样在 T3 写入，地址和要写的数这时已在线上稳定。`;
              const replaced = old === undefined ? '' : `原来的 ${String(old)} 被盖掉。`;
              return `${command}DBUS 上的 ${String(s.bus.DBUS.value)} 写进数存 ${String(a)} 号单元，${replaced}写数存不经过 DR。`;
            },
            update: (d) => {
              const a = d.reg.AR ?? 0;
              if (d.bus.DBUS.value !== null) d.dmem[String(a)] = d.bus.DBUS.value;
            },
            ask: {
              id: 'STO-data-to',
              make: (s) => ({
                prompt: `数据 ${String(s.bus.DBUS.value)} 在 DBUS 上，地址 ${String(s.reg.AR)} 在 AR 里。T3 由哪个部件接收`,
                kind: 'choice',
                options: ['DR', 'AR', PART_LABEL.DMEM, 'PC'],
                answer: PART_LABEL.DMEM,
                hint: '看这条指令的数最后要落在哪里。',
              }),
            },
          },
        ],
      };
      return [fetch, address, data];
    }

    case 'JMP': {
      const { addr } = ins;
      const ref = REF.JMP;
      const execute: CyclePlan = {
        name: '执行',
        title: '执行周期：送转移地址',
        ref,
        why: `译码认出 JMP。转移地址 ${String(addr)} 在 IR 的地址码字段里，经 C3 上 DBUS 送进 PC。DBUS 只用一次，一个 CPU 周期够。`,
        micros: [
          irToBus(ref, '转移地址', ''),
          {
            beat: 'T4',
            level: 'beat',
            op: 'DBUS→PC',
            title: 'DBUS → PC',
            hold: [],
            pulse: [SIG.LDPC],
            path: ['DBUS', 'PC'],
            ref,
            why: (s) =>
              `T4 发 ${list(SIG.LDPC)}，DBUS 上的 ${String(s.bus.DBUS.value)} 打入 PC，取指周期里加 1 得到的 ${String(s.reg.PC)} 被盖掉。下一条指令从 ${String(s.bus.DBUS.value)} 号单元取。`,
            update: (d) => {
              if (d.bus.DBUS.value !== null) d.reg.PC = d.bus.DBUS.value;
            },
            ask: {
              id: 'JMP-address-to',
              make: (s) => ({
                prompt: `转移地址 ${String(s.bus.DBUS.value)} 在 DBUS 上，T4 把它打入哪个寄存器`,
                kind: 'choice',
                options: ['AR', 'DR', 'PC', 'IR'],
                answer: PART_LABEL.PC,
                hint: '看下一条指令的地址由哪个寄存器给出。',
              }),
            },
          },
        ],
      };
      return [fetch, execute];
    }
  }
}

/** 这一步在所选的那套名字里有名字的信号。 */
function named(sigs: Sig[], names: SignalNames): string[] {
  return sigs.map((sig) => sig[names]).filter((name): name is string => name !== null);
}

/** 解题表「控制信号」一栏：电位信号直接写，脉冲信号注明节拍。 */
function signalCell(micro: Micro, names: SignalNames): string {
  const cell = [...named(micro.hold, names), ...named(micro.pulse, names).map((name) => `${name}(${micro.beat})`)].join('，');
  return cell || (micro.note?.[names] ?? '');
}

// ---------- 方框图（不带数值） ----------

export interface FlowMicro {
  beat: Beat;
  level: 'beat' | 'explain';
  /** 写成「源→目的」。 */
  op: string;
  /** 电位信号。 */
  hold: string[];
  /** 这个节拍的脉冲信号，不带节拍标注。 */
  pulse: string[];
  /** 解题表「控制信号」一栏：电位信号直接写，脉冲信号注节拍；没有信号时是说明或空串。 */
  cell: string;
}

export interface FlowCycle {
  cycle: CycleName;
  micros: FlowMicro[];
}

/** 一条指令的指令周期：每个 CPU 周期里按顺序有哪些微操作、发哪些控制信号。不依赖寄存器里的数。 */
export function flow(ins: Instruction, names: SignalNames): FlowCycle[] {
  return plan(ins, names).map((cycle) => ({
    cycle: cycle.name,
    micros: cycle.micros.map((micro) => ({
      beat: micro.beat,
      level: micro.level,
      op: micro.op,
      hold: named(micro.hold, names),
      pulse: named(micro.pulse, names),
      cell: signalCell(micro, names),
    })),
  }));
}

// ---------- 运行 ----------

function initialState(params: Params): State {
  const imem: State['imem'] = {};
  for (const line of [...params.program].sort((a, b) => a.addr - b.addr)) {
    imem[String(line.addr)] = { op: line.ins.op, operands: operandsOf(line.ins) };
  }
  const dmem: State['dmem'] = {};
  for (const cell of [...params.memory].sort((a, b) => a.addr - b.addr)) dmem[String(cell.addr)] = cell.value;
  const r = params.registers;
  return {
    reg: {
      PC: r.PC,
      IR: { op: null, operands: null },
      AR: null,
      DR: null,
      R0: r.R0,
      R1: r.R1,
      R2: r.R2,
      R3: r.R3,
      PSWR: { C: null, V: null, Z: null, N: null },
    },
    decoder: null,
    sel: { left: null, right: null, write: null },
    alu: { fn: null, out: null },
    bus: { ABUS_I: free(), IBUS: free(), DBUS: free(), ABUS_D: free() },
    gate: { C1: false, C2: false, C3: false },
    imem,
    dmem,
    signals: { level: [], pulse: [] },
    timing: { instruction: 0, addr: null, cycle: null, cycleNo: 0, cycles: 0, beat: null },
    halted: false,
  };
}

function instructionWhy(ins: Instruction, addr: number): string {
  const at = `PC 指着指存 ${String(addr)} 号单元。`;
  switch (ins.op) {
    case 'LAD':
      return `${at}LAD 访问一次指存、一次数存，地址和数据又都要走 DBUS，指令周期是 3 个 CPU 周期：取指、送地址、取数。`;
    case 'STO':
      return `${at}STO 的地址和要存的数都得经过 DBUS，各占一个 CPU 周期，加上取指共 3 个 CPU 周期。`;
    case 'ADD':
      return `${at}ADD 的两个操作数都在通用寄存器里，不访问数存，DBUS 只送一次结果，指令周期是 2 个 CPU 周期：取指、执行。`;
    case 'AND':
      return `${at}AND 和 ADD 一样是寄存器之间的运算，DBUS 只送一次结果，指令周期按 2 个 CPU 周期算。教材列出了这条指令，没有逐步跟踪它。`;
    case 'JMP':
      return `${at}JMP 只把转移地址送进 PC，DBUS 只送一次，指令周期是 2 个 CPU 周期。`;
    default:
      return `${at}${ins.op} 只在通用寄存器之间传数，DBUS 只送一次，指令周期是 2 个 CPU 周期：取指、执行。`;
  }
}

/** 第一次在 T3 打入时补的一句（教材 p152 电位-脉冲方式，p169 图 5.23，p178 图 5.30）。 */
const WHY_T3 =
  '打入靠节拍脉冲：电位信号从 T1 起把通路接好，等存储器读出或 ALU 运算的结果在总线上稳定了才用脉冲打入（教材 p169 图 5.23），图 5.30 把 IR、DR 的打入放在 T3，好留出 T4 给下一级的 PC 或通用寄存器（p178）。';
/** 第一次在 T4 打入时补的一句。 */
const WHY_T4 =
  'T4 是 CPU 周期的最后一拍，图 5.30 把 PC、AR 和通用寄存器的打入都放在这里（p178）：PC 在 T1 到 T3 一直给指存当地址，要等 IR 在 T3 打入后才能改，通用寄存器也要等 DR 在 T3 拿到数。';

/** 运行程序，得到逐步的 Trace。参数不合法时抛出错误。 */
export function run(params: Params): Trace<Params, State> {
  const problems = checkParams(params);
  if (problems.length > 0) throw new Error(`模型机参数有问题：${problems.join('；')}`);
  const limit = params.limit ?? LIMIT_DEFAULT;
  const names = params.names;
  const initial = initialState(params);

  const conditions: Condition[] = [
    { label: '字长', value: '8 位，寄存器、数存单元和地址都在 0–255，数按十进制写' },
    { label: '时序', value: '一个 CPU 周期含 T1–T4 四个节拍；电位信号保持整个 CPU 周期，打入在 T3 或 T4' },
    { label: 'PC', value: `起始地址 ${String(initial.reg.PC)}，每取一条指令加 1` },
    { label: '通用寄存器', value: GENERAL_REGISTERS.map((r) => `${r}=${String(initial.reg[r])}`).join('，') },
    {
      label: '数存',
      value: `${Object.entries(initial.dmem)
        .map(([addr, value]) => `${addr} 号 ${String(value)}`)
        .join('，')}${Object.keys(initial.dmem).length > 0 ? '；' : ''}没列出的单元读出 0`,
    },
    { label: '信号名', value: names === 'book' ? '教材的写法（LDIR、LDAR、LDDR、RD(D)、WE(D)）' : '解析书的写法（SIR、SAR、SDR、LRi、SRi、DR/W̄）' },
    { label: '停机', value: `PC 指到没有指令的单元，或执行满 ${String(limit)} 条指令` },
  ];

  const builder = new TraceBuilder<Params, State>('cpu', params, initial, conditions);
  const rows: SolutionTable['rows'] = [];
  const asked = new Set<string>();
  let stepCount = 0;
  /** 当前状态的副本，只读；每走一步换成新的。 */
  let current = clone(initial);

  /** 走一步，并把「变了的位置 + 通路上的部件」记进 focus。返回这一步的 id。 */
  const emit = (input: {
    level: 'instruction' | 'cycle' | 'beat' | 'explain';
    title: string;
    why: string;
    ref: string;
    path: PartId[];
    ask?: AskSpec | undefined;
    update: (draft: State) => void;
  }): string => {
    const before = current;
    const after = clone(before);
    input.update(after);
    const changed = diffStates(before, after).map((change) => change.at);
    let ask: Ask | undefined;
    if (input.ask && !asked.has(input.ask.id)) {
      asked.add(input.ask.id);
      ask = input.ask.make(before);
    }
    builder.step({
      level: input.level,
      title: input.title,
      why: input.why,
      ref: input.ref,
      focus: [...new Set<string>([...changed, ...input.path])],
      ...(ask ? { ask } : {}),
      update: input.update,
    });
    current = after;
    stepCount += 1;
    return `s${String(stepCount)}`;
  };

  /** 第一次在 T3、T4 打入时各说一句为什么是这一拍。 */
  const told = { T3: false, T4: false };
  let executed = 0;
  let cpuCycles = 0;
  const perInstruction: string[] = [];
  let reason: 'end' | 'limit' = 'limit';

  for (;;) {
    const addr = current.reg.PC;
    const ins = instructionAt(params.program, addr);
    if (ins === null) {
      reason = 'end';
      break;
    }
    if (executed >= limit) {
      reason = 'limit';
      break;
    }
    executed += 1;
    const cycles = plan(ins, names);
    const text = format(ins);
    perInstruction.push(`${text} ${String(cycles.length)}`);

    const countAsk: AskSpec | undefined =
      ins.op === 'LAD' || ins.op === 'STO' || ins.op === 'ADD'
        ? {
            id: `${ins.op}-cycles`,
            make: () => ({
              prompt: `${text}（${meaning(ins)}）的指令周期有几个 CPU 周期`,
              kind: 'number',
              answer: String(cycles.length),
              hint: '数一数这条指令要让 DBUS 送几次数，每次占一个 CPU 周期，另加取指的一个。',
            }),
          }
        : undefined;

    const number = executed;
    const instructionStep = emit({
      level: 'instruction',
      title: `第 ${String(number)} 条指令 ${text}：${meaning(ins)}`,
      why: instructionWhy(ins, addr),
      ref: INSTRUCTION_REF[ins.op],
      path: ['PC', 'IMEM'],
      ask: countAsk,
      update: (d) => {
        release(d);
        d.decoder = null;
        d.timing = { instruction: number, addr, cycle: null, cycleNo: 0, cycles: cycles.length, beat: null };
      },
    });
    rows.push({ cells: [text, '', meaning(ins), ''], step: instructionStep });

    cycles.forEach((cycle, index) => {
      cpuCycles += 1;
      emit({
        level: 'cycle',
        title: cycle.title,
        why: cycle.why,
        ref: cycle.ref,
        path: [],
        ask: cycle.ask,
        update: (d) => {
          release(d);
          d.timing.cycle = cycle.name;
          d.timing.cycleNo = index + 1;
          d.timing.beat = null;
        },
      });
      for (const micro of cycle.micros) {
        const before = current;
        let why = micro.why(before);
        if (micro.pulse.length > 0 && micro.beat === 'T3' && !told.T3) {
          told.T3 = true;
          why += WHY_T3;
        }
        if (micro.pulse.length > 0 && micro.beat === 'T4' && !told.T4) {
          told.T4 = true;
          why += WHY_T4;
        }
        const id = emit({
          level: micro.level,
          title: micro.title,
          why,
          ref: micro.ref,
          path: micro.path,
          ask: micro.ask,
          update: (d) => {
            if (d.timing.beat !== micro.beat) d.signals.pulse = [];
            d.timing.beat = micro.beat;
            for (const name of named(micro.hold, names)) if (!d.signals.level.includes(name)) d.signals.level.push(name);
            for (const name of named(micro.pulse, names)) if (!d.signals.pulse.includes(name)) d.signals.pulse.push(name);
            micro.update(d);
          },
        });
        rows.push({ cells: [cycle.name, micro.op === '译码' ? '' : micro.beat, micro.op, signalCell(micro, names)], step: id });
      }
    });
  }

  const last = current;
  const haltStep = emit({
    level: 'instruction',
    title: `停机，PC = ${String(last.reg.PC)}`,
    why:
      reason === 'end'
        ? `指存 ${String(last.reg.PC)} 号单元没有指令，程序到此结束。这台模型机没有停机指令，这里按人为停机处理。最后一个 CPU 周期的信号撤掉，总线空出来。`
        : `已经执行了 ${String(executed)} 条指令，到了参数设的上限，按人为停机处理。PC 指着下一条本来要取的 ${String(last.reg.PC)} 号单元。`,
    ref: '教材 p160，p161',
    path: ['PC'],
    update: (d) => {
      release(d);
      d.timing.cycle = null;
      d.timing.cycleNo = 0;
      d.timing.cycles = 0;
      d.timing.beat = null;
      d.halted = true;
    },
  });
  rows.push({ cells: ['停机', '', `PC = ${String(last.reg.PC)}`, ''], step: haltStep });

  const final = current;
  const result: Record<string, string> = { PC: String(final.reg.PC) };
  for (const r of GENERAL_REGISTERS) result[r] = String(final.reg[r]);
  for (const [addr, value] of Object.entries(final.dmem)) {
    if (initial.dmem[addr] !== value) result[`数存 ${addr} 号单元`] = String(value);
  }
  result['执行的指令数'] = String(executed);
  result['CPU 周期数'] = String(cpuCycles);
  result['各指令的 CPU 周期数'] = perInstruction.join('，');
  result['停机原因'] = reason === 'end' ? 'PC 指到没有指令的单元' : `执行满 ${String(limit)} 条指令`;

  return builder.finish(result, { columns: ['CPU 周期', '节拍', '操作', '控制信号'], rows });
}

// ---------- 弄坏它：往总线上再放一个驱动者 ----------

/** 学生做的一次操作：让某个部件把数送上某条总线。 */
export interface TransferAction {
  bus: BusId;
  /** 送数的部件：ALU（经 C1）、R0–R3（经 C2）、IR（经 C3）、DMEM（读命令）、PC、AR、IMEM。 */
  driver: PartId;
}

export interface TransferCheck {
  /** ok：总线空着或本来就是它在送；conflict：总线上已有另一个驱动者；no-path：这个部件没有通到这条总线的出口。 */
  verdict: 'ok' | 'conflict' | 'no-path';
  bus: BusId;
  /** 这次操作之后同时往这条总线送数的部件。冲突时是两个：原有的在前。 */
  drivers: PartId[];
  /** 与 drivers 一一对应的值。 */
  values: (number | string | null)[];
  /** 打开的是哪个三态门；不经三态门时为 null。 */
  gate: GateId | null;
  /** 一句话：这样做在真实硬件里会怎样。 */
  message: string;
}

/** 每条总线上有出口的部件。 */
const OUTLETS: Readonly<Record<BusId, readonly PartId[]>> = {
  ABUS_I: ['PC'],
  IBUS: ['IMEM'],
  DBUS: ['ALU', 'R0', 'R1', 'R2', 'R3', 'IR', 'DMEM'],
  ABUS_D: ['AR'],
};

function gateOf(driver: PartId): GateId | null {
  if (driver === 'ALU') return 'C1';
  if (isRegister(driver)) return 'C2';
  if (driver === 'IR') return 'C3';
  return null;
}

/** 让这个部件上总线要做的事，写成一个短句。 */
function outletName(driver: PartId): string {
  const gate = gateOf(driver);
  if (gate) return `打开三态门 ${gate}`;
  if (driver === 'DMEM') return '发数存读命令';
  if (driver === 'IMEM') return '发指存读命令';
  return `${PART_LABEL[driver]} 直通这条总线`;
}

function driveValue(state: State, driver: PartId): number | string | null {
  if (driver === 'ALU') return state.alu.out;
  if (isRegister(driver)) return state.reg[driver];
  if (driver === 'IR') return irAddress(state.reg.IR);
  if (driver === 'DMEM') return state.reg.AR === null ? null : readCell(state, state.reg.AR);
  if (driver === 'PC') return state.reg.PC;
  if (driver === 'AR') return state.reg.AR;
  if (driver === 'IMEM') {
    const cell = state.imem[String(state.reg.PC)];
    return cell ? `${cell.op} ${cell.operands}` : null;
  }
  return null;
}

/**
 * 检查「让 driver 往 bus 上送数」在当前状态下行不行。不改状态。
 * 总线上已有别的驱动者时报冲突，并用一句话说明真实硬件里的后果。
 */
export function checkTransfer(state: State, action: TransferAction): TransferCheck {
  const { bus, driver } = action;
  const busName = PART_LABEL[bus];
  const who = PART_LABEL[driver];
  const gate = gateOf(driver);
  if (!OUTLETS[bus].includes(driver)) {
    return {
      verdict: 'no-path',
      bus,
      drivers: [],
      values: [],
      gate: null,
      message: `${who} 没有通到 ${busName} 的出口，能往 ${busName} 送数的只有 ${OUTLETS[bus].map((p) => PART_LABEL[p]).join('、')}。`,
    };
  }
  const value = driveValue(state, driver);
  const current = state.bus[bus];
  if (current.driver === null || current.driver === driver) {
    return {
      verdict: 'ok',
      bus,
      drivers: [driver],
      values: [value],
      gate,
      message:
        current.driver === driver
          ? `${busName} 上本来就是 ${who} 在送数，没有第二个驱动者。`
          : `${busName} 空着，${outletName(driver)}，上面只有 ${who} 一个驱动者，${value === null ? '不过它这时没有确定的数可送' : `${String(value)} 可以送上去`}。`,
    };
  }
  const first = PART_LABEL[current.driver];
  const existing = current.value;
  let clash: string;
  if (typeof existing === 'number' && typeof value === 'number') {
    let differing = 0;
    for (let diff = existing ^ value; diff !== 0; diff >>= 1) differing += diff & 1;
    clash =
      differing === 0
        ? `两个数这次碰巧相同，线上的电平暂时不打架，可只要有一位不同，那根线就会被一头拉高一头拉低`
        : `两个数有 ${String(differing)} 位不同，这几根线被一头拉高一头拉低，两个输出端之间流过很大的电流，线上的电平不确定`;
  } else {
    clash = '两个输出端在同一组线上各送各的电平，不同的位上一头拉高一头拉低，电流很大，线上的电平不确定';
  }
  return {
    verdict: 'conflict',
    bus,
    drivers: [current.driver, driver],
    values: [existing, value],
    gate,
    message: `${busName} 上已有 ${first} 送来的 ${String(existing)}，又${outletName(driver)}，让 ${who} 送 ${String(value)}：${clash}，接收的寄存器打入的数不可信，器件还可能过热损坏。`,
  };
}

// ---------- 样例程序 ----------

/**
 * 讲解用的样例：把数存 9 号单元的数加上 R1，和存回数存 14 号单元，然后跳过一条指令。
 * 五条被执行的指令各不相同，LAD（3 个 CPU 周期）紧挨着 ADD（2 个）。地址和数都是自己定的。
 */
export function sampleParams(names: SignalNames = 'book'): Params {
  return {
    program: [
      { addr: 32, ins: { op: 'LAD', rx: 'R0', addr: 9 } },
      { addr: 33, ins: { op: 'ADD', rx: 'R0', ry: 'R1' } },
      { addr: 34, ins: { op: 'STO', rx: 'R1', ry: 'R3' } },
      { addr: 35, ins: { op: 'JMP', addr: 37 } },
      { addr: 36, ins: { op: 'NOT', rx: 'R1', ry: 'R0' } },
      { addr: 37, ins: { op: 'MOV', rx: 'R2', ry: 'R1' } },
    ],
    registers: { PC: 32, R0: 5, R1: 25, R2: 3, R3: 14 },
    memory: [
      { addr: 9, value: 48 },
      { addr: 10, value: 7 },
      { addr: 14, value: 60 },
      { addr: 15, value: 91 },
    ],
    names,
    limit: 8,
  };
}
