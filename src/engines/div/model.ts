/**
 * 原码加减交替除法（教材 2.4，p48–54）。规格见 specs/2-div.md。
 *
 * 做法跟例 2.25：商符 q_f = x_f ⊕ y_f 单独算；数值部分是两个正的定点小数相除，要求 |x| < |y|。
 * 部分余数用 n+1 位、单符号位的补码：第 0 轮减 y（加 [−|y|]补）；余数 ≥ 0 上商 1，下一轮左移后减 y；
 * 余数 < 0 上商 0，下一轮左移后加 y；共 n+1 轮得 q_0…q_n。最后一位商是 0 时再加 y 纠余。
 * 余数等于最后的部分余数乘 2^-n，符号与被除数相同。
 *
 * rounds 是同一过程的阵列视图（图 2.10）：第 i 轮就是第 i 行 CAS，P 是这一行做加还是做减，
 * 最左单元的进位输出就是 q_i。状态路径（rounds.2.sum、q.3 等）是场景引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';
import {
  BitsError,
  NOTATION_NAME,
  type Bit,
  type Bits,
  type Notation,
  formatDecimal,
  formatValue,
  fromUnsigned,
  parseBits,
  parseValue,
  rippleAdd,
  toUnsigned,
} from '../../lib/bits';

export const ENGINE = 'div';
export const MIN_N = 2;
export const MAX_N = 12;

/** 真值：二进制数（+0.1011、-0.0111，整数写法 11000、-01011）。机器数：n+1 位原码，小数可带小数点。 */
export type OperandInput = { as: '真值'; text: string } | { as: '机器数'; bits: string };

export interface DivParams {
  n: number;
  /** 整数时先乘比例因子 2^-n 化成小数。 */
  notation: Notation;
  x: OperandInput;
  y: OperandInput;
}

export type Cell = '' | Bit;
export type Operation = '减 y' | '加 y';

/** 一轮，也是阵列除法器的一行。位串都是 n+1 位，写成 0.1011 的样子。 */
export interface Round {
  op: '' | Operation;
  /** 这一行 CAS 的控制线：1 做减法，0 做加法。 */
  p: Cell;
  /** 参加加减的部分余数：第 0 轮是 |x|，以后是左移后的余数。 */
  left: string;
  /** 加数：[−|y|]补 或 [|y|]原。 */
  addend: string;
  sum: string;
  /** 符号位向外的进位（阵列里每行最左单元的进位输出）。 */
  carry: Cell;
  q: Cell;
}

export interface DivState {
  /** [x]原、[y]原。 */
  x: string;
  y: string;
  sign: { xf: Cell; yf: Cell; qf: Cell };
  absX: string;
  absY: string;
  negY: string;
  /** 部分余数寄存器的当前内容。 */
  r: string;
  /** q[0…n]。 */
  q: Cell[];
  /** 下一轮要做的运算。 */
  next: '' | Operation;
  rounds: Round[];
  /** 纠余：needed 为 1 时 sum 是加 y 之后的余数。 */
  correction: { needed: Cell; sum: string };
  quotient: string;
  quotientValue: string;
  remainder: string;
  check: string;
}

export type DivTrace = Trace<DivParams, DivState>;

function fail(kind: 'format' | 'range', message: string): never {
  throw new BitsError(kind, message);
}

function xor(a: Bit, b: Bit): Bit {
  return a === b ? '0' : '1';
}

/** n+1 位位串写成 0.1011。 */
function show(bits: Bits): string {
  return `${bits.charAt(0)}.${bits.slice(1)}`;
}

function checkN(n: number): void {
  if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) fail('format', `n 必须是 ${MIN_N} 到 ${MAX_N} 的整数，收到 ${String(n)}`);
}

interface Operand {
  sign: Bit;
  magnitude: number;
  /** 化成小数后的真值写法。 */
  text: string;
  /** 题目原来的写法。 */
  given: string;
}

function readOperand(name: 'x' | 'y', input: OperandInput, n: number, notation: Notation): Operand {
  const raw: unknown = input;
  if (typeof raw !== 'object' || raw === null) fail('format', `缺少操作数 ${name}`);
  const limit = 2 ** n - 1;
  let sign: Bit;
  let magnitude: number;
  if (input.as === '真值') {
    if (typeof input.text !== 'string') fail('format', `${name} 的真值要写成字符串，如 +0.1011`);
    const units = parseValue(input.text, n, notation);
    sign = /^\s*[-−–]/.test(input.text) ? '1' : '0';
    magnitude = Math.abs(units);
  } else {
    if (input.as !== '机器数') fail('format', `${name} 的 as 只能是「真值」或「机器数」`);
    if (typeof input.bits !== 'string') fail('format', `${name} 的机器数要写成字符串，如 0.1011`);
    const parsed = parseBits(input.bits);
    if (parsed.bits.length !== n + 1) fail('format', `[${name}]原 应为 ${n + 1} 位，收到 ${parsed.bits.length} 位「${input.bits}」`);
    if (parsed.point !== null && (notation === '整数' || parsed.point !== 1)) {
      fail('format', notation === '整数' ? `定点整数的机器码不带小数点，收到「${input.bits}」` : `「${input.bits}」的小数点应在符号位后面`);
    }
    sign = parsed.bits.charAt(0) === '1' ? '1' : '0';
    magnitude = toUnsigned(parsed.bits.slice(1));
  }
  if (magnitude > limit) {
    const scale = notation === '整数' ? `${limit}` : `1 − 2^-${n}`;
    fail('range', `${name} 超出范围：${n} 位数值位的原码绝对值最大是 ${scale}`);
  }
  const signed = sign === '1' ? -magnitude : magnitude;
  const text = (sign === '1' && magnitude === 0 ? '−' : '') + formatValue(signed, n, '小数');
  const given = notation === '整数' ? (sign === '1' && magnitude === 0 ? '−' : '') + formatValue(signed, n, '整数') : text;
  return { sign, magnitude, text, given };
}

export interface DivSolution {
  xf: Bit;
  yf: Bit;
  qf: Bit;
  absX: Bits;
  absY: Bits;
  negY: Bits;
  rounds: { op: Operation; left: Bits; addend: Bits; sum: Bits; carry: Bit; q: Bit }[];
  corrected: Bits | null;
  /** 最后的部分余数（纠余之后），非负。 */
  final: Bits;
  /** 商的数值位 q_1…q_n。 */
  quotientBits: Bits;
  xUnits: number;
  yUnits: number;
  quotientUnits: number;
  /** 余数的绝对值，单位 2^-2n。 */
  remainderUnits: number;
}

function check(params: DivParams): { x: Operand; y: Operand } {
  const raw: unknown = params;
  if (typeof raw !== 'object' || raw === null) fail('format', '缺少参数');
  checkN(params.n);
  if (params.notation !== '小数' && params.notation !== '整数') fail('format', `写法只能是「小数」或「整数」，收到「${String(params.notation)}」`);
  const x = readOperand('x', params.x, params.n, params.notation);
  const y = readOperand('y', params.y, params.n, params.notation);
  if (y.magnitude === 0) fail('range', '除数是 0，不能除');
  if (x.magnitude >= y.magnitude) {
    fail('range', `|x| 不小于 |y|，商会大于等于 1，定点小数放不下。要求 |x| < |y|`);
  }
  return { x, y };
}

function solveWith(params: DivParams, x: Operand, y: Operand): DivSolution {
  const { n } = params;
  const absX = `0${fromUnsigned(x.magnitude, n)}`;
  const absY = `0${fromUnsigned(y.magnitude, n)}`;
  const negY = fromUnsigned(2 ** (n + 1) - y.magnitude, n + 1);
  const rounds: DivSolution['rounds'] = [];
  let r = absX;
  let op: Operation = '减 y';
  for (let i = 0; i <= n; i += 1) {
    const left = i === 0 ? absX : `${r.slice(1)}0`;
    const addend = op === '减 y' ? negY : absY;
    const added = rippleAdd(left, addend);
    const q: Bit = added.sum.charAt(0) === '0' ? '1' : '0';
    rounds.push({ op, left, addend, sum: added.sum, carry: added.carryOut, q });
    r = added.sum;
    op = q === '1' ? '减 y' : '加 y';
  }
  const corrected = r.charAt(0) === '1' ? rippleAdd(r, absY).sum : null;
  const final = corrected ?? r;
  const quotientBits = rounds
    .slice(1)
    .map((round) => round.q)
    .join('');
  return {
    xf: x.sign,
    yf: y.sign,
    qf: xor(x.sign, y.sign),
    absX,
    absY,
    negY,
    rounds,
    corrected,
    final,
    quotientBits,
    xUnits: x.magnitude,
    yUnits: y.magnitude,
    quotientUnits: toUnsigned(quotientBits),
    remainderUnits: toUnsigned(final),
  };
}

/** 只要答案、不要步骤时用。 */
export function solve(params: DivParams): DivSolution {
  const { x, y } = check(params);
  return solveWith(params, x, y);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenerateOptions {
  n?: number;
  notation?: Notation;
}

/** 出题：同一个种子得到同一组参数；保证 0 < |x| < |y|，符号随机。 */
export function generate(seed: number, options: GenerateOptions = {}): DivParams {
  if (!Number.isInteger(seed)) fail('format', `种子必须是整数，收到 ${String(seed)}`);
  const next = mulberry32(seed);
  const pick = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
  const n = options.n ?? pick(4, 6);
  checkN(n);
  const notation = options.notation ?? '小数';
  const yUnits = pick(2, 2 ** n - 1);
  const xUnits = pick(1, yUnits - 1);
  const signed = (units: number): OperandInput => ({ as: '真值', text: formatValue(next() < 0.5 ? -units : units, n, notation) });
  const x = signed(xUnits);
  const y = signed(yUnits);
  return { n, notation, x, y };
}

export function run(params: DivParams): DivTrace {
  const { x, y } = check(params);
  const { n, notation } = params;
  const s = solveWith(params, x, y);
  const remainderValue = formatValue(x.sign === '1' ? -s.remainderUnits : s.remainderUnits, 2 * n, '小数');
  const remainderText = x.sign === '1' && s.remainderUnits === 0 ? `−${remainderValue}` : remainderValue;
  const quotient = `${s.qf}.${s.quotientBits}`;
  const quotientValue = (s.qf === '1' && s.quotientUnits === 0 ? '−' : '') + formatValue(s.qf === '1' ? -s.quotientUnits : s.quotientUnits, n, '小数');
  const dec = (units: number, bits: number) => formatDecimal(units, bits, '小数');
  const checkText = `|x| = q·|y| + r：${dec(s.xUnits, n)} = ${dec(s.quotientUnits, n)} × ${dec(s.yUnits, n)} + ${dec(s.remainderUnits, 2 * n)}`;

  const initial: DivState = {
    x: '',
    y: '',
    sign: { xf: '', yf: '', qf: '' },
    absX: '',
    absY: '',
    negY: '',
    r: '',
    q: Array.from({ length: n + 1 }, (): Cell => ''),
    next: '',
    rounds: Array.from({ length: n + 1 }, (): Round => ({ op: '', p: '', left: '', addend: '', sum: '', carry: '', q: '' })),
    correction: { needed: '', sum: '' },
    quotient: '',
    quotientValue: '',
    remainder: '',
    check: '',
  };

  const conditions: Condition[] = [
    { label: '写法', value: notation === '整数' ? `${NOTATION_NAME.整数}，先乘比例因子 2^-${n} 化成小数` : NOTATION_NAME.小数 },
    { label: '数值位', value: `n = ${n}，商 q_0…q_${n} 共 ${n + 1} 位` },
    { label: 'x', value: x.given },
    { label: 'y', value: y.given },
    { label: '要求', value: '|x| < |y|，y ≠ 0' },
  ];

  const builder = new TraceBuilder<DivParams, DivState>(ENGINE, params, initial, conditions);
  let count = 0;
  const push = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };

  const columns = ['行', '符号位', ...Array.from({ length: n }, (_, i) => `2^-${i + 1}`), '判断', '上商'];
  const rows: SolutionTable['rows'] = [];
  const addRow = (label: string, bits: Bits, judge: string, note: string, step: string) => {
    rows.push({ cells: [label, ...bits.split(''), judge, note], step });
  };

  const xMachine = `${x.sign}.${fromUnsigned(x.magnitude, n)}`;
  const yMachine = `${y.sign}.${fromUnsigned(y.magnitude, n)}`;
  push({
    title: `写出 [x]原 = ${xMachine}，[y]原 = ${yMachine}，商符 q_f = ${s.xf} ⊕ ${s.yf} = ${s.qf}`,
    why:
      (notation === '整数' ? `两个整数同乘 2^-${n} 化成小数，商不变：x = ${x.text}，y = ${y.text}。` : '') +
      '原码的符号位和数值位分开处理：商的符号由两个符号位异或得出，数值部分只用两个绝对值相除。',
    ref: '教材 p49',
    update: (d) => {
      d.x = xMachine;
      d.y = yMachine;
      d.sign = { xf: s.xf, yf: s.yf, qf: s.qf };
    },
  });
  const writeStep = push({
    title: `[|x|]原 = ${show(s.absX)}，[|y|]原 = ${show(s.absY)}，[−|y|]补 = ${show(s.negY)}`,
    why: '机器不会估商，只能先减再看余数的符号。减 |y| 用加 [−|y|]补 来做：把 [|y|]原 连同符号位各位取反，末位加 1。',
    ref: '教材 p50',
    update: (d) => {
      d.absX = show(s.absX);
      d.absY = show(s.absY);
      d.negY = show(s.negY);
      d.r = show(s.absX);
    },
  });
  addRow('被除数 x', s.absX, '', '', writeStep);

  // 第一次「上一位商是 0」的那一轮问下一步做什么；没有就问第 1 轮。
  const firstAfterNegative = s.rounds.findIndex((round, i) => i > 0 && s.rounds[i - 1]!.q === '0');
  const askRound = firstAfterNegative > 0 ? firstAfterNegative : 1;

  for (let i = 0; i <= n; i += 1) {
    const round = s.rounds[i]!;
    if (i > 0) {
      const previous = s.rounds[i - 1]!;
      const shiftStep = push({
        title: `左移一位：${show(previous.sum)} → ${show(round.left)}`,
        why: '部分余数整体左移一位，最高位移出丢掉，最低位补 0。左移等于乘 2，相当于把除数相对右移一位，下一位商的权少一半。',
        ref: '教材 p50',
        update: (d) => {
          d.r = show(round.left);
          d.rounds[i]!.left = show(round.left);
        },
      });
      addRow('左移', round.left, '', '', shiftStep);
    }
    const subtract = round.op === '减 y';
    const ask: Ask | undefined =
      i === askRound
        ? {
            prompt: `上一位商是 ${s.rounds[i - 1]!.q}。左移之后这一轮做什么？`,
            kind: 'choice',
            options: ['减 y', '加 y'],
            answer: round.op,
            hint: '看上一轮余数的符号：余数为负时，本该先加回 y 再左移减 y，两步可以并成一步。',
          }
        : undefined;
    let why: string;
    if (i === 0) {
      why = '第一步总是减 y，看 |x| 够不够减。阵列除法器最上面一行的 P 固定接 1，也是这个道理。';
    } else if (subtract) {
      why = `上一位商是 1，余数为正，够减，这一轮接着减 y：r_${i} = 2r_${i - 1} − |y|。阵列里这一行的 P = 1。`;
    } else {
      why = `上一位商是 0，余数为负。本该先加 y 恢复，再左移减 y；而 2(r + |y|) − |y| = 2r + |y|，所以不恢复，直接左移后加 y。阵列里这一行的 P = 0。`;
    }
    const addStep = push({
      level: 'beat',
      title: `${round.op}：${show(round.left)} + ${show(round.addend)} = ${show(round.sum)}，符号位向外的进位 ${round.carry}`,
      why,
      ref: i === 0 ? '教材 p50、p52' : '教材 p50',
      ...(ask ? { ask } : {}),
      update: (d) => {
        d.r = show(round.sum);
        const target = d.rounds[i]!;
        target.op = round.op;
        target.p = subtract ? '1' : '0';
        if (i === 0) target.left = show(round.left);
        target.addend = show(round.addend);
        target.sum = show(round.sum);
        target.carry = round.carry;
        d.next = '';
      },
    });
    addRow(round.op, round.addend, '', '', addStep);

    const negative = round.q === '0';
    const zero = !negative && toUnsigned(round.sum) === 0;
    const nextOp: Operation = round.q === '1' ? '减 y' : '加 y';
    const isLast = i === n;
    const quotientStep = push({
      title: `余数${negative ? '为负' : zero ? '为 0' : '为正'}，上商 q_${i} = ${round.q}` + (isLast ? '' : `，下一轮左移后${nextOp}`),
      why:
        (negative ? '符号位是 1，不够减，商 0。' : '符号位是 0，够减，商 1。') +
        `符号位向外的进位也是 ${round.carry}：有进位结果为正，没进位结果为负，阵列除法器就用每行最左单元的这个进位当商位。`,
      ref: '教材 p50、p53',
      update: (d) => {
        d.q[i] = round.q;
        d.rounds[i]!.q = round.q;
        d.next = isLast ? '' : nextOp;
      },
    });
    addRow(negative ? '余数为负' : zero ? '余数为 0' : '余数为正', round.sum, negative ? '< 0' : zero ? '= 0' : '> 0', `q_${i} = ${round.q}`, quotientStep);
  }

  const askCorrection: Ask = {
    prompt: `q_${n} = ${s.rounds[n]!.q}，最后的余数是 ${show(s.rounds[n]!.sum)}。还要纠余吗？`,
    kind: 'choice',
    options: ['要，再加 y', '不要'],
    answer: s.corrected ? '要，再加 y' : '不要',
    hint: '余数必须与被除数同号，这里的数值部分都按正数算。',
  };
  if (s.corrected) {
    const corrected = s.corrected;
    const correctionStep = push({
      level: 'beat',
      title: `纠余：${show(s.rounds[n]!.sum)} + ${show(s.absY)} = ${show(corrected)}`,
      why: '最后一位商是 0，余数为负，后面没有下一轮来抵消，只好加 y 把余数恢复成正的。',
      ref: '教材 p50、p53',
      ask: askCorrection,
      update: (d) => {
        d.r = show(corrected);
        d.correction = { needed: '1', sum: show(corrected) };
      },
    });
    addRow('加 y', s.absY, '', '纠余', correctionStep);
    addRow(toUnsigned(corrected) === 0 ? '余数为 0' : '余数为正', corrected, toUnsigned(corrected) === 0 ? '= 0' : '> 0', '', correctionStep);
  }

  const shifted = `0.${'0'.repeat(n)}${s.final.slice(1)}`;
  push({
    title: `商 [q]原 = ${quotient}，余数 r = ${remainderText}`,
    why:
      `q_0 = 0 说明商小于 1；q_1…q_${n} 是商的数值位，前面接商符 ${s.qf}。` +
      `每轮左移都把余数放大了 2 倍，共 ${n} 次，所以最后的部分余数 ${show(s.final)} 要乘 2^-${n}，得 ${shifted}；余数和被除数同号。` +
      `验算：${checkText}。`,
    ref: '教材 p50、p54',
    ...(s.corrected ? {} : { ask: askCorrection }),
    update: (d) => {
      if (!s.corrected) d.correction = { needed: '0', sum: '' };
      d.quotient = quotient;
      d.quotientValue = quotientValue;
      d.remainder = remainderText;
      d.check = checkText;
    },
  });

  return builder.finish(
    {
      '[q]原': quotient,
      商的真值: quotientValue,
      余数: remainderText,
      验证: checkText,
    },
    { columns, rows },
  );
}
