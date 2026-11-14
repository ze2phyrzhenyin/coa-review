/**
 * 阵列乘法（教材 2.3，p43–48）。规格见 specs/2-mul.md。
 *
 * 做法跟教材：与门同时产生 n² 个位积 a_i·b_j → 图 2.7 的全加器阵列，前 n−1 行逐行相加（同一行的全加器同时工作），
 * 最后一行是行波进位加法器 → 得到 2n 位积 P。带符号时外面套图 2.9 的三个求补器：
 * 两个算前求补器取绝对值，算后求补器在两数异号时把积变回补码，符号位 p_2n = x_f ⊕ y_f 单独算。
 *
 * 全加器的编号：rows[r][k]，r = 0…n−1 是行（最后一行是行波进位加法器），k = 0…n−2 自右向左，权是 r+1+k。
 * 状态路径（rows.2.1.sum、products.3.0、p.7 等）是场景引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';
import { BitsError, type Bit, type Bits, decode, encode, formatValue, fromUnsigned, fullAdd, parseBits, parseValue, toUnsigned } from '../../lib/bits';

export const ENGINE = 'mul';

export type MulMode = '无符号' | '原码' | '补码';
export const MODES: readonly MulMode[] = ['无符号', '原码', '补码'];
export const MIN_N = 2;
export const MAX_N = 8;

/**
 * 操作数的两种给法。真值：二进制定点整数（+1111、-1101；无符号不带负号，如 11011）。
 * 机器数：带符号时是 n+1 位原码或补码，无符号时是 n 位。
 */
export type OperandInput = { as: '真值'; text: string } | { as: '机器数'; bits: string };

export interface MulParams {
  mode: MulMode;
  /** 阵列是 n 位 × n 位。带符号时操作数另有 1 个符号位。 */
  n: number;
  x: OperandInput;
  y: OperandInput;
}

export type Cell = '' | Bit;

export interface FullAdder {
  /** 权：这个全加器的和落在 2^weight 那一列。 */
  weight: number;
  /** 三个输入各从哪里来，固定不变（如 a3b0、上一行的和、上一行的进位、右邻的进位、0）。 */
  from: { top: string; right: string; diag: string };
  top: Cell;
  right: Cell;
  diag: Cell;
  sum: Cell;
  carry: Cell;
}

/** 对 2 求补器（图 2.8）。位串左边是高位。 */
export interface Complementer {
  input: string;
  /** 使能：1 求补，0 原样通过。 */
  e: Cell;
  /** 扫描链 C_i = a_i + C_{i−1}，与 input 对齐。 */
  chain: string;
  output: string;
}

export interface MulState {
  /** 题目给的两个机器数（无符号时就是 A、B）。 */
  x: string;
  y: string;
  /** 带符号时：两个符号位和积的符号位 p_2n。无符号时为 null。 */
  sign: { xf: Cell; yf: Cell; pf: Cell } | null;
  /** 带符号时的两个算前求补器。无符号时为 null。 */
  pre: { x: Complementer; y: Complementer } | null;
  /** 进入阵列的两个 n 位数 A、B。 */
  a: string;
  b: string;
  /** products[j][i] = a_i·b_j。 */
  products: Cell[][];
  rows: FullAdder[][];
  /** p[k] 是积的第 k 位（权 2^k），k = 0…2n−1。 */
  p: Cell[];
  /** 带符号时的算后求补器（2n 位）。无符号时为 null。 */
  post: Complementer | null;
  /** 最后的积：无符号是 P（2n 位），带符号是 [x×y]原 或 [x·y]补（2n+1 位）。 */
  product: string;
  value: string;
  decimal: string;
  delay: string;
  /** 最长延迟路径上的全加器（状态路径 rows.r.k），延迟那一步写入。 */
  path: string[];
}

export type MulTrace = Trace<MulParams, MulState>;

function fail(kind: 'format' | 'range', message: string): never {
  throw new BitsError(kind, message);
}

function xor(a: Bit, b: Bit): Bit {
  return a === b ? '0' : '1';
}

function and(a: Cell, b: Cell): Bit {
  return a === '1' && b === '1' ? '1' : '0';
}

function bit(bits: string, index: number): Bit {
  return bits.charAt(index) === '1' ? '1' : '0';
}

/** 第 i 位（权 2^i）。 */
function weightBit(bits: string, i: number): Bit {
  return bit(bits, bits.length - 1 - i);
}

/** 图 2.8 的对 2 求补器：C_{−1} = 0，C_i = a_i + C_{i−1}，a_i* = a_i ⊕ E·C_{i−1}。 */
export function complement(input: Bits, e: Bit): Complementer {
  let carry = '0' as Bit;
  const chain: Bit[] = [];
  const output: Bit[] = [];
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const a = bit(input, i);
    output[i] = xor(a, and(e, carry));
    carry = a === '1' || carry === '1' ? '1' : '0';
    chain[i] = carry;
  }
  return { input, e, chain: chain.join(''), output: output.join('') };
}

function checkN(n: number): void {
  if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) fail('format', `n 必须是 ${MIN_N} 到 ${MAX_N} 的整数，收到 ${String(n)}`);
}

interface Operand {
  bits: Bits;
  units: number;
  text: string;
}

/** 把题目给的操作数读成机器数和真值。 */
function readOperand(name: 'x' | 'y', input: OperandInput, mode: MulMode, n: number): Operand {
  const raw: unknown = input;
  if (typeof raw !== 'object' || raw === null) fail('format', `缺少操作数 ${name}`);
  const width = mode === '无符号' ? n : n + 1;
  if (input.as === '真值') {
    if (typeof input.text !== 'string') fail('format', `${name} 的真值要写成字符串，如 +1101`);
    const units = parseValue(input.text, n, '整数');
    if (mode === '无符号') {
      if (/^\s*[-−–]/.test(input.text)) fail('range', `无符号数不带负号，收到 ${name} = ${input.text}`);
      if (units >= 2 ** n) fail('range', `${name} 超出范围：${n} 位无符号数只能是 0 到 ${2 ** n - 1}`);
      return { bits: fromUnsigned(units, n), units, text: fromUnsigned(units, n) };
    }
    const negativeZero = units === 0 && /^\s*[-−–]/.test(input.text);
    const bits = encode(mode, units, n, { negativeZero: mode === '原码' && negativeZero });
    return { bits, units, text: formatValue(units, n, '整数') };
  }
  if (input.as !== '机器数') fail('format', `${name} 的 as 只能是「真值」或「机器数」`);
  if (typeof input.bits !== 'string') fail('format', `${name} 的机器数要写成字符串，如 10011`);
  const parsed = parseBits(input.bits);
  if (parsed.point !== null) fail('format', `这里只用定点整数，机器数不带小数点，收到「${input.bits}」`);
  if (parsed.bits.length !== width) {
    fail('format', `${mode === '无符号' ? name : `[${name}]${mode === '原码' ? '原' : '补'}`} 应为 ${width} 位，收到 ${parsed.bits.length} 位「${input.bits}」`);
  }
  const units = mode === '无符号' ? toUnsigned(parsed.bits) : decode(mode, parsed.bits);
  return { bits: parsed.bits, units, text: mode === '无符号' ? parsed.bits : formatValue(units, n, '整数') };
}

function checkParams(params: MulParams): { x: Operand; y: Operand } {
  const raw: unknown = params;
  if (typeof raw !== 'object' || raw === null) fail('format', '缺少参数');
  if (!MODES.includes(params.mode)) fail('format', `模式只能是 无符号、原码、补码，收到「${String(params.mode)}」`);
  checkN(params.n);
  const x = readOperand('x', params.x, params.mode, params.n);
  const y = readOperand('y', params.y, params.mode, params.n);
  if (params.mode === '补码') {
    for (const [name, op] of [['x', x], ['y', y]] as const) {
      if (op.units === -(2 ** params.n)) {
        fail('range', `${name} = ${op.text} 是 ${params.n} 位数值位的最小负数，它的绝对值要 ${params.n + 1} 位，${params.n} 位算前求补器给不出来`);
      }
    }
    if ((x.units === 0 && y.units < 0) || (y.units === 0 && x.units < 0)) {
      fail('range', '补码里 0 乘负数时，算后求补器把全 0 的积原样送出，符号位却是 1，拼出来是 −2^2n，不是 0；这种情况不演示');
    }
  }
  return { x, y };
}

/** 阵列本身：位积、每个全加器、积的每一位。 */
export interface ArrayResult {
  products: Bit[][];
  rows: (FullAdder & { top: Bit; right: Bit; diag: Bit; sum: Bit; carry: Bit })[][];
  p: Bit[];
}

/** 按图 2.7 连好的 n 位 × n 位无符号阵列。a、b 是 n 位位串。 */
export function multiplyArray(a: Bits, b: Bits): ArrayResult {
  const n = a.length;
  const products: Bit[][] = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => and(weightBit(a, i), weightBit(b, j))));
  const rows: ArrayResult['rows'] = [];
  for (let r = 0; r < n; r += 1) {
    const row: ArrayResult['rows'][number] = [];
    const last = r === n - 1;
    for (let k = 0; k < n - 1; k += 1) {
      const weight = r + 1 + k;
      const above = rows[r - 1];
      let top: Bit;
      let fromTop: string;
      if (r === 0) {
        top = products[0]![k + 1]!;
        fromTop = `a${k + 1}b0`;
      } else if (k === n - 2) {
        top = products[r]![n - 1]!;
        fromTop = `a${n - 1}b${r}`;
      } else {
        top = above![k + 1]!.sum;
        fromTop = `rows.${r - 1}.${k + 1}.sum`;
      }
      const diag: Bit = r === 0 ? '0' : above![k]!.carry;
      const fromDiag = r === 0 ? '0' : `rows.${r - 1}.${k}.carry`;
      let right: Bit;
      let fromRight: string;
      if (!last) {
        right = products[r + 1]![k]!;
        fromRight = `a${k}b${r + 1}`;
      } else if (k === 0) {
        right = '0';
        fromRight = '0';
      } else {
        right = row[k - 1]!.carry;
        fromRight = `rows.${r}.${k - 1}.carry`;
      }
      const added = fullAdd(top, right, diag);
      row.push({ weight, from: { top: fromTop, right: fromRight, diag: fromDiag }, top, right, diag, sum: added.sum, carry: added.carry });
    }
    rows.push(row);
  }
  const p: Bit[] = [products[0]![0]!];
  for (let j = 1; j < n; j += 1) p[j] = rows[j - 1]![0]!.sum;
  const ripple = rows[n - 1]!;
  for (let k = 0; k < n - 1; k += 1) p[n + k] = ripple[k]!.sum;
  p[2 * n - 1] = ripple[n - 2]!.carry;
  return { products, rows, p };
}

/** 积的位串，左边是 p_{2n−1}。 */
function pBits(p: readonly Cell[]): string {
  return [...p].reverse().join('');
}

function emptyComplementer(): Complementer {
  return { input: '', e: '', chain: '', output: '' };
}

/** 一行解题表：位串放在权 low…low+len−1 的列上。 */
function placeBits(bits: string, low: number, totalWeights: number): string[] {
  const cells = Array.from({ length: totalWeights }, () => '');
  for (let i = 0; i < bits.length; i += 1) {
    const weight = low + bits.length - 1 - i;
    cells[totalWeights - 1 - weight] = bits.charAt(i);
  }
  return cells;
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
  mode?: MulMode;
  n?: number;
}

/** 出题：同一个种子得到同一组参数。操作数不为 0，带符号时符号随机。 */
export function generate(seed: number, options: GenerateOptions = {}): MulParams {
  if (!Number.isInteger(seed)) fail('format', `种子必须是整数，收到 ${String(seed)}`);
  const next = mulberry32(seed);
  const pick = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));
  const mode = options.mode ?? MODES[pick(0, 2)]!;
  const n = options.n ?? pick(3, 5);
  checkN(n);
  const operand = (): OperandInput => {
    const magnitude = pick(1, 2 ** n - 1);
    if (mode === '无符号') return { as: '真值', text: fromUnsigned(magnitude, n) };
    const negative = next() < 0.5;
    return { as: '真值', text: formatValue(negative ? -magnitude : magnitude, n, '整数').replace('−', '-') };
  };
  return { mode, n, x: operand(), y: operand() };
}

const SUM_WHY = ['三个输入都是 0，和 0，不进位', '三个输入里有一个 1，和 1，不进位', '三个输入里有两个 1，和 0，进位 1', '三个输入都是 1，和 1，进位 1'] as const;

function faWhy(fa: { top: Bit; right: Bit; diag: Bit }): string {
  return SUM_WHY[Number(fa.top) + Number(fa.right) + Number(fa.diag)]!;
}

export function run(params: MulParams): MulTrace {
  const { x, y } = checkParams(params);
  const { mode, n } = params;
  const signed = mode !== '无符号';
  const width = 2 * n;
  const codeName = mode === '原码' ? '原' : '补';

  // 先把整件事算完，再按顺序写成步骤。
  const xf: Bit = signed ? bit(x.bits, 0) : '0';
  const yf: Bit = signed ? bit(y.bits, 0) : '0';
  const pf = xor(xf, yf);
  const preX = signed ? complement(x.bits.slice(1), mode === '补码' ? xf : '0') : null;
  const preY = signed ? complement(y.bits.slice(1), mode === '补码' ? yf : '0') : null;
  const a = preX ? preX.output : x.bits;
  const b = preY ? preY.output : y.bits;
  const array = multiplyArray(a, b);
  const pString = pBits(array.p);
  const post = signed ? complement(pString, mode === '补码' ? pf : '0') : null;
  const product = post ? pf + post.output : pString;
  const productUnits = signed ? decode(mode, product) : toUnsigned(product);
  const valueText = signed ? formatValue(productUnits, width, '整数') : product;
  const signedText = (v: number) => String(v).replace('-', '−');
  const decimal = signedText(productUnits);
  const delayUnits = 8 * n - 4;
  const delayText = `(8n−4)T = ${delayUnits}T`;

  const initial: MulState = {
    x: '',
    y: '',
    sign: signed ? { xf: '', yf: '', pf: '' } : null,
    pre: signed ? { x: emptyComplementer(), y: emptyComplementer() } : null,
    a: '',
    b: '',
    products: Array.from({ length: n }, () => Array.from({ length: n }, (): Cell => '')),
    rows: array.rows.map((row) =>
      row.map((fa) => ({ weight: fa.weight, from: fa.from, top: '' as Cell, right: '' as Cell, diag: '' as Cell, sum: '' as Cell, carry: '' as Cell })),
    ),
    p: Array.from({ length: width }, (): Cell => ''),
    post: signed ? emptyComplementer() : null,
    product: '',
    value: '',
    decimal: '',
    delay: '',
    path: [],
  };

  const conditions: Condition[] = [
    { label: '方式', value: mode === '无符号' ? '无符号数阵列乘法' : `带求补器的${mode}阵列乘法` },
    { label: '阵列', value: `${n} 位 × ${n} 位，${n * (n - 1)} 个全加器，${n * n} 个与门` },
    { label: signed ? 'x' : 'A', value: signed ? `${x.text}（${x.units}）` : `${x.bits}（${x.units}）` },
    { label: signed ? 'y' : 'B', value: signed ? `${y.text}（${y.units}）` : `${y.bits}（${y.units}）` },
    { label: '门延迟', value: '与门 T_a = T，全加器进位 T_f = 2T，和 6T，异或门 3T' },
  ];

  const builder = new TraceBuilder<MulParams, MulState>(ENGINE, params, initial, conditions);
  let count = 0;
  const push = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };

  const columns = ['行', ...(signed ? ['符号'] : []), ...Array.from({ length: width }, (_, i) => `2^${width - 1 - i}`), '说明'];
  const rows: SolutionTable['rows'] = [];
  const addRow = (label: string, sign: string, bits: string, low: number, note: string, step: string) => {
    rows.push({ cells: [label, ...(signed ? [sign] : []), ...placeBits(bits, low, width), note], step });
  };

  let stepA = '';
  let stepB = '';
  if (signed && preX && preY) {
    const writeStep = push({
      title: `写出 [x]${codeName} = ${x.bits}，[y]${codeName} = ${y.bits}`,
      why: `最高位是符号位，后面 ${n} 位是数值位。符号位不进阵列，单独处理。`,
      ref: '教材 p47',
      update: (s) => {
        s.x = x.bits;
        s.y = y.bits;
        if (s.sign) {
          s.sign.xf = xf;
          s.sign.yf = yf;
        }
      },
    });
    addRow(`[x]${codeName}`, xf, x.bits.slice(1), 0, '', writeStep);
    addRow(`[y]${codeName}`, yf, y.bits.slice(1), 0, '', writeStep);
    const signStep = push({
      title: `积的符号位 p_${width} = x_f ⊕ y_f = ${xf} ⊕ ${yf} = ${pf}`,
      why: pf === '1' ? '两数一正一负，积为负。符号位用一个异或门单独得出。' : '两数同号，积为正。符号位用一个异或门单独得出。',
      ref: '教材 p47 图 2.9',
      update: (s) => {
        if (s.sign) s.sign.pf = pf;
      },
    });
    addRow('符号位', pf, '', 0, `x_f ⊕ y_f = ${xf} ⊕ ${yf} = ${pf}`, signStep);

    const preWhy = (name: 'x' | 'y', c: Complementer, sign: Bit) => {
      if (mode === '原码') return `原码的数值位就是绝对值，算前求补器的 E 置 0，${c.input} 原样通过。`;
      if (sign === '0') return `${name} 是正数，E 接符号位 0，${c.input} 原样通过，它就是 |${name}|。`;
      const pivot = c.input.lastIndexOf('1');
      return `${name} 是负数，E 接符号位 1，要求补。扫描链从最右边找第一个 1（左起第 ${pivot + 1} 位），它和右边不变，左边取反，得 |${name}| = ${c.output}。`;
    };
    stepA = push({
      level: 'beat',
      title: `x 的算前求补器：E = ${preX.e}，输出 |x| = ${preX.output}`,
      why: preWhy('x', preX, xf),
      ref: '教材 p46–47 图 2.8、2.9',
      update: (s) => {
        if (s.pre) s.pre.x = preX;
        s.a = a;
      },
    });
    stepB = push({
      level: 'beat',
      title: `y 的算前求补器：E = ${preY.e}，输出 |y| = ${preY.output}`,
      why: preWhy('y', preY, yf),
      ref: '教材 p46–47 图 2.8、2.9',
      update: (s) => {
        if (s.pre) s.pre.y = preY;
        s.b = b;
      },
    });
    addRow('|x|', '', a, 0, mode === '原码' ? '算前求补器 E = 0，直通' : `算前求补器 E = ${preX.e}`, stepA);
    addRow('× |y|', '', b, 0, mode === '原码' ? '算前求补器 E = 0，直通' : `算前求补器 E = ${preY.e}`, stepB);
  } else {
    stepA = push({
      title: `写出 A = ${a}（${x.units}），B = ${b}（${y.units}）`,
      why: `两个 ${n} 位无符号整数，A 是被乘数，B 是乘数。积最多 ${width} 位。`,
      ref: '教材 p44',
      update: (s) => {
        s.x = x.bits;
        s.y = y.bits;
        s.a = a;
        s.b = b;
      },
    });
    stepB = stepA;
    addRow('A', '', a, 0, `= ${x.units}`, stepA);
    addRow('× B', '', b, 0, `= ${y.units}`, stepA);
  }

  const name = (v: 'a' | 'b') => (signed ? (v === 'a' ? '|x|' : '|y|') : v === 'a' ? 'A' : 'B');
  const productStep = push({
    level: 'beat',
    title: `${n * n} 个与门同时给出全部位积 a_i·b_j，p_0 = a_0·b_0 = ${array.p[0]}`,
    why: `一位乘一位就是与：b_j 为 1 的那一行抄下 ${name('a')}，为 0 的那一行全是 0。第 j 行要左移 j 位，因为 b_j 的权是 2^j。最右一列只有 a_0·b_0 一个位积，它直接就是 p_0。`,
    ref: '教材 p44–45',
    update: (s) => {
      s.products = array.products.map((row) => [...row]);
      s.p[0] = array.p[0]!;
    },
  });
  for (let j = 0; j < n; j += 1) {
    const rowBits = [...array.products[j]!].reverse().join('');
    const bj = weightBit(b, j);
    addRow(j === 0 ? '位积' : '', '', rowBits, j, `b_${j} = ${bj}，${bj === '1' ? `抄 ${name('a')}` : '全 0'}`, productStep);
  }

  let lastStep = productStep;
  for (let r = 0; r < n - 1; r += 1) {
    const row = array.rows[r]!;
    const pj = row[0]!.sum;
    const ask: Ask | undefined =
      mode !== '补码' && r === 0
        ? {
            prompt: `第一行最右边的全加器把 a_1·b_0 和 a_0·b_1 相加。p_1 是几？`,
            kind: 'bits',
            answer: pj,
            hint: '看最右第二列：只有 a_1·b_0 和 a_0·b_1 两个位积，再加进位输入 0。',
          }
        : undefined;
    const sums = [...row].reverse().map((fa) => fa.sum).join('');
    const carries = [...row].reverse().map((fa) => fa.carry).join('');
    lastStep = push({
      level: 'beat',
      title: `第 ${r + 1} 行 ${n - 1} 个全加器同时相加，p_${r + 1} = ${pj}`,
      why:
        r === 0
          ? `第一行把 b_0 行和 b_1 行对齐的位积两两相加，进位输入都是 0。和竖直往下送，进位斜着送到下一行高一位。各位的和 ${sums}，进位 ${carries}。`
          : `这一行把上一行的和、上一行低一位送来的进位、b_${r + 1} 行的位积三个数相加。同一行里互不等待，所以一起算出。各位的和 ${sums}，进位 ${carries}；最右边的和不再往下加，就是 p_${r + 1}。`,
      ref: '教材 p45 图 2.7',
      ...(ask ? { ask } : {}),
      update: (s) => {
        s.rows[r] = row.map((fa) => ({ ...fa, from: { ...fa.from } }));
        s.p[r + 1] = pj;
      },
    });
  }

  const ripple = array.rows[n - 1]!;
  for (let k = 0; k < n - 1; k += 1) {
    const fa = ripple[k]!;
    const isLast = k === n - 2;
    const ask: Ask | undefined = isLast
      ? {
          prompt: `最后一行最左边的全加器送出的进位就是积的最高位 p_${width - 1}。它是几？`,
          kind: 'bits',
          answer: fa.carry,
          hint: '数一数这个全加器三个输入里有几个 1：两个以上才有进位。',
        }
      : undefined;
    lastStep = push({
      level: 'beat',
      title: isLast
        ? `最后一行第 ${k + 1} 个全加器：p_${fa.weight} = ${fa.sum}，进位输出 p_${width - 1} = ${fa.carry}`
        : `最后一行第 ${k + 1} 个全加器：p_${fa.weight} = ${fa.sum}，进位 ${fa.carry} 送给左边`,
      why: `最后一行是行波进位加法器：每个全加器要等右边送来进位才能算。输入是上一行同一列的和 ${fa.top}、上一行低一位的进位 ${fa.diag}、右边来的进位 ${fa.right}；${faWhy(fa)}。`,
      ref: '教材 p45 图 2.7',
      ...(ask ? { ask } : {}),
      update: (s) => {
        s.rows[n - 1]![k] = { ...fa, from: { ...fa.from } };
        s.p[fa.weight] = fa.sum;
        if (isLast) s.p[width - 1] = fa.carry;
      },
    });
  }
  addRow(signed ? '和' : 'P', '', pString, 0, `= ${toUnsigned(pString)}`, lastStep);

  let finalStep: string;
  if (signed && post) {
    const postStep = push({
      level: 'beat',
      title: `算后求补器：E = ${post.e}，输出 ${post.output}`,
      why:
        mode === '原码'
          ? '原码的积就是符号位加上绝对值，算后求补器的 E 置 0，原样通过。'
          : pf === '1'
            ? `两数异号，E = x_f ⊕ y_f = 1，把积的绝对值 ${pString} 变成补码的 ${width} 位：从右找第一个 1，左边取反。`
            : `两数同号，E = x_f ⊕ y_f = 0，积是正数，${pString} 原样通过。`,
      ref: '教材 p47 图 2.9',
      ...(mode === '补码'
        ? {
            ask: {
              prompt: '算后求补器这次要求补，还是原样通过？',
              kind: 'choice' as const,
              options: ['求补', '直通'],
              answer: post.e === '1' ? '求补' : '直通',
              hint: '算后求补器的 E 接的是两个符号位的异或。',
            },
          }
        : {}),
      update: (s) => {
        s.post = post;
      },
    });
    addRow('算后求补', '', post.output, 0, mode === '原码' ? 'E = 0，直通' : `E = ${post.e}`, postStep);
    const label = mode === '原码' ? '[x×y]原' : '[x·y]补';
    finalStep = push({
      title: `拼上符号位：${label} = ${product}`,
      why: `符号位 ${pf} 放在 ${width} 位数值前面，共 ${width + 1} 位。按${mode}读出是 ${valueText}，十进制 ${decimal}；${signedText(x.units)} × ${signedText(y.units)} = ${decimal}，对得上。`,
      ref: '教材 p47–48',
      update: (s) => {
        s.product = product;
        s.value = valueText;
        s.decimal = decimal;
      },
    });
    addRow(label, pf, post.output, 0, `${valueText} = ${decimal}`, finalStep);
  } else {
    finalStep = push({
      title: `积 P = ${product} = ${decimal}`,
      why: `p_${width - 1} 到 p_0 依次排开就是积。${signedText(x.units)} × ${signedText(y.units)} = ${decimal}，对得上。`,
      ref: '教材 p46',
      update: (s) => {
        s.product = product;
        s.value = valueText;
        s.decimal = decimal;
      },
    });
  }

  const path: string[] = [];
  for (let r = 0; r < n - 1; r += 1) path.push(`rows.${r}.${n - 2 - r}`);
  for (let k = 0; k < n - 1; k += 1) path.push(`rows.${n - 1}.${k}`);
  push({
    title: `乘法时间 t_m = ${delayText}`,
    why:
      `最慢的一条路：与门 T_a = T；沿 p_${n - 1} 那一列竖直穿过 ${n - 1} 个全加器，每个出和要 6T；再沿最后一行传 ${n - 1} 次进位，每次 T_f = 2T；最后一个和再过异或门 3T。` +
      `合起来 T + ${n - 1}×6T + ${n - 1}×2T + 3T = ${delayUnits}T。` +
      (mode === '补码' ? '补码还要过三个求补器，教材只说总时间约为原码阵列乘法的 2 倍，没有给式子。' : ''),
    ref: '教材 p45–46 式 2.26',
    focus: path,
    update: (s) => {
      s.delay = delayText;
      s.path = path;
    },
  });

  const result: Record<string, string> = {
    乘积: product,
    真值: valueText,
    十进制: decimal,
    延迟: delayText,
  };
  return builder.finish(result, { columns, rows });
}
