/**
 * 寻址方式的台面：指令字切成几段翻片，寻址特征的卡落到方式牌上，地址卡跳进主存的格子，
 * 每跳一次（访存一次）计数牌翻一下，最后操作数落进「操作数」。数都取自引擎 src/engines/ea 的状态。
 *
 * 台面布局（x 向右，z 朝向观看的人）：
 *   后排：指令字、切开的字段（翻片）和字段读数；
 *   中排左：方式牌（每个寻址特征一块）；中：寄存器；中右：地址加法器；右：主存。
 *   前排：EA、操作数、访存次数。
 */
import { FORMULA, MODE_KINDS, solveWord } from '../../engines/ea/model';
import type { EaParams, EaState, ModeKind, WordState } from '../../engines/ea/model';
import type { Step, Trace } from '../../engines/trace';
import { bindTable, from } from '../../scene';
import type { BindContext, Move, PartSpec, SceneSpec, WireSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

type Ctx = BindContext<EaState>;
const PITCH = 0.46;
const GAP = 0.62;

const regOf = (p: EaParams, w: WordState | null): string | null => {
  if (!w || !w.mode || !w.fields) return null;
  const key = p.modeFields.map((m) => w.fields![m]!).join('');
  const mode = p.modes[key];
  if (!mode) return null;
  if (mode.reg) return mode.reg;
  if (mode.regField) return `R${parseInt(w.fields[mode.regField]!, 2)}`;
  if (mode.kind === '相对' || mode.kind === '先相对后间接') return 'PC';
  return null;
};
const keyOf = (p: EaParams, w: WordState | null): string | null => (w?.fields ? p.modeFields.map((m) => w.fields![m]!).join('') : null);
const current = (s: EaState): WordState | null => (s.current === null ? null : (s.words[s.current] ?? null));
const ADD_KINDS: readonly string[] = ['变址', '基址', '相对', '段', '先变址后间接', '先基址后间接', '先相对后间接'];

/** 主存里要画的单元：题目给出的和任何一条指令会读到的，按地址排。 */
export function memoryRows(trace: Trace<EaParams, EaState>): string[] {
  const rows = new Set<string>();
  const last = trace.steps.length ? trace.steps[trace.steps.length - 1]!.state : trace.initial;
  for (const w of last.words) for (const r of w.reads) rows.add(r.addr);
  const bits = trace.params.addressBits ?? 16;
  for (const a of Object.keys(trace.params.memory ?? {})) rows.add(`${parseInt(a, 16).toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`);
  return [...rows].sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
}

interface Layout {
  field: Record<string, [number, number]>;
  word: [number, number];
  iw: [number, number];
  key: [number, number];
  /** 手机上形式地址的读数挪到加法器旁边（字段那一排离得太远）。 */
  va?: [number, number];
  plate: (i: number, n: number) => [number, number];
  reg: (i: number) => [number, number];
  adder: [number, number];
  ea: [number, number];
  mem: [number, number];
  opd: [number, number];
  count: [number, number];
}

/** 字段一排：每段之间空 GAP。返回每段中心的 x（以整排中心为 0）。 */
function fieldXs(p: EaParams): Record<string, number> {
  const widths = p.fields.map((f) => f.bits * PITCH);
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (p.fields.length - 1);
  const out: Record<string, number> = {};
  let x = -total / 2;
  p.fields.forEach((f, i) => {
    out[f.name] = x + widths[i]! / 2;
    x += widths[i]! + GAP;
  });
  return out;
}

function layout(p: EaParams, narrow: boolean): Layout {
  const xs = fieldXs(p);
  const keyX = p.modeFields.reduce((a, m) => a + xs[m]!, 0) / p.modeFields.length;
  if (narrow) {
    // 手机：从上往下排，镜头跟着当前步走。
    const field: Record<string, [number, number]> = {};
    for (const f of p.fields) field[f.name] = [xs[f.name]!, -7.4];
    return {
      field,
      iw: [-2.4, -11.6],
      word: [0, -9.6],
      key: [keyX, -5.9],
      plate: (i) => [-1.6 + (i % 2) * 3.2, -3.9 + Math.floor(i / 2) * 1.8],
      reg: (i) => [-2.3 + (i % 3) * 2.3, 3.2 + Math.floor(i / 3) * 1.8],
      adder: [1.7, 6.6],
      va: [-1.9, 6.4],
      ea: [-1.6, 9.0],
      mem: [0.4, 14.4],
      opd: [1.4, 19.2],
      count: [-2.2, 19.2],
    };
  }
  const shift = -1.2;
  const field: Record<string, [number, number]> = {};
  for (const f of p.fields) field[f.name] = [xs[f.name]! + shift, -4.3];
  return {
    field,
    iw: [-9.4, -6.9],
    word: [shift, -6.9],
    key: [keyX + shift, -2.85],
    plate: (i, n) => (n > 4 ? [-10.0 + (i % 2) * 3.0, -1.2 + Math.floor(i / 2) * 1.75] : [-8.8, -1.2 + i * 1.75]),
    reg: (i) => [-4.4, -1.2 + i * 1.75],
    adder: [0.2, -0.4],
    ea: [0.2, 2.8],
    mem: [6.8, -1.6],
    opd: [6.8, 4.4],
    count: [0.2, 5.4],
  };
}

const sortedKeys = (p: EaParams): string[] => Object.keys(p.modes).sort();

export function eaScene(trace: Trace<EaParams, EaState>, narrow: boolean): SceneSpec {
  const p = trace.params;
  const L = layout(p, narrow);
  const keys = sortedKeys(p);
  const regs = Object.keys(p.registers);
  const rows = memoryRows(trace);
  const addressField = p.addressField ?? 'A';
  const parts: PartSpec[] = [
    { id: 'IW', kind: 'register', position: L.iw, props: { name: '指令字', value: '', width: 2.2 } },
    { id: 'WORD', kind: 'bits', position: L.word, title: '二进制', props: { bits: ' '.repeat(p.wordBits), pitch: PITCH, group: 4 } },
    ...p.fields.map((f): PartSpec => ({ id: `N_${f.name}`, kind: 'label', position: [L.field[f.name]![0], L.field[f.name]![1] + 0.72], props: { text: f.name, size: 0.3, tone: 'muted', weight: 600 } })),
    ...p.fields.map(
      (f): PartSpec => ({ id: `F_${f.name}`, kind: 'bits', position: L.field[f.name]!, title: `${f.name} 字段`, props: { bits: ' '.repeat(f.bits), pitch: PITCH, group: f.bits > 4 ? 4 : f.bits } }),
    ),
    { id: 'V_KEY', kind: 'label', position: L.key, props: { text: '', size: 0.34, mono: true, plate: true, hidden: true } },
    { id: 'V_A', kind: 'label', position: L.va ?? [L.field[addressField]![0], L.key[1]], props: { text: '', size: 0.34, mono: true, plate: true, hidden: true } },
    ...keys.map(
      (key, i): PartSpec => ({
        id: `M_${key}`,
        kind: 'register',
        position: L.plate(i, keys.length),
        title: p.modes[key]!.kind,
        props: { name: `${p.modeFields.join('')}=${key}`, value: p.modes[key]!.kind, width: 2.7, ink: 'ctrl' },
        pick: true,
      }),
    ),
    ...regs.map((name, i): PartSpec => ({ id: `R_${name}`, kind: 'register', position: L.reg(i), props: { name, value: hexOf(p.registers[name]!, p), width: 2.0, ink: 'addr' } })),
    { id: 'ADDER', kind: 'register', position: L.adder, props: { name: '地址加法', value: '', width: 2.6, ink: 'addr' } },
    { id: 'EA', kind: 'register', position: L.ea, props: { name: 'EA', value: '', width: 2.4, ink: 'addr' } },
    {
      id: 'MEM',
      kind: 'memory',
      position: L.mem,
      props: { name: '主存', columns: [{ title: '内容', width: 1.7 }], rows: rows.map(() => ['']), labels: rows },
    },
    { id: 'OPD', kind: 'register', position: L.opd, props: { name: '操作数', value: '', width: 2.4 } },
    { id: 'COUNT', kind: 'register', position: L.count, props: { name: '访存次数', value: '', width: 1.8 } },
  ];
  const wires: WireSpec[] = [
    { id: 'a-add', from: `F_${addressField}.s`, to: 'ADDER.n', ink: 'addr' },
    ...regs.map((name): WireSpec => ({ id: `r-add-${name}`, from: `R_${name}.e`, to: 'ADDER.w', ink: 'addr' })),
    { id: 'add-ea', from: 'ADDER.s', to: 'EA.n', ink: 'addr' },
    { id: 'ea-mem', from: 'EA.e', to: 'MEM.w', ink: 'addr' },
    { id: 'mem-opd', from: 'MEM.s', to: 'OPD.n' },
  ];
  return { parts, wires };
}

const hexOf = (v: number, p: EaParams): string => `${v.toString(16).toUpperCase().padStart(Math.ceil((p.addressBits ?? 16) / 4), '0')}H`;
const fieldHex = (bits: string): string => `${parseInt(bits, 2).toString(16).toUpperCase().padStart(Math.ceil(bits.length / 4), '0')}H`;

export function eaBind(trace: Trace<EaParams, EaState>) {
  const p = trace.params;
  const n = trace.initial.words.length;
  const all = (tail: string) => Array.from({ length: n }, (_, i) => `words.${i}.${tail}`);
  const rows = memoryRows(trace);
  const keys = sortedKeys(p);
  const regs = Object.keys(p.registers);
  const addressField = p.addressField ?? 'A';
  let offset = 0;
  const slices = p.fields.map((f) => {
    const at = offset;
    offset += f.bits;
    return { name: f.name, at, bits: f.bits };
  });
  const table: Record<string, Record<string, unknown>> = {
    IW: { value: from<EaState>(['current'], (c) => current(c.state)?.word ?? '') },
  };
  table.WORD = { bits: from<EaState>(all('binary'), (c) => current(c.state)?.binary ?? ' '.repeat(p.wordBits)) };
  for (const s of slices) {
    table[`F_${s.name}`] = { bits: from<EaState>(all('fields'), (c) => current(c.state)?.fields?.[s.name] ?? ' '.repeat(s.bits)) };
  }
  table.V_KEY = {
    text: from<EaState>(all('fields'), (c) => {
      const key = keyOf(p, current(c.state));
      return key === null ? '' : `${p.modeFields.join('')} = ${key}`;
    }),
    hidden: (c: Ctx) => keyOf(p, current(c.state)) === null,
  };
  table.V_A = {
    text: from<EaState>(all('fields'), (c) => {
      const bits = current(c.state)?.fields?.[addressField];
      return bits ? `${addressField} = ${fieldHex(bits)}` : '';
    }),
    hidden: (c: Ctx) => !current(c.state)?.fields,
  };
  // 方式牌、寄存器、加法器不登记状态路径：它们只在用到时亮，变化列表里的路径不落到它们身上。
  for (const key of keys) {
    const mine = (c: Ctx) => keyOf(p, current(c.state)) === key && !!current(c.state)?.mode;
    table[`M_${key}`] = { focus: mine, changed: (c: Ctx) => mine(c) && [...c.changed].some((x) => x.endsWith('.mode')) };
  }
  for (const name of regs) {
    table[`R_${name}`] = { focus: (c: Ctx) => regOf(p, current(c.state)) === name && !!current(c.state)?.mode };
  }
  const adderValue = (c: Ctx): string => {
    const w = current(c.state);
    if (!w || !w.mode || !ADD_KINDS.includes(w.mode)) return '';
    if (w.mode.startsWith('先')) return w.reads[0]?.addr ?? '';
    return w.ea ?? '';
  };
  table.ADDER = {
    value: adderValue,
    changed: (c: Ctx) => adderValue(c) !== '' && [...c.changed].some((x) => x.endsWith('.ea')),
    name: (c: Ctx) => {
      const w = current(c.state);
      const reg = regOf(p, w);
      return w?.mode && ADD_KINDS.includes(w.mode) && reg ? (w.mode === '段' ? `(${reg})×16+${addressField}` : `(${reg})+${addressField}`) : '地址加法';
    },
  };
  table.EA = { value: from<EaState>(all('ea'), (c) => current(c.state)?.ea ?? '') };
  table.OPD = { value: from<EaState>(all('operand'), (c) => current(c.state)?.operand ?? '') };
  table.COUNT = {
    value: from<EaState>(all('reads'), (c) => {
      const w = current(c.state);
      return w?.mode ? `${w.reads.length} 次` : '';
    }),
  };
  table.MEM = {
    // 主存的内容是题目给的，一直摆着；读过的格子在 changedCells 里。
    rows: from<EaState>(all('reads'), () => rows.map((addr) => [memValue(p, addr)])),
    active: (c: Ctx) => {
      const w = current(c.state);
      const last = w?.reads[w.reads.length - 1];
      return last ? rows.indexOf(last.addr) : -1;
    },
    open: (c: Ctx) => {
      const w = current(c.state);
      const touched = [...c.changed].some((x) => x.includes('.reads.'));
      const last = w?.reads[w.reads.length - 1];
      return touched && last ? rows.indexOf(last.addr) : -1;
    },
    changedCells: (c: Ctx) => {
      const w = current(c.state);
      const touched = [...c.changed].some((x) => x.includes('.reads.'));
      const last = w?.reads[w.reads.length - 1];
      return touched && last ? [`${rows.indexOf(last.addr)}.0`] : [];
    },
  };
  return bindTable<EaState>(table as never);
}

/** 主存单元的内容（题目给的；没列出的读出 0）。 */
function memValue(p: EaParams, addr: string): string {
  const want = parseInt(addr, 16);
  const hit = Object.entries(p.memory ?? {}).find(([a]) => parseInt(a, 16) === want);
  return hexOf(hit ? hit[1] : 0, p);
}

/** 一步里谁走到哪：只看这一步的变化。 */
export function eaMoves(p: EaParams, rows: string[]) {
  const addressField = p.addressField ?? 'A';
  return (step: Step<EaState>): Move[] => {
    const s = step.state;
    const i = s.current;
    if (i === null) return [];
    const w = s.words[i]!;
    const has = (tail: string) => step.changes.some((c) => c.at === `words.${i}.${tail}` || c.at.startsWith(`words.${i}.${tail}.`));
    const out: Move[] = [];
    const reg = regOf(p, w);
    const aText = w.fields ? fieldHex(w.fields[addressField]!) : '';
    const cell = (addr: string) => `MEM.${rows.indexOf(addr)}.0`;
    if (has('binary') && w.binary) {
      out.push({ value: w.word, from: 'IW', to: 'WORD', arc: true });
      return out;
    }
    if (has('fields') && w.fields) {
      // 整串位从高位起切成几段，每段落到自己的槽里。
      for (const f of p.fields) out.push({ value: w.fields[f.name]!, from: 'WORD', to: `F_${f.name}`, arc: true });
      return out;
    }
    if (has('mode') && w.mode) {
      const key = keyOf(p, w)!;
      out.push({ value: key, from: `F_${p.modeFields[0]!}`, to: `M_${key}`, arc: true, ink: 'ctrl' });
      return out;
    }
    const newRead = has('reads') ? w.reads[w.reads.length - 1] : undefined;
    if (newRead && newRead.why === '取操作数地址') {
      // 间接类：先按公式送出一个地址，那个单元里取出的才是 EA。
      if (w.mode === '间接') {
        out.push({ value: newRead.addr, from: `F_${addressField}`, to: cell(newRead.addr), arc: true, ink: 'addr', phase: 0 });
      } else {
        out.push({ value: hexOf(p.registers[reg!]!, p), from: `R_${reg}`, to: 'ADDER', via: [`r-add-${reg}`], ink: 'addr', phase: 0 });
        out.push({ value: aText, from: `F_${addressField}`, to: 'ADDER', via: ['a-add'], ink: 'addr', phase: 0 });
        out.push({ value: newRead.addr, from: 'ADDER', to: cell(newRead.addr), arc: true, ink: 'addr', phase: 1 });
      }
      out.push({ value: newRead.value, from: cell(newRead.addr), to: 'EA', arc: true, ink: 'addr', phase: w.mode === '间接' ? 1 : 2 });
      return out;
    }
    if (newRead) {
      out.push({ value: newRead.addr, from: 'EA', to: cell(newRead.addr), via: ['ea-mem'], ink: 'addr', phase: 0 });
      out.push({ value: newRead.value, from: cell(newRead.addr), to: 'OPD', via: ['mem-opd'], phase: 1 });
      return out;
    }
    if (has('ea') && w.ea) {
      if (w.mode === '直接') out.push({ value: w.ea, from: `F_${addressField}`, to: 'EA', arc: true, ink: 'addr' });
      else if (w.mode === '寄存器间接' && reg) out.push({ value: w.ea, from: `R_${reg}`, to: 'EA', arc: true, ink: 'addr' });
      else if (reg) {
        out.push({ value: hexOf(p.registers[reg]!, p), from: `R_${reg}`, to: 'ADDER', via: [`r-add-${reg}`], ink: 'addr', phase: 0 });
        out.push({ value: aText, from: `F_${addressField}`, to: 'ADDER', via: ['a-add'], ink: 'addr', phase: 0 });
        out.push({ value: w.ea, from: 'ADDER', to: 'EA', via: ['add-ea'], ink: 'addr', phase: 1 });
      }
      return out;
    }
    if (has('operand') && w.operand) {
      if (w.mode === '立即') out.push({ value: w.operand, from: `F_${addressField}`, to: 'OPD', arc: true });
      else if (reg) out.push({ value: w.operand, from: `R_${reg}`, to: 'OPD', arc: true });
    }
    return out;
  };
}

/** 引擎给第一步的焦点是整条指令；场景里只看指令字和翻片。 */
export function polish(trace: Trace<EaParams, EaState>): Trace<EaParams, EaState> {
  return {
    ...trace,
    steps: trace.steps.map((step) => {
      const i = step.state.current;
      if (step.level === 'instruction' && i !== null) return { ...step, focus: ['IW', ...trace.params.fields.map((f) => `F_${f.name}`)] };
      return step;
    }),
  };
}

const pathName = (path: string, p: EaParams): string => {
  const m = /^words\.(\d+)\.(\w+)(?:\.(\d+)\.(\w+)|\.(\w+))?$/.exec(path);
  if (!m) return path === 'current' ? '当前指令' : path;
  const tag = `I${Number(m[1]) + 1}`;
  const names: Record<string, string> = { binary: '二进制', mode: '寻址方式', a: '形式地址的值', ea: 'EA', operand: '操作数', word: '指令字' };
  if (m[2] === 'fields') return `${tag} 的 ${m[5] ?? '字段'}`;
  if (m[2] === 'reads') return `${tag} 第 ${Number(m[3]) + 1} 次访存的${m[4] === 'addr' ? '地址' : m[4] === 'value' ? '读出值' : '用途'}`;
  void p;
  return `${tag} 的${/^[A-Z]/.test(names[m[2]!] ?? '') ? ' ' : ''}${names[m[2]!] ?? m[2]}`;
};

export function eaNames(p: EaParams) {
  return (path: string) => pathName(path, p);
}

export function eaValues(path: string, value: string): string {
  if (path === 'current') return value === '' || value === 'null' ? '空' : `I${Number(value) + 1}`;
  if (/\.a$/.test(path) && value !== '' && value !== 'null') {
    const v = Number(value);
    return v < 0 ? `−${(-v).toString(16).toUpperCase()}H` : `${v.toString(16).toUpperCase()}H`;
  }
  return value;
}

/** 镜头：EA 算出来那一步看加法器和 EA；取操作数那一步看 EA、主存、操作数。 */
export function eaFrame(p: EaParams, narrow: boolean) {
  return (step: Step<EaState>): string[] | null => {
    const i = step.state.current;
    if (i === null) return null;
    const w = step.state.words[i]!;
    if (step.changes.some((c) => c.at === `words.${i}.mode`)) {
      const key = keyOf(p, w)!;
      return [`F_${p.modeFields[0]!}`, `M_${key}`];
    }
    if (!narrow) return null;
    // 手机：访存的步停在主存上（被读的那一格拉出来）；算地址的步看加法器和旁边的 A。
    const read = step.changes.some((c) => c.at.startsWith(`words.${i}.reads.`));
    if (read) return w.reads[w.reads.length - 1]!.why === '取操作数' ? ['OPD', 'MEM'] : ['MEM'];
    if (step.changes.some((c) => c.at === `words.${i}.ea`) && w.mode && ADD_KINDS.includes(w.mode)) return ['V_A', 'ADDER'];
    return null;
  };
}

/** 选方式的题：镜头看寻址特征那几位和全部方式牌。 */
export function eaAskFrame(p: EaParams) {
  return (): string[] => [...p.modeFields.map((m) => `F_${m}`), ...Object.keys(p.modes).map((k) => `M_${k}`)];
}

/** 第 0 步的问题、结论、需要先会。 */
export const EA_QUESTION = { text: '指令字里哪几位决定寻址方式，取到操作数要访存几次', at: ['IW', 'WORD'] };
export const EA_CONCLUSION =
  '先把十六进制展开成二进制，按格式切出寻址特征和形式地址 A，查表认出方式再代公式：直接 EA = A，间接 EA = (A)，变址、基址 EA = (R) + A，相对 EA = (PC) + A；公式里每多一层括号就多访存一次，取操作数再访存一次。';
export const EA_NEEDS = [
  { href: '/4-opcode', text: '指令格式与操作码' },
  { href: '/2-codes', text: '补码' },
];

/** 答错 EA 时演学生的答案：他的地址卡飞向主存，告诉他错在哪一跳。 */
export function eaWrong(p: EaParams, rows: string[]) {
  return (ask: { kind: string; answer: string }, value: string, state: EaState, next: Step<EaState> | null): Breakage | null => {
    if (ask.kind !== 'text' || !next) return null;
    const i = next.state.current;
    if (i === null) return null;
    const w = next.state.words[i]!;
    const said = normHex(value);
    if (said === null) return { label: '', patch: {}, moves: [], message: '写成十六进制，例如 01A0H。' };
    const bits = p.addressBits ?? 16;
    const shown = `${said.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`;
    const addressField = p.addressField ?? 'A';
    const a = w.fields ? parseInt(w.fields[addressField]!, 2) : null;
    const pointer = w.reads.find((r) => r.why === '取操作数地址');
    const row = rows.indexOf(shown);
    const moves: Move[] = [{ value: shown, from: row >= 0 ? 'EA' : `F_${addressField}`, to: row >= 0 ? `MEM.${row}.0` : 'EA', arc: true, ink: 'addr' }];
    const patch = { EA: { value: shown } };
    let message: string;
    if (pointer && said === parseInt(pointer.addr, 16)) {
      message = `${shown} 是存放 EA 的单元，不是 EA。间接寻址还要再访存一次，把这个单元里的数取出来才是 EA。`;
    } else if (a !== null && said === a && w.mode !== '直接' && w.mode !== '间接') {
      const reg = regOf(p, current(state) ?? w) ?? 'R';
      message = `${shown} 只是形式地址 ${addressField}。这一条是${w.mode}寻址，还要加上 (${reg})。`;
    } else if (w.mode && (w.mode === '相对' || w.mode === '先相对后间接') && a !== null) {
      message = `按 ${shown} 去主存取数，取到的不是这条指令要的操作数。相对寻址的 ${addressField} 按补码看，最高位是 1 时是负数，要减。`;
    } else {
      message = `按 ${shown} 去主存取数，取到的不是这条指令要的操作数。把方式的公式和题目给的寄存器再对一遍。`;
    }
    return { label: '', patch, moves, message };
  };
}

function normHex(text: string): number | null {
  const t = text.trim().replace(/\s+/g, '').replace(/[hH]$/, '');
  if (!/^[0-9A-Fa-f]+$/.test(t)) return null;
  return parseInt(t, 16);
}

/**
 * 弄坏它：把当前指令的寻址特征最低位翻过来，让引擎按改坏的指令字重算一遍，
 * 演出它按另一种方式取到的数。真实硬件不会报错，只是程序算错。
 */
export function eaBreak(p: EaParams, rows: string[]) {
  return (state: EaState, part: string | null): Breakage | null => {
    const w = current(state);
    if (!w || !w.mode || w.operand === null || state.current === null) return null;
    if (part !== null && !part.startsWith('F_') && !part.startsWith('M_')) return null;
    const keyField = p.modeFields[p.modeFields.length - 1]!;
    let at = 0;
    for (const f of p.fields) {
      if (f.name === keyField) {
        at += f.bits - 1;
        break;
      }
      at += f.bits;
    }
    const flipped = w.binary!.slice(0, at) + (w.binary![at] === '1' ? '0' : '1') + w.binary!.slice(at + 1);
    const word = parseInt(flipped, 2).toString(16).toUpperCase().padStart(p.wordBits / 4, '0');
    let solved;
    try {
      solved = solveWord(p, word);
    } catch {
      return null;
    }
    const bits = p.addressBits ?? 16;
    const h = (v: number) => `${v.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`;
    const opd = solved.operand === null ? '' : h(solved.operand);
    const ea = solved.ea === null ? '' : h(solved.ea);
    const moves: Move[] = [];
    solved.reads.forEach((r, k) => {
      const row = rows.indexOf(h(r.addr));
      const target = row >= 0 ? `MEM.${row}.0` : 'MEM';
      moves.push({ value: h(r.addr), from: k === 0 ? (solved.mode.kind === '直接' || solved.mode.kind === '间接' ? `F_${p.addressField ?? 'A'}` : 'EA') : 'EA', to: target, arc: true, ink: 'addr', phase: k * 2 });
      moves.push({ value: h(r.value), from: target, to: r.why === '取操作数' ? 'OPD' : 'EA', arc: true, phase: k * 2 + 1 });
    });
    const patch: Record<string, Record<string, unknown>> = {
      [`F_${keyField}`]: { bits: flipped.slice(at - (p.fields.find((f) => f.name === keyField)!.bits - 1), at + 1) },
      IW: { value: `${word}H` },
      EA: { value: ea },
      OPD: { value: opd },
      COUNT: { value: `${solved.reads.length} 次` },
    };
    const key = solved.key;
    if (`M_${key}` && p.modes[key]) patch[`M_${key}`] = { focus: true };
    const was = w.operand;
    const kind = solved.mode.kind as ModeKind;
    return {
      label: `弄坏它：翻转 ${keyField} 位`,
      patch,
      moves,
      message: `${keyField} 位翻过来，指令字成了 ${word}H，CPU 照${kind}寻址（${FORMULA[kind]}）去取${solved.reads.length ? `，访存 ${solved.reads.length} 次` : ''}，拿到的操作数是 ${opd || '（不取）'}，本来应是 ${was}。硬件不会报错，程序只是悄悄算错了。`,
    };
  };
}

/** 常见错误：每条在场景里演一遍，数都取自 Trace。 */
export function eaMistakes(trace: Trace<EaParams, EaState>, rows: string[]): Mistake<EaState>[] {
  const p = trace.params;
  const steps = trace.steps;
  const out: Mistake<EaState>[] = [];
  const indirect = steps.findIndex((s) => s.level === 'access' && s.state.current !== null && s.state.words[s.state.current]!.reads.length === 1 && s.state.words[s.state.current]!.reads[0]!.why === '取操作数地址');
  if (indirect >= 0) {
    const at = steps[indirect]!.state.current!;
    const w = steps[steps.length - 1]!.state.words[at]!;
    const pointer = w.reads[0]!;
    out.push({
      text: '容易把存放 EA 的单元地址当成 EA，因为直接寻址时 A 就是 EA',
      at: indirect,
      act: () => ({
        label: '',
        patch: { EA: { value: pointer.addr }, COUNT: { value: '1 次' } },
        moves: [{ value: pointer.addr, from: w.mode === '间接' ? `F_${p.addressField ?? 'A'}` : 'ADDER', to: 'EA', arc: true, ink: 'addr' }],
        message: `${pointer.addr} 单元里放的是 ${pointer.value}，这才是 EA。间接寻址比直接寻址多一跳：先访存取地址，再访存取操作数，一共 ${w.reads.length} 次。`,
      }),
    });
  }
  const relative = steps.findIndex((s) => s.state.current !== null && s.state.words[s.state.current]!.mode === '相对' && (s.state.words[s.state.current]!.a ?? 0) < 0 && s.changes.some((c) => c.at.endsWith('.ea')));
  if (relative >= 0) {
    const st = steps[relative]!.state;
    const w = st.words[st.current!]!;
    const raw = parseInt(w.fields![p.addressField ?? 'A']!, 2);
    const bits = p.addressBits ?? 16;
    const wrong = ((p.registers.PC ?? 0) + raw) % 2 ** bits;
    const shown = `${wrong.toString(16).toUpperCase().padStart(Math.ceil(bits / 4), '0')}H`;
    out.push({
      text: '容易把相对寻址的形式地址当正数加，因为别的方式都按无符号数',
      at: relative,
      act: () => ({
        label: '',
        patch: { EA: { value: shown }, ADDER: { value: shown } },
        moves: [{ value: shown, from: 'ADDER', to: 'EA', via: ['add-ea'], ink: 'addr' }],
        message: `把 ${fieldHex(w.fields![p.addressField ?? 'A']!)} 当正数加，得到 ${shown}。相对寻址的 A 按补码看，最高位是 1 就是负数，要往回数：EA 应是 ${w.ea}。`,
      }),
    });
  }
  const fetch = steps.findIndex((s) => s.level === 'access' && s.state.current !== null && s.state.words[s.state.current]!.reads.at(-1)?.why === '取操作数');
  if (fetch >= 0) {
    const w = steps[fetch]!.state.words[steps[fetch]!.state.current!]!;
    out.push({
      text: '容易把取指令那次也数进访存次数，因为它也读了主存',
      at: fetch + 1,
      act: () => ({
        label: '',
        patch: { COUNT: { value: `${w.reads.length + 1} 次` }, IW: { changed: true } },
        moves: [{ value: w.word, from: 'MEM', to: 'IW', arc: true }],
        message: `题目问的是取操作数要访存几次，取指令那次不算。这一条是 ${w.reads.length} 次：${w.reads.map((r) => r.why).join('、')}。`,
      }),
    });
  }
  return out.slice(0, 3);
}

/** 用到本站约定的步：相对寻址时 (PC) 直接用题目给的值。 */
export function eaConvention(step: Step<EaState>): string | null {
  const i = step.state.current;
  if (i === null) return null;
  const w = step.state.words[i]!;
  if ((w.mode === '相对' || w.mode === '先相对后间接') && step.changes.some((c) => c.at.endsWith('.mode'))) {
    return '(PC) 直接用题目给的值，不再自己加指令长度（解析书 析10 的做法）；教材 p140 讲 IA-32 时用的是下一条指令的地址，考试按题目给的条件算。';
  }
  return null;
}

export { MODE_KINDS };
