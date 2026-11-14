/**
 * 有效地址计算：十六进制指令字 → 二进制 → 按字段切开 → 查寻址方式 → 算 EA → 取操作数。
 * 寻址方式按教材表 4.5（p135–138）和例 4.4（p140–141），复合方式按解析书 析6。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'ea';
export const MAX_WORDS = 8;

export type ModeKind =
  | '立即'
  | '直接'
  | '间接'
  | '寄存器'
  | '寄存器间接'
  | '变址'
  | '基址'
  | '相对'
  | '先变址后间接'
  | '先基址后间接'
  | '先相对后间接'
  | '段';

export const MODE_KINDS: readonly ModeKind[] = ['立即', '直接', '间接', '寄存器', '寄存器间接', '变址', '基址', '相对', '先变址后间接', '先基址后间接', '先相对后间接', '段'];

/** 每种方式的公式（教材的写法，A 是形式地址）。 */
export const FORMULA: Readonly<Record<ModeKind, string>> = {
  立即: '操作数 = A',
  直接: 'EA = A',
  间接: 'EA = (A)',
  寄存器: '操作数 = (R)',
  寄存器间接: 'EA = (R)',
  变址: 'EA = (R) + A',
  基址: 'EA = (R) + A',
  相对: 'EA = (PC) + A',
  先变址后间接: 'EA = ((R) + A)',
  先基址后间接: 'EA = ((R) + A)',
  先相对后间接: 'EA = ((PC) + A)',
  段: 'EA = (段寄存器) × 16 + A',
};

/** 需要寄存器的方式。 */
const NEEDS_REGISTER: readonly ModeKind[] = ['寄存器', '寄存器间接', '变址', '基址', '先变址后间接', '先基址后间接', '段'];

export interface Mode {
  kind: ModeKind;
  /** 用哪个寄存器，例如 X1、R2、PC。与 regField 二选一。 */
  reg?: string;
  /** 寄存器编号取自哪个字段，编号 n 对应寄存器 Rn。 */
  regField?: string;
  /** 形式地址按补码（可正可负）解释。缺省：相对类为是，其余为否（p136）。 */
  signed?: boolean;
}

export interface Field {
  /** 字段名。OP 是操作码，A（或 D）是形式地址；其余按 modeFields 和 regField 的用法。 */
  name: string;
  bits: number;
}

export interface EaParams {
  /** 指令字长（位），4 的倍数，8–32。 */
  wordBits: number;
  /** 从左（高位）到右的字段，位数之和等于字长。 */
  fields: Field[];
  /** 形式地址所在的字段名，缺省 A；书上有的题叫 D。 */
  addressField?: string;
  /** 哪几个字段拼起来决定寻址方式，按顺序拼成键。 */
  modeFields: string[];
  /** 键 → 寻址方式。 */
  modes: Record<string, Mode>;
  /** 一条或几条十六进制指令字（不带 H）。 */
  words: string[];
  /** 寄存器的内容，含 PC。 */
  registers: Record<string, number>;
  /** 主存内容：十六进制地址 → 值。没列出的单元读出 0。 */
  memory?: Record<string, number>;
  /** 地址位数，缺省 16；算出的地址按这个位数取模。 */
  addressBits?: number;
  /** 算出 EA 后是否再取操作数，缺省是。 */
  fetchOperand?: boolean;
}

export interface WordState {
  word: string;
  binary: string | null;
  fields: Record<string, string> | null;
  mode: string | null;
  /** 形式地址按方式解释后的值。 */
  a: number | null;
  ea: string | null;
  operand: string | null;
  /** 访存记录：为什么读、地址、读出的值。不含取指令那一次。 */
  reads: { why: string; addr: string; value: string }[];
}

export interface EaState {
  current: number | null;
  words: WordState[];
}

export interface Solved {
  word: string;
  binary: string;
  fields: Record<string, string>;
  key: string;
  mode: Mode;
  register: string | null;
  a: number;
  ea: number | null;
  operand: number | null;
  reads: { why: string; addr: number; value: number }[];
}

const isHex = (s: string): boolean => /^[0-9A-Fa-f]+$/.test(s);

export function checkEa(p: EaParams): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(p.wordBits) || p.wordBits < 8 || p.wordBits > 32 || p.wordBits % 4 !== 0) problems.push('字长要是 8 到 32 之间 4 的倍数');
  const sum = p.fields.reduce((a, f) => a + f.bits, 0);
  if (sum !== p.wordBits) problems.push(`字段位数之和 ${sum} 不等于字长 ${p.wordBits}`);
  if (p.fields.some((f) => !Number.isInteger(f.bits) || f.bits < 1)) problems.push('每个字段至少 1 位');
  const names = p.fields.map((f) => f.name);
  if (new Set(names).size !== names.length) problems.push('字段名不能重复');
  const addressField = p.addressField ?? 'A';
  if (!names.includes(addressField)) problems.push(`没有形式地址字段 ${addressField}`);
  for (const m of p.modeFields) if (!names.includes(m)) problems.push(`寻址特征字段 ${m} 不在格式里`);
  const keyBits = p.modeFields.reduce((a, m) => a + (p.fields.find((f) => f.name === m)?.bits ?? 0), 0);
  for (const [key, mode] of Object.entries(p.modes)) {
    if (!new RegExp(`^[01]{${keyBits}}$`).test(key)) problems.push(`寻址方式的键 ${key} 要是 ${keyBits} 位二进制`);
    if (!MODE_KINDS.includes(mode.kind)) problems.push(`不认识寻址方式 ${String(mode.kind)}`);
    if (NEEDS_REGISTER.includes(mode.kind) && !mode.reg && !mode.regField) problems.push(`${mode.kind}寻址要指明寄存器`);
    if (mode.reg && mode.regField) problems.push('寄存器和寄存器字段只给一个');
    if (mode.regField && !names.includes(mode.regField)) problems.push(`寄存器字段 ${mode.regField} 不在格式里`);
    if (mode.reg && !(mode.reg in p.registers)) problems.push(`没有给出寄存器 ${mode.reg} 的内容`);
  }
  const relative = Object.values(p.modes).some((m) => m.kind === '相对' || m.kind === '先相对后间接');
  if (relative && !('PC' in p.registers)) problems.push('有相对寻址，要给出 (PC)');
  if (p.words.length < 1 || p.words.length > MAX_WORDS) problems.push(`指令字要有 1 到 ${MAX_WORDS} 条`);
  for (const w of p.words) if (!isHex(w) || w.length !== p.wordBits / 4) problems.push(`指令字 ${w} 要是 ${p.wordBits / 4} 位十六进制`);
  const ab = p.addressBits ?? 16;
  if (!Number.isInteger(ab) || ab < 4 || ab > 32) problems.push('地址位数要是 4 到 32 的整数');
  for (const [r, v] of Object.entries(p.registers)) if (!Number.isInteger(v) || v < 0 || v >= 2 ** 32) problems.push(`寄存器 ${r} 的内容要是非负整数`);
  for (const [a, v] of Object.entries(p.memory ?? {})) {
    if (!isHex(a)) problems.push(`主存地址 ${a} 要是十六进制`);
    if (!Number.isInteger(v) || v < 0 || v >= 2 ** 32) problems.push(`主存 ${a} 的内容要是非负整数`);
  }
  return problems;
}

/** 负数写成 −…H，其余同 hex。 */
export function signedHex(v: number, bits: number): string {
  return v < 0 ? `−${hex(-v, bits)}` : hex(v, bits);
}

/** 按 width 位写成十六进制，带 H。 */
export function hex(v: number, bits: number): string {
  return `${(v >>> 0).toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`;
}

function memoryReader(p: EaParams): (addr: number) => number {
  const table = new Map<number, number>();
  for (const [a, v] of Object.entries(p.memory ?? {})) table.set(parseInt(a, 16), v);
  return (addr) => table.get(addr) ?? 0;
}

function registerOf(mode: Mode, fields: Record<string, string>): string | null {
  if (mode.reg) return mode.reg;
  if (mode.regField) return `R${parseInt(fields[mode.regField]!, 2)}`;
  if (mode.kind === '相对' || mode.kind === '先相对后间接') return 'PC';
  return null;
}

/** 只算一条指令，不出 Trace。 */
export function solveWord(p: EaParams, word: string): Solved {
  const binary = parseInt(word, 16).toString(2).padStart(p.wordBits, '0');
  const fields: Record<string, string> = {};
  let at = 0;
  for (const f of p.fields) {
    fields[f.name] = binary.slice(at, at + f.bits);
    at += f.bits;
  }
  const key = p.modeFields.map((m) => fields[m]!).join('');
  const mode = p.modes[key];
  if (!mode) throw new Error(`指令 ${word}H 的寻址特征 ${key} 没有对应的寻址方式`);
  const register = registerOf(mode, fields);
  if (register && !(register in p.registers)) throw new Error(`指令 ${word}H 要用寄存器 ${register}，没有给出它的内容`);
  const aBits = fields[p.addressField ?? 'A']!;
  const raw = parseInt(aBits, 2);
  const signed = mode.signed ?? (mode.kind === '相对' || mode.kind === '先相对后间接');
  const a = signed && aBits[0] === '1' ? raw - 2 ** aBits.length : raw;
  const bits = p.addressBits ?? 16;
  const wrap = (v: number): number => ((v % 2 ** bits) + 2 ** bits) % 2 ** bits;
  const read = memoryReader(p);
  const reads: Solved['reads'] = [];
  const reg = register ? p.registers[register]! : 0;
  let ea: number | null = null;
  let operand: number | null = null;
  switch (mode.kind) {
    case '立即':
      operand = a;
      break;
    case '寄存器':
      operand = reg;
      break;
    case '直接':
      ea = wrap(a);
      break;
    case '寄存器间接':
      ea = wrap(reg);
      break;
    case '变址':
    case '基址':
    case '相对':
      ea = wrap(reg + a);
      break;
    case '段':
      ea = wrap(reg * 16 + a);
      break;
    case '间接': {
      const v = read(wrap(a));
      reads.push({ why: '取操作数地址', addr: wrap(a), value: v });
      ea = wrap(v);
      break;
    }
    case '先变址后间接':
    case '先基址后间接':
    case '先相对后间接': {
      const mid = wrap(reg + a);
      const v = read(mid);
      reads.push({ why: '取操作数地址', addr: mid, value: v });
      ea = wrap(v);
      break;
    }
  }
  if (ea !== null && p.fetchOperand !== false) {
    operand = read(ea);
    reads.push({ why: '取操作数', addr: ea, value: operand });
  }
  return { word: word.toUpperCase(), binary, fields, key, mode, register, a, ea, operand, reads };
}

const spaced = (bin: string): string => bin.replace(/(.{4})(?=.)/g, '$1 ');

/** 算一条或几条指令的有效地址。参数不合法时抛出错误。 */
export function run(params: EaParams): Trace<EaParams, EaState> {
  const problems = checkEa(params);
  if (problems.length) throw new Error(`寻址参数有问题：${problems.join('；')}`);
  const bits = params.addressBits ?? 16;
  const addressField = params.addressField ?? 'A';
  const solved = params.words.map((w) => solveWord(params, w));
  const regText = Object.entries(params.registers).map(([r, v]) => `(${r}) = ${hex(v, bits)}`).join('，');
  const conditions: Condition[] = [
    { label: '指令格式', value: params.fields.map((f) => `${f.name}（${f.bits} 位）`).join(' | ') },
    { label: '寻址特征', value: Object.entries(params.modes).map(([k, m]) => `${params.modeFields.join('')}=${k}：${m.kind}${m.reg ? ` ${m.reg}` : ''}`).join('；') },
    { label: '寄存器', value: regText },
  ];
  if (params.memory && Object.keys(params.memory).length) {
    conditions.push({ label: '主存', value: Object.entries(params.memory).map(([a, v]) => `[${hex(parseInt(a, 16), bits)}] = ${hex(v, bits)}`).join('，') });
  }
  const initial: EaState = {
    current: null,
    words: solved.map((s) => ({ word: `${s.word}H`, binary: null, fields: null, mode: null, a: null, ea: null, operand: null, reads: [] })),
  };
  const builder = new TraceBuilder<EaParams, EaState>(ENGINE, params, initial, conditions);
  let count = 0;
  const step = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };
  const rows: SolutionTable['rows'] = [];
  const modeNames = [...new Set(Object.values(params.modes).map((m) => m.kind))];

  solved.forEach((s, i) => {
    const first = step({
      level: 'instruction',
      title: `${s.word}H 展开成二进制：${spaced(s.binary)}`,
      why: '一位十六进制数对应四位二进制数，按位展开后才能按字段的位数切开。',
      ref: '教材 p134–135',
      focus: [`words.${i}`],
      update: (d) => {
        d.current = i;
        d.words[i]!.binary = s.binary;
      },
    });
    step({
      level: 'explain',
      title: `切字段：${params.fields.map((f) => `${f.name}=${s.fields[f.name]!}`).join('，')}`,
      why: `从最高位起依次切出 ${params.fields.map((f) => `${f.name} ${f.bits} 位`).join('、')}。`,
      ref: '教材 p135',
      update: (d) => {
        d.words[i]!.fields = { ...s.fields };
      },
    });
    const ask: Ask | null =
      modeNames.length >= 2 && i === 0
        ? { prompt: `${params.modeFields.join('、')} 是 ${s.key}，这是哪种寻址方式`, kind: 'choice', options: modeNames, answer: s.mode.kind, hint: '对照题目给的寻址特征表。' }
        : null;
    step({
      level: 'explain',
      title: `${params.modeFields.join('')} = ${s.key}：${s.mode.kind}寻址，${FORMULA[s.mode.kind].replace('(R)', s.register ? `(${s.register})` : '(R)')}`,
      why: whyMode(s, addressField),
      ref: s.mode.kind.startsWith('先') ? '解析书 析6；教材 p136–137' : '教材 p135–138，表 4.5',
      ...(ask ? { ask } : {}),
      update: (d) => {
        d.words[i]!.mode = s.mode.kind;
        d.words[i]!.a = s.a;
      },
    });
    const regVal = s.register ? params.registers[s.register]! : 0;
    const aText = s.a < 0 ? `(−${hex(-s.a, bits)})` : hex(s.a, bits);
    const indirectRead = s.reads.find((r) => r.why === '取操作数地址');
    let eaStep: string | null = null;
    switch (s.mode.kind) {
      case '立即':
        step({
          level: 'explain',
          title: `操作数 = ${signedHex(s.a, bits)}，不用访存`,
          why: `立即寻址的形式地址就是操作数本身，随指令一起取出（p135）。`,
          ref: '教材 p135',
          update: (d) => {
            d.words[i]!.operand = signedHex(s.operand!, bits);
          },
        });
        break;
      case '寄存器':
        step({
          level: 'explain',
          title: `操作数 = (${s.register}) = ${hex(regVal, bits)}，不用访存`,
          why: '操作数在寄存器里，地址字段给的是寄存器编号（p136）。',
          ref: '教材 p136',
          update: (d) => {
            d.words[i]!.operand = hex(s.operand!, bits);
          },
        });
        break;
      default: {
        if (indirectRead) {
          const where = s.mode.kind === '间接' ? hex(indirectRead.addr, bits) : `${s.mode.kind === '先相对后间接' ? '(PC)' : `(${s.register})`} + ${aText} = ${hex(indirectRead.addr, bits)}`;
          eaStep = step({
            level: 'access',
            title: `读主存 ${hex(indirectRead.addr, bits)}，取出 EA = ${hex(indirectRead.value, bits)}`,
            why: `${where} 这个单元里放的不是操作数，是操作数的地址，要先访存一次把它取出来（p136）。`,
            ref: '教材 p136',
            ask: { prompt: '有效地址 EA 是多少（十六进制）', kind: 'text', answer: hex(s.ea!, bits) },
            update: (d) => {
              d.words[i]!.reads.push({ why: indirectRead.why, addr: hex(indirectRead.addr, bits), value: hex(indirectRead.value, bits) });
              d.words[i]!.ea = hex(s.ea!, bits);
            },
          });
        } else {
          eaStep = step({
            level: 'explain',
            title: `EA = ${eaExpression(s, regVal, aText, bits)}`,
            why: eaWhy(s),
            ref: '教材 p135–138',
            ask: { prompt: '有效地址 EA 是多少（十六进制）', kind: 'text', answer: hex(s.ea!, bits) },
            update: (d) => {
              d.words[i]!.ea = hex(s.ea!, bits);
            },
          });
        }
        if (params.fetchOperand !== false) {
          step({
            level: 'access',
            title: `读主存 ${hex(s.ea!, bits)}，取出操作数 ${hex(s.operand!, bits)}`,
            why: '按有效地址访存一次，拿到的才是操作数。',
            ref: '教材 p135',
            update: (d) => {
              d.words[i]!.reads.push({ why: '取操作数', addr: hex(s.ea!, bits), value: hex(s.operand!, bits) });
              d.words[i]!.operand = hex(s.operand!, bits);
            },
          });
        }
      }
    }
    rows.push({
      cells: [
        `${s.word}H`,
        params.modeFields.map((m) => s.fields[m]!).join(' '),
        hex(parseInt(s.fields[addressField]!, 2), params.fields.find((f) => f.name === addressField)!.bits),
        s.mode.kind,
        s.ea === null ? '—' : hex(s.ea, bits),
        s.operand === null ? '—' : signedHex(s.operand, bits),
        String(s.reads.length),
      ],
      step: eaStep ?? first,
    });
  });

  const result: Record<string, string> = {};
  solved.forEach((s, i) => {
    const tag = `I${i + 1}（${s.word}H）`;
    result[`${tag} 寻址方式`] = s.mode.kind;
    result[`${tag} 有效地址`] = s.ea === null ? '无（不访存）' : hex(s.ea, bits);
    result[`${tag} 操作数`] = s.operand === null ? '未取' : signedHex(s.operand, bits);
    result[`${tag} 访存次数`] = String(s.reads.length);
  });
  return builder.finish(result, {
    columns: ['指令', params.modeFields.join(' '), `形式地址 ${addressField}`, '寻址方式', '有效地址 EA', '操作数', '访存次数'],
    rows,
  });
}

function whyMode(s: Solved, addressField: string): string {
  const name = addressField;
  switch (s.mode.kind) {
    case '立即':
      return `${name} 字段直接放着操作数。`;
    case '直接':
      return `${name} 字段就是操作数在主存里的地址。`;
    case '间接':
      return `${name} 字段给的单元里存着操作数的地址，要多访存一次。`;
    case '寄存器':
      return `操作数在 ${s.register} 里，不访问主存。`;
    case '寄存器间接':
      return `${s.register} 里放的是操作数的地址。`;
    case '变址':
      return `${s.register} 是变址寄存器，${name} 当作基准地址，加上 ${s.register} 里的偏移量。`;
    case '基址':
      return `${s.register} 是基址寄存器，存着基地址，${name} 是相对它的偏移量。`;
    case '相对':
      return `以 PC 的当前内容为基准，${name} 按补码看，可正可负。(PC) 用题目给的值，不再自己加指令长度。`;
    case '段':
      return `段寄存器的内容左移 4 位（乘 16）作为段的起点，再加上 ${name} 作为段内偏移。`;
    default:
      return `先按${s.mode.kind.slice(1, 3)}算出一个地址，那个单元里存的才是操作数的地址，再访存一次。`;
  }
}

function eaExpression(s: Solved, reg: number, aText: string, bits: number): string {
  const ea = hex(s.ea!, bits);
  switch (s.mode.kind) {
    case '直接':
      return `${aText}`;
    case '寄存器间接':
      return `(${s.register}) = ${ea}`;
    case '段':
      return `${hex(reg, bits)} × 16 + ${aText} = ${ea}`;
    default:
      return `(${s.register}) + ${aText} = ${hex(reg, bits)} + ${aText} = ${ea}`;
  }
}

function eaWhy(s: Solved): string {
  if (s.mode.kind === '直接') return '形式地址就是有效地址，不用计算。';
  if (s.mode.kind === '寄存器间接') return '寄存器里的内容就是有效地址，算地址时不访存。';
  if (s.a < 0) return `形式地址最高位是 1，按补码是负数，所以实际是减（p136）。结果按地址位数取模。`;
  return '寄存器的内容加上形式地址，结果按地址位数取模。';
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

/** 本站的样例格式：16 位，OP 6 位、X 2 位、A 8 位；X=00 直接，01 用 X1 变址，10 先变址后间接（X2），11 相对。 */
export function sampleParams(): EaParams {
  return {
    wordBits: 16,
    fields: [
      { name: 'OP', bits: 6 },
      { name: 'X', bits: 2 },
      { name: 'A', bits: 8 },
    ],
    modeFields: ['X'],
    modes: { '00': { kind: '直接' }, '01': { kind: '变址', reg: 'X1' }, '10': { kind: '基址', reg: 'X2' }, '11': { kind: '相对' } },
    words: ['2C35', '1D10', '0EA8', '07F0'],
    registers: { PC: 0x3A20, X1: 0x0150, X2: 0x2000 },
    memory: { '0035': 0x0042, '0160': 0x7788, '20A8': 0x1357, '3A10': 0x00FF },
  };
}

/** 随机出题：固定样例格式，随机几条指令字和寄存器。 */
export function generate(seed: number): EaParams {
  const r = generator(seed);
  const p = sampleParams();
  const word = (): string => Math.floor(r() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  const n = 2 + Math.floor(r() * 4);
  return {
    ...p,
    words: Array.from({ length: n }, word),
    registers: { PC: Math.floor(r() * 0x10000), X1: Math.floor(r() * 0x1000), X2: Math.floor(r() * 0x10000) },
    memory: {},
  };
}
