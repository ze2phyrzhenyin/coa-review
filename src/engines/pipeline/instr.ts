/**
 * 流水线一节用的指令写法（教材 5.6.3，p190–192）：三地址目标在最前，`ADD R1,R2,R3` 是 R2+R3→R1；
 * 两地址 `ADD R2,R1` 是 R2+R1→R2；`LAD R1,A` 是 M(A)→R1；`STO M(x),R3` 是 R3→M(x)。
 * 这和模型机（5.2 节）的 `ADD Rx,Ry`（结果进 Ry）不同，这里按 5.6 节的写法。
 */

export interface PipeInstruction {
  /** 原样的写法。 */
  text: string;
  op: string;
  /** 读的寄存器或存储单元，例如 R2、M(x)。 */
  reads: string[];
  /** 写的寄存器或存储单元。 */
  writes: string[];
  /** 箭头写法的含义，例如 R2+R3→R1。 */
  meaning: string;
}

/** 直接给出读写集合的写法：教材没有列的指令，或想自己定读写集合时用。 */
export interface ExplicitInstruction {
  text: string;
  reads: string[];
  writes: string[];
}

export type InstructionInput = string | ExplicitInstruction;

const ALU: Readonly<Record<string, string>> = { ADD: '+', SUB: '−', MUL: '×', DIV: '÷', AND: '·', OR: ' or ' };
const REGISTER = /^R([0-9]|[12][0-9]|3[01])$/;

function isRegister(s: string): boolean {
  return REGISTER.test(s);
}

/** 存储器操作数统一写成 M(…)。`M(x)` 原样保留，`A`、`200` 这样的地址写成 `M(A)`。 */
function memoryOperand(s: string): string | null {
  const m = /^M\(([A-Za-z0-9_]+)\)$/.exec(s);
  if (m) return `M(${m[1]!})`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !isRegister(s) && !/^R\d+$/.test(s)) return `M(${s})`;
  if (/^\d+$/.test(s)) return `M(${s})`;
  return null;
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

/** 把一条指令的写法解析成读集合、写集合。写法不认识时抛出错误。 */
export function parseInstruction(input: InstructionInput): PipeInstruction {
  if (typeof input !== 'string') {
    if (!input.text.trim()) throw new Error('指令写法不能为空');
    for (const loc of [...input.reads, ...input.writes]) {
      if (!isRegister(loc) && !/^M\([A-Za-z0-9_]+\)$/.test(loc)) throw new Error(`「${loc}」不是寄存器（R0–R31）也不是存储单元 M(…)`);
    }
    const op = input.text.trim().split(/\s+/)[0]!.toUpperCase();
    const meaning = `读 ${input.reads.join('、') || '无'}，写 ${input.writes.join('、') || '无'}`;
    return { text: input.text.trim(), op, reads: unique(input.reads), writes: unique(input.writes), meaning };
  }
  const text = input.trim().replace(/\s+/g, ' ');
  const m = /^([A-Za-z]+)\s+(.+)$/.exec(text);
  if (!m) throw new Error(`看不懂指令「${input}」：要写成「操作码 操作数,操作数」`);
  const op = m[1]!.toUpperCase();
  const args = m[2]!.split(',').map((a) => a.trim());
  if (args.some((a) => a === '')) throw new Error(`指令「${input}」里有空的操作数`);
  const bad = (why: string): never => {
    throw new Error(`指令「${input}」：${why}`);
  };
  if (op in ALU) {
    const sym = ALU[op]!;
    if (args.length === 3) {
      const [d, s, t] = args as [string, string, string];
      if (![d, s, t].every(isRegister)) bad('三地址运算的三个操作数都要是寄存器 R0–R31');
      return { text, op, reads: unique([s, t]), writes: [d], meaning: `${s}${sym}${t}→${d}` };
    }
    if (args.length === 2) {
      const [a, b] = args as [string, string];
      if (![a, b].every(isRegister)) bad('两地址运算的两个操作数都要是寄存器 R0–R31');
      return { text, op, reads: unique([a, b]), writes: [a], meaning: `${a}${sym}${b}→${a}` };
    }
    return bad('运算指令要有两个或三个操作数');
  }
  if (op === 'MOV' || op === 'NOT') {
    if (args.length !== 2 || !args.every(isRegister)) bad(`${op} 写成「${op} 目标寄存器,源寄存器」`);
    const [d, s] = args as [string, string];
    return { text, op, reads: [s], writes: [d], meaning: op === 'MOV' ? `${s}→${d}` : `${s} 取反→${d}` };
  }
  if (op === 'LAD') {
    if (args.length !== 2 || !isRegister(args[0]!)) bad('LAD 写成「LAD 寄存器,地址」');
    const mem = memoryOperand(args[1]!) ?? bad('LAD 的第二个操作数要是存储单元，例如 A 或 M(x)');
    return { text, op, reads: [mem], writes: [args[0]!], meaning: `${mem}→${args[0]!}` };
  }
  if (op === 'STO') {
    if (args.length !== 2) bad('STO 要有两个操作数');
    const [a, b] = args as [string, string];
    const reg = isRegister(a) ? a : isRegister(b) ? b : null;
    const other = reg === a ? b : a;
    const mem = memoryOperand(other);
    if (!reg || !mem) bad('STO 要一个寄存器和一个存储单元，例如 STO M(x),R3');
    return { text, op, reads: [reg!], writes: [mem!], meaning: `${reg!}→${mem!}` };
  }
  return bad(`不认识操作码 ${op}；可用 ADD SUB MUL DIV AND OR MOV NOT LAD STO，或直接给读写集合`);
}

/** 访问数存的指令：读或写 M(…)。 */
export function touchesMemory(ins: PipeInstruction): boolean {
  return [...ins.reads, ...ins.writes].some((loc) => loc.startsWith('M('));
}

export function registersOf(list: string[]): string[] {
  return list.filter(isRegister);
}

/** mulberry32：同一个种子给出同一串数。只给出题用。 */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 保留两位小数，去掉末尾的 0。 */
export function fmt(x: number, digits = 2): string {
  const text = x.toFixed(digits);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}
