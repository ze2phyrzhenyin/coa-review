/**
 * 四种码的场景：上面一块「真值 x」，下面四格，每格是一排位片（这种码的机器码）和一个码盘。
 * 码盘是 n+1 位的全部 2^(n+1) 种写法排成一圈，指针指 x 的机器码；同一个 x 在四个盘上指的格子不同。
 * 宽屏两行两列，按 原码 → 反码 → 补码 → 移码 顺时针排；窄屏一列，镜头跟着当前的码走。
 * 位串、真值、有没有都取自引擎的 Trace；盘边的字和学生答错时的读数用位串库 decode 读出，不另算。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import type { CodesParams, CodesState } from '../../engines/codes/model';
import { codeText } from '../../engines/codes/model';
import { decode, formatDecimal, fromUnsigned, isNegativeZero } from '../../lib/bits';
import type { Code, Notation } from '../../lib/bits';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export const CODES: Code[] = ['原码', '反码', '补码', '移码'];
const SHORT: Record<Code, string> = { 原码: '原', 反码: '反', 补码: '补', 移码: '移' };
export const tag = (code: Code) => `[x]_{${SHORT[code]}}`;

export const CODES_QUESTION_TEXT = '同一个 x 放到四个码盘上，哪种码写不下它，0 占几格，补码和移码的指针差多少';
export const CODES_CONCLUSION =
  '原码、反码的 0 有 +0、−0 两种写法，占掉 1 后面全 0（反码是全 1）那一格，只能表示 ±(2^n − 1)；补码、移码的 0 只有一种，空出的那一格给了 −2^n，所以 −128 只有 8 位补码和移码。移码是补码的符号位取反，指针差半圈。';

export interface CodesScene {
  scene: SceneSpec;
  bind: Binding<CodesState>;
  moves: (step: Step<CodesState>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  flipPart: (ask: Ask, index: number) => string | null;
  wrong: (ask: Ask, value: string, state: CodesState, next: Step<CodesState> | null) => Breakage | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<CodesState>) => string[] | null;
  mistakes: Mistake<CodesState>[];
  convention: (step: Step<CodesState>) => string | null;
  question: { text: string; at: string[] };
}

/** 这一步写的是哪一种码（看状态里哪种码的 status 变了）。 */
export function codeOf(step: Step<CodesState> | undefined | null): Code | null {
  if (!step) return null;
  for (const code of CODES) if (step.changes.some((change) => change.at.startsWith(`codes.${code}.`))) return code;
  return null;
}

const plain = (text: string) => text.replace(/[^01]/g, '');

/** 一种码在盘上关键的四格：0、正数最大、1 后面全 0、全 1。 */
export function ringMarks(code: Code, n: number, notation: Notation): [number, string, boolean?][] {
  const half = 2 ** n;
  const size = 2 * half;
  return [0, half - 1, half, size - 1].map((k) => {
    const bits = fromUnsigned(k, n + 1);
    const units = decode(code, bits);
    const text = isNegativeZero(code, bits) ? '−0' : units === 0 ? (code === '原码' || code === '反码' ? '+0' : '0') : `${units > 0 ? '+' : ''}${formatDecimal(units, n, notation)}`;
    return [k, text, units === 0];
  });
}

/** 一个位串在某种码的盘上读成多少。 */
export function readOn(code: Code, bits: string, n: number, notation: Notation): string {
  if (isNegativeZero(code, bits)) return '−0';
  const units = decode(code, bits);
  return units === 0 ? '0' : `${units > 0 ? '+' : ''}${formatDecimal(units, n, notation)}`;
}

/** 位的名字：符号位，或数值位的权。 */
export function bitName(i: number, n: number, notation: Notation): string {
  if (i === 0) return '符号位';
  return notation === '整数' ? `权 2^${n - i} 的位` : `权 2^-${i} 的位`;
}

export function codesScene(trace: Trace<CodesParams, CodesState>, compact = false): CodesScene {
  const { n, notation } = trace.params;
  const half = 2 ** n;
  const size = 2 * half;
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<CodesState>>[0] = {};
  const blank = ' '.repeat(n + 1);
  const R = 1.3;
  // 宽屏：原 左上，反 右上，补 右下，移 左下。窄屏：一列。
  const COL = Math.max(3.3, (n + 1) * 0.28 + 1.6);
  const cells: Record<Code, [number, number]> = compact
    ? { 原码: [0, 0], 反码: [0, 6.0], 补码: [0, 12.0], 移码: [0, 18.0] }
    : { 原码: [-COL, 0], 反码: [COL, 0], 补码: [COL, 5.1], 移码: [-COL, 5.1] };

  parts.push({ id: 'x', kind: 'register', position: [0, -1.9], props: { name: '真值 x', value: '', width: 4.8 }, title: '真值 x' });
  table.x = { value: from(['value.binary', 'value.decimal'], (c) => (c.state.value.binary ? `${c.state.value.binary}（${c.state.value.decimal}）` : '')) };

  for (const code of CODES) {
    const [cx, cz] = cells[code];
    const bitsId = `bits-${code}`;
    const ringId = `ring-${code}`;
    // 位片稍往右，左边留给名牌。
    parts.push({ id: bitsId, kind: 'bits', position: [cx + 0.45, cz], props: { name: tag(code), bits: blank, group: notation === '小数' ? n + 1 : 4 }, title: tag(code), delay: 0 });
    table[bitsId] = { bits: from(`codes.${code}.bits`, (c) => c.state.codes[code].bits || blank) };
    parts.push({
      id: ringId,
      kind: '2-codes:ring',
      position: [compact ? cx : cx - 0.9, cz + 2.7],
      props: { name: '', size, marks: ringMarks(code, n, notation), neg: code === '移码' ? [0, half] : [half, half], pointer: -1, ghost: -1, reading: '', empty: '', from: -1, dir: 1, below: compact },
      title: `${code}的码盘`,
      describe: (p) => `${code}的码盘，${String(p.reading || '指针还没放')}`,
    });
    table[ringId] = {
      pointer: from(`codes.${code}.bits`, (c) => (c.state.codes[code].status === '有' ? parseInt(c.state.codes[code].bits, 2) : -1)),
      ghost: from(`codes.${code}.zero`, (c) => (c.state.codes[code].zero ? parseInt(plain(c.state.codes[code].zero), 2) : -1)),
      reading: from(`codes.${code}.status`, (c) => {
        const cell = c.state.codes[code];
        if (cell.status === '无') return '写不下';
        if (cell.status !== '有') return '';
        return cell.zero ? `−0 是 ${cell.zero}` : `指 ${c.state.value.decimal}`;
      }),
      empty: from(`codes.${code}.status`, (c) => (c.state.codes[code].status === '无' ? '无' : '')),
    };
  }

  const scene: SceneSpec = { parts, wires: [], kinds: () => import('./parts') };
  const bind = bindTable<CodesState>(table);
  const show = (code: Code, bits: string) => codeText(code, bits, notation);

  const source: Record<Code, string> = { 原码: 'x', 反码: 'bits-原码', 补码: 'bits-反码', 移码: 'bits-补码' };
  const moves = (step: Step<CodesState>): Move[] => {
    const code = codeOf(step);
    if (!code) return [];
    const cell = step.state.codes[code];
    if (cell.status === '无') return [{ value: step.state.value.binary, from: 'x', to: `ring-${code}`, arc: true }];
    // −2^n 没有反码可加 1，按定义从真值直接写；正数的反码、补码与原码相同，也从原码那一排来。
    const isMin = step.state.codes.反码.status === '无' && code === '补码';
    const start = isMin ? 'x' : source[code];
    return [
      { value: show(code, cell.bits), from: start, to: `bits-${code}`, arc: true },
      { value: show(code, cell.bits), from: `bits-${code}`, to: `ring-${code}`, arc: true, phase: 1 },
    ];
  };

  const names = (path: string): string => {
    if (path === 'value.binary') return '真值 x';
    if (path === 'value.decimal') return 'x 的十进制';
    const match = /^codes\.(\S+?)\.(\w+)$/.exec(path);
    if (match) {
      const code = match[1] as Code;
      if (match[2] === 'zero') return `${tag(code)} 的 −0`;
      return tag(code);
    }
    return path;
  };
  const values = (path: string, value: string): string => (path.endsWith('.status') && value === '无' ? '写不下' : value);

  const flipPart = (ask: Ask, index: number): string | null => {
    if (ask.kind !== 'bits') return null;
    const code = codeOf(trace.steps[index]);
    return code ? `bits-${code}` : null;
  };

  const before: Record<Code, Code | null> = { 原码: null, 反码: '原码', 补码: '反码', 移码: '补码' };
  const askFrame = (ask: Ask, index: number): string[] => {
    const code = codeOf(trace.steps[index]);
    if (!code) return [];
    const prev = before[code];
    if (ask.kind === 'bits') return compact ? [`bits-${code}`] : [...(prev ? [`bits-${prev}`] : ['x']), `bits-${code}`, `ring-${code}`];
    return compact ? [`ring-${code}`] : ['x', `bits-${code}`, `ring-${code}`];
  };

  /** 学生写的位串放到这种码的盘上：指针指过去，读数写出它其实是多少。 */
  const onRing = (code: Code, bits: string, note: string): Breakage['patch'] => ({
    [`bits-${code}`]: { bits },
    [`ring-${code}`]: { pointer: parseInt(bits, 2), ghost: -1, empty: '', reading: `${compact ? (note.includes('是') ? '是 ' : '指 ') : note}${readOn(code, bits, n, notation)}` },
  });

  const wrong = (ask: Ask, value: string, state: CodesState, next: Step<CodesState> | null): Breakage | null => {
    const code = codeOf(next);
    if (!code || !next) return null;
    const x = next.state.value.decimal;
    if (ask.kind === 'bits') {
      const got = plain(value);
      const want = plain(ask.answer);
      if (got.length !== want.length) return null;
      const at = [...want].findIndex((bit, i) => got[i] !== bit);
      const read = readOn(code, got, n, notation);
      return {
        label: '',
        patch: onRing(code, got, '按你写的指 '),
        moves: [{ value: show(code, got), from: `bits-${code}`, to: `ring-${code}`, arc: true }],
        message: `${show(code, got)} 在${code}盘上指 ${read}，x 是 ${x}。左起第 ${at + 1} 位（${bitName(at, n, notation)}）不对。`,
      };
    }
    if (ask.answer === '不能' && value === '能') {
      const guess = `1${'0'.repeat(n)}`;
      return {
        label: '',
        patch: onRing(code, guess, '这一格是 '),
        moves: [{ value: state.value.binary, from: 'x', to: `ring-${code}`, arc: true }],
        message: `${show(code, guess)} 在原码盘上是 −0：原码的数值位只有 ${n} 位，装不下 |x| = 2^${n}。`,
      };
    }
    if (ask.answer === '一种' && value === '两种') {
      return {
        label: '',
        patch: { [`ring-${code}`]: { ghost: half, reading: `${compact ? '' : '1 后面全 0 '}是 ${readOn(code, fromUnsigned(half, n + 1), n, notation)}` } },
        moves: [{ value: show(code, fromUnsigned(half, n + 1)), from: `bits-${code}`, to: `ring-${code}`, arc: true }],
        message: `补码盘上 1 后面全 0 那一格读成 ${readOn(code, fromUnsigned(half, n + 1), n, notation)}，不是 −0。−0 的反码加 1，进位出了符号位按模丢掉，落回 0 那一格。`,
      };
    }
    // 练习里「写得出吗」：选错时按学生的说法演。
    if (ask.options?.includes('写得出') && value !== ask.answer) {
      if (value === '写得出') {
        const guess = code === '反码' ? `1${'1'.repeat(n)}` : `1${'0'.repeat(n)}`;
        return {
          label: '',
          patch: onRing(code, guess, '这一格是 '),
          moves: [{ value: state.value.binary, from: 'x', to: `ring-${code}`, arc: true }],
          message: `${code}盘上最靠近的那一格 ${show(code, guess)} 读成 ${readOn(code, guess, n, notation)}。${code}只能到 ±(2^${n} − 1)。`,
        };
      }
      return {
        label: '',
        patch: { [`ring-${code}`]: { empty: '无', pointer: -1, reading: '写不下？' } },
        moves: [{ value: state.value.binary, from: 'x', to: `ring-${code}`, arc: true }],
        message: `x 在${code}的范围里，盘上有它的格子。看条件里的范围。`,
      };
    }
    return null;
  };

  const frame = (step: Step<CodesState>): string[] | null => {
    // 最后核对补码和移码：两排位片和两个盘一起看。
    if (step.changes.length === 0 && step.state.codes.移码.status === '有') return compact ? ['bits-补码', 'bits-移码'] : ['bits-补码', 'bits-移码', 'ring-补码', 'ring-移码'];
    return null;
  };

  const stepOf = (code: Code) => trace.steps.findIndex((step) => codeOf(step) === code) + 1;
  const final = trace.steps[trace.steps.length - 1]?.state ?? trace.initial;
  const mistakes: Mistake<CodesState>[] = [];
  const bu = final.codes.补码.bits;
  const fan = final.codes.反码.bits;
  const units = bu ? decode('补码', bu) : 0;
  if (units < 0 && fan) {
    mistakes.push({
      text: '容易把反码当成补码，因为忘了末位加 1',
      at: stepOf('补码'),
      act: () => ({
        label: '',
        patch: onRing('补码', fan, '少加 1，指 '),
        moves: [
          { value: show('反码', fan), from: 'bits-反码', to: 'bits-补码', arc: true },
          { value: show('补码', fan), from: 'bits-补码', to: 'ring-补码', arc: true, phase: 1 },
        ],
        message: `少加 1，补码盘上的指针差一格，读出来是 ${readOn('补码', fan, n, notation)}，不是 ${final.value.decimal}。`,
      }),
    });
  }
  if (final.codes.补码.status === '有' && units === 0) {
    mistakes.push({
      text: '容易以为补码也有 −0，因为原码、反码都有两个 0',
      at: stepOf('补码'),
      act: () => ({
        label: '',
        patch: { 'ring-补码': { ghost: half, reading: `${compact ? '' : '1 后面全 0 '}是 ${readOn('补码', fromUnsigned(half, n + 1), n, notation)}` } },
        moves: [{ value: show('补码', fromUnsigned(half, n + 1)), from: 'bits-补码', to: 'ring-补码', arc: true }],
        message: `补码盘上 1 后面全 0 那一格已经给了 ${readOn('补码', fromUnsigned(half, n + 1), n, notation)}。补码一圈 ${size} 格，${size} 个不同的数，没有哪一格是 −0。`,
      }),
    });
  }
  mistakes.push({
    text: '容易把 1 后面全 0 的原码当成 −2^n，因为补码里它就是 −2^n',
    at: stepOf('原码'),
    act: () => ({
      label: '',
      patch: onRing('原码', `1${'0'.repeat(n)}`, '这一格是 '),
      moves: [{ value: show('原码', `1${'0'.repeat(n)}`), from: 'bits-原码', to: 'ring-原码', arc: true }],
      message: `原码只看后 ${n} 位的大小，1 后面全 0 是 −0。原码最小只到 −(2^${n} − 1)，这里是 ${formatDecimal(-(half - 1), n, notation)}。`,
    }),
  });
  if (bu && mistakes.length < 3) {
    mistakes.push({
      text: '容易把移码的符号位写成和补码一样，因为两种码的数值位相同',
      at: stepOf('移码'),
      act: () => ({
        label: '',
        patch: onRing('移码', bu, '符号位没取反，指 '),
        moves: [
          { value: show('补码', bu), from: 'bits-补码', to: 'bits-移码', arc: true },
          { value: show('移码', bu), from: 'bits-移码', to: 'ring-移码', arc: true, phase: 1 },
        ],
        message: `移码 = ${notation === '整数' ? `2^${n}` : '1'} + x，和补码差 ${notation === '整数' ? `2^${n}` : '1'}，正好是符号位的权。符号位不取反，移码盘上读出 ${readOn('移码', bu, n, notation)}。`,
      }),
    });
  }

  const convention = (step: Step<CodesState>): string | null =>
    notation === '小数' && codeOf(step) === '移码' ? '教材的移码只对整数定义（p27）；定点小数这里按 1 + x 写，任课老师可能不要求。' : null;

  const question = { text: CODES_QUESTION_TEXT, at: compact ? ['x', 'bits-原码'] : ['ring-原码', 'ring-反码', 'ring-补码', 'ring-移码'] };
  return { scene, bind, moves, names, values, flipPart, wrong, askFrame, frame, mistakes, convention, question };
}
