/**
 * 浮点加减（教材 2.6.1，p62–66，图 2.17）。规格见 specs/2-fpadd.md。
 *
 * 两种写法：
 * - 补码：习题 9 的教学格式。阶码 k 位数值位、补码，运算时写两个符号位；尾数 m 位数值位、变形补码。
 *   步骤：写操作数 →（减法）y 变符号 → 0 操作数检查 → 求阶差 → 对阶（一位一步）→ 尾数相加 →
 *   规格化（一位一步）→ 舍入 →（需要时）再规格化 → 溢出判断。
 * - 有效位：例 2.30 的写法 ±(1.xxx)₂ × 2^e，按例 2.30 的顺序在规格化之后先查溢出再舍入。
 * 对阶、规格化右移出去的位留在 out 里，到舍入时才处理。状态路径（x.mant、sum.out 等）是场景引用的 id。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';
import {
  BitsError,
  codeRange,
  encodeModified,
  formatValue,
  fromUnsigned,
  negateByInvertAddOne,
  parseValue,
  rippleAdd,
} from '../../lib/bits';
import { makeRandom } from '../codes/random';
import { MINUS, type Rational, abs, log2Floor, mul, parseDecimal, pow2, rational, toDecimal } from '../ieee/rational';

export const ENGINE = 'fpadd';

export type Op = '加' | '减';
export type Rounding = '0舍1入' | '截断' | '就近舍入';

/** 补码格式的一个操作数：阶码真值（二进制整数）和尾数真值（二进制小数）。 */
export interface TwosOperand {
  exp: string;
  mant: string;
}

export interface TwosParams {
  style: '补码';
  /** 阶码数值位数。 */
  k: number;
  /** 尾数数值位数。 */
  m: number;
  op: Op;
  x: TwosOperand;
  y: TwosOperand;
  rounding: '0舍1入' | '截断';
}

export interface SigParams {
  style: '有效位';
  /** 有效位数，含小数点前的 1。 */
  digits: number;
  op: Op;
  /** 十进制：0.5、−0.4375、3/8。 */
  x: string;
  y: string;
  rounding: Rounding;
}

export type FpAddParams = TwosParams | SigParams;

export interface OperandState {
  /** 阶码真值。补码格式是二进制（−101），有效位格式是十进制（−1）。 */
  exp: string;
  /** 阶码的变形补码（两个符号位）；有效位格式为空串。 */
  expCode: string;
  /** 尾数：补码格式是变形补码（11.101010），有效位格式是带符号的二进制（−1.110）。 */
  mant: string;
  /** 右移出去、还没舍入的位。 */
  out: string;
}

export type NormDirection = '' | '向左规格化' | '向右规格化' | '不用规格化';
export type OverflowVerdict = '' | '无溢出' | '上溢' | '下溢';

export interface FpAddState {
  stage: string;
  check: string;
  x: OperandState;
  y: OperandState;
  /** 阶差 ΔE = Ex − Ey。 */
  diff: string;
  diffCode: string;
  /** 被右移的是哪个数的尾数：x、y，或「不移」。 */
  shift: string;
  sum: OperandState;
  norm: NormDirection;
  overflow: OverflowVerdict;
  result: string;
  decimal: string;
}

const SHIFT_OPTIONS = ['x 的尾数', 'y 的尾数', '都不移'];
const NORM_OPTIONS = ['向左规格化', '向右规格化', '不用规格化'];

function emptyOperand(): OperandState {
  return { exp: '', expCode: '', mant: '', out: '' };
}

function initialState(): FpAddState {
  return {
    stage: '',
    check: '',
    x: emptyOperand(),
    y: emptyOperand(),
    diff: '',
    diffCode: '',
    shift: '',
    sum: emptyOperand(),
    norm: '',
    overflow: '',
    result: '',
    decimal: '',
  };
}

const withOut = (mant: string, out: string) => (out ? `${mant}(${out})` : mant);

function expText(e: number): string {
  return e < 0 ? `${MINUS}${-e}` : String(e);
}

type Builder = TraceBuilder<FpAddParams, FpAddState>;
type StepInput = Parameters<Builder['step']>[0];

class Steps {
  private count = 0;
  constructor(readonly builder: Builder) {}
  push(input: StepInput): string {
    this.builder.step(input);
    this.count += 1;
    return `s${this.count}`;
  }
}

export function run(params: FpAddParams): Trace<FpAddParams, FpAddState> {
  if (params.op !== '加' && params.op !== '减') throw new BitsError('format', `运算只能是「加」或「减」，收到「${String(params.op)}」`);
  if (params.style === '补码') return runTwos(params);
  if (params.style === '有效位') return runSig(params);
  throw new BitsError('format', `格式只能是「补码」或「有效位」，收到「${String((params as { style: unknown }).style)}」`);
}

// =====================================================================
// 补码格式（习题 9）
// =====================================================================

interface Reg {
  e: number;
  /** 变形补码尾数，m+2 位。 */
  main: string;
  out: string;
}

function checkTwos(p: TwosParams): void {
  if (!Number.isInteger(p.k) || p.k < 2 || p.k > 4) throw new BitsError('format', `阶码数值位数 k 必须是 2 到 4 的整数，收到 ${String(p.k)}`);
  if (!Number.isInteger(p.m) || p.m < 3 || p.m > 12) throw new BitsError('format', `尾数数值位数 m 必须是 3 到 12 的整数，收到 ${String(p.m)}`);
  if (p.rounding !== '0舍1入' && p.rounding !== '截断') throw new BitsError('format', `补码格式的舍入只能是「0舍1入」或「截断」，收到「${String(p.rounding)}」`);
}

function readTwos(name: string, op: TwosOperand, k: number, m: number): Reg {
  const e = parseValue(op.exp, k, '整数');
  const er = codeRange('补码', k);
  if (e < er.min || e > er.max) {
    throw new BitsError('range', `${name} 的阶码 ${op.exp} 超出 ${k} 位补码的范围 ${formatValue(er.min, k, '整数')} 到 ${formatValue(er.max, k, '整数')}`);
  }
  const units = parseValue(op.mant, m, '小数');
  const mr = codeRange('补码', m);
  if (units < mr.min || units > mr.max) {
    throw new BitsError('range', `${name} 的尾数 ${op.mant} 超出 ${m} 位补码的范围 −1 到 1 − 2^-${m}`);
  }
  return { e, main: encodeModified(units, m), out: '' };
}

/** 阶码的变形补码（两个符号位），k+2 位。溢出后的值（在 ±2^(k+1) 内）也照写，符号位是 01 或 10。 */
function expCode(e: number, k: number): string {
  const mod = 2 ** (k + 2);
  return fromUnsigned(((e % mod) + mod) % mod, k + 2);
}

function mantText(main: string): string {
  return `${main.slice(0, 2)}.${main.slice(2)}`;
}

function isZeroBits(bits: string): boolean {
  return !bits.includes('1');
}

/** 尾数（含 out 位）的真值，单位 2^-(m + out 位数)。 */
function mantRational(main: string, out: string, m: number): Rational {
  const bits = main + out;
  const raw = BigInt(`0b${bits}`) - (bits.charAt(0) === '1' ? 1n << BigInt(bits.length) : 0n);
  return rational(raw, 1n << BigInt(m + out.length));
}

function shiftRight(r: Reg): Reg {
  const main = r.main.charAt(0) + r.main.slice(0, -1);
  return { e: r.e + 1, main, out: r.main.slice(-1) + r.out };
}

function shiftLeft(r: Reg): Reg {
  return { e: r.e - 1, main: r.main.slice(1) + (r.out.charAt(0) || '0'), out: r.out.slice(1) };
}

function runTwos(p: TwosParams): Trace<FpAddParams, FpAddState> {
  checkTwos(p);
  const { k, m, op } = p;
  const emax = 2 ** k - 1;
  const emin = -(2 ** k);
  const W = m + 2;
  const x0 = readTwos('x', p.x, k, m);
  const y0 = readTwos('y', p.y, k, m);
  const expValue = (e: number) => formatValue(e, k, '整数');
  const mantValue = (main: string, out = '') => {
    const bits = main + out;
    const raw = parseInt(bits, 2) - (bits.charAt(0) === '1' ? 2 ** bits.length : 0);
    return formatValue(raw, m + out.length, '小数');
  };
  const operandState = (r: Reg): OperandState => ({ exp: expValue(r.e), expCode: expCode(r.e, k), mant: mantText(r.main), out: r.out });
  const valueOf = (r: Reg) => mul(mantRational(r.main, r.out, m), pow2(r.e));
  const resultText = (r: Reg) => {
    const exp = expValue(r.e).replace(/^\+/, '');
    const mant = mantValue(r.main, r.out);
    return `2^${exp} × ${mant.startsWith('+') ? mant.slice(1) : `(${mant})`}`;
  };

  const conditions: Condition[] = [
    { label: '格式', value: `阶码 ${k} 位数值位、用补码；尾数 ${m} 位数值位、用变形补码` },
    { label: '运算', value: op === '加' ? 'x + y' : 'x − y' },
    { label: 'x', value: `2^${p.x.exp} × ${p.x.mant}` },
    { label: 'y', value: `2^${p.y.exp} × ${p.y.mant}` },
    { label: '阶码范围', value: `${expValue(emin)} 到 ${expValue(emax)}` },
    { label: '舍入', value: p.rounding },
  ];
  const builder: Builder = new TraceBuilder<FpAddParams, FpAddState>(ENGINE, p, initialState(), conditions);
  const steps = new Steps(builder);
  const rows: SolutionTable['rows'] = [];
  const row = (cells: string[], step: string) => rows.push({ cells, step });

  // 1. 写出操作数
  const stepWrite = steps.push({
    title: `写出 [x]浮、[y]浮：x 阶码 ${expCode(x0.e, k)}、尾数 ${mantText(x0.main)}；y 阶码 ${expCode(y0.e, k)}、尾数 ${mantText(y0.main)}`,
    why: '阶码和尾数都写成补码，阶码多写一个符号位、尾数写成变形补码，两个符号位留着判断运算中的溢出。',
    ref: '教材 p62 式(2.35)；解析 p20 计算28',
    focus: ['x', 'y'],
    update: (s) => {
      s.stage = '写出操作数';
      s.x = operandState(x0);
      s.y = operandState(y0);
    },
  });
  row(['[x]浮', expCode(x0.e, k), mantText(x0.main), `x = ${resultText(x0)}`], stepWrite);
  row(['[y]浮', expCode(y0.e, k), mantText(y0.main), `y = ${resultText(y0)}`], stepWrite);

  let x = x0;
  let y = y0;
  if (op === '减') {
    const neg = negateByInvertAddOne(y0.main).result;
    y = { ...y0, main: neg };
    const stepNeg = steps.push({
      title: `y 变符号：[−My]补 = ${mantText(neg)}`,
      why: '减法按 x + (−y) 做（图 2.17 的「y 变符号」）：只把 y 的尾数连同两个符号位取反、末位加 1，阶码不动。',
      ref: '教材 p62 图2.17；p36 式(2.16)',
      focus: ['y.mant'],
      update: (s) => {
        s.y.mant = mantText(neg);
      },
    });
    row(['[−y]浮', expCode(y.e, k), mantText(neg), '尾数求补'], stepNeg);
  }

  const finish = (result: Record<string, string>) =>
    builder.finish(result, { columns: ['步骤', '阶码', '尾数', '说明'], rows });

  // 2. 0 操作数检查
  const xZero = isZeroBits(x.main);
  const yZero = isZeroBits(y.main);
  const zeroAnswer = xZero ? y : yZero ? x : null;
  const check = xZero && yZero ? 'x、y 都为 0' : xZero ? 'x 为 0' : yZero ? 'y 为 0' : '都不为 0';
  const stepCheck = steps.push({
    title: zeroAnswer ? `${check}，结果直接取${xZero ? (op === '减' ? ' −y' : ' y') : ' x'}` : 'x、y 的尾数都不为 0，接着算',
    why: zeroAnswer ? '有一个操作数为 0 时，和就是另一个数，后面的对阶、相加都不用做（图 2.17）。' : '0 操作数检查是第一步：只要有一个数为 0，就能直接得出结果。',
    ref: '教材 p63；图2.17',
    focus: ['check'],
    ...(zeroAnswer
      ? {
          update: (s: FpAddState) => {
            s.stage = '0 操作数检查';
            s.check = check;
            s.sum = operandState(zeroAnswer);
            s.overflow = '无溢出';
            s.result = isZeroBits(zeroAnswer.main) ? '0' : resultText(zeroAnswer);
            s.decimal = toDecimal(valueOf(zeroAnswer));
          },
        }
      : {
          update: (s: FpAddState) => {
            s.stage = '0 操作数检查';
            s.check = check;
          },
        }),
  });
  if (zeroAnswer) {
    row(['结果', expCode(zeroAnswer.e, k), mantText(zeroAnswer.main), check], stepCheck);
    return finish(twosResult(zeroAnswer, '无溢出', isZeroBits(zeroAnswer.main) ? '0' : resultText(zeroAnswer), toDecimal(valueOf(zeroAnswer)), k));
  }

  // 3. 求阶差
  const dE = x.e - y.e;
  const negEy = expCode(-y.e, k);
  const dCode = rippleAdd(expCode(x.e, k), negEy).sum;
  const smaller = dE < 0 ? 'x' : dE > 0 ? 'y' : '';
  const shiftAnswer = smaller === 'x' ? 'x 的尾数' : smaller === 'y' ? 'y 的尾数' : '都不移';
  const stepDiff = steps.push({
    title: `求阶差：ΔE = [Ex]补 + [−Ey]补 = ${expCode(x.e, k)} + ${negEy} = ${dCode}，ΔE = ${expText(dE)}`,
    why:
      dE === 0
        ? '阶差为 0，两数的小数点已经对齐，不用对阶。'
        : `ΔE ${dE > 0 ? '> 0，Ex 大' : '< 0，Ey 大'}。对阶要让小阶向大阶看齐：阶码小的那个数，尾数右移，每移一位阶码加 1。尾数左移会丢掉高位，误差大，所以不移大阶的数（p63）。`,
    ref: '教材 p63',
    focus: ['diff', 'diffCode'],
    ask: {
      prompt: `ΔE = ${expText(dE)}。对阶时哪个数的尾数要右移？`,
      kind: 'choice',
      options: SHIFT_OPTIONS,
      answer: shiftAnswer,
      hint: '比较两个阶码的大小：小阶向大阶看齐，尾数右移。',
    },
    update: (s) => {
      s.stage = '对阶';
      s.diff = expText(dE);
      s.diffCode = dCode;
      s.shift = smaller || '不移';
    },
  });
  row(['阶差', dCode, '', `ΔE = ${expText(dE)}`], stepDiff);

  // 4. 对阶，一位一步
  let lastAlign = stepDiff;
  if (smaller) {
    let r = smaller === 'x' ? x : y;
    const target = smaller === 'x' ? y.e : x.e;
    const total = Math.abs(dE);
    for (let i = 1; i <= total; i += 1) {
      const next = shiftRight(r);
      const outBit = next.out.charAt(0);
      const gone = isZeroBits(next.main);
      lastAlign = steps.push({
        title: `${smaller} 的阶码加 1 成 ${expValue(next.e)}，尾数右移 1 位：${withOut(mantText(next.main), next.out)}`,
        why: `${i === 1 ? '小阶的尾数右移，阶码加 1，数值不变。' : ''}补码右移时符号位照抄，移出去的 ${outBit} 先记在括号里，舍入时再处理（p64）。${i === total ? `阶码到 ${expValue(target)}，和另一个数相等，对阶结束。` : `还差 ${total - i} 位。`}`,
        ref: '教材 p63–64',
        focus: [`${smaller}.exp`, `${smaller}.mant`, `${smaller}.out`],
        update: (s) => {
          s[smaller] = operandState(next);
        },
      });
      r = next;
      if (gone) break;
    }
    if (smaller === 'x') x = r;
    else y = r;
    row([`对阶后 [${smaller}]浮`, expCode(r.e, k), withOut(mantText(r.main), r.out), `${smaller} 的尾数右移 ${Math.abs(r.e - (smaller === 'x' ? x0.e : y0.e))} 位`], lastAlign);
    if (isZeroBits(r.main)) {
      const other = smaller === 'x' ? y : x;
      const stepGone = steps.push({
        title: `${smaller} 的尾数已全部移成 0，结果直接取另一个数`,
        why: '对阶时小数的有效位全部移出，相当于加 0，结果就是另一个数（图 2.17 中「尾数 = 0?」那一支）。',
        ref: '教材 p62 图2.17',
        focus: ['sum', 'result'],
        update: (s) => {
          s.stage = '结束';
          s.sum = operandState(other);
          s.overflow = '无溢出';
          s.result = resultText(other);
          s.decimal = toDecimal(valueOf(other));
        },
      });
      row(['结果', expCode(other.e, k), mantText(other.main), '另一个数'], stepGone);
      return finish(twosResult(other, '无溢出', resultText(other), toDecimal(valueOf(other)), k));
    }
  }

  // 5. 尾数相加
  const G = Math.max(x.out.length, y.out.length);
  const fullX = x.main + x.out.padEnd(G, '0');
  const fullY = y.main + y.out.padEnd(G, '0');
  const added = rippleAdd(fullX, fullY);
  let sum: Reg = { e: x.e, main: added.sum.slice(0, W), out: added.sum.slice(W) };
  const sumZero = isZeroBits(added.sum);
  const stepAdd = steps.push({
    title: `尾数相加：${withOut(mantText(x.main), x.out)} + ${withOut(mantText(y.main), y.out)} = ${withOut(mantText(sum.main), sum.out)}`,
    why: `两阶已相等，尾数按定点补码相加，括号里的位一起加${added.carryOut === '1' ? '；最高符号位向外的进位按模丢掉' : ''}。${sumZero ? '和为 0，结果就是 0（图 2.17）。' : ''}`,
    ref: '教材 p64',
    focus: ['sum'],
    update: (s) => {
      s.stage = '尾数加减';
      s.sum = operandState(sum);
      if (sumZero) {
        s.overflow = '无溢出';
        s.result = '0';
        s.decimal = '0';
      }
    },
  });
  row(['', '', withOut(mantText(x.main), x.out), '尾数相加'], stepAdd);
  row(['+', '', withOut(mantText(y.main), y.out), ''], stepAdd);
  row(['=', expCode(sum.e, k), withOut(mantText(sum.main), sum.out), ''], stepAdd);
  if (sumZero) return finish(twosResult(sum, '无溢出', '0', '0', k));

  // 6. 规格化
  const needsRight = (r: Reg) => r.main.charAt(0) !== r.main.charAt(1);
  const needsLeft = (r: Reg) => r.main.charAt(1) === r.main.charAt(2);
  const dir: NormDirection = needsRight(sum) ? '向右规格化' : needsLeft(sum) ? '向左规格化' : '不用规格化';
  const signs = sum.main.slice(0, 2);
  const stepDecide = steps.push({
    title: `看尾数 ${mantText(sum.main)}：${dir}`,
    why:
      dir === '向右规格化'
        ? `两个符号位是 ${signs}，不同：尾数的绝对值超过了 1。定点运算里这算溢出，浮点里只要尾数右移 1 位、阶码加 1（p64）。`
        : dir === '向左规格化'
          ? `符号位与最高数值位相同（${sum.main.slice(1, 3)}），尾数的绝对值不够大，要左移，每移一位阶码减 1，直到两者不同。`
          : '两个符号位相同，且符号位与最高数值位不同，已是规格化数。',
    ref: '教材 p64；解析 p21 计算30',
    focus: ['sum.mant', 'norm'],
    ask: {
      prompt: `尾数相加得 ${mantText(sum.main)}，下一步往哪边规格化？`,
      kind: 'choice',
      options: NORM_OPTIONS,
      answer: dir,
      hint: '先看两个符号位是否相同；相同时再看符号位和最高数值位是否相同。',
    },
    update: (s) => {
      s.stage = '规格化';
      s.norm = dir;
    },
  });
  let lastNorm = stepDecide;
  let verdict: OverflowVerdict = '';
  let shifts = 0;
  if (dir === '向右规格化') {
    const next = shiftRight(sum);
    lastNorm = steps.push({
      title: `向右规格化：尾数右移 1 位成 ${withOut(mantText(next.main), next.out)}，阶码加 1 成 ${expCode(next.e, k)}`,
      why: `最高符号位 ${sum.main.charAt(0)} 是真实的符号，右移时把它照抄进两个符号位，移出的位记进括号。${next.e > emax ? '阶码加 1 后超过最大值，阶码上溢（图 2.17）。' : ''}`,
      ref: '教材 p64；图2.17',
      focus: ['sum.mant', 'sum.exp', 'sum.expCode', 'sum.out'],
      update: (s) => {
        s.sum = operandState(next);
      },
    });
    sum = next;
    shifts = 1;
    if (sum.e > emax) verdict = '上溢';
  } else if (dir === '向左规格化') {
    while (needsLeft(sum)) {
      const next = shiftLeft(sum);
      shifts += 1;
      const under = next.e < emin;
      lastNorm = steps.push({
        title: `向左规格化：尾数左移 1 位成 ${withOut(mantText(next.main), next.out)}，阶码减 1 成 ${expCode(next.e, k)}`,
        why: under
          ? '阶码减 1 后低于最小值，阶码下溢，不再左移（图 2.17）。'
          : `${shifts === 1 ? '左移一位，尾数的值乘 2，阶码减 1 抵回来，数值不变。' : ''}${sum.out ? `括号里的 ${sum.out.charAt(0)} 移进尾数末位。` : '末位补 0。'}${needsLeft(next) ? '符号位和最高数值位还相同，继续。' : '符号位和最高数值位已经不同，规格化结束。'}`,
        ref: '教材 p64；图2.17',
        focus: ['sum.mant', 'sum.exp', 'sum.expCode', 'sum.out'],
        update: (s) => {
          s.sum = operandState(next);
        },
      });
      sum = next;
      if (under) {
        verdict = '下溢';
        break;
      }
    }
  }
  if (dir !== '不用规格化') row(['规格化后', expCode(sum.e, k), withOut(mantText(sum.main), sum.out), `${dir} ${shifts} 位`], lastNorm);

  // 7. 舍入
  if (verdict === '') {
    const out = sum.out;
    const roundUp = p.rounding === '0舍1入' && out.charAt(0) === '1';
    const rounded = roundUp ? rippleAdd(sum.main, `${'0'.repeat(W - 1)}1`).sum : sum.main;
    const before = sum;
    sum = { e: sum.e, main: rounded, out: '' };
    const roundWhy =
      out === ''
        ? '尾数后面没有被移出的位，不用舍入。'
        : p.rounding === '截断'
          ? `按截断处理：括号里的 ${out} 直接丢掉（p67）。`
          : `按 0 舍 1 入：被移出的最高位是 ${out.charAt(0)}，${roundUp ? '在尾数最低位加 1' : '直接舍去'}（p67）。教材只给了原码尾数的规则，补码尾数这里按同样的办法做。`;
    const stepRound = steps.push({
      title: out === '' ? `没有被移出的位，尾数仍是 ${mantText(rounded)}` : `舍入：${withOut(mantText(before.main), out)} 变成 ${mantText(rounded)}`,
      why: roundWhy,
      ref: '教材 p64、p67',
      focus: ['sum.mant', 'sum.out'],
      update: (s) => {
        s.stage = '舍入';
        s.sum = operandState(sum);
      },
    });
    if (out !== '') row(['舍入后', expCode(sum.e, k), mantText(sum.main), p.rounding], stepRound);

    // 舍入后可能要再规格化（p65）
    if (needsRight(sum) || needsLeft(sum)) {
      const right = needsRight(sum);
      const next = right ? shiftRight(sum) : shiftLeft(sum);
      const fixed = { ...next, out: '' };
      const stepAgain = steps.push({
        title: `舍入后尾数成 ${mantText(sum.main)}，再${right ? '向右' : '向左'}规格化一位：${mantText(fixed.main)}，阶码 ${expCode(fixed.e, k)}`,
        why: right
          ? '末位加 1 一路进到符号位，两个符号位不同了，要右移 1 位、阶码加 1。'
          : '末位加 1 后尾数成了 11.100…0，符号位和最高数值位相同，不是规格化数，左移 1 位、阶码减 1。',
        ref: '教材 p65',
        focus: ['sum.mant', 'sum.exp', 'sum.expCode'],
        update: (s) => {
          s.sum = operandState(fixed);
        },
      });
      sum = fixed;
      row(['再规格化', expCode(sum.e, k), mantText(sum.main), right ? '向右规格化 1 位' : '向左规格化 1 位'], stepAgain);
    }
    verdict = sum.e > emax ? '上溢' : sum.e < emin ? '下溢' : '无溢出';
  }

  // 8. 溢出判断
  const code = expCode(sum.e, k);
  const finalText = verdict === '上溢' ? '上溢' : verdict === '下溢' ? '0' : resultText(sum);
  const finalDecimal = verdict === '上溢' ? '无' : verdict === '下溢' ? '0' : toDecimal(valueOf(sum));
  const stepOverflow = steps.push({
    title: `阶码 ${code}，两个符号位 ${code.slice(0, 2)}：${verdict}${verdict === '无溢出' ? `，结果 ${finalText}` : ''}`,
    why:
      verdict === '上溢'
        ? '阶码的两个符号位是 01，超过了最大阶码，是上溢，要报告出错（p64）。'
        : verdict === '下溢'
          ? '阶码的两个符号位是 10，比最小阶码还小，是下溢，结果按 0 处理（p64）。'
          : '阶码的两个符号位相同，没有超出阶码的范围。浮点数的溢出只看阶码（p64）。',
    ref: '教材 p64',
    focus: ['sum.expCode', 'overflow', 'result'],
    update: (s) => {
      s.stage = '溢出判断';
      s.overflow = verdict;
      s.result = finalText;
      s.decimal = finalDecimal;
    },
  });
  row(['结果', code, verdict === '无溢出' ? mantText(sum.main) : '', verdict === '无溢出' ? finalText : verdict], stepOverflow);
  return finish(twosResult(sum, verdict, finalText, finalDecimal, k));
}

function twosResult(r: Reg, verdict: OverflowVerdict, text: string, decimal: string, k: number): Record<string, string> {
  return { 结果: text, 阶码: expCode(r.e, k), 尾数: mantText(r.main), 溢出: verdict, 十进制: decimal };
}

// =====================================================================
// 有效位格式（例 2.30）
// =====================================================================

interface Sig {
  neg: boolean;
  /** 有效位，整数；值 = sig × 2^(e − f)。 */
  sig: bigint;
  f: number;
  e: number;
}

const SIG_EMAX = 127;
const SIG_EMIN = -126;

function readSig(name: string, text: string, digits: number): Sig {
  const value = parseDecimal(text);
  if (!value) throw new BitsError('format', `${name} = 「${text}」不是十进制数，可以写 0.5、−0.4375、3/8`);
  const neg = value.num < 0n;
  const mag = abs(value);
  if (mag.num === 0n) return { neg: false, sig: 0n, f: digits - 1, e: 0 };
  const e = log2Floor(mag);
  const scaled = mul(mag, pow2(digits - 1 - e));
  if (scaled.den !== 1n) throw new BitsError('range', `${name} = ${text} 用 ${digits} 位有效位写不出来`);
  if (e > SIG_EMAX || e < SIG_EMIN) throw new BitsError('range', `${name} = ${text} 的指数 ${e} 超出 −126 到 127`);
  return { neg, sig: scaled.num, f: digits - 1, e };
}

function sigBody(s: Sig, d: number): { mant: string; out: string } {
  const intPart = (s.sig >> BigInt(s.f)).toString(2);
  const frac = s.f === 0 ? '' : (s.sig & ((1n << BigInt(s.f)) - 1n)).toString(2).padStart(s.f, '0');
  const main = frac.slice(0, d).padEnd(d, '0');
  const out = frac.slice(d);
  return { mant: `${s.neg ? MINUS : ''}${intPart}.${main}`, out };
}

function sigText(s: Sig, d: number): string {
  const { mant, out } = sigBody(s, d);
  const bare = mant.replace(MINUS, '');
  return `${s.neg ? MINUS : ''}(${withOut(bare, out)})₂ × 2^${expText(s.e)}`;
}

function sigValue(s: Sig): Rational {
  return mul(rational(s.neg ? -s.sig : s.sig), pow2(s.e - s.f));
}

function runSig(p: SigParams): Trace<FpAddParams, FpAddState> {
  const { digits, op } = p;
  if (!Number.isInteger(digits) || digits < 2 || digits > 12) throw new BitsError('format', `有效位数必须是 2 到 12 的整数，收到 ${String(digits)}`);
  if (p.rounding !== '0舍1入' && p.rounding !== '截断' && p.rounding !== '就近舍入') {
    throw new BitsError('format', `舍入只能是「0舍1入」「截断」或「就近舍入」，收到「${String(p.rounding)}」`);
  }
  const d = digits - 1;
  const x0 = readSig('x', p.x, digits);
  const y0 = readSig('y', p.y, digits);
  const operandState = (s: Sig): OperandState => ({ exp: expText(s.e), expCode: '', ...sigBody(s, d) });

  const conditions: Condition[] = [
    { label: '格式', value: `(1.xxx)₂ × 2^e，有效位 ${digits} 位，指数 −126 到 127` },
    { label: '运算', value: op === '加' ? 'x + y' : 'x − y' },
    { label: 'x', value: p.x },
    { label: 'y', value: p.y },
    { label: '舍入', value: p.rounding },
  ];
  const builder: Builder = new TraceBuilder<FpAddParams, FpAddState>(ENGINE, p, initialState(), conditions);
  const steps = new Steps(builder);
  const rows: SolutionTable['rows'] = [];
  const row = (cells: string[], step: string) => rows.push({ cells, step });
  const finish = (result: Record<string, string>) => builder.finish(result, { columns: ['步骤', '阶码', '尾数', '说明'], rows });
  const resultOf = (s: Sig, verdict: OverflowVerdict, text: string, decimal: string): Record<string, string> => ({
    结果: text,
    阶码: expText(s.e),
    尾数: sigBody(s, d).mant,
    溢出: verdict,
    十进制: decimal,
  });
  const nonzero = (s: Sig) => s.sig !== 0n;
  const display = (s: Sig) => (nonzero(s) ? sigText(s, d) : '0');

  const stepWrite = steps.push({
    title: `写成二进制：x = ${toDecimal(sigValue(x0))} = ${display(x0)}，y = ${toDecimal(sigValue(y0))} = ${display(y0)}`,
    why: `把小数点移到第一个 1 后面，保留 ${digits} 位有效位，写成 (1.xxx)₂ × 2^e。`,
    ref: '教材 p65 例2.30',
    focus: ['x', 'y'],
    update: (s) => {
      s.stage = '写出操作数';
      s.x = operandState(x0);
      s.y = operandState(y0);
    },
  });
  row(['x', expText(x0.e), sigBody(x0, d).mant, display(x0)], stepWrite);
  row(['y', expText(y0.e), sigBody(y0, d).mant, display(y0)], stepWrite);

  let x = x0;
  let y = y0;
  if (op === '减') {
    y = { ...y0, neg: nonzero(y0) ? !y0.neg : false };
    const stepNeg = steps.push({
      title: `y 变符号：−y = ${display(y)}`,
      why: '减法按 x + (−y) 做，只改 y 的符号，指数和有效位不动（图 2.17）。',
      ref: '教材 p62 图2.17',
      focus: ['y.mant'],
      update: (s) => {
        s.y = operandState(y);
      },
    });
    row(['−y', expText(y.e), sigBody(y, d).mant, display(y)], stepNeg);
  }

  // 0 操作数检查
  const zeroAnswer = !nonzero(x) ? y : !nonzero(y) ? x : null;
  const check = !nonzero(x) && !nonzero(y) ? 'x、y 都为 0' : !nonzero(x) ? 'x 为 0' : !nonzero(y) ? 'y 为 0' : '都不为 0';
  const zeroResult = zeroAnswer ? display(zeroAnswer) : '';
  const zeroDecimal = zeroAnswer ? toDecimal(sigValue(zeroAnswer)) : '';
  const stepCheck = steps.push({
    title: zeroAnswer ? `${check}，结果直接取 ${zeroResult}` : 'x、y 都不为 0，接着算',
    why: zeroAnswer ? '有一个操作数为 0 时，和就是另一个数（图 2.17）。' : '0 操作数检查是第一步：只要有一个数为 0，就能直接得出结果。',
    ref: '教材 p63；图2.17',
    focus: ['check'],
    update: (s) => {
      s.stage = '0 操作数检查';
      s.check = check;
      if (zeroAnswer) {
        s.sum = operandState(zeroAnswer);
        s.overflow = '无溢出';
        s.result = zeroResult;
        s.decimal = zeroDecimal;
      }
    },
  });
  if (zeroAnswer) {
    row(['结果', expText(zeroAnswer.e), sigBody(zeroAnswer, d).mant, zeroResult], stepCheck);
    return finish(resultOf(zeroAnswer, '无溢出', zeroResult, zeroDecimal));
  }

  // 求阶差
  const dE = x.e - y.e;
  const smaller = dE < 0 ? 'x' : dE > 0 ? 'y' : '';
  const stepDiff = steps.push({
    title: `求阶差：ΔE = ${expText(x.e)} − (${expText(y.e)}) = ${expText(dE)}`,
    why:
      dE === 0
        ? '指数相同，小数点已经对齐，不用对阶。'
        : `${smaller} 的指数小。小阶向大阶看齐：把 ${smaller} 的有效位右移，每移一位指数加 1（p63）。`,
    ref: '教材 p63；p65 例2.30',
    focus: ['diff'],
    ask: {
      prompt: `ΔE = ${expText(dE)}。对阶时哪个数的尾数要右移？`,
      kind: 'choice',
      options: SHIFT_OPTIONS,
      answer: smaller === 'x' ? 'x 的尾数' : smaller === 'y' ? 'y 的尾数' : '都不移',
      hint: '比较两个指数：小阶向大阶看齐。',
    },
    update: (s) => {
      s.stage = '对阶';
      s.diff = expText(dE);
      s.shift = smaller || '不移';
    },
  });
  row(['阶差', expText(dE), '', `ΔE = ${expText(dE)}`], stepDiff);

  if (smaller) {
    let r = smaller === 'x' ? x : y;
    const total = Math.abs(dE);
    let last = stepDiff;
    for (let i = 1; i <= total; i += 1) {
      const next: Sig = { ...r, f: r.f + 1, e: r.e + 1 };
      const gone = next.sig >> BigInt(next.f - d) === 0n;
      last = steps.push({
        title: `${smaller} 右移 1 位，指数加 1：${sigText(next, d)}`,
        why: `${i === 1 ? '有效位右移一位，值减半，指数加 1 补回来，数值不变。' : ''}移出 ${digits} 位以外的位记在括号里，舍入时再处理。${i === total ? '两数指数已相等。' : `还差 ${total - i} 位。`}`,
        ref: '教材 p63；p65 例2.30',
        focus: [`${smaller}.exp`, `${smaller}.mant`, `${smaller}.out`],
        update: (s) => {
          s[smaller] = operandState(next);
        },
      });
      r = next;
      if (gone) break;
    }
    if (smaller === 'x') x = r;
    else y = r;
    row([`对阶后 ${smaller}`, expText(r.e), withOut(sigBody(r, d).mant, sigBody(r, d).out), sigText(r, d)], last);
    if (r.sig >> BigInt(r.f - d) === 0n) {
      const other = smaller === 'x' ? y : x;
      const text = display(other);
      const decimal = toDecimal(sigValue(other));
      const stepGone = steps.push({
        title: `${smaller} 的有效位已全部移出，结果直接取另一个数 ${text}`,
        why: '对阶时小数的有效位全部移出，相当于加 0（图 2.17 中「尾数 = 0?」那一支）。',
        ref: '教材 p62 图2.17',
        focus: ['sum', 'result'],
        update: (s) => {
          s.stage = '结束';
          s.sum = operandState(other);
          s.overflow = '无溢出';
          s.result = text;
          s.decimal = decimal;
        },
      });
      row(['结果', expText(other.e), sigBody(other, d).mant, text], stepGone);
      return finish(resultOf(other, '无溢出', text, decimal));
    }
  }

  // 尾数相加
  const f = Math.max(x.f, y.f);
  const ax = (x.neg ? -1n : 1n) * (x.sig << BigInt(f - x.f));
  const ay = (y.neg ? -1n : 1n) * (y.sig << BigInt(f - y.f));
  const total = ax + ay;
  let sum: Sig = { neg: total < 0n, sig: total < 0n ? -total : total, f, e: x.e };
  const stepAdd = steps.push({
    title: `有效位相加：${sigText(x, d)} + ${y.neg ? `(${sigText(y, d)})` : sigText(y, d)} = ${nonzero(sum) ? sigText(sum, d) : '0'}`,
    why: `指数相同后，有效位按带符号的二进制数相加，${x.neg === y.neg ? '同号绝对值相加' : '异号用大的绝对值减小的，取大的那个的符号'}。${nonzero(sum) ? '' : '和为 0，结果就是 0（图 2.17）。'}`,
    ref: '教材 p64；p65 例2.30',
    focus: ['sum'],
    update: (s) => {
      s.stage = '尾数加减';
      s.sum = operandState(sum);
      if (!nonzero(sum)) {
        s.overflow = '无溢出';
        s.result = '0';
        s.decimal = '0';
      }
    },
  });
  row(['和', expText(sum.e), withOut(sigBody(sum, d).mant, sigBody(sum, d).out), nonzero(sum) ? sigText(sum, d) : '0'], stepAdd);
  if (!nonzero(sum)) return finish(resultOf(sum, '无溢出', '0', '0'));

  // 规格化
  const tooBig = (s: Sig) => s.sig >= 1n << BigInt(s.f + 1);
  const tooSmall = (s: Sig) => s.sig < 1n << BigInt(s.f);
  const dir: NormDirection = tooBig(sum) ? '向右规格化' : tooSmall(sum) ? '向左规格化' : '不用规格化';
  const stepDecide = steps.push({
    title: `看有效位 ${sigBody(sum, d).mant}：${dir}`,
    why:
      dir === '向右规格化'
        ? '小数点前有两位，绝对值不小于 2，右移 1 位、指数加 1。'
        : dir === '向左规格化'
          ? '小数点前是 0，不是 1.xxx 的形式，要左移，每移一位指数减 1，直到小数点前是 1（p64）。'
          : '已经是 1.xxx 的形式，不用规格化。',
    ref: '教材 p64',
    focus: ['sum.mant', 'norm'],
    ask: {
      prompt: `有效位相加得 ${sigBody(sum, d).mant}，下一步往哪边规格化？`,
      kind: 'choice',
      options: NORM_OPTIONS,
      answer: dir,
      hint: '规格化的目标是 1.xxx：看小数点前是什么。',
    },
    update: (s) => {
      s.stage = '规格化';
      s.norm = dir;
    },
  });
  let lastNorm = stepDecide;
  let shifts = 0;
  while (tooBig(sum) || tooSmall(sum)) {
    const right = tooBig(sum);
    const next: Sig = right
      ? { ...sum, f: sum.f + 1, e: sum.e + 1 }
      : sum.f > d
        ? { ...sum, f: sum.f - 1, e: sum.e - 1 }
        : { ...sum, sig: sum.sig << 1n, e: sum.e - 1 };
    shifts += 1;
    lastNorm = steps.push({
      title: `${right ? '右移' : '左移'} 1 位，指数${right ? '加' : '减'} 1：${sigText(next, d)}`,
      why: right ? '小数点左移一位，指数加 1，数值不变。' : `小数点右移一位，指数减 1，数值不变。${tooSmall(next) ? '小数点前还是 0，继续。' : '小数点前已是 1。'}`,
      ref: '教材 p64；p65 例2.30',
      focus: ['sum.mant', 'sum.exp', 'sum.out'],
      update: (s) => {
        s.sum = operandState(next);
      },
    });
    sum = next;
  }
  if (dir !== '不用规格化') row(['规格化后', expText(sum.e), withOut(sigBody(sum, d).mant, sigBody(sum, d).out), `${dir} ${shifts} 位`], lastNorm);

  // 检查上溢、下溢（例 2.30 放在舍入之前）
  const rangeVerdict = (e: number): OverflowVerdict => (e > SIG_EMAX ? '上溢' : e < SIG_EMIN ? '下溢' : '无溢出');
  let verdict = rangeVerdict(sum.e);
  const stepRange = steps.push({
    title: `检查上溢、下溢：指数 ${expText(sum.e)}，${verdict === '无溢出' ? '在 −126 到 127 之间，无溢出' : verdict}`,
    why:
      verdict === '无溢出'
        ? '指数用移码存，规格化数的指数只能在 −126 到 127 之间（p28），这里没有超出。'
        : verdict === '上溢'
          ? '指数超过 127，阶码上溢，按无穷大处理（p64）。'
          : '指数小于 −126，阶码下溢，按 0 处理（p64）。',
    ref: '教材 p65 例2.30；p64',
    focus: ['sum.exp', 'overflow'],
    update: (s) => {
      s.stage = '溢出判断';
      s.overflow = verdict;
      if (verdict !== '无溢出') {
        s.result = verdict === '上溢' ? `${sum.neg ? MINUS : '+'}∞` : '0';
        s.decimal = verdict === '上溢' ? '无' : '0';
      }
    },
  });
  if (verdict !== '无溢出') {
    const text = verdict === '上溢' ? `${sum.neg ? MINUS : '+'}∞` : '0';
    row(['结果', expText(sum.e), '', verdict], stepRange);
    return finish(resultOf(sum, verdict, text, verdict === '上溢' ? '无' : '0'));
  }

  // 舍入
  const extra = sum.f - d;
  let q = extra > 0 ? sum.sig >> BigInt(extra) : sum.sig;
  const rest = extra > 0 ? sum.sig & ((1n << BigInt(extra)) - 1n) : 0n;
  const half = extra > 0 ? 1n << BigInt(extra - 1) : 0n;
  const outBits = sigBody(sum, d).out;
  let up = false;
  if (extra > 0 && rest !== 0n) {
    if (p.rounding === '0舍1入') up = rest >= half;
    else if (p.rounding === '就近舍入') up = rest > half || (rest === half && (q & 1n) === 1n);
  }
  if (up) q += 1n;
  const before = sum;
  sum = { neg: sum.neg, sig: q, f: d, e: sum.e };
  const roundWhy =
    rest === 0n
      ? `有效位恰好 ${digits} 位${outBits ? '，括号里全是 0' : ''}，舍入时不用改动。`
      : p.rounding === '截断'
        ? `按截断处理：括号里的 ${outBits} 直接丢掉（p67）。`
        : p.rounding === '0舍1入'
          ? `按 0 舍 1 入：丢掉的最高位是 ${outBits.charAt(0)}，${up ? '在最低位加 1' : '直接舍去'}（p67）。`
          : `按就近舍入：丢掉的部分${rest > half ? '超过最低位的一半，最低位加 1' : rest < half ? '不到最低位的一半，截掉' : (q & 1n) === 0n && up ? '正好一半，最低位加 1 变成偶数' : '正好一半，最低位已是 0，截掉'}（p64）。`;
  const stepRound = steps.push({
    title: rest === 0n ? `舍入到 ${digits} 位有效位：不用改动，仍是 ${sigText(sum, d)}` : `舍入到 ${digits} 位有效位：${sigText(before, d)} 变成 ${sigText(sum, d)}`,
    why: roundWhy,
    ref: '教材 p64、p67',
    focus: ['sum.mant', 'sum.out'],
    update: (s) => {
      s.stage = '舍入';
      s.sum = operandState(sum);
    },
  });
  if (rest !== 0n) row(['舍入后', expText(sum.e), sigBody(sum, d).mant, p.rounding], stepRound);
  if (tooBig(sum)) {
    const next: Sig = { ...sum, sig: sum.sig >> 1n, e: sum.e + 1 };
    verdict = rangeVerdict(next.e);
    const stepAgain = steps.push({
      title: `舍入后进位成 ${sigBody(sum, d).mant}，再右移 1 位：${sigText(next, d)}`,
      why: `末位加 1 一路进到小数点前，成了 10.000…，右移 1 位、指数加 1。${verdict === '上溢' ? '指数超过 127，上溢。' : '指数仍在范围内。'}`,
      ref: '教材 p65',
      focus: ['sum.mant', 'sum.exp'],
      update: (s) => {
        s.sum = operandState(next);
        s.overflow = verdict;
      },
    });
    sum = next;
    row(['再规格化', expText(sum.e), sigBody(sum, d).mant, '向右规格化 1 位'], stepAgain);
  }

  const text = verdict === '上溢' ? `${sum.neg ? MINUS : '+'}∞` : sigText(sum, d);
  const decimal = verdict === '上溢' ? '无' : toDecimal(sigValue(sum));
  const stepDone = steps.push({
    title: `结果：${text}${verdict === '上溢' ? '' : ` = ${decimal}`}`,
    why: verdict === '上溢' ? '舍入后指数超出范围，结果上溢。' : '把结果的二进制换成十进制，可以和直接用十进制算的值核对（例 2.30 的「十进制数验证」）。',
    ref: '教材 p66 例2.30',
    focus: ['result', 'decimal'],
    update: (s) => {
      s.stage = '结束';
      s.result = text;
      s.decimal = decimal;
    },
  });
  row(['结果', expText(sum.e), sigBody(sum, d).mant, text], stepDone);
  return finish(resultOf(sum, verdict, text, decimal));
}

// =====================================================================
// 出题
// =====================================================================

/** 出题：同一个种子同一组参数。补码格式约七成，阶差不为 0 的占多数。 */
export function generate(seed: number): FpAddParams {
  const rng = makeRandom(seed);
  const op: Op = rng.chance(0.5) ? '加' : '减';
  if (rng.chance(0.7)) {
    const [k, m] = rng.pick([
      [3, 6],
      [3, 6],
      [3, 6],
      [2, 4],
      [4, 8],
    ] as const);
    const mant = () => {
      const top = 2 ** m;
      return rng.chance(0.5) ? rng.int(top / 2, top - 1) : -rng.int(top / 2 + 1, top);
    };
    const ex = rng.int(-(2 ** k) + 1, 2 ** k - 2);
    const gap = rng.pick([0, 1, 1, 2, 2, 3]);
    const ey = Math.max(-(2 ** k), Math.min(2 ** k - 1, ex + (rng.chance(0.5) ? gap : -gap)));
    const text = (units: number, n: number, notation: '整数' | '小数') => formatValue(units, n, notation).replace(MINUS, '-');
    return {
      style: '补码',
      k,
      m,
      op,
      x: { exp: text(ex, k, '整数') || '0', mant: text(mant(), m, '小数') },
      y: { exp: text(ey, k, '整数') || '0', mant: text(mant(), m, '小数') },
      rounding: rng.chance(0.8) ? '0舍1入' : '截断',
    };
  }
  const digits = rng.pick([4, 4, 5, 6]);
  const value = () => {
    const sig = rng.int(2 ** (digits - 1), 2 ** digits - 1);
    const e = rng.int(-5, 4);
    const v = mul(rational(BigInt(rng.chance(0.4) ? -sig : sig)), pow2(e - (digits - 1)));
    return toDecimal(v).replace(MINUS, '-');
  };
  return { style: '有效位', digits, op, x: value(), y: value(), rounding: rng.pick(['0舍1入', '0舍1入', '截断', '就近舍入'] as const) };
}

