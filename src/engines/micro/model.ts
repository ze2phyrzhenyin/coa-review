/**
 * 微程序控制器：图 5.21 的简单运算器、图 5.22 的 23 位微指令、图 5.24 的控制器框图，
 * 跑图 5.25 的「十进制加法」微程序（教材 5.4.1，p167–173）。
 * 另有 `runFields`：微指令各字段位数和控存容量（5.4.2，p173–177；习题 6、11；解析书 析8、析12、设5）。
 */
import { TraceBuilder, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'micro';
export const FIELDS_ENGINE = 'micro-fields';
export const WORD_BITS = 23;
export const ADDRESS_BITS = 4;
/** 寄存器、ALU 都按 4 位（一位 BCD 数字）。Cy 是最高位的进位。 */
export const DATA_BITS = 4;
export const LIMIT = 32;
export const FETCH_ADDRESS = '0000';

/** 图 5.22 第 1–17 位各是什么微命令（p168）。带撇的是电位信号，打入寄存器时再与 T4 相与（p169）。 */
export const COMMANDS: readonly string[] = [
  'LDR1′',
  'LDR2′',
  'LDR3′',
  'R1→X',
  'R1→Y',
  'R2→X',
  'R2→Y',
  'DR→X',
  'R3→Y',
  '+',
  'M',
  '−',
  'RD(D)′',
  'LDDR′',
  'LDIR′',
  'LDAR′',
  'PC+1',
];

const X_SOURCES: Readonly<Record<number, 'R1' | 'R2' | 'DR'>> = { 4: 'R1', 6: 'R2', 8: 'DR' };
const Y_SOURCES: Readonly<Record<number, 'R1' | 'R2' | 'R3'>> = { 5: 'R1', 7: 'R2', 9: 'R3' };
const FUNCTIONS: Readonly<Record<number, '+' | 'M' | '−'>> = { 10: '+', 11: 'M', 12: '−' };
const LOADS: Readonly<Record<number, 'R1' | 'R2' | 'R3'>> = { 1: 'R1', 2: 'R2', 3: 'R3' };
/** 引擎不模拟数存通路，这几位不能用。 */
const UNMODELLED = [13, 14, 16];

export interface StoreWord {
  /** 4 位微地址，如 1010。 */
  addr: string;
  /** 23 位微指令，可以带空格分段。 */
  word: string;
  /** 这条微指令做什么，只作显示。 */
  note?: string;
}

/** 图 5.25 的四条微指令（p170–172）。 */
export const BOOK_STORE: readonly StoreWord[] = [
  { addr: '0000', word: '000 000 000 000 00101 10 0000', note: '取指' },
  { addr: '1010', word: '010 100 100 100 00000 00 1001', note: 'R1+R2→R2' },
  { addr: '1001', word: '010 001 001 100 00000 01 0000', note: 'R2+R3→R2' },
  { addr: '0001', word: '010 011 000 001 00000 00 0000', note: 'R2−R1→R2' },
];

export interface MicroParams {
  /** 两个一位十进制数，0–9，执行前在 R2、R3。 */
  a: number;
  b: number;
  /** 指令操作码，4 位，缺省 1010（p171 的假定）。 */
  op?: string;
  /** 控制存储器的内容，缺省为图 5.25 的四条。 */
  store?: StoreWord[];
  /** R1 里的常数，缺省 6。 */
  r1?: number;
  /** DR 的内容，缺省 0。只有用到 DR→X 时有意义。 */
  dr?: number;
  /** 取指时 PC 的值，缺省 0。 */
  pc?: number;
}

export type Fn = '+' | 'M' | '−';

export interface Decoded {
  bits: string;
  commands: string[];
  x: 'R1' | 'R2' | 'DR' | null;
  y: 'R1' | 'R2' | 'R3' | null;
  fn: Fn | null;
  load: ('R1' | 'R2' | 'R3')[];
  ldir: boolean;
  pcPlus: boolean;
  p1: 0 | 1;
  p2: 0 | 1;
  next: string;
}

export interface MicroState {
  /** 控存：每个已用单元的微地址、23 位编码（分段写）和说明。 */
  cm: { addr: string; word: string; note: string }[];
  /** 微地址寄存器。 */
  uAR: string;
  /** 微命令寄存器：控制字段、P1、P2；下地址字段在 next。 */
  uIR: { control: string; p1: 0 | 1; p2: 0 | 1; next: string } | null;
  /** 这条微指令发出的微命令。 */
  commands: string[];
  reg: { R1: number; R2: number; R3: number; DR: number; PC: number; IR: string | null };
  alu: { x: string | null; y: string | null; fn: Fn | null; out: number | null };
  Cy: 0 | 1;
  /** 这个周期 T4 打入了哪些寄存器。 */
  loaded: string[];
  /** 已执行的微指令条数，也是 CPU 周期数。 */
  cycle: number;
  /** 地址转移逻辑这一拍的输入和输出。 */
  branch: { field: string; test: string; modified: string } | null;
  done: boolean;
}

const clean = (word: string): string => word.replace(/\s+/g, '');

/** 23 位分成 3、3、3、3、5 ｜ 2 ｜ 4 写，便于对照图 5.22 的位号。 */
export function groupWord(word: string): string {
  const w = clean(word);
  return `${w.slice(0, 3)} ${w.slice(3, 6)} ${w.slice(6, 9)} ${w.slice(9, 12)} ${w.slice(12, 17)} ${w.slice(17, 19)} ${w.slice(19, 23)}`;
}

/** 解一条 23 位微指令。不合法时抛出错误。 */
export function decode(word: string): Decoded {
  const bits = clean(word);
  if (!/^[01]{23}$/.test(bits)) throw new Error(`微指令要是 23 位二进制：${word}`);
  const on = (i: number): boolean => bits[i - 1] === '1';
  const commands = COMMANDS.filter((_, i) => on(i + 1));
  for (const i of UNMODELLED) if (on(i)) throw new Error(`第 ${i} 位 ${COMMANDS[i - 1]!} 要用数存通路，这个引擎只模拟图 5.21 的运算器`);
  const pickOne = <T>(table: Readonly<Record<number, T>>, what: string): T | null => {
    const hit = Object.keys(table).map(Number).filter(on);
    if (hit.length > 1) throw new Error(`${hit.map((i) => COMMANDS[i - 1]!).join('、')} 是相斥的微命令（${what}），不能在同一条微指令里`);
    return hit.length ? table[hit[0]!]! : null;
  };
  const x = pickOne(X_SOURCES, 'X 输入');
  const y = pickOne(Y_SOURCES, 'Y 输入');
  const fn = pickOne(FUNCTIONS, 'ALU 操作');
  const load = Object.keys(LOADS).map(Number).filter(on).map((i) => LOADS[i]!);
  if (load.length && !fn) throw new Error('有打入寄存器的微命令，却没有 ALU 操作');
  if (fn && !x) throw new Error(`ALU 做 ${fn} 要有 X 输入`);
  if ((fn === '+' || fn === '−') && !y) throw new Error(`ALU 做 ${fn} 要有 Y 输入`);
  return {
    bits,
    commands,
    x,
    y,
    fn,
    load,
    ldir: on(15),
    pcPlus: on(17),
    p1: on(18) ? 1 : 0,
    p2: on(19) ? 1 : 0,
    next: bits.slice(19),
  };
}

/** 地址转移逻辑（图 5.24）：P1 用 OP 修改微地址，P2 用 Cy 修改最后一位（p171–172）。 */
export function nextAddress(d: Pick<Decoded, 'p1' | 'p2' | 'next'>, op: string, cy: 0 | 1): string {
  let addr = parseInt(d.next, 2);
  if (d.p1) addr |= parseInt(op, 2);
  // 教材 p172 的约定：Cy=0 时下一条是 0001，Cy=1 时保持 0000，即 Cy=0 把最低位置 1。
  if (d.p2 && cy === 0) addr |= 1;
  return addr.toString(2).padStart(ADDRESS_BITS, '0');
}

/** ALU：4 位。只有 + 更新最高进位 Cy；− 取 X−Y 的低 4 位，M 把 X 原样送出，两者都不动 Cy。 */
export function alu(fn: Fn, x: number, y: number): { out: number; cy: 0 | 1 | null } {
  const mask = (1 << DATA_BITS) - 1;
  if (fn === 'M') return { out: x & mask, cy: null };
  if (fn === '−') return { out: (x - y) & mask, cy: null };
  const sum = x + y;
  return { out: sum & mask, cy: sum > mask ? 1 : 0 };
}

const nibble = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= 15;

export function checkMicro(p: MicroParams): string[] {
  const problems: string[] = [];
  for (const [name, v] of [['a', p.a], ['b', p.b]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 9) problems.push(`${name} 要是 0 到 9 的整数（一位 BCD 码）`);
  }
  if (p.op !== undefined && !/^[01]{4}$/.test(p.op)) problems.push('操作码要是 4 位二进制');
  if (p.r1 !== undefined && !nibble(p.r1)) problems.push('R1 要是 0 到 15 的整数');
  if (p.dr !== undefined && !nibble(p.dr)) problems.push('DR 要是 0 到 15 的整数');
  if (p.pc !== undefined && !(Number.isInteger(p.pc) && p.pc >= 0 && p.pc <= 255)) problems.push('PC 要是 0 到 255 的整数');
  const store = p.store ?? BOOK_STORE;
  const seen = new Set<string>();
  for (const w of store) {
    if (!/^[01]{4}$/.test(w.addr)) problems.push(`微地址 ${w.addr} 要是 4 位二进制`);
    if (seen.has(w.addr)) problems.push(`微地址 ${w.addr} 重复`);
    seen.add(w.addr);
    try {
      const d = decode(w.word);
      if (d.ldir && w.addr !== FETCH_ADDRESS) problems.push(`LDIR′ 只能在 ${FETCH_ADDRESS} 号取指微指令里`);
    } catch (e) {
      problems.push(`微地址 ${w.addr}：${(e as Error).message}`);
    }
  }
  if (!seen.has(FETCH_ADDRESS)) problems.push(`控存要有 ${FETCH_ADDRESS} 号取指微指令`);
  else if (!decode(store.find((w) => w.addr === FETCH_ADDRESS)!.word).ldir) problems.push(`${FETCH_ADDRESS} 号微指令要发 LDIR′ 取指`);
  return problems;
}

const bin = (v: number): string => v.toString(2).padStart(DATA_BITS, '0');
const show = (v: number): string => `${bin(v)}（${v}）`;

/** 执行一条机器指令：从 0000 号取指微指令起，回到 0000 为止。参数不合法时抛出错误。 */
export function run(params: MicroParams): Trace<MicroParams, MicroState> {
  const problems = checkMicro(params);
  if (problems.length) throw new Error(`微程序参数有问题：${problems.join('；')}`);
  const op = params.op ?? '1010';
  const store = [...(params.store ?? BOOK_STORE)].sort((x, y) => x.addr.localeCompare(y.addr));
  const byAddr = new Map(store.map((w) => [w.addr, w]));
  const initial: MicroState = {
    cm: store.map((w) => ({ addr: w.addr, word: groupWord(w.word), note: w.note ?? '' })),
    uAR: FETCH_ADDRESS,
    uIR: null,
    commands: [],
    reg: { R1: params.r1 ?? 6, R2: params.a, R3: params.b, DR: params.dr ?? 0, PC: params.pc ?? 0, IR: null },
    alu: { x: null, y: null, fn: null, out: null },
    Cy: 0,
    loaded: [],
    cycle: 0,
    branch: null,
    done: false,
  };
  const conditions: Condition[] = [
    { label: '机器指令', value: `十进制加法，操作码 ${op}，隐含寻址` },
    { label: '执行前', value: `R1=${initial.reg.R1}（常数），R2=a=${params.a}，R3=b=${params.b}，Cy=0` },
    { label: '字长', value: '寄存器和 ALU 都是 4 位，Cy 是最高位进位' },
    { label: '微指令', value: '23 位：1–17 位一位一个微命令，18、19 位是 P1、P2，20–23 位是下地址' },
    { label: 'P 测试', value: 'P1=1 用 OP 修改下地址；P2=1 时 Cy=0 把下地址最低位置 1' },
  ];
  const builder = new TraceBuilder<MicroParams, MicroState>(ENGINE, params, initial, conditions);
  let count = 0;
  const b = {
    get state(): MicroState {
      return builder.state;
    },
    step(input: Parameters<typeof builder.step>[0]): void {
      builder.step(input);
      count += 1;
    },
  };
  const rows: SolutionTable['rows'] = [];
  let addr = FETCH_ADDRESS;
  let executed = 0;
  let askedP1 = false;
  let askedP2 = false;
  for (;;) {
    if (executed >= LIMIT) throw new Error(`执行了 ${LIMIT} 条微指令还没回到取指微指令，微程序可能死循环`);
    const word = byAddr.get(addr);
    if (!word) throw new Error(`控存 ${addr} 号单元是空的，微程序跑丢了`);
    const d = decode(word.word);
    executed += 1;
    const cycleNo = executed;
    const readStep = `s${count + 1}`;
    b.step({
      level: 'cycle',
      title: `第 ${cycleNo} 个 CPU 周期：按微地址 ${addr} 读出微指令`,
      why: `微地址寄存器里是 ${addr}，控存读出这一单元的 23 位送进微指令寄存器。一个 CPU 周期执行一条微指令：上一周期的 T4 读出，这一周期 T1 打入（p173）。这条微指令发出 ${d.commands.length ? d.commands.join('、') : '（没有微命令）'}。`,
      ref: '教材 p168–170，图 5.22、图 5.24',
      focus: ['uAR', 'uIR', 'commands', `cm.${store.indexOf(word)}`],
      update: (s) => {
        s.uAR = addr;
        s.uIR = { control: d.bits.slice(0, 17), p1: d.p1, p2: d.p2, next: d.next };
        s.commands = d.commands;
        s.alu = { x: null, y: null, fn: null, out: null };
        s.loaded = [];
        s.branch = null;
        s.cycle = cycleNo;
      },
    });

    const effects: string[] = [];
    if (d.ldir) {
      b.step({
        level: 'beat',
        title: `指存读出十进制加法指令，打入 IR，OP=${op}`,
        why: `第 15 位 LDIR′ 在周期开头发出指存读命令，读出后再把 IBUS 上的指令打入 IR（p171）。`,
        ref: '教材 p171',
        update: (s) => {
          s.reg.IR = op;
        },
      });
      effects.push(`IR←指令（OP=${op}）`);
    }
    if (d.fn) {
      const st = b.state;
      const xv = st.reg[d.x!];
      const yv = d.y ? st.reg[d.y] : 0;
      const r = alu(d.fn, xv, yv);
      const expr = d.fn === 'M' ? `${d.x}=${xv}` : `${d.x}${d.fn}${d.y} = ${xv}${d.fn}${yv}`;
      const cyText =
        d.fn === 'M' ? 'M 只传送，Cy 不变' : d.fn === '−' ? '减法不改 Cy，Cy 留着上一次加法的进位' : r.cy ? '和超过 15，Cy=1' : '和不超过 15，Cy=0';
      b.step({
        level: 'beat',
        title: `ALU：${expr}，输出 ${show(r.out)}`,
        why: `${d.x}→X${d.y ? `、${d.y}→Y` : ''} 打开多路开关，${d.fn} 选定 ALU 操作；这些都是电位信号，T1 到 T3 一直有效，ALU 在这段时间里算完，结果在公共总线上稳定（p169 图 5.23）。${cyText}。`,
        ref: '教材 p168–169，图 5.21、图 5.23',
        update: (s) => {
          s.alu = { x: d.x, y: d.y, fn: d.fn, out: r.out };
          if (r.cy !== null) s.Cy = r.cy;
        },
      });
      if (d.load.length) {
        b.step({
          level: 'beat',
          title: `T4：${d.load.map((x) => `LD${x}`).join('、')} 把 ${show(r.out)}打入 ${d.load.join('、')}`,
          why: `${d.load.map((x) => `LD${x}′`).join('、')} 是电位信号，与 T4 相与成为打入脉冲，等总线上的结果稳定了才打入（p169）。`,
          ref: '教材 p169，图 5.23',
          update: (s) => {
            for (const target of d.load) s.reg[target] = r.out;
            s.loaded = [...d.load];
          },
        });
        effects.push(`${expr}→${d.load.join('、')}`);
      } else effects.push(`${expr}（不打入）`);
    }
    if (d.pcPlus) {
      b.step({
        level: 'beat',
        title: `PC+1：PC 由 ${b.state.reg.PC} 变为 ${b.state.reg.PC + 1}`,
        why: '第 17 位发出 PC+1，为取下一条机器指令做准备（p171）。',
        ref: '教材 p171',
        update: (s) => {
          s.reg.PC += 1;
        },
      });
      effects.push('PC+1');
    }

    const cy = b.state.Cy;
    const target = nextAddress(d, op, cy);
    const tests: string[] = [];
    if (d.p1) tests.push(`P1：用 OP ${op} 修改`);
    if (d.p2) tests.push(`P2：Cy=${cy}${cy === 0 ? '，最低位置 1' : '，不改'}`);
    const testText = tests.join('；') || '不测试';
    let whyNext: string;
    if (d.p1 && d.p2) whyNext = `P1、P2 都是 1，先按 OP 修改，再按 Cy 修改最低位。`;
    else if (d.p1) whyNext = `P1=1：取指之后要按指令的种类分支，地址转移逻辑把 IR 的 OP 字段并进下地址 ${d.next}，各条指令的微程序入口就在各自 OP 对应的微地址上（p171）。`;
    else if (d.p2) whyNext = `P2=1：测试进位 Cy。按教材的约定，Cy=0 时把下地址 ${d.next} 的最低位置成 1，Cy=1 时不改（p172）。${cy === 0 ? 'a+b+6 没有超过 15，说明 a+b 不超过 9，多加的 6 要减回去。' : 'a+b+6 超过 15，说明 a+b 大于 9，加 6 修正是对的，R2 已是结果。'}`;
    else whyNext = `P1、P2 都是 0，不测试，下地址字段 ${d.next} 就是下一条微指令的地址（p169）。`;
    const isEnd = target === FETCH_ADDRESS;
    const ask =
      d.p1 && !askedP1
        ? { prompt: '经过 P1 测试，下一条微指令的地址是多少', kind: 'bits' as const, answer: target, hint: '下地址字段和 OP 字段按位合在一起。' }
        : d.p2 && !askedP2
          ? { prompt: `Cy=${cy}，经过 P2 测试，下一条微指令的地址是多少`, kind: 'bits' as const, answer: target, hint: '看 Cy 是 0 还是 1，只动最低位。' }
          : null;
    if (d.p1) askedP1 = true;
    if (d.p2) askedP2 = true;
    b.step({
      level: 'explain',
      title: `下一条微地址 ${target}${isEnd && cycleNo > 1 ? '，回到取指微指令' : ''}`,
      why: `${whyNext}${isEnd && cycleNo > 1 ? '这条机器指令的微程序走完了，转入公操作，下一个 CPU 周期取下一条机器指令。' : ''}`,
      ref: d.p1 || d.p2 ? '教材 p169–172，图 5.24、图 5.25' : '教材 p169',
      focus: ['uAR', 'branch'],
      ...(ask ? { ask } : {}),
      update: (s) => {
        s.branch = { field: d.next, test: testText, modified: target };
        s.uAR = target;
        if (isEnd && cycleNo > 1) s.done = true;
      },
    });
    rows.push({
      cells: [String(cycleNo), addr, groupWord(d.bits), d.commands.join('，') || '—', effects.join('；') || '—', testText, target],
      step: readStep,
    });
    if (isEnd && cycleNo > 1) break;
    addr = target;
  }

  const last = b.state;
  const result: Record<string, string> = {
    R2: show(last.reg.R2),
    Cy: String(last.Cy),
    微指令条数: String(executed),
    执行路径: rows.map((r) => r.cells[1]!).join(' → '),
  };
  if (!params.store) result['十进制结果'] = `${params.a}+${params.b} = ${params.a + params.b}：个位 ${last.reg.R2}，向高位进位 ${last.Cy}`;
  return builder.finish(result, {
    columns: ['CPU 周期', '微地址', '微指令（1–17｜P1P2｜下地址）', '发出的微命令', '完成的操作', 'P 测试', '下一微地址'],
    rows,
  });
}

/** 朴素地算十进制加法应有的结果：个位和进位。 */
export function decimalSum(a: number, b: number): { digit: number; carry: 0 | 1 } {
  const s = a + b;
  return s > 9 ? { digit: s - 10, carry: 1 } : { digit: s, carry: 0 };
}

// ---------- 字段位数与控存容量 ----------

export type TestEncoding = '每个条件一位' | '编码';

export interface FieldParams {
  /** 直接表示的微命令个数，一位一个。 */
  direct?: number;
  /** 各相斥组里微命令的个数，每组编码成一个字段。 */
  groups?: number[];
  /** 转移条件个数。 */
  conditions?: number;
  /** 判别测试字段怎么算：每个条件一位，或把条件编码（留一个码表示不测试）。缺省每个条件一位。 */
  testEncoding?: TestEncoding;
  /** 微指令字长（位）。 */
  wordBits?: number;
  /** 控存单元数，2 的幂。 */
  cmWords?: number;
  /** 机器指令条数和平均每条的微指令数（含取指），取指微指令共用。 */
  program?: { instructions: number; perInstruction: number };
}

export interface FieldState {
  fields: { name: string; bits: number | null }[];
  wordBits: number | null;
  nextBits: number | null;
  testBits: number | null;
  controlBits: number | null;
  words: number | null;
  capacity: string | null;
}

export interface Fields {
  groupBits: number[];
  controlBits: number;
  testBits: number;
  nextBits: number;
  wordBits: number;
  words: number;
  capacityBits: number;
}

const log2ceil = (n: number): number => {
  let b = 0;
  while (1 << b < n) b += 1;
  return b;
};
const isPow2 = (n: number): boolean => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;

/** 一个含 k 个相斥微命令的字段要几位：留一个码表示不发命令，⌈log2(k+1)⌉（p174）。 */
export function groupBits(k: number): number {
  return log2ceil(k + 1);
}

/** 只算数，不出 Trace。参数不够或矛盾时抛出错误。 */
export function fields(p: FieldParams): Fields {
  const problems: string[] = [];
  const posInt = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v > 0;
  if (p.direct !== undefined && !(Number.isInteger(p.direct) && p.direct >= 0 && p.direct <= 200)) problems.push('直接表示的微命令个数要是 0 到 200 的整数');
  if (p.groups !== undefined && (!p.groups.every((g) => posInt(g) && g <= 1000) || p.groups.length > 20)) problems.push('每个相斥组要有 1 到 1000 个微命令，最多 20 组');
  if (p.conditions !== undefined && !(Number.isInteger(p.conditions) && p.conditions >= 0 && p.conditions <= 64)) problems.push('转移条件个数要是 0 到 64 的整数');
  if (p.wordBits !== undefined && !(posInt(p.wordBits) && p.wordBits <= 256)) problems.push('微指令字长要是 1 到 256 的整数');
  if (p.cmWords !== undefined && !(isPow2(p.cmWords) && p.cmWords <= 1 << 20)) problems.push('控存单元数要是 2 的幂，不超过 2^20');
  if (p.program !== undefined && !(posInt(p.program.instructions) && posInt(p.program.perInstruction) && p.program.instructions <= 4096 && p.program.perInstruction <= 64)) {
    problems.push('指令条数、每条的微指令数要是正整数');
  }
  if (p.testEncoding !== undefined && p.testEncoding !== '每个条件一位' && p.testEncoding !== '编码') problems.push('判别字段只能「每个条件一位」或「编码」');
  if (problems.length) throw new Error(`字段参数有问题：${problems.join('；')}`);
  const hasControl = p.direct !== undefined || p.groups !== undefined;
  const gb = (p.groups ?? []).map(groupBits);
  const conditions = p.conditions ?? 0;
  const testBits = conditions === 0 ? 0 : (p.testEncoding ?? '每个条件一位') === '编码' ? log2ceil(conditions + 1) : conditions;
  const programWords = p.program ? p.program.instructions * (p.program.perInstruction - 1) + 1 : null;
  let controlBits: number | null = hasControl ? (p.direct ?? 0) + gb.reduce((a, c) => a + c, 0) : null;
  let nextBits: number | null = p.cmWords !== undefined ? log2ceil(p.cmWords) : programWords !== null ? log2ceil(programWords) : null;
  let wordBits: number | null = p.wordBits ?? null;
  if (nextBits === null) {
    if (controlBits === null || wordBits === null) throw new Error('要算下地址字段，得知道控存单元数，或者同时知道微命令和字长');
    nextBits = wordBits - controlBits - testBits;
    if (nextBits < 1) throw new Error(`字长 ${wordBits} 位不够：微命令 ${controlBits} 位、判别 ${testBits} 位之后没有位置放下地址`);
  }
  if (controlBits === null) {
    if (wordBits === null) throw new Error('不知道微命令有多少，也不知道字长，算不出微命令字段');
    controlBits = wordBits - testBits - nextBits;
    if (controlBits < 1) throw new Error('字长减去判别字段和下地址字段后没有位置放微命令');
  }
  if (wordBits === null) wordBits = controlBits + testBits + nextBits;
  else if (wordBits !== controlBits + testBits + nextBits) {
    throw new Error(`字长 ${wordBits} 位与各字段之和 ${controlBits}+${testBits}+${nextBits} 对不上`);
  }
  if (programWords !== null && p.cmWords !== undefined && programWords > p.cmWords) throw new Error(`微程序要 ${programWords} 条微指令，控存只有 ${p.cmWords} 个单元`);
  const words = p.cmWords ?? programWords ?? 2 ** nextBits;
  return { groupBits: gb, controlBits, testBits, nextBits, wordBits, words, capacityBits: words * wordBits };
}

/** 逐步推出各字段位数和控存容量。 */
export function runFields(params: FieldParams): Trace<FieldParams, FieldState> {
  const f = fields(params);
  const conditions: Condition[] = [];
  if (params.direct !== undefined) conditions.push({ label: '直接表示的微命令', value: `${params.direct} 个` });
  if (params.groups) conditions.push({ label: '相斥组', value: params.groups.map((g) => `${g} 个`).join('、') });
  if (params.conditions !== undefined) conditions.push({ label: '转移条件', value: `${params.conditions} 个，${params.testEncoding ?? '每个条件一位'}` });
  if (params.wordBits !== undefined) conditions.push({ label: '微指令字长', value: `${params.wordBits} 位` });
  if (params.cmWords !== undefined) conditions.push({ label: '控存', value: `${params.cmWords} 个单元` });
  if (params.program) conditions.push({ label: '微程序', value: `${params.program.instructions} 条机器指令，平均每条 ${params.program.perInstruction} 条微指令（含取指）` });
  const initial: FieldState = { fields: [], wordBits: null, nextBits: null, testBits: null, controlBits: null, words: null, capacity: null };
  const builder = new TraceBuilder<FieldParams, FieldState>(FIELDS_ENGINE, params, initial, conditions);
  let count = 0;
  const b = {
    step(input: Parameters<typeof builder.step>[0]): void {
      builder.step(input);
      count += 1;
    },
  };
  const rows: SolutionTable['rows'] = [];
  const push = (cells: string[]): void => {
    rows.push({ cells, step: `s${count}` });
  };
  const hasControl = params.direct !== undefined || params.groups !== undefined;
  const programWords = params.program ? params.program.instructions * (params.program.perInstruction - 1) + 1 : null;

  if (params.direct) {
    b.step({
      level: 'explain',
      title: `直接表示：${params.direct} 个微命令占 ${params.direct} 位`,
      why: '相容的微命令可能同时发出，每个占一位，1 表示发出（p173–174）。',
      ref: '教材 p173–174',
      update: (s) => {
        s.fields.push({ name: '直接控制', bits: params.direct! });
      },
    });
    push(['直接控制', `${params.direct} 个`, `${params.direct}`]);
  }
  (params.groups ?? []).forEach((g, i) => {
    const bits = f.groupBits[i]!;
    b.step({
      level: 'explain',
      title: `第 ${i + 1} 组 ${g} 个相斥微命令：⌈log2(${g}+1)⌉ = ${bits} 位`,
      why: `同组的微命令不会同时发出，编成一个字段再译码。${g} 个微命令加一个「不发命令」的码共 ${g + 1} 种状态，${bits} 位能表示 ${2 ** bits} 种。`,
      ref: '教材 p174',
      update: (s) => {
        s.fields.push({ name: `第 ${i + 1} 组`, bits });
      },
    });
    push([`第 ${i + 1} 组`, `${g} 个`, `${bits}`]);
  });
  if (hasControl) {
    b.step({
      level: 'explain',
      title: `微命令字段共 ${f.controlBits} 位`,
      why: '各字段的位数相加。',
      ref: '教材 p174',
      update: (s) => {
        s.controlBits = f.controlBits;
      },
    });
  }
  if (params.conditions !== undefined) {
    const coded = (params.testEncoding ?? '每个条件一位') === '编码';
    b.step({
      level: 'explain',
      title: `判别测试字段 ${f.testBits} 位`,
      why: params.conditions === 0
        ? '没有转移条件，不设判别测试字段。'
        : coded
          ? `把 ${params.conditions} 个条件编码，再留一个码表示不测试，共 ${params.conditions + 1} 种，要 ${f.testBits} 位。`
          : `每个条件占一位（像图 5.22 的 P1、P2），${params.conditions} 个条件 ${f.testBits} 位。题目没说时要写明按哪种算。`,
      ref: '教材 p168–169，p175',
      update: (s) => {
        s.testBits = f.testBits;
        s.fields.push({ name: '判别测试', bits: f.testBits });
      },
    });
    push(['判别测试', `${params.conditions} 个条件`, `${f.testBits}`]);
  }
  if (programWords !== null) {
    b.step({
      level: 'explain',
      title: `微指令条数 = ${params.program!.instructions}×(${params.program!.perInstruction}−1)+1 = ${programWords}`,
      why: '取指微指令所有机器指令共用，只存一份；每条机器指令自己的微程序再占其余几条。',
      ref: '教材 p172–173，习题 6（p201）',
      update: (s) => {
        s.words = programWords;
      },
    });
    push(['微指令条数', `${params.program!.instructions} 条指令`, `${programWords}`]);
  }
  let nextWhy: string;
  if (params.cmWords !== undefined) nextWhy = `控存 ${params.cmWords} 个单元，下地址要能指到每一个，log2 ${params.cmWords} = ${f.nextBits} 位。`;
  else if (programWords !== null) nextWhy = `${programWords} 条微指令，下地址要能指到每一条，2^${f.nextBits} = ${2 ** f.nextBits} ≥ ${programWords}。`;
  else nextWhy = `字长减去微命令 ${f.controlBits} 位和判别 ${f.testBits} 位，剩下的都给下地址。`;
  b.step({
    level: 'explain',
    title: `下地址字段 ${f.nextBits} 位`,
    why: nextWhy,
    ref: '教材 p175',
    update: (s) => {
      s.nextBits = f.nextBits;
      s.fields.push({ name: '下地址', bits: f.nextBits });
    },
  });
  push(['下地址', '', `${f.nextBits}`]);
  if (!hasControl) {
    b.step({
      level: 'explain',
      title: `微命令字段 = ${f.wordBits}−${f.testBits}−${f.nextBits} = ${f.controlBits} 位`,
      why: '字长减去顺序控制部分（判别测试和下地址），剩下的是操作控制部分。',
      ref: '教材 p168',
      update: (s) => {
        s.controlBits = f.controlBits;
        s.fields.unshift({ name: '微命令', bits: f.controlBits });
      },
    });
    rows.unshift({ cells: ['微命令', '', `${f.controlBits}`], step: `s${count}` });
  }
  const capacity = `${f.words} × ${f.wordBits} 位`;
  b.step({
    level: 'explain',
    title: `字长 ${f.wordBits} 位，控存 ${capacity}`,
    why: params.cmWords !== undefined || programWords !== null ? '控存字长就是微指令字长，单元数由题目给出或由微指令条数定。' : `下地址 ${f.nextBits} 位能指到 2^${f.nextBits} = ${f.words} 个单元，控存就按这么多算。`,
    ref: '教材 p169–170',
    ask: { prompt: '控存一共有多少个单元', kind: 'number', answer: String(f.words) },
    update: (s) => {
      s.wordBits = f.wordBits;
      s.words = f.words;
      s.capacity = capacity;
    },
  });
  push(['字长', '', `${f.wordBits}`]);
  return builder.finish(
    {
      微命令字段: `${f.controlBits} 位`,
      判别测试字段: `${f.testBits} 位`,
      下地址字段: `${f.nextBits} 位`,
      字长: `${f.wordBits} 位`,
      控存容量: `${capacity}（${f.capacityBits} 位）`,
    },
    { columns: ['字段', '依据', '位数'], rows },
  );
}

// ---------- 出题 ----------

function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机出一道十进制加法：a、b 各取 0–9。 */
export function generate(seed: number): MicroParams {
  const r = generator(seed);
  return { a: Math.floor(r() * 10), b: Math.floor(r() * 10) };
}

/** 随机出一道字段题：几组相斥微命令、几个条件，给字长或给控存。 */
export function generateFields(seed: number): FieldParams {
  const r = generator(seed);
  const pick = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const groups = Array.from({ length: pick(2, 5) }, () => pick(2, 20));
  const direct = pick(0, 10);
  const conditions = pick(1, 6);
  const testEncoding: TestEncoding = r() < 0.5 ? '每个条件一位' : '编码';
  const control = direct + groups.map(groupBits).reduce((a, c) => a + c, 0);
  const test = testEncoding === '编码' ? log2ceil(conditions + 1) : conditions;
  if (r() < 0.5) return { direct, groups, conditions, testEncoding, wordBits: control + test + pick(6, 10) };
  return { direct, groups, conditions, testEncoding, cmWords: 2 ** pick(6, 10) };
}
