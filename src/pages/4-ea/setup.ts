/**
 * 寻址方式页的参数：几种指令格式、讲解的例题、试一试的网址参数、练习的出题。
 * 这里只摆题目的条件（格式、指令字、寄存器、主存），有效地址和操作数都由引擎 src/engines/ea 算。
 */
import { solveWord } from '../../engines/ea/model';
import type { EaParams, Field, Mode } from '../../engines/ea/model';
import { seeded } from './shell';

export interface Format {
  key: string;
  label: string;
  /** 一行说明，列在条件里。 */
  fields: Field[];
  modeFields: string[];
  modes: Record<string, Mode>;
  /** 用到的寄存器（PC 也算）。 */
  registers: string[];
  addressBits?: number;
}

/** 本站格式：教材 p135 那种 OP | X | I | A，X 是变址位，I 是间址位，各 1 位。 */
const XI: Format = {
  key: 'xi',
  label: '变址位 + 间址位',
  fields: [
    { name: 'OP', bits: 6 },
    { name: 'X', bits: 1 },
    { name: 'I', bits: 1 },
    { name: 'A', bits: 8 },
  ],
  modeFields: ['X', 'I'],
  modes: { '00': { kind: '直接' }, '01': { kind: '间接' }, '10': { kind: '变址', reg: 'X1' }, '11': { kind: '先变址后间接', reg: 'X1' } },
  registers: ['X1'],
};

/** 两位寻址特征：直接、变址、基址、相对（引擎的样例格式）。 */
const X2: Format = {
  key: 'x2',
  label: '两位寻址特征',
  fields: [
    { name: 'OP', bits: 6 },
    { name: 'X', bits: 2 },
    { name: 'A', bits: 8 },
  ],
  modeFields: ['X'],
  modes: { '00': { kind: '直接' }, '01': { kind: '变址', reg: 'X1' }, '10': { kind: '基址', reg: 'X2' }, '11': { kind: '相对' } },
  registers: ['PC', 'X1', 'X2'],
};

/** 三位方式字段 M、一位寄存器号 R：八种方式放在一个格式里。 */
const M3: Format = {
  key: 'm3',
  label: '三位方式字段',
  fields: [
    { name: 'OP', bits: 4 },
    { name: 'M', bits: 3 },
    { name: 'R', bits: 1 },
    { name: 'A', bits: 8 },
  ],
  modeFields: ['M'],
  modes: {
    '000': { kind: '立即' },
    '001': { kind: '直接' },
    '010': { kind: '间接' },
    '011': { kind: '寄存器', regField: 'R' },
    '100': { kind: '寄存器间接', regField: 'R' },
    '101': { kind: '变址', regField: 'R' },
    '110': { kind: '相对' },
    '111': { kind: '先相对后间接' },
  },
  registers: ['PC', 'R0', 'R1'],
};

export const FORMATS: readonly Format[] = [XI, X2, M3];
export const formatOf = (key: string): Format => FORMATS.find((f) => f.key === key) ?? XI;

export function paramsOf(format: Format, words: string[], registers: Record<string, number>, memory: Record<string, number>): EaParams {
  return {
    wordBits: format.fields.reduce((a, f) => a + f.bits, 0),
    fields: format.fields,
    modeFields: format.modeFields,
    modes: format.modes,
    words,
    registers,
    memory,
    ...(format.addressBits ? { addressBits: format.addressBits } : {}),
  };
}

/** 讲解的例题。数是本站自取的。 */
export const EXAMPLES = [
  {
    key: 'xi',
    label: '例题：间址和变址',
    lead: '同一个形式地址 3CH，I 位是 0 和 1 时各取到什么；再看变址之后再间址。',
    params: paramsOf(XI, ['143C', '153C', '171C'], { X1: 0x0120 }, { '003C': 0x0250, '0250': 0x1a2b, '013C': 0x0310, '0310': 0x0007 }),
  },
  {
    key: 'var',
    label: '变式：去掉间址',
    lead: '把例题第三条的 I 位改成 0，其余不变。',
    params: paramsOf(XI, ['161C'], { X1: 0x0120 }, { '003C': 0x0250, '0250': 0x1a2b, '013C': 0x0310, '0310': 0x0007 }),
  },
  {
    key: 'x2',
    label: '例题二：基址和相对',
    lead: '寻址特征两位。相对寻址的形式地址按补码看，F0H 是 −10H。',
    params: paramsOf(X2, ['2C35', '1D10', '0EA8', '07F0'], { PC: 0x3a20, X1: 0x0150, X2: 0x2000 }, { '0035': 0x0042, '0160': 0x7788, '20A8': 0x1357, '3A10': 0x00ff }),
  },
] as const;

/** 试一试的缺省值（网址里没写时用）。 */
export const TRY_DEFAULTS: Record<string, { words: string; regs: string; mem: string }> = {
  xi: { words: '143C 153C 171C', regs: 'X1=0120', mem: '003C=0250 0250=1A2B 013C=0310 0310=0007' },
  x2: { words: '2C35 1D10 0EA8 07F0', regs: 'PC=3A20 X1=0150 X2=2000', mem: '0035=0042 0160=7788 20A8=1357 3A10=00FF' },
  m3: { words: '0012 1312 2412 3612 4812 5A02 6CF8 7EF8', regs: 'PC=0108 R0=0040 R1=0030', mem: '0012=0034 0034=5555 0040=6666 0042=7777 0100=0012' },
};

const hexWord = /^[0-9A-Fa-f]+$/;

/** 读「X1=0120 PC=3A20」这样的写法。返回值和问题。 */
function readPairs(text: string, what: string): { values: Record<string, number>; problems: string[] } {
  const values: Record<string, number> = {};
  const problems: string[] = [];
  for (const item of text.split(/[\s,，;；]+/).filter(Boolean)) {
    const m = /^([A-Za-z0-9]+)\s*[=:：]\s*([0-9A-Fa-f]+)H?$/i.exec(item);
    if (!m) {
      problems.push(`${what}「${item}」要写成 名字=十六进制数`);
      continue;
    }
    values[what === '主存' ? m[1]!.toUpperCase().padStart(4, '0') : m[1]!.toUpperCase()] = parseInt(m[2]!, 16);
  }
  return { values, problems };
}

/** 试一试：网址参数 → 引擎参数。不合法时给出第一条问题，引擎的检查放在后面。 */
export function readTry(formatKey: string, words: string, regs: string, mem: string): { params: EaParams | null; problems: string[] } {
  const format = formatOf(formatKey);
  const list = words.split(/[\s,，;；]+/).filter(Boolean).map((w) => w.replace(/H$/i, '').toUpperCase());
  const problems: string[] = [];
  if (list.length === 0) problems.push('至少写一条指令字');
  for (const w of list) if (!hexWord.test(w)) problems.push(`指令字 ${w} 不是十六进制数`);
  const r = readPairs(regs, '寄存器');
  const m = readPairs(mem, '主存');
  problems.push(...r.problems, ...m.problems);
  for (const name of format.registers) if (!(name in r.values) && list.length) problems.push(`这个格式要给出 (${name})`);
  if (problems.length) return { params: null, problems };
  return { params: paramsOf(format, list, r.values, m.values), problems: [] };
}

const hex4 = (v: number): string => v.toString(16).toUpperCase().padStart(4, '0');

/**
 * 练习出题：按种子选格式、出两到三条指令字和寄存器；指令要读的主存单元填上随机的数
 * （读哪个单元由引擎的 solveWord 算出，读到新单元就再填一个，直到不再变）。
 */
export function makeExercise(seed: number): EaParams {
  const r = seeded(seed);
  const pick = (n: number): number => Math.floor(r() * n);
  const format = [XI, X2, M3][seed % 3]!;
  const keys = Object.keys(format.modes);
  const opBits = format.fields[0]!.bits;
  const n = 2 + pick(2);
  // 每条指令用不同的寻址特征，免得一道题全是同一种。
  const chosen: string[] = [];
  while (chosen.length < n) {
    const k = keys[pick(keys.length)]!;
    if (!chosen.includes(k)) chosen.push(k);
  }
  const words = chosen.map((key) => {
    let bits = pick(2 ** opBits).toString(2).padStart(opBits, '0');
    for (const f of format.fields.slice(1)) {
      if (format.modeFields.includes(f.name)) {
        const at = format.modeFields.slice(0, format.modeFields.indexOf(f.name)).reduce((a, name) => a + format.fields.find((x) => x.name === name)!.bits, 0);
        bits += key.slice(at, at + f.bits);
      } else bits += pick(2 ** f.bits).toString(2).padStart(f.bits, '0');
    }
    return parseInt(bits, 2).toString(16).toUpperCase().padStart(bits.length / 4, '0');
  });
  const registers: Record<string, number> = {};
  for (const name of format.registers) registers[name] = name === 'PC' ? 0x0100 + pick(0x0f00) : pick(0x0400);
  const memory: Record<string, number> = {};
  const params = paramsOf(format, words, registers, memory);
  for (let round = 0; round < 6; round++) {
    let added = false;
    for (const w of words) {
      for (const read of solveWord(params, w).reads) {
        const at = hex4(read.addr);
        if (!(at in memory)) {
          // 读出的地址落在低 4K 里，题目好看；操作数随意。
          memory[at] = read.why === '取操作数地址' ? 0x0100 + pick(0x0e00) : pick(0x10000);
          added = true;
        }
      }
    }
    if (!added) break;
  }
  return params;
}
