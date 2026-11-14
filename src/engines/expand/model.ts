/**
 * 存储器容量扩充引擎（教材 3.2.4，p76–77，例 3.1、例 3.2）。规格见 specs/3-expand.md。
 *
 * 容量写成「字数 × 位数」，K = 2^10，M = 2^20。位扩展：各片地址线、控制线共用，数据线分开；
 * 字扩展：片内地址线、数据线、读写线共用，高位地址经译码器产生片选。字位扩展先位扩展再字扩展。
 * 状态路径（d、chips.3.data、ranges.0.from …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'expand';
export const MAX_GROUPS = 16;
export const MAX_PER_GROUP = 16;

export interface Chip {
  /** 字数：2 的幂，可写数字或「2048K」「1M」这样的串。 */
  words: number | string;
  /** 位数。 */
  bits: number;
}

export interface Params {
  target: Chip;
  chip: Chip;
  /** 可选：看这个地址选中哪一组。 */
  probe?: number;
}

export interface ChipWire {
  group: number;
  index: number;
  /** 接哪几根数据线，如 D7–D4。 */
  data: string;
  /** 片选接什么，如 Y2。 */
  select: string;
}

export interface Range {
  group: number;
  select: string;
  from: string;
  to: string;
}

export interface Probe {
  address: string;
  bits: string;
  group: number | null;
  inner: string;
}

export interface State {
  d: number | null;
  perGroup: number | null;
  groups: number | null;
  /** 接每一片的片内地址线，如 A17–A0。 */
  chipLines: string;
  /** 进译码器的地址线；没有为空串。 */
  decoderLines: string;
  /** 译码器，如 3:8 译码器。 */
  decoder: string;
  chips: ChipWire[];
  ranges: Range[];
  probe: Probe | null;
}

/** 由参数算出的全部接法。 */
export interface Plan {
  kind: '位扩展' | '字扩展' | '字位扩展';
  targetWords: number;
  chipWords: number;
  d: number;
  perGroup: number;
  groups: number;
  /** 目标地址位数 n 和芯片地址位数 k。 */
  n: number;
  k: number;
  chipLines: string;
  decoderLines: string;
  decoder: string;
  chips: ChipWire[];
  ranges: Range[];
}

const UNITS: Record<string, number> = { '': 1, K: 2 ** 10, M: 2 ** 20, G: 2 ** 30 };

/** 字数：数字原样，串按 K、M、G 换算。不合格返回 null。 */
export function parseWords(words: unknown): number | null {
  if (typeof words === 'number') return Number.isInteger(words) && words > 0 ? words : null;
  if (typeof words !== 'string') return null;
  const m = /^\s*(\d+)\s*([KMG]?)\s*$/i.exec(words);
  if (!m) return null;
  const value = Number(m[1]) * (UNITS[(m[2] ?? '').toUpperCase()] ?? 1);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 2 的幂写成 1M、256K 这样。 */
export function sizeText(n: number): string {
  if (n >= 2 ** 30 && n % 2 ** 30 === 0) return `${n / 2 ** 30}G`;
  if (n >= 2 ** 20 && n % 2 ** 20 === 0) return `${n / 2 ** 20}M`;
  if (n >= 2 ** 10 && n % 2 ** 10 === 0) return `${n / 2 ** 10}K`;
  return String(n);
}

/** 字数的写法：给的是串就原样，是数字就换成 K、M。 */
function wordsText(chip: Chip): string {
  return typeof chip.words === 'string' ? chip.words.trim().toUpperCase() : sizeText(chip.words);
}

const capacity = (chip: Chip): string => `${wordsText(chip)}×${chip.bits} 位`;

function isPowerOfTwo(n: number): boolean {
  let x = n;
  while (x % 2 === 0) x /= 2;
  return x === 1;
}

function log2(n: number): number {
  let bits = 0;
  for (let x = n; x > 1; x /= 2) bits += 1;
  return bits;
}

/** 一段地址线，如 A17–A0；只有一根时写 A5。 */
export function lines(prefix: string, high: number, low: number): string {
  if (high < low) return '';
  return high === low ? `${prefix}${high}` : `${prefix}${high}–${prefix}${low}`;
}

/** 地址的十六进制写法，补足位数，带 H。 */
export function hex(value: number, bits: number): string {
  return `${value.toString(16).toUpperCase().padStart(Math.max(1, Math.ceil(bits / 4)), '0')}H`;
}

/** 参数有什么问题。空表示可以运行。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const t = params?.target as Partial<Chip> | undefined;
  const c = params?.chip as Partial<Chip> | undefined;
  const tw = parseWords(t?.words);
  const cw = parseWords(c?.words);
  if (tw === null || !isPowerOfTwo(tw) || tw > 2 ** 30) problems.push('目标字数必须是 2 的幂，不超过 1G');
  if (cw === null || !isPowerOfTwo(cw)) problems.push('芯片字数必须是 2 的幂');
  const okBits = (b: unknown): b is number => typeof b === 'number' && Number.isInteger(b) && b >= 1 && b <= 64;
  if (!okBits(t?.bits)) problems.push('目标位数必须是 1 到 64 的整数');
  if (!okBits(c?.bits)) problems.push('芯片位数必须是 1 到 64 的整数');
  if (problems.length > 0) return problems;
  const tb = t?.bits as number;
  const cb = c?.bits as number;
  if ((cw as number) > (tw as number)) problems.push('芯片字数比目标还多，用不着字扩展；换小一点的芯片或大一点的目标');
  if (cb > tb || tb % cb !== 0) problems.push('目标位数必须是芯片位数的整数倍');
  if (problems.length > 0) return problems;
  const groups = (tw as number) / (cw as number);
  const perGroup = tb / cb;
  if (groups * perGroup < 2) problems.push('一片就够了，不需要扩充');
  if (groups > MAX_GROUPS) problems.push(`组数不能超过 ${MAX_GROUPS}`);
  if (perGroup > MAX_PER_GROUP) problems.push(`每组片数不能超过 ${MAX_PER_GROUP}`);
  if (params.probe !== undefined) {
    const p = params.probe;
    if (typeof p !== 'number' || !Number.isInteger(p) || p < 0 || p >= (tw as number)) problems.push(`要查的地址必须是 0 到 ${(tw as number) - 1} 的整数`);
  }
  return problems;
}

/** 芯片数、分组、各片接线、各组地址范围。参数要先通过 validateParams。 */
export function plan(params: Params): Plan {
  const targetWords = parseWords(params.target.words) ?? 1;
  const chipWords = parseWords(params.chip.words) ?? 1;
  const b = params.chip.bits;
  const perGroup = params.target.bits / b;
  const groups = targetWords / chipWords;
  const n = log2(targetWords);
  const k = log2(chipWords);
  const h = n - k;
  const kind = groups === 1 ? '位扩展' : perGroup === 1 ? '字扩展' : '字位扩展';
  const select = (g: number): string => (groups === 1 ? '片选（共用）' : `Y${g}`);
  const chips: ChipWire[] = [];
  for (let g = 0; g < groups; g += 1) {
    for (let j = 0; j < perGroup; j += 1) {
      chips.push({ group: g, index: j, data: lines('D', (j + 1) * b - 1, j * b), select: select(g) });
    }
  }
  const ranges: Range[] =
    groups === 1
      ? []
      : Array.from({ length: groups }, (_, g) => ({
          group: g,
          select: select(g),
          from: hex(g * chipWords, n),
          to: hex((g + 1) * chipWords - 1, n),
        }));
  return {
    kind,
    targetWords,
    chipWords,
    d: groups * perGroup,
    perGroup,
    groups,
    n,
    k,
    chipLines: lines('A', k - 1, 0),
    decoderLines: groups === 1 ? '' : lines('A', n - 1, k),
    decoder: groups === 1 ? '' : `${h}:${2 ** h} 译码器`,
    chips,
    ranges,
  };
}

/** 选择题的选项：正确答案，和把片内地址线、全部地址线当片选的两个错答。 */
function decoderOptions(p: Plan): string[] {
  const options = [p.decoderLines];
  for (const o of [p.chipLines, lines('A', p.n - 1, 0)]) if (o && !options.includes(o)) options.push(o);
  if (options.length < 2) options.push(lines('A', p.n, p.k));
  return options;
}

/** 按教材的顺序算芯片数、分组、接线。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`容量扩充参数不对：${problems.join('；')}`);
  const p = plan(params);
  const target = capacity(params.target);
  const chip = capacity(params.chip);
  const tb = params.target.bits;
  const cb = params.chip.bits;
  const conditions: Condition[] = [
    { label: '目标', value: target },
    { label: '芯片', value: chip },
    { label: '单位', value: 'K = 2^10，M = 2^20' },
  ];
  if (p.groups > 1) conditions.push({ label: '译码器输出', value: 'Y0、Y1…（图 3.8 写作 sel0、sel1…），低电平有效' });
  const initial: State = { d: null, perGroup: null, groups: null, chipLines: '', decoderLines: '', decoder: '', chips: [], ranges: [], probe: null };
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditions);
  const table: SolutionTable = { columns: ['项目', '算式或接法', '结果'], rows: [] };
  let n = 0;
  const add = (label: string, how: string, value: string): void => {
    table.rows.push({ cells: [label, how, value], step: `s${n}` });
  };

  // 1. 芯片数；不用扩展的那一维在这一步直接写 1。
  const notes: string[] = [];
  if (p.perGroup === 1) notes.push(`芯片和目标都是 ${tb} 位，不用位扩展，每组 1 片`);
  if (p.groups === 1) notes.push(`芯片和目标都是 ${wordsText(params.target)} 个字，不用字扩展，只有 1 组，也不要译码器`);
  builder.step({
    title: `需要 ${p.d} 片，${p.kind}`,
    why:
      `芯片数 = 要求的容量 ÷ 一片的容量 = (${target.replace(' 位', '')}) / (${chip.replace(' 位', '')}) = ${p.d}。两边都按「字数 × 位数」写，单位才对得上。` +
      (notes.length > 0 ? `${notes.join('；')}。` : '字数和位数都不够，先位扩展，再字扩展。'),
    ref: '教材 p76–77',
    focus: ['d'],
    update: (s) => {
      s.d = p.d;
      if (p.perGroup === 1) {
        s.perGroup = 1;
        s.chips = p.chips.map((c) => ({ ...c, select: '' }));
      }
      if (p.groups === 1) s.groups = 1;
    },
  });
  n += 1;
  add('芯片数 d', `(${target.replace(' 位', '')}) / (${chip.replace(' 位', '')})`, `${p.d} 片`);

  // 2. 位扩展
  if (p.perGroup > 1) {
    const groupChips = p.chips.filter((c) => c.group === 0);
    builder.step({
      title: `位扩展：每 ${p.perGroup} 片并成一组，组成 ${wordsText(params.chip)}×${tb} 位`,
      why:
        `一片只有 ${cb} 位，要 ${tb} 位，得 ${tb} ÷ ${cb} = ${p.perGroup} 片同时工作。` +
        `组内各片的地址线、控制线接在一起，数据线分开：${groupChips.map((c) => `第 ${c.index} 片接 ${c.data}`).join('，')}。`,
      ref: '教材 p76 例 3.1',
      focus: ['perGroup', ...groupChips.map((_, j) => `chips.${j}.data`)],
      update: (s) => {
        s.perGroup = p.perGroup;
        s.chips = p.chips.map((c) => ({ ...c, select: '' }));
      },
    });
    n += 1;
  }
  add('每组片数', `${tb} 位 ÷ ${cb} 位`, String(p.perGroup));

  // 3. 字扩展
  if (p.groups > 1) {
    builder.step({
      title: `字扩展：共 ${p.groups} 组，分时工作`,
      why: `一组只有 ${wordsText(params.chip)} 个字，要 ${wordsText(params.target)} 个字，得 ${sizeText(p.targetWords)} ÷ ${sizeText(p.chipWords)} = ${p.groups} 组。同一时刻只让一组工作，各组的数据线、片内地址线、读写线都共用。`,
      ref: '教材 p77 例 3.2',
      focus: ['groups'],
      update: (s) => {
        s.groups = p.groups;
      },
    });
    n += 1;
  }
  add('组数', `${sizeText(p.targetWords)} ÷ ${sizeText(p.chipWords)}`, String(p.groups));

  // 4. 地址线
  const ask: Ask | undefined =
    p.groups > 1
      ? {
          prompt: '进译码器的是哪几位',
          kind: 'choice',
          options: decoderOptions(p),
          answer: p.decoderLines,
          hint: `一片 ${wordsText(params.chip)} 个字，片内地址要用掉低 ${p.k} 位。`,
        }
      : undefined;
  builder.step({
    title: p.groups > 1 ? `${p.chipLines} 接每一片，${p.decoderLines} 进 ${p.decoder}` : `${p.chipLines} 接每一片，片选共用`,
    why:
      `目标 ${wordsText(params.target)} 个字 = 2^${p.n}，地址 ${p.n} 位；一片 ${wordsText(params.chip)} 个字 = 2^${p.k}，片内地址 ${p.k} 位，用低位 ${p.chipLines}。` +
      (p.groups > 1
        ? `剩下的高 ${p.n - p.k} 位 ${p.decoderLines} 正好区分 ${p.groups} 组，送进 ${p.decoder}，Yi 接第 i 组每一片的片选。`
        : '只有一组，所有芯片同时选中，片选和读写线都接在一起。'),
    ref: p.groups > 1 ? '教材 p77 图 3.8' : '教材 p76 图 3.7',
    focus: ['chipLines', 'decoderLines', 'decoder'],
    ...(ask ? { ask } : {}),
    update: (s) => {
      s.chipLines = p.chipLines;
      s.decoderLines = p.decoderLines;
      s.decoder = p.decoder;
      s.chips = p.chips.map((c) => ({ ...c }));
    },
  });
  n += 1;
  add('片内地址线', `${wordsText(params.chip)} = 2^${p.k}`, `${p.chipLines} 接每片`);
  if (p.groups > 1) add('片选', `${p.groups} 组 = 2^${p.n - p.k}`, `${p.decoderLines} 进 ${p.decoder}`);

  // 5. 每组地址范围
  for (const r of p.ranges) {
    builder.step({
      title: `第 ${r.group} 组（${r.select}）：${r.from}–${r.to}`,
      why: `${p.decoderLines} 为 ${r.group.toString(2).padStart(p.n - p.k, '0')} 时 ${r.select} 有效，选中第 ${r.group} 组；片内地址从全 0 到全 1，共 ${wordsText(params.chip)} 个字。`,
      ref: '教材 p77 图 3.8',
      focus: [`ranges.${r.group}`],
      update: (s) => {
        s.ranges.push({ ...r });
      },
    });
    n += 1;
    add(`第 ${r.group} 组`, r.select, `${r.from}–${r.to}`);
  }

  const result: Record<string, string> = {
    扩展方式: p.kind,
    芯片数: String(p.d),
    每组片数: String(p.perGroup),
    组数: String(p.groups),
    片内地址线: p.chipLines,
    译码地址线: p.decoderLines || '无',
  };
  if (p.groups > 1) result['地址范围'] = p.ranges.map((r) => `${r.select}：${r.from}–${r.to}`).join('；');

  // 6. 查地址
  if (params.probe !== undefined) {
    const address = params.probe;
    const group = Math.floor(address / p.chipWords);
    const inner = hex(address % p.chipWords, p.k);
    const bits = address.toString(2).padStart(p.n, '0');
    const high = bits.slice(0, p.n - p.k);
    builder.step({
      title: p.groups > 1 ? `地址 ${hex(address, p.n)} 选中第 ${group} 组` : `地址 ${hex(address, p.n)}，片内地址 ${inner}`,
      why:
        `${hex(address, p.n)} = ${bits}。` +
        (p.groups > 1 ? `高 ${p.n - p.k} 位 ${high} 进译码器，Y${group} 有效，第 ${group} 组的 ${p.perGroup} 片工作；` : '所有芯片一起工作；') +
        `低 ${p.k} 位送进芯片，片内地址 ${inner}。`,
      ref: '教材 p77',
      focus: ['probe'],
      ...(p.groups > 1 ? { ask: { prompt: '选中第几组', kind: 'number' as const, answer: String(group), hint: '看高位地址的取值。' } } : {}),
      update: (s) => {
        s.probe = { address: hex(address, p.n), bits, group: p.groups > 1 ? group : null, inner };
      },
    });
    n += 1;
    result['选中'] = p.groups > 1 ? `第 ${group} 组（Y${group}），片内地址 ${inner}` : `全部芯片，片内地址 ${inner}`;
  }

  return builder.finish(result, table);
}

/** 种子 → 32 位无符号数序列（mulberry32）。 */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** 随机出一道题：芯片 1K–512K、位数 1/4/8/16，三种扩展都会出现，带一个要查的地址。 */
export function generate(seed: number): Params {
  const next = generator(seed);
  const pick = (n: number): number => next() % n;
  for (;;) {
    const chipWords = 2 ** (10 + pick(10));
    const chipBits = [1, 4, 8, 16][pick(4)] ?? 8;
    const kind = pick(3);
    const groups = kind === 0 ? 1 : 2 ** (1 + pick(3));
    const perGroup = kind === 1 ? 1 : 2 ** (1 + pick(2));
    const targetBits = chipBits * perGroup;
    if (targetBits > 64) continue;
    const targetWords = chipWords * groups;
    return {
      target: { words: targetWords, bits: targetBits },
      chip: { words: chipWords, bits: chipBits },
      probe: (next() % targetWords) >>> 0,
    };
  }
}
