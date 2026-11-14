/**
 * 一个真值的原码、反码、补码、移码（教材 2.1.2，p24–27）。规格见 specs/2-codes.md。
 *
 * 做法跟教材 p27：先写原码（符号位 + |x|），负数的数值位逐位取反得反码，反码末位加 1 得补码；
 * 移码按式 (2.9) 是 2^n + x，与补码只差符号位。−2^n 只有补码和移码，0 在原码、反码里有两种写法。
 * 状态路径（codes.补码.bits 等）是场景引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';
import {
  BitsError,
  NOTATION_NAME,
  type Bits,
  type Code,
  type Notation,
  assertValueBits,
  codeRange,
  decode,
  encode,
  formatBits,
  formatDecimal,
  formatExcess,
  formatValue,
  parseBits,
  parseValue,
  rippleAdd,
} from '../../lib/bits';
import { makeRandom } from './random';

export const ENGINE = 'codes';

export type CodesInput =
  | { as: '十进制'; text: string }
  | { as: '真值'; text: string }
  | { as: '机器数'; code: Code; bits: string };

export interface CodesParams {
  /** 数值位位数，不含符号位。机器码宽 n+1 位。 */
  n: number;
  notation: Notation;
  input: CodesInput;
}

export type CodeStatus = '' | '有' | '无';

export interface CodeCell {
  /** 机器码，不带小数点和逗号；没有这种码时为空串。 */
  bits: string;
  /** 教材写法：定点小数带小数点，整数移码带逗号。 */
  text: string;
  /** 0 的另一种写法（原码、反码的 −0），没有就是空串。 */
  zero: string;
  status: CodeStatus;
  /** 这种码为什么写不出来，只在 status 为「无」时有字。 */
  why: string;
}

export interface CodesState {
  value: { binary: string; decimal: string };
  codes: Record<Code, CodeCell>;
}

export interface CodesSolution {
  units: number;
  binary: string;
  decimal: string;
  codes: Record<Code, { bits: string; zero: string } | null>;
}

const NOTATIONS: readonly Notation[] = ['整数', '小数'];
const CODE_NAMES: readonly Code[] = ['原码', '反码', '补码', '移码'];

function checkParams(params: CodesParams): void {
  assertValueBits(params.n);
  if (!NOTATIONS.includes(params.notation)) throw new BitsError('format', `写法只能是「整数」或「小数」，收到「${String(params.notation)}」`);
  const input = params.input as { as?: unknown };
  if (input.as !== '十进制' && input.as !== '真值' && input.as !== '机器数') {
    throw new BitsError('format', '输入只能是十进制、真值或机器数');
  }
}

/** 十进制读成以最低位为单位的整数。整数不许带小数；小数必须能用 n 位写完。 */
export function parseDecimalUnits(text: string, n: number, notation: Notation): number {
  const compact = text.replace(/\s+/g, '').replace(/[−–]/g, '-');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(compact);
  const whole = match?.[2] ?? '';
  const part = (match?.[3] ?? '').replace(/0+$/, '');
  if (!match || (whole === '' && part === '')) {
    throw new BitsError('format', `「${text}」不是十进制数，应写成 −35 或 −0.375 这样的形式`);
  }
  const negative = match[1] === '-';
  if (whole.length + part.length > 120) throw new BitsError('range', `「${text}」的位数太多`);
  const scaled = BigInt((whole || '0') + part); // 真值 × 10^part.length
  const ten = 10n ** BigInt(part.length);
  let units: bigint;
  if (notation === '整数') {
    if (part !== '') throw new BitsError('format', `定点整数的真值不带小数，收到「${text}」`);
    units = scaled;
  } else {
    const shifted = scaled * 2n ** BigInt(n);
    if (shifted % ten !== 0n) {
      throw new BitsError('range', `${text} 化成二进制小数超过 ${n} 位，${n} 位数值位写不下`);
    }
    units = shifted / ten;
  }
  const limit = 2n ** BigInt(n + 2);
  if (units > limit) throw new BitsError('range', `「${text}」超出 ${n} 位数值位的范围`);
  const value = Number(units);
  return negative && value !== 0 ? -value : value;
}

function readUnits(params: CodesParams): number {
  const { n, notation, input } = params;
  switch (input.as) {
    case '十进制':
      return parseDecimalUnits(input.text, n, notation);
    case '真值':
      return parseValue(input.text, n, notation);
    case '机器数': {
      if (!CODE_NAMES.includes(input.code)) throw new BitsError('format', `码制只能是原码、反码、补码、移码，收到「${String(input.code)}」`);
      const { bits, point } = parseBits(input.bits);
      if (bits.length !== n + 1) throw new BitsError('format', `${input.code}应为 ${n + 1} 位，收到 ${bits.length} 位「${input.bits}」`);
      if (point !== null && point !== 1) throw new BitsError('format', `分隔符只能在符号位后面，收到「${input.bits}」`);
      if (point !== null && notation === '整数' && input.bits.includes('.')) {
        throw new BitsError('format', `定点整数的机器码不带小数点，收到「${input.bits}」`);
      }
      return decode(input.code, bits);
    }
  }
}

function checkRange(units: number, n: number, notation: Notation): void {
  const { min, max } = codeRange('补码', n);
  if (units < min || units > max) {
    throw new BitsError(
      'range',
      `真值超出范围：${n} 位数值位的${NOTATION_NAME[notation]}，四种码合起来只能表示 ${formatValue(min, n, notation)} 到 ${formatValue(max, n, notation)}（${formatDecimal(min, n, notation)} 到 ${formatDecimal(max, n, notation)}）`,
    );
  }
}

function has(code: Code, units: number, n: number): boolean {
  const { min, max } = codeRange(code, n);
  return units >= min && units <= max;
}

/** 只要答案、不要步骤时用。 */
export function solve(params: CodesParams): CodesSolution {
  checkParams(params);
  const { n, notation } = params;
  const units = readUnits(params);
  checkRange(units, n, notation);
  const codes = {} as CodesSolution['codes'];
  for (const code of CODE_NAMES) {
    if (!has(code, units, n)) {
      codes[code] = null;
      continue;
    }
    const zero = units === 0 && (code === '原码' || code === '反码') ? encode(code, 0, n, { negativeZero: true }) : '';
    codes[code] = { bits: encode(code, units, n), zero };
  }
  return { units, binary: formatValue(units, n, notation), decimal: formatDecimal(units, n, notation), codes };
}

/** 教材写法：定点小数在符号位后加小数点；整数的移码在符号位后加逗号（p27）。 */
export function codeText(code: Code, bits: Bits, notation: Notation): string {
  if (notation === '小数') return formatBits(bits, '小数');
  return code === '移码' ? formatExcess(bits) : bits;
}

function emptyCell(): CodeCell {
  return { bits: '', text: '', zero: '', status: '', why: '' };
}

export function run(params: CodesParams): Trace<CodesParams, CodesState> {
  checkParams(params);
  const { n, notation, input } = params;
  const solution = solve(params);
  const { units } = solution;
  const top = 2 ** n;
  const negative = units < 0;
  const isMin = units === -top;
  const isZero = units === 0;
  const show = (code: Code, bits: Bits) => codeText(code, bits, notation);
  const value = (u: number) => formatValue(u, n, notation);
  const lsb = notation === '整数' ? '1' : `2^-${n}`;
  const width = n + 1;
  const modulus = notation === '整数' ? `2^${n + 1}` : '2';
  const offset = notation === '整数' ? `2^${n}` : '1';

  const initial: CodesState = {
    value: { binary: '', decimal: '' },
    codes: { 原码: emptyCell(), 反码: emptyCell(), 补码: emptyCell(), 移码: emptyCell() },
  };

  const range = (code: Code) => {
    const r = codeRange(code, n);
    return `${value(r.min)} 到 ${value(r.max)}`;
  };
  const conditions: Condition[] = [
    { label: '写法', value: NOTATION_NAME[notation] },
    { label: '字长', value: `${width} 位：1 个符号位加 ${n} 个数值位` },
    {
      label: '输入',
      value: input.as === '机器数' ? `[x]${input.code.slice(0, 1)} = ${input.bits}` : `x = ${input.text}`,
    },
    { label: '原码、反码的范围', value: range('原码') },
    { label: '补码、移码的范围', value: range('补码') },
  ];

  const builder = new TraceBuilder<CodesParams, CodesState>(ENGINE, params, initial, conditions);
  let count = 0;
  const push = (step: Parameters<typeof builder.step>[0]): string => {
    builder.step(step);
    count += 1;
    return `s${count}`;
  };

  const binary = solution.binary;
  const decimal = solution.decimal;

  // 1. 读真值
  let readTitle: string;
  let readWhy: string;
  let readRef: string;
  if (input.as === '十进制') {
    readTitle = `把 ${decimal} 化成二进制：x = ${binary}`;
    readWhy =
      notation === '整数'
        ? `整数部分反复除以 2 取余数，从下往上读；不够 ${n} 位的在左边补 0，凑满 ${n} 个数值位。`
        : `小数部分反复乘 2 取整数位，从上往下读；不够 ${n} 位的在右边补 0，凑满 ${n} 个数值位。`;
    readRef = '教材 p23';
  } else if (input.as === '真值') {
    readTitle = `真值 x = ${binary}，十进制是 ${decimal}`;
    readWhy = `${NOTATION_NAME[notation]}有 ${n} 个数值位，真值的二进制写满 ${n} 位，正负号单独写在前面。`;
    readRef = '教材 p23';
  } else {
    const given = parseBits(input.bits).bits;
    const sign = given.charAt(0);
    readTitle = `由 [x]${input.code.slice(0, 1)} = ${show(input.code, given)} 求真值：x = ${binary}（${decimal}）`;
    switch (input.code) {
      case '原码':
        readWhy = `原码的符号位 ${sign} 表示${sign === '1' ? '负' : '正'}，后面 ${n} 位就是 |x|。`;
        break;
      case '反码':
        readWhy =
          sign === '1'
            ? `反码符号位是 1，是负数；把数值位逐位取反回到 |x|。`
            : '反码符号位是 0，是正数，数值位就是 |x|。';
        break;
      case '补码':
        readWhy =
          notation === '整数'
            ? `按式 (2.8)，符号位的权是 −2^${n}，其余各位的权是正的，逐位相加：x = −2^${n}·${sign} 加上后面 ${n} 位的值。`
            : `定点小数补码的符号位权是 −1，第 i 个数值位的权是 2^-i，逐位相加。`;
        break;
      case '移码':
        readWhy = `[x]移 = ${offset} + x，所以 x = [x]移 − ${offset}：把整个码当无符号数，减去 ${offset}。`;
        break;
    }
    readRef = input.code === '补码' ? '教材 p26 式(2.8)' : input.code === '移码' ? '教材 p27 式(2.9)' : '教材 p25–27';
  }
  const stepRead = push({
    title: readTitle,
    why: readWhy,
    ref: readRef,
    focus: ['value.binary', 'value.decimal'],
    update: (s) => {
      s.value.binary = binary;
      s.value.decimal = decimal;
    },
  });

  const asks: Partial<Record<Code, Ask>> = {};
  if (isMin) {
    asks.原码 = {
      prompt: `x = ${binary}，${width} 位的原码能不能表示它？`,
      kind: 'choice',
      options: ['能', '不能'],
      answer: '不能',
      hint: `原码的数值位只有 ${n} 位，看 |x| 要几位。`,
    };
  }
  if (negative && !isMin) {
    asks.反码 = {
      prompt: `[x]原 = ${show('原码', solution.codes.原码?.bits ?? '')}，[x]反 是什么？`,
      kind: 'bits',
      answer: solution.codes.反码?.bits ?? '',
      hint: '负数的反码：符号位不动，只改数值位。',
    };
    asks.补码 = {
      prompt: `[x]反 = ${show('反码', solution.codes.反码?.bits ?? '')}，[x]补 是什么？`,
      kind: 'bits',
      answer: solution.codes.补码?.bits ?? '',
      hint: '在反码的最低位上加 1，进位照常向左传。',
    };
  }
  if (isZero) {
    asks.补码 = {
      prompt: '原码、反码的 0 都有两种写法。补码的 0 有几种写法？',
      kind: 'choice',
      options: ['一种', '两种'],
      answer: '一种',
      hint: `把 −0 的反码末位加 1，看进位到哪里去了，模是 ${modulus}。`,
    };
  }
  if (Object.keys(asks).length === 0) {
    asks.移码 = {
      prompt: `[x]补 = ${show('补码', solution.codes.补码?.bits ?? '')}，[x]移 是什么（不写逗号）？`,
      kind: 'bits',
      answer: solution.codes.移码?.bits ?? '',
      hint: `[x]移 = ${offset} + x，和补码比只差一位。`,
    };
  }

  const set = (s: CodesState, code: Code, bits: Bits, zero: Bits = '') => {
    s.codes[code] = { bits, text: show(code, bits), zero: zero === '' ? '' : show(code, zero), status: '有', why: '' };
  };
  const none = (s: CodesState, code: Code, why: string) => {
    s.codes[code] = { bits: '', text: '', zero: '', status: '无', why };
  };
  const tooBig = `|x| = 2^${n}${notation === '小数' ? '（即 1）' : ''}，数值位要 ${n + 1} 位才写得下，${n} 位放不下`;

  // 2. 原码
  const yuan = solution.codes.原码;
  const stepYuan = push({
    title: yuan
      ? isZero
        ? `[+0]原 = ${show('原码', yuan.bits)}，[−0]原 = ${show('原码', yuan.zero)}`
        : `[x]原 = ${show('原码', yuan.bits)}`
      : `x = ${binary} 没有原码`,
    why: yuan
      ? isZero
        ? `原码是符号位加 |x|。0 的数值位全是 0，符号位写 0 或 1 都表示 0，所以有 +0、−0 两种写法。`
        : `原码是符号位加 |x|：符号位写 ${negative ? '1 表示负' : '0 表示正'}，后面 ${n} 位照抄 |x| 的二进制（式 2.5）。`
      : `原码只能表示 ${range('原码')}：${tooBig}。`,
    ref: '教材 p25 式(2.5)',
    focus: ['codes.原码'],
    ...(asks.原码 ? { ask: asks.原码 } : {}),
    update: (s) => {
      if (yuan) set(s, '原码', yuan.bits, yuan.zero);
      else none(s, '原码', `原码只能表示 ${range('原码')}`);
    },
  });

  // 3. 反码
  const fan = solution.codes.反码;
  let fanWhy: string;
  if (!fan) fanWhy = `反码的范围和原码一样，也只到 ${range('反码')}，写不出 ${binary}。`;
  else if (isZero) fanWhy = '+0 的反码就是原码 000…0；−0 是负数的写法，数值位全部取反，得 111…1。两种都表示 0。';
  else if (!negative) fanWhy = '正数的反码与原码相同，不用变。';
  else fanWhy = '负数的反码：原码的符号位 1 不变，数值位逐位取反，0 变 1、1 变 0。';
  const stepFan = push({
    title: fan
      ? isZero
        ? `[+0]反 = ${show('反码', fan.bits)}，[−0]反 = ${show('反码', fan.zero)}`
        : `[x]反 = ${show('反码', fan.bits)}`
      : `x = ${binary} 没有反码`,
    why: fanWhy,
    ref: '教材 p26–27',
    focus: ['codes.原码', 'codes.反码'],
    ...(asks.反码 ? { ask: asks.反码 } : {}),
    update: (s) => {
      if (fan) set(s, '反码', fan.bits, fan.zero);
      else none(s, '反码', `反码只能表示 ${range('反码')}`);
    },
  });

  // 4. 补码
  const bu = solution.codes.补码;
  if (!bu) throw new Error('补码不应缺失');
  let buWhy: string;
  if (isMin) {
    buWhy =
      notation === '整数'
        ? `没有反码可加 1，直接按定义算：[x]补 = 2^${n + 1} + x = 2^${n + 1} − 2^${n} = 2^${n}，写成 ${width} 位就是 1 后面 ${n} 个 0（式 2.6）。补码的负数比原码多一个，就是它。`
        : `没有反码可加 1，直接按定义算：[x]补 = 2 + x = 2 − 1 = 1，写成 1.00…0（式 2.7）。所以定点小数补码能表示 −1。`;
  } else if (isZero) {
    buWhy = `+0 的补码是 000…0。−0 的反码 111…1 末位加 1，一路进位到符号位以外，按模 ${modulus} 丢掉后还是 000…0。所以补码的 0 只有一种写法。`;
  } else if (!negative) {
    buWhy = '正数的补码与原码相同，不用变。';
  } else {
    const fanBits = fan?.bits ?? '';
    const sum = rippleAdd(fanBits, '0'.repeat(n) + '1');
    buWhy = `负数的补码：反码的符号位 1 不变，最低位加 ${lsb}，得 ${show('补码', sum.sum)}。结果与按定义 ${modulus} + x 算出的相同（式 ${notation === '整数' ? '2.6' : '2.7'}）。`;
  }
  const stepBu = push({
    title: `[x]补 = ${show('补码', bu.bits)}`,
    why: buWhy,
    ref: isMin || isZero ? `教材 p25–26 式(${notation === '整数' ? '2.6' : '2.7'})` : '教材 p27',
    focus: ['codes.反码', 'codes.补码'],
    ...(asks.补码 ? { ask: asks.补码 } : {}),
    update: (s) => set(s, '补码', bu.bits),
  });

  // 5. 移码
  const yi = solution.codes.移码;
  if (!yi) throw new Error('移码不应缺失');
  const yiWhy =
    notation === '整数'
      ? `移码是在真值上加偏移量 2^${n}：[x]移 = 2^${n} + x（式 2.9），写成 ${width} 位，逗号只标出左边一位是符号位。`
      : `教材的移码只定义了整数阶码。这里按同样的办法把偏移量取成 1：[x]移 = 1 + x，写成 ${width} 位。`;
  const stepYi = push({
    title: `[x]移 = ${show('移码', yi.bits)}`,
    why: `${yiWhy}符号位 1 表示正、0 表示负，与原码、补码相反。`,
    ref: '教材 p27 式(2.9)',
    focus: ['codes.移码'],
    ...(asks.移码 ? { ask: asks.移码 } : {}),
    update: (s) => set(s, '移码', yi.bits),
  });

  // 6. 核对：补码和移码只差符号位
  const flipped = (bu.bits.charAt(0) === '1' ? '0' : '1') + bu.bits.slice(1);
  if (flipped !== yi.bits) throw new Error('补码与移码应只差符号位');
  push({
    title: `[x]补 = ${show('补码', bu.bits)}，[x]移 = ${show('移码', yi.bits)}：只有符号位不同`,
    why: `两者相差 ${notation === '整数' ? `2^${n}` : '1'}，正好是符号位的权；所以把补码的符号位取反就得到移码。${isMin ? '−2^n 在补码里是最小的负数，在移码里是全 0。' : ''}`,
    ref: '教材 p29–30 例2.8',
    focus: ['codes.补码.bits', 'codes.移码.bits'],
    update: () => undefined,
  });

  const cell = (code: Code) => {
    const c = solution.codes[code];
    if (!c) return '无';
    return c.zero === '' ? show(code, c.bits) : `${show(code, c.bits)} 或 ${show(code, c.zero)}`;
  };
  const table: SolutionTable = {
    columns: ['量', '机器数', '怎么得到'],
    rows: [
      { cells: ['真值 x', `${binary}（${decimal}）`, input.as === '十进制' ? '十进制化成二进制' : input.as === '真值' ? '题目给出' : `由 [x]${input.code.slice(0, 1)} 还原`], step: stepRead },
      { cells: ['[x]原', cell('原码'), yuan ? '符号位加 |x|' : `|x| 超出 ${n} 位`], step: stepYuan },
      { cells: ['[x]反', cell('反码'), !fan ? `|x| 超出 ${n} 位` : negative ? '原码数值位取反' : '与原码相同'], step: stepFan },
      { cells: ['[x]补', cell('补码'), isMin ? '按定义' : negative ? '反码末位加 1' : '与原码相同'], step: stepBu },
      { cells: ['[x]移', cell('移码'), '补码符号位取反'], step: stepYi },
    ],
  };

  return builder.finish(
    {
      真值: binary,
      十进制: decimal,
      '[x]原': cell('原码'),
      '[x]反': cell('反码'),
      '[x]补': cell('补码'),
      '[x]移': cell('移码'),
    },
    table,
  );
}

/** 出题：同一个种子同一组参数。约一成落在边界值上。 */
export function generate(seed: number): CodesParams {
  const rng = makeRandom(seed);
  const notation: Notation = rng.chance(0.7) ? '整数' : '小数';
  const n = notation === '整数' ? rng.pick([7, 7, 7, 5, 6, 8]) : rng.pick([4, 5, 6, 7]);
  const top = 2 ** n;
  let units: number;
  if (rng.chance(0.12)) {
    units = rng.pick([-top, 0, top - 1, -(top - 1), -1]);
  } else {
    do units = rng.int(-(top - 1), top - 1);
    while (Math.abs(units) < 3);
  }
  const form = rng.next();
  if (form < 0.55) return { n, notation, input: { as: '十进制', text: formatDecimal(units, n, notation).replace('−', '-') } };
  if (form < 0.8) return { n, notation, input: { as: '真值', text: formatValue(units, n, notation).replace('−', '-') } };
  const choices: Code[] = units === -top ? ['补码', '移码'] : ['原码', '反码', '补码', '补码', '移码'];
  const code = rng.pick(choices);
  const bits = encode(code, units, n);
  return { n, notation, input: { as: '机器数', code, bits: notation === '小数' ? formatBits(bits, '小数') : bits } };
}

