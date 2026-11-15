/**
 * 变形补码加减与溢出判断（教材 2.2.1–2.2.3，p34–38）。规格见 specs/2-overflow.md。
 *
 * 做法跟教材：写出 [x]变补、[y]变补（减法先求 [−y]变补）→ 竖式逐位相加，两个符号位一起参加 →
 * 丢掉最高符号位向外的进位 → 看两个符号位 V = S_f1 ⊕ S_f2 → 用 V = C_f ⊕ C_0 再判一次 → 结论。
 *
 * 竖式的列：每一行都有 n+3 格。第 0 格是最高符号位左边的「出界」格，只有进位行会用到；
 * 第 1 格是最高符号位 S_f1，第 2 格是第二符号位 S_f2，第 3 格起是 n 个数值位。
 * 进位行第 c 格写的是进入第 c 列的进位。状态路径（rows.sum.cells.2 等）是场景引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';
import {
  BitsError,
  NOTATION_NAME,
  type Bit,
  type Bits,
  type Notation,
  type OverflowKind,
  assertValueBits,
  bitAt,
  carryInto,
  codeRange,
  decodeModified,
  encodeModified,
  formatBits,
  formatDecimal,
  formatValue,
  fromUnsigned,
  invert,
  modifiedOverflow,
  negateByInvertAddOne,
  negateByScan,
  parseBits,
  parseValue,
  rippleAdd,
  toModified,
} from '../../lib/bits';

export const ENGINE = 'overflow';

export type Operation = '加' | '减';

/**
 * 操作数的两种给法。
 * 真值：二进制真值，教材的写法，如 +1010、-0111、-0.0111。
 * 机器数：n+1 位的补码或 n+2 位的变形补码，定点小数可带小数点，如 10111、11.0111。
 */
export type OperandInput = { as: '真值'; text: string } | { as: '机器数'; bits: string };

export interface OverflowParams {
  x: OperandInput;
  y: OperandInput;
  /** 数值位的位数，不含符号位。 */
  n: number;
  op: Operation;
  notation: Notation;
}

/** 一格：还没写时是空串。 */
export type Cell = '' | Bit;

export interface Row {
  label: string;
  cells: Cell[];
}

export const COLUMN_OUT = 0;
export const COLUMN_SF1 = 1;
export const COLUMN_SF2 = 2;
export const COLUMN_FIRST_VALUE = 3;

/** 减去最小负数时，竖式的进位行和加法器进位行的行名。解题表和状态里都用这两个名字。 */
export const MAIN_CARRY_LABEL_SPECIAL = '进位（此例不读 C_f、C_0）';
export const ADDER_CARRY_LABEL = '加法器进位（读 C_f、C_0）';

export interface OverflowState {
  rows: {
    /** [x]变补。 */
    x: Row;
    /** [y]变补。加法时它就是第二个加数。 */
    y: Row;
    /** 减法：[y]变补 各位取反。加法时为 null。 */
    inverted: Row | null;
    /** 减法：[−y]变补，竖式的第二个加数。加法时为 null。 */
    negY: Row | null;
    /** 进位行：第 c 格是进入第 c 列的进位，第 0 格是最高符号位向外的进位。 */
    carry: Row;
    /** 和：[x+y]变补 或 [x−y]变补。 */
    sum: Row;
  };
  /** 最高符号位向外的进位，按模丢掉。丢之前是空串。 */
  dropped: Cell;
  /** 结果的最高符号位、第二符号位。读出之前是空串。 */
  sf1: Cell;
  sf2: Cell;
  /** 单符号位判法用的两个进位：符号位产生的进位、最高数值位产生的进位。 */
  cf: Cell;
  c0: Cell;
  /** 溢出标志 V 的两种算法：S_f1 ⊕ S_f2 和 C_f ⊕ C_0。 */
  vBySign: Cell;
  vByCarry: Cell;
  /** 判定结果，判定之前是空串。 */
  verdict: '' | OverflowKind;
  /** 无溢出时结果的真值（教材写法）；溢出或还没到结论时是空串。 */
  value: string;
  conclusion: string;
  /**
   * 只在减去最小负数时有（其余为 null），在用进位再判一次那一步写出：按加法器做减法的办法重算的
   * 单符号位加法，C_f、C_0 从它的进位行读。列与竖式相同，单符号位放在 S_f2 那一列，
   * 所以 C_0 在第 2 格（符号位上方），C_f 在第 1 格；最右一格是最低位进的 1。
   */
  adder: AdderRows | null;
}

export interface AdderRows {
  /** 加法器的进位行，第 c 格是进入第 c 列的进位。 */
  carry: Row;
  /** [x]补（单符号位）。 */
  x: Row;
  /** [y]补 各位取反（单符号位）。 */
  notY: Row;
  /** 加法器的和，等于竖式结果的低 n+1 位。 */
  sum: Row;
}

/** 加法器重算的位串（单符号位，n+1 位）。 */
export interface AdderBits {
  x: Bits;
  notY: Bits;
  sum: Bits;
  /** n+1 位里每一位送出的进位，下标与位串相同；carries[0] 就是 C_f。 */
  carries: Bits;
}

interface Operand {
  units: number;
  modified: Bits;
  title: string;
  why: string;
  condition: Condition;
}

export interface OverflowSolution {
  n: number;
  width: number;
  op: Operation;
  notation: Notation;
  /** 两个操作数的真值，单位是最低位。 */
  xUnits: number;
  yUnits: number;
  xBits: Bits;
  yBits: Bits;
  /** 减法才有：[y]变补 各位取反、[−y]变补。 */
  invertedBits: Bits | null;
  negYBits: Bits | null;
  /** 竖式的第二个加数：加法是 [y]变补，减法是 [−y]变补。 */
  addendBits: Bits;
  sumBits: Bits;
  /** 每一位产生的进位，下标与位串相同。 */
  carries: Bits;
  /** 最高符号位向外的进位。 */
  carryOut: Bit;
  sf1: Bit;
  sf2: Bit;
  cf: Bit;
  c0: Bit;
  vBySign: Bit;
  vByCarry: Bit;
  /** C_f、C_0 是否就是进位行里的那两格。减法且 y 为最小负数时不是，见 specs/2-overflow.md。 */
  carriesFromRow: boolean;
  /** carriesFromRow 为 false 时：按加法器重算的那次加法。否则为 null。 */
  adder: AdderBits | null;
  verdict: OverflowKind;
  /** 数学上的结果（单位是最低位），由 n+2 位的和按补码读出。 */
  exactUnits: number;
}

function fail(kind: 'format' | 'range', message: string): never {
  throw new BitsError(kind, message);
}

function xor(a: Bit, b: Bit): Bit {
  return a === b ? '0' : '1';
}

function checkParams(params: OverflowParams): void {
  assertValueBits(params.n);
  if (params.op !== '加' && params.op !== '减') fail('format', `运算只能是「加」或「减」，收到「${String(params.op)}」`);
  if (params.notation !== '整数' && params.notation !== '小数') {
    fail('format', `写法只能是「整数」或「小数」，收到「${String(params.notation)}」`);
  }
}

/** 把题目给的操作数变成变形补码，同时准备好这一步的讲解。 */
function readOperand(name: 'x' | 'y', input: OperandInput, n: number, notation: Notation): Operand {
  const show = (bits: Bits) => formatBits(bits, notation, 2);
  const range = codeRange('补码', n);
  const raw: unknown = input;
  if (typeof raw !== 'object' || raw === null) fail('format', `缺少操作数 ${name}`);
  if (input.as === '真值') {
    if (typeof input.text !== 'string') fail('format', `${name} 的真值要写成字符串，如 +1010`);
    const units = parseValue(input.text, n, notation);
    const text = formatValue(units, n, notation);
    if (units < range.min || units > range.max) {
      fail(
        'range',
        `${name} = ${text} 超出范围：${n} 位数值位只能表示 ${formatValue(range.min, n, notation)} 到 ${formatValue(range.max, n, notation)}`,
      );
    }
    const modified = encodeModified(units, n);
    const valueBits = modified.slice(2);
    let why: string;
    if (units >= 0) {
      why = `${name} = ${text} 不是负数，两个符号位写 00，后面接 ${n} 位数值 ${valueBits}。`;
    } else if (units === range.min) {
      why = `${name} = ${text} 是 ${n} 位数值位能表示的最小负数：两个符号位写 11，数值位全是 0。`;
    } else {
      const magnitude = fromUnsigned(-units, n);
      why = `${name} = ${text} 是负数，两个符号位写 11。数值位由 ${magnitude} 各位取反得 ${invert(magnitude)}，末位加 1 得 ${valueBits}。`;
    }
    return { units, modified, title: `写出 [${name}]变补 = ${show(modified)}`, why, condition: { label: name, value: text } };
  }
  if (input.as !== '机器数') fail('format', `${name} 的 as 只能是「真值」或「机器数」`);
  if (typeof input.bits !== 'string') fail('format', `${name} 的机器数要写成字符串，如 10111`);
  const parsed = parseBits(input.bits);
  const length = parsed.bits.length;
  if (length !== n + 1 && length !== n + 2) {
    fail('format', `[${name}]补 应为 ${n + 1} 位，或写成 ${n + 2} 位的变形补码，收到 ${length} 位「${input.bits}」`);
  }
  const signBits = length - n;
  if (parsed.point !== null) {
    if (notation === '整数') fail('format', `定点整数的机器码不带小数点，收到「${input.bits}」`);
    if (parsed.point !== signBits) fail('format', `「${input.bits}」的小数点应在符号位后面、${n} 位数值位前面`);
  }
  if (signBits === 2 && modifiedOverflow(parsed.bits) !== '无溢出') {
    fail('range', `「${input.bits}」的两个符号位不同，它本身已经溢出，不能当作操作数`);
  }
  const modified = signBits === 2 ? parsed.bits : toModified(parsed.bits);
  const units = decodeModified(modified);
  const text = formatValue(units, n, notation);
  const given = formatBits(parsed.bits, notation, signBits);
  const why =
    signBits === 2
      ? `题目给的已经是变形补码，两个符号位相同，照抄。它表示 ${name} = ${text}。`
      : `题目给的 [${name}]补 = ${given} 只有一个符号位。把符号位 ${modified.charAt(0)} 再写一遍放到最前面，值不变，${name} = ${text}。`;
  return {
    units,
    modified,
    title: `写出 [${name}]变补 = ${show(modified)}`,
    why,
    condition: { label: signBits === 2 ? `[${name}]变补` : `[${name}]补`, value: given },
  };
}

function solveWith(params: OverflowParams, x: Operand, y: Operand): OverflowSolution {
  const { n, op, notation } = params;
  const width = n + 2;
  const negation = op === '减' ? negateByInvertAddOne(y.modified) : null;
  const addendBits = negation ? negation.result : y.modified;
  const added = rippleAdd(x.modified, addendBits);
  const sf1 = bitAt(added.sum, 0);
  const sf2 = bitAt(added.sum, 1);

  // 单符号位判法的两个进位。加数的两个符号位相同时，就是进位行里进入两个符号位列的进位。
  // 减法且 y 是最小负数时，−y 写不成 n+1 位补码，[−y]变补 的符号位是 01，进位行的两格不能直接用；
  // 这时按加法器的做法（教材 p39 图 2.3(b)，M=1）：[x]补 + [y]补 各位取反，最低位进 1。
  const carriesFromRow = modifiedOverflow(addendBits) === '无溢出';
  let cf: Bit;
  let c0: Bit;
  let adder: AdderBits | null = null;
  if (carriesFromRow) {
    cf = carryInto(added, 0);
    c0 = carryInto(added, 1);
  } else {
    const xTwos = x.modified.slice(1);
    const notY = invert(y.modified.slice(1));
    const sum = rippleAdd(xTwos, notY, '1');
    cf = sum.carryOut;
    c0 = carryInto(sum, 0);
    adder = { x: xTwos, notY, sum: sum.sum, carries: sum.carries };
  }

  return {
    n,
    width,
    op,
    notation,
    xUnits: x.units,
    yUnits: y.units,
    xBits: x.modified,
    yBits: y.modified,
    invertedBits: negation ? negation.inverted : null,
    negYBits: negation ? negation.result : null,
    addendBits,
    sumBits: added.sum,
    carries: added.carries,
    carryOut: added.carryOut,
    sf1,
    sf2,
    cf,
    c0,
    vBySign: xor(sf1, sf2),
    vByCarry: xor(cf, c0),
    carriesFromRow,
    adder,
    verdict: modifiedOverflow(added.sum),
    exactUnits: decodeModified(added.sum),
  };
}

/** 只要答案、不要步骤时用。结果全部由位运算得出，与 run 的 Trace 一致。 */
export function solve(params: OverflowParams): OverflowSolution {
  checkParams(params);
  return solveWith(params, readOperand('x', params.x, params.n, params.notation), readOperand('y', params.y, params.n, params.notation));
}

/** 用真值（单位是最低位）构造操作数参数，出题器和测试用。 */
export function operandFromUnits(units: number, n: number, notation: Notation): OperandInput {
  return { as: '真值', text: formatValue(units, n, notation) };
}

function emptyRow(label: string, width: number): Row {
  return { label, cells: Array.from({ length: width + 1 }, (): Cell => '') };
}

/** 位串放进一行：第 0 格（出界格）留空。 */
function cellsOf(bits: Bits): Cell[] {
  return ['', ...[...bits].map((_, i): Cell => bitAt(bits, i))];
}

const COLUMN_TOTAL_WHY = [
  '这一位的和是 0，写 0，没有进位。',
  '这一位的和是 1，不满 2，写 1，没有进位。',
  '这一位的和是 2，二进制是 10，本位写 0，1 进到左边一位。',
  '这一位的和是 3，二进制是 11，本位写 1，1 进到左边一位。',
] as const;

export function run(params: OverflowParams): Trace<OverflowParams, OverflowState> {
  checkParams(params);
  const { n, op, notation } = params;
  const x = readOperand('x', params.x, n, notation);
  const y = readOperand('y', params.y, n, notation);
  const solution = solveWith(params, x, y);
  const { width, sumBits, addendBits, verdict } = solution;

  const show = (bits: Bits) => formatBits(bits, notation, 2);
  const value = (units: number) => formatValue(units, n, notation);
  const decimal = (units: number) => formatDecimal(units, n, notation);
  const range = codeRange('补码', n);
  const modulus = notation === '整数' ? `2^${width}` : '4';
  const expression = op === '加' ? 'x + y' : 'x − y';
  const sumLabel = op === '加' ? '[x+y]变补' : '[x−y]变补';
  const addendKey = op === '加' ? 'y' : 'negY';

  const initial: OverflowState = {
    rows: {
      x: emptyRow('[x]变补', width),
      y: emptyRow('[y]变补', width),
      inverted: op === '减' ? emptyRow('[y]变补 各位取反', width) : null,
      negY: op === '减' ? emptyRow('[−y]变补', width) : null,
      carry: emptyRow('进位', width),
      sum: emptyRow(sumLabel, width),
    },
    dropped: '',
    sf1: '',
    sf2: '',
    cf: '',
    c0: '',
    vBySign: '',
    vByCarry: '',
    verdict: '',
    value: '',
    conclusion: '',
    adder: null,
  };

  const conditions: Condition[] = [
    { label: '写法', value: NOTATION_NAME[notation] },
    { label: '数值位', value: `n = ${n}` },
    { label: '运算', value: expression },
    x.condition,
    y.condition,
    { label: '变形补码', value: `${width} 位：2 个符号位加 ${n} 个数值位，模 ${modulus}` },
    { label: '表示范围', value: `${value(range.min)} 到 ${value(range.max)}` },
  ];

  const builder = new TraceBuilder<OverflowParams, OverflowState>(ENGINE, params, initial, conditions);
  let count = 0;
  const push = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };

  // 1. 写出两个操作数的变形补码
  const stepX = push({
    title: x.title,
    why: x.why,
    ref: '教材 p38',
    update: (s) => {
      s.rows.x.cells = cellsOf(x.modified);
    },
  });
  const stepY = push({
    title: y.title,
    why: op === '减' ? `${y.why}做减法要用它求 [−y]变补。` : y.why,
    ref: '教材 p38',
    update: (s) => {
      s.rows.y.cells = cellsOf(y.modified);
    },
  });

  // 2. 减法：由 [y]变补 求 [−y]变补，分「各位取反」「末位加 1」两小步
  let stepInverted = '';
  let stepAddend = stepY;
  if (solution.invertedBits !== null && solution.negYBits !== null) {
    const invertedBits = solution.invertedBits;
    const negYBits = solution.negYBits;
    stepInverted = push({
      title: `[y]变补 各位取反，得 ${show(invertedBits)}`,
      why: `减法按 x − y = x + (−y) 来做，依据是 [x−y]补 = [x]补 + [−y]补，所以要由 [y]变补 求出 [−y]变补。这是前一半：连同两个符号位，每一位 0 改成 1、1 改成 0。`,
      ref: '教材 p36 式(2.15)',
      update: (s) => {
        if (s.rows.inverted) s.rows.inverted.cells = cellsOf(invertedBits);
      },
    });
    const scan = negateByScan(y.modified);
    const parts = [
      `一个数加上它各位取反后的数，每一位都是 1；再加 1 就整个进到最高位以外，在模 ${modulus} 下等于 0。所以取反之后加 1，得到的正是 −y 的变形补码。`,
    ];
    if (notation === '小数') parts.push(`定点小数末位的权是 2^-${n}，加的就是 2^-${n}。`);
    if (scan.pivot < 0) {
      parts.push('这里 [y]变补 全是 0，加 1 时一路进位到最高位以外，丢掉后仍是全 0：0 的相反数还是 0。');
    } else {
      parts.push(`检查：从右往左找到 [y]变补 的第一个 1，它和它右边的位不变，左边各位取反，同样得到 ${show(scan.result)}。`);
    }
    if (!solution.carriesFromRow) {
      parts.push(`−y = ${value(-y.units)} 超过了 ${n} 位数值位的上限，所以这里的两个符号位是 01。${width} 位还放得下，可以照常相加。`);
    }
    stepAddend = push({
      title: `末位加 1，得 [−y]变补 = ${show(negYBits)}`,
      why: parts.join(''),
      ref: '教材 p36 式(2.16)；从右找第一个 1 的做法见 p46',
      update: (s) => {
        if (s.rows.negY) s.rows.negY.cells = cellsOf(negYBits);
      },
    });
  }

  // 3. 从最低位起逐位相加，一列一步
  const added = rippleAdd(solution.xBits, addendBits);
  let stepFirstColumn = '';
  for (let i = width - 1; i >= 0; i -= 1) {
    const column = i + 1;
    const a = bitAt(solution.xBits, i);
    const b = bitAt(addendBits, i);
    const lowest = i === width - 1;
    const carryIn = carryInto(added, i);
    const carryOut = bitAt(added.carries, i);
    const digit = bitAt(sumBits, i);
    const total = Number(a) + Number(b) + Number(carryIn);
    const name = i === 0 ? '最高符号位' : i === 1 ? '第二符号位' : `右起第 ${width - i} 位`;
    const lead =
      i === 0
        ? '最高符号位同样当作一位数来加。'
        : i === 1
          ? '符号位和数值位一样参加相加，最高数值位送来的进位也要加进去。'
          : lowest
            ? '最低位右边没有别的位，没有进位进来。'
            : '';
    let totalWhy: string = COLUMN_TOTAL_WHY[total] ?? '';
    if (i === 0 && carryOut === '1') totalWhy = totalWhy.replace('1 进到左边一位。', '1 进到最高符号位以外。');
    let ask: Ask | undefined;
    if (i === 1) {
      ask = {
        prompt: `数值位已经加完，最高数值位送给符号位的进位是 ${carryIn}。把剩下两位加完，结果的两个符号位是什么？`,
        kind: 'bits',
        answer: sumBits.slice(0, 2),
        hint: '符号位和数值位一样逐列相加，从第二符号位加起，别漏掉送进来的进位。',
      };
    }
    const id = push({
      level: 'beat',
      title: `${name}：${a} 加 ${b}${lowest ? '' : ` 加进位 ${carryIn}`}，写 ${digit}，${carryOut === '1' ? '向左进 1' : '不进位'}`,
      why: lead + totalWhy,
      ref: i <= 1 ? '教材 p38' : '教材 p35',
      focus: [
        `rows.x.cells.${column}`,
        `rows.${addendKey}.cells.${column}`,
        ...(lowest ? [] : [`rows.carry.cells.${column}`]),
        `rows.sum.cells.${column}`,
        `rows.carry.cells.${column - 1}`,
      ],
      ...(ask ? { ask } : {}),
      update: (s) => {
        s.rows.sum.cells[column] = digit;
        s.rows.carry.cells[column - 1] = carryOut;
      },
    });
    if (lowest) stepFirstColumn = id;
  }

  // 4. 丢掉最高符号位向外的进位
  const stepDrop = push({
    title:
      solution.carryOut === '1'
        ? `丢掉最高符号位向外的进位 1，${sumLabel} = ${show(sumBits)}`
        : `最高符号位没有向外进位，${sumLabel} = ${show(sumBits)}`,
    why:
      solution.carryOut === '1'
        ? `变形补码按模 ${modulus} 运算，结果只留 ${width} 位。这个进位的权正好是一个模，丢掉它，结果在模 ${modulus} 下不变。丢进位和溢出是两回事：有没有溢出要看结果的两个符号位。`
        : `变形补码按模 ${modulus} 运算，结果只留 ${width} 位。这次没有超出 ${width} 位的进位，没有要丢的。有没有这个进位都不说明是否溢出，要看结果的两个符号位。`,
    ref: '教材 p38',
    focus: [`rows.carry.cells.${COLUMN_OUT}`, 'dropped'],
    update: (s) => {
      s.dropped = solution.carryOut;
    },
  });

  // 5. 看两个符号位：V = S_f1 ⊕ S_f2
  const { sf1, sf2 } = solution;
  const signFormula = `V = S_f1 ⊕ S_f2 = ${sf1} ⊕ ${sf2} = ${solution.vBySign}`;
  const decideWhy =
    verdict === '无溢出'
      ? `${signFormula}。两个符号位相同，结果没有超出范围，${sf1 === '0' ? '不是负数' : '是负数'}。`
      : verdict === '正溢'
        ? `${signFormula}，有溢出。最高符号位 S_f1 始终是结果的真实符号，它是 0，真实结果为正，数值超过了上限，所以是正溢。`
        : `${signFormula}，有溢出。最高符号位 S_f1 始终是结果的真实符号，它是 1，真实结果为负，低于下限，所以是负溢。`;
  push({
    title: `结果的符号位是 ${sf1}${sf2}，两位${verdict === '无溢出' ? '相同' : '不同'}，${verdict}`,
    why: decideWhy,
    ref: '教材 p38',
    focus: [`rows.sum.cells.${COLUMN_SF1}`, `rows.sum.cells.${COLUMN_SF2}`, 'sf1', 'sf2', 'vBySign', 'verdict'],
    ask: {
      prompt: `结果的两个符号位是 ${sf1}${sf2}，这次运算属于哪一种？`,
      kind: 'choice',
      options: ['无溢出', '正溢', '负溢'],
      answer: verdict,
      hint: '比较两个符号位是否相同；不同时结果的符号看最高符号位。',
    },
    update: (s) => {
      s.sf1 = sf1;
      s.sf2 = sf2;
      s.vBySign = solution.vBySign;
      s.verdict = verdict;
    },
  });

  // 6. 用进位再判一次：V = C_f ⊕ C_0
  const { cf, c0 } = solution;
  const carryFormula = `V = C_f ⊕ C_0 = ${cf} ⊕ ${c0} = ${solution.vByCarry}`;
  // 用进位判时怎样分正溢、负溢：两个进位不同才溢出，看是哪一个进位是 1。
  const carryJudge =
    solution.vByCarry === '0'
      ? `两个进位相同，${verdict}。`
      : `两个进位不同就是溢出：C_f = 0、C_0 = 1 是正溢，C_f = 1、C_0 = 0 是负溢。这里 C_f = ${cf}、C_0 = ${c0}，是${verdict}。`;
  const adderBits = solution.adder;
  const adderRows: AdderRows | null = adderBits
    ? {
        carry: {
          label: ADDER_CARRY_LABEL,
          cells: ['', bitAt(adderBits.carries, 0), ...[...adderBits.x].map((_, i): Cell => (i === n ? '1' : bitAt(adderBits.carries, i + 1)))],
        },
        x: { label: '[x]补', cells: ['', '', ...[...adderBits.x].map((_, i): Cell => bitAt(adderBits.x, i))] },
        notY: { label: '+ [y]补 各位取反', cells: ['', '', ...[...adderBits.notY].map((_, i): Cell => bitAt(adderBits.notY, i))] },
        sum: { label: '加法器的和', cells: ['', '', ...[...adderBits.sum].map((_, i): Cell => bitAt(adderBits.sum, i))] },
      }
    : null;
  const stepConfirm = push({
    title: `用进位再判一次：${carryFormula}`,
    why: adderRows
      ? `单符号位判法要求两个加数都是合法的 ${n + 1} 位补码。这里 −y = ${value(-y.units)} 写不成 ${n + 1} 位补码，上面进位行里的两格不能当作 C_f、C_0。改用加法器做减法的办法重算，写在解题表下面另起的几行：[x]补 加上 [y]补 各位取反，最低位再进 1。在这几行的进位行里，符号位那一列上方是 C_0 = ${c0}，再左一列是 C_f = ${cf}。加法器的和 ${formatBits(adderBits!.sum, notation, 1)} 与上面结果的低 ${n + 1} 位相同。${carryJudge}与两个符号位的结论一致。`
      : `去掉最高符号位，剩下的就是单符号位的补码加法。C_0 是最高数值位送进符号位的进位，写在进位行第二符号位上方，这里是 ${c0}；C_f 是符号位再向左送出的进位，写在最高符号位上方，这里是 ${cf}。${carryJudge}两个加数各自的两个符号位相同，结果的两个符号位只会因为这两个进位不同而不同，所以两种判法结论总是一致。`,
    ref: adderRows ? '教材 p38、p39 图2.3(b)' : '教材 p38',
    focus: adderRows
      ? [`adder.carry.cells.${COLUMN_SF1}`, `adder.carry.cells.${COLUMN_SF2}`, 'cf', 'c0', 'vByCarry']
      : [`rows.carry.cells.${COLUMN_SF1}`, `rows.carry.cells.${COLUMN_SF2}`, 'cf', 'c0', 'vByCarry'],
    update: (s) => {
      s.cf = cf;
      s.c0 = c0;
      s.vByCarry = solution.vByCarry;
      if (adderRows) {
        s.adder = adderRows;
        s.rows.carry.label = MAIN_CARRY_LABEL_SPECIAL;
      }
    },
  });

  // 7. 结论
  const exact = solution.exactUnits;
  const exactText = value(exact);
  const valueBits = sumBits.slice(2);
  let conclusionTitle: string;
  let conclusionWhy: string;
  let conclusion: string;
  if (verdict === '无溢出') {
    conclusionTitle = `结论：无溢出，${expression} = ${exactText}`;
    conclusion = `无溢出，${expression} = ${exactText}`;
    if (sf1 === '0') {
      conclusionWhy = `符号位 00 表示结果不是负数，${n} 位数值位 ${valueBits} 就是真值的数值：${expression} = ${exactText}，十进制 ${decimal(exact)}。`;
    } else if (exact === range.min) {
      conclusionWhy = `符号位 11、数值位全是 0，是 ${n} 位数值位能表示的最小负数：${expression} = ${exactText}，十进制 ${decimal(exact)}。`;
    } else {
      conclusionWhy = `符号位 11 表示负数。数值位 ${valueBits} 各位取反、末位加 1 得 ${fromUnsigned(-exact, n)}，这是绝对值：${expression} = ${exactText}，十进制 ${decimal(exact)}。`;
    }
  } else if (verdict === '正溢') {
    conclusionTitle = `结论：正溢，这 ${width} 位里的数值不能当结果`;
    conclusion = `正溢，${expression} = ${exactText} 超出上限 ${value(range.max)}`;
    conclusionWhy = `按真值算，${expression} = ${exactText}，十进制 ${decimal(exact)}。${n} 位数值位最大只能表示 ${value(range.max)}，十进制 ${decimal(range.max)}。结果超出上限，多出的一位数值挤进了第二符号位，符号位才成了 01。`;
  } else {
    conclusionTitle = `结论：负溢，这 ${width} 位里的数值不能当结果`;
    conclusion = `负溢，${expression} = ${exactText} 低于下限 ${value(range.min)}`;
    conclusionWhy = `按真值算，${expression} = ${exactText}，十进制 ${decimal(exact)}。${n} 位数值位最小只能表示 ${value(range.min)}，十进制 ${decimal(range.min)}。结果低于下限，第二符号位被数值占了，符号位才成了 10。`;
  }
  push({
    title: conclusionTitle,
    why: conclusionWhy,
    ref: '教材 p37',
    update: (s) => {
      s.value = verdict === '无溢出' ? exactText : '';
      s.conclusion = conclusion;
    },
  });

  // 纸面竖式：一位一列，定点小数在符号位后面多一列小数点
  const weights = Array.from({ length: n }, (_, k) => (notation === '整数' ? `2^${n - 1 - k}` : `2^-${k + 1}`));
  const point = notation === '小数';
  const columns = ['', '出界', 'S_f1', 'S_f2', ...(point ? ['.'] : []), ...weights];
  const line = (label: string, cells: readonly string[], dot: string): string[] => [
    label,
    ...cells.slice(0, COLUMN_FIRST_VALUE),
    ...(point ? [dot] : []),
    ...cells.slice(COLUMN_FIRST_VALUE),
  ];
  // 进位行第 c 格是进入第 c 列的进位，也就是右边一位送出的进位；最右一列没有进位进来。
  const carryCells: string[] = [...added.carries, ''];
  const table: SolutionTable = { columns, rows: [] };
  if (solution.invertedBits !== null && solution.negYBits !== null) {
    table.rows.push({ cells: line('[y]变补', cellsOf(solution.yBits), '.'), step: stepY });
    table.rows.push({ cells: line('各位取反', cellsOf(solution.invertedBits), '.'), step: stepInverted });
  }
  table.rows.push({ cells: line(adderRows ? MAIN_CARRY_LABEL_SPECIAL : '进位', carryCells, ''), step: stepFirstColumn });
  table.rows.push({ cells: line('[x]变补', cellsOf(solution.xBits), '.'), step: stepX });
  table.rows.push({ cells: line(op === '加' ? '+ [y]变补' : '+ [−y]变补', cellsOf(addendBits), '.'), step: stepAddend });
  table.rows.push({ cells: line(sumLabel, cellsOf(sumBits), '.'), step: stepDrop });
  // 减去最小负数：在竖式下面另起几行，写加法器重算的那次加法，C_f、C_0 从它的进位行读。
  if (adderRows) {
    table.rows.push({ cells: line(adderRows.carry.label, adderRows.carry.cells, ''), step: stepConfirm });
    table.rows.push({ cells: line(adderRows.x.label, adderRows.x.cells, '.'), step: stepConfirm });
    table.rows.push({ cells: line(adderRows.notY.label, adderRows.notY.cells, '.'), step: stepConfirm });
    table.rows.push({ cells: line(adderRows.sum.label, adderRows.sum.cells, '.'), step: stepConfirm });
  }

  const result: Record<string, string> = {
    结果的变形补码: show(sumBits),
    是否溢出: verdict,
  };
  if (verdict === '无溢出') result['真值'] = exactText;

  return builder.finish(result, table);
}
