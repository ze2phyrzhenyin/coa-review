/**
 * 浮点机器码的场景：上面一排是 x、二进制、规格化写法；中间是机器码本身（S、阶码 E、尾数 M 三段位片）；
 * 尾数旁边一格「隐藏位」不在机器码里；再往下是指数 e、偏移量、阶码的十进制值、十六进制；最下面是带放大镜的尺子。
 * 机器数→十进制时多一排「五种情况」（p28），学生点其中一块作答。
 * 所有数都取自引擎的 Trace；尺子的位置只从状态里的规格化写法读出来，不另算。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import type { IeeeParams, IeeeState } from '../../engines/ieee/model';
import { layoutOf } from '../../engines/ieee/model';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export interface IeeeScene {
  scene: SceneSpec;
  bind: Binding<IeeeState>;
  moves: (step: Step<IeeeState>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  flipPart: (ask: Ask, index: number) => string | null;
  wrong: (ask: Ask, value: string, state: IeeeState, next: Step<IeeeState> | null) => Breakage | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<IeeeState>) => string[] | null;
  mistakes: Mistake<IeeeState>[];
  convention: (step: Step<IeeeState>) => string | null;
  question: { text: string; at: string[] };
}

export const IEEE_CONCLUSION =
  '规格化以后小数点前总是 1，知道数落在 2^e 到 2^(e+1) 那一段就知道它，所以 IEEE 754 不存它，读的时候补回来（非规格化数补 0）。阶码 E = e + 偏移量：单精度是 127 = 2^7 − 1，不是 128；E − 128 只是例 2.10 那种非 IEEE 格式。';

const RULES: Record<string, string> = {
  规格化数: 'E 不全 0 也不全 1',
  非规格化数: 'E 全 0，M 不全 0',
  零: 'E 全 0，M 全 0',
  无穷大: 'E 全 1，M 全 0',
  NaN: 'E 全 1，M 不全 0',
  不是规格化数: '尾数最高数值位无效',
};

const MINUS = '−';
/** 长的二进制写法只留前面一段，后面写「…」，台面上的牌放得下。 */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** 从规格化写法（−1.10101 × 2^2、0.1101000 × 2^2）读出尺子上的段和位置。非规格化数、没有写时返回 null。 */
export function onRuler(normal: string, teach: boolean): { binade: number; frac: number } | null {
  const match = /^[−-]?([01])\.([01]*)…? × 2\^([−-]?\d+)$/.exec(normal.trim());
  if (!match) return null;
  const lead = match[1]!;
  const bits = match[2]!.slice(0, 40);
  const e = Number(match[3]!.replace(MINUS, '-'));
  let value = lead === '1' ? 1 : 0;
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') value += 2 ** -(i + 1);
  if (!teach) return lead === '1' ? { binade: e, frac: value } : null;
  if (value < 0.5) return null;
  return { binade: e - 1, frac: value * 2 };
}

function mantissaRows(m: number, compact: boolean): number[] {
  const per = compact ? 8 : 12;
  const rows: number[] = [];
  for (let left = m; left > 0; left -= per) rows.push(Math.min(per, left));
  return rows;
}

/** mode：encode 是十进制→机器数，decode 是机器数→十进制（「弄坏它」也用 decode 的读法）。 */
export function ieeeScene(trace: Trace<IeeeParams, IeeeState>, compact = false, mode: 'encode' | 'decode' = trace.params.direction === '十进制→机器数' ? 'encode' : 'decode'): IeeeScene {
  const L = layoutOf(trace.params.format);
  const teach = L.teach;
  const expBits = L.teach ? L.k : L.expBits;
  const mantBits = L.teach ? L.m : L.mantBits;
  const bias = L.teach ? null : L.bias;
  const input = trace.conditions.find((c) => c.label === '十进制' || c.label === '机器码')?.value ?? trace.params.text;
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<IeeeState>>[0] = {};
  const W = compact;

  // 上面一排：x、二进制、规格化写法。
  const top: [string, string, number, [number, number], [number, number]][] = [
    ['x', 'x（十进制）', W ? 4.6 : 3.6, [-5.0, -2.5], [0, -5.4]],
    ['bin', mode === 'encode' ? '|x| 的二进制' : '真值（二进制）', W ? 5.6 : 4.6, [-0.6, -2.5], [0, -3.95]],
    ['normal', teach ? '尾数 × 2^e' : '规格化写法', W ? 5.6 : 4.8, [4.6, -2.5], [0, -2.5]],
  ];
  for (const [id, name, width, wide, narrow] of top) parts.push({ id, kind: 'register', position: W ? narrow : wide, props: { name, value: '', width }, title: name });
  const fit = W ? 20 : 18;
  table.x = { value: mode === 'encode' ? from('decimal', () => input.replace('-', MINUS)) : from('decimal', (c) => clip(c.state.decimal, fit)) };
  table.bin = { value: mode === 'encode' ? from('binary', (c) => clip(c.state.binary, fit)) : from('value', (c) => clip(c.state.value, fit)) };
  table.normal = { value: from('normal', (c) => (c.state.normal.length > fit ? c.state.normal.replace(/^([−]?[01]\.[01]{0,10})[01]*…?/, '$1…') : c.state.normal)) };

  // 机器码：S、E 一行，M 一行或几行。
  const blank = (k: number) => ' '.repeat(k);
  const rows = mantissaRows(mantBits, true);
  // 宽屏：左半边 S、阶码，下面隐藏位、舍去的位，再下面 e、偏移量、E；右半边尾数几行，下面十六进制。
  // 窄屏：一列往下排。
  parts.push({ id: 'S', kind: 'bits', position: W ? [-1.6, 0] : [-6.7, 0], props: { name: teach ? '数符' : 'S', bits: ' ', group: 4 }, title: '符号位 S', pick: true });
  table.S = { bits: from('sign', (c) => c.state.sign || ' ') };
  const eWidth = expBits * 0.56 + 0.4;
  parts.push({ id: 'E', kind: 'bits', position: W ? [0.55 - (8 - expBits) * 0.28, 1.2] : [-0.25 - eWidth / 2, 0], props: { name: '阶码', bits: blank(expBits), group: 4 }, title: '阶码', pick: true });
  table.E = { bits: from('exponent', (c) => c.state.exponent || blank(expBits)) };
  let offset = 0;
  const mX = W ? 0.55 : 5.0;
  const mZ = W ? 2.4 : 0;
  rows.forEach((count, r) => {
    const start = offset;
    const id = `M${r + 1}`;
    parts.push({ id, kind: 'bits', position: [mX - (8 - count) * 0.28, mZ + r * 1.2], props: { ...(r === 0 ? { name: '尾数 M' } : {}), bits: blank(count), group: 4 }, title: `尾数第 ${start + 1}–${start + count} 位`, pick: true });
    table[id] = { bits: from('mantissa', (c) => (c.state.mantissa ? c.state.mantissa.slice(start, start + count) : blank(count))) };
    offset += count;
  });
  const mEnd = mZ + rows.length * 1.2;
  const below = W ? mEnd + 0.3 : 1.75;

  // 隐藏位（不在机器码里）和舍去的位。
  if (!teach) {
    parts.push({ id: 'hid', kind: 'register', position: W ? [-2.0, below] : [-5.5, below], props: { name: '隐藏位，不存', value: '', width: 2.2 }, title: '隐藏位' });
    table.hid = { value: 'hidden' };
  }
  parts.push({ id: 'cut', kind: 'register', position: W ? [1.7, below] : [-2.2, below], props: { name: '舍去的位', value: '', width: 3.2 }, title: '舍去的位' });
  table.cut = { value: from('rounded', (c) => clip(c.state.rounded, 12)), hidden: from('rounded', (c) => !c.state.rounded) };

  // 指数、偏移量、阶码、十六进制。
  const zNum = W ? below + 1.4 : 3.2;
  const num: [string, string, number, [number, number], [number, number]][] = [
    ['e', '指数 e', W ? 1.7 : 2.0, [-6.3, zNum], [-2.45, zNum]],
    ...(bias !== null ? ([['bias', '偏移量', W ? 2.9 : 3.0, [-3.65, zNum], [0, zNum]]] as [string, string, number, [number, number], [number, number]][]) : []),
    ['Edec', teach ? '阶码' : '阶码 E', W ? 1.7 : 2.0, [-1.0, zNum], [2.45, zNum]],
    ['hex', mode === 'encode' ? '十六进制' : '给出的机器码', 3.6, [4.1, Math.max(zNum, mEnd + 0.35)], [0, zNum + 1.35]],
  ];
  for (const [id, name, width, wide, narrow] of num) parts.push({ id, kind: 'register', position: W ? narrow : wide, props: { name, value: '', width }, title: name });
  table.e = { value: from('e', (c) => c.state.e.replace('-', MINUS)) };
  if (bias !== null) table.bias = { value: from('E', () => (bias === 127 ? '127 = 2^7 − 1' : bias === 1023 ? '1023 = 2^10 − 1' : '128 = 2^7')) };
  table.Edec = { value: 'E' };
  table.hex = { value: mode === 'encode' ? 'hex' : from('hex', (c) => clip(c.state.hex || input, 12)) };
  let zNext = W ? zNum + 2.7 : Math.max(zNum, mEnd + 0.35) + 1.5;

  // 五种情况（机器数→十进制，有这道题时）。
  const kindAsk = trace.steps.find((step) => step.ask?.kind === 'choice' && step.changes.some((change) => change.at === 'kind'))?.ask;
  const kinds = kindAsk?.options ?? [];
  kinds.forEach((kind, i) => {
    const per = W ? 2 : 3;
    const col = i % per;
    const row = Math.floor(i / per);
    const w = W ? 3.2 : 3.6;
    const count = Math.min(per, kinds.length - row * per);
    const x = (col - (count - 1) / 2) * (w + 0.25);
    const id = `kind-${i}`;
    parts.push({ id, kind: 'register', position: [x, zNext + row * 1.6], props: { name: kind, value: RULES[kind] ?? '', width: w }, pick: true, title: kind });
    // 函数绑定：不占 kind 这条路径，写出结论时只有选中的那一块垫焦点纸。
    table[id] = { focus: (c) => c.state.kind === kind && c.changed.has('kind') };
  });
  if (kinds.length) zNext += Math.ceil(kinds.length / (W ? 2 : 3)) * 1.6 + 0.3;

  // 尺子。
  const rulerZ = zNext + 2.1;
  parts.push({
    id: 'ruler',
    kind: '2-ieee:ruler',
    position: [W ? 0.3 : 0, rulerZ],
    props: { binade: null, frac: 1, shift: 0, pin: '', bias: null, lens: '', empty: '', compact: W },
    title: '数轴',
    describe: (p) => (p.binade === null ? '数轴，没有指针' : `数轴，指针在 2^${String(p.binade)} 到 2^${Number(p.binade) + 1} 之间`),
  });
  table.ruler = {
    binade: from('normal', (c) => onRuler(c.state.normal, teach)?.binade ?? null),
    frac: from('normal', (c) => onRuler(c.state.normal, teach)?.frac ?? 1),
    pin: from(['binary', 'decimal'], (c) => {
      if (mode === 'encode') return c.state.binary ? clip(input.replace(/^[-−]/, ''), 10) : '';
      return c.state.decimal ? clip(c.state.decimal.replace(/^[-−]/, ''), 10) : '|x|';
    }),
    bias: from('E', (c) => (c.state.E && bias !== null ? bias : null)),
    lens: from('normal', (c) => {
      const at = onRuler(c.state.normal, teach);
      if (!at) return '';
      const low = teach ? at.binade + 1 - mantBits : at.binade - mantBits;
      return `这一段相邻两数差 2^${low}`;
    }),
    empty: from('kind', (c) => (c.state.kind === '零' ? '零不在这几段上' : c.state.kind === '无穷大' || c.state.kind === 'NaN' ? `${c.state.kind}不是数轴上的点` : c.state.kind === '非规格化数' ? '非规格化数在 0 和最小规格化数之间' : '')),
  };

  const scene: SceneSpec = { parts, wires: [], kinds: () => import('./parts') };
  const bind = bindTable<IeeeState>(table);
  const changed = (step: Step<IeeeState>, path: string) => step.changes.find((change) => change.at === path);

  const moves = (step: Step<IeeeState>): Move[] => {
    const s = step.state;
    const out: Move[] = [];
    if (mode === 'encode') {
      if (changed(step, 'sign')) out.push({ value: s.sign, from: 'x', to: 'S', arc: true });
      if (changed(step, 'binary')) out.push({ value: clip(s.binary, 14), from: 'x', to: 'bin', arc: true });
      if (changed(step, 'e') && !changed(step, 'exponent')) {
        out.push({ value: clip(s.normal, 16), from: 'bin', to: 'normal', arc: true });
        out.push({ value: `e = ${s.e.replace('-', MINUS)}`, from: 'normal', to: 'e', arc: true, phase: 1 });
      }
      if (changed(step, 'rounded')) out.push({ value: clip(s.rounded, 10), from: 'normal', to: 'cut', arc: true });
      if (changed(step, 'exponent')) {
        if (bias !== null) {
          out.push({ value: `+${bias}`, from: 'bias', to: 'Edec', arc: true });
          out.push({ value: s.E, from: 'Edec', to: 'E', arc: true, phase: 1 });
        } else out.push({ value: s.exponent, from: 'e', to: 'E', arc: true });
      }
      if (changed(step, 'mantissa')) {
        if (!teach) out.push({ value: '1', from: 'normal', to: 'hid', arc: true });
        out.push({ value: clip(s.mantissa, 12), from: 'normal', to: 'M1', arc: true, phase: teach ? 0 : 1 });
      }
      if (changed(step, 'hex')) out.push({ value: s.hex, from: 'E', to: 'hex', arc: true });
    } else {
      if (changed(step, 'mantissa') && changed(step, 'exponent')) {
        out.push({ value: s.sign, from: 'hex', to: 'S', arc: true });
        out.push({ value: s.exponent, from: 'hex', to: 'E', arc: true });
        out.push({ value: clip(s.mantissa, 12), from: 'hex', to: 'M1', arc: true });
      }
      const k = kinds.indexOf(s.kind);
      if (changed(step, 'kind') && k >= 0) out.push({ value: s.exponent, from: 'E', to: `kind-${k}`, arc: true });
      if (changed(step, 'E') && !changed(step, 'exponent')) {
        out.push({ value: s.E, from: 'E', to: 'Edec', arc: true });
        if (s.e) out.push({ value: `e = ${s.e.replace('-', MINUS)}`, from: 'Edec', to: 'e', arc: true, phase: 1 });
      } else if (changed(step, 'e') && !changed(step, 'E')) out.push({ value: `e = ${s.e.replace('-', MINUS)}`, from: 'E', to: 'e', arc: true });
      if (changed(step, 'hidden') && !teach) out.push({ value: s.hidden, from: 'hid', to: 'normal', arc: true });
      if (changed(step, 'decimal')) {
        out.push({ value: clip(s.value, 14), from: 'normal', to: 'bin', arc: true });
        out.push({ value: clip(s.decimal, 14), from: 'bin', to: 'x', arc: true, phase: 1 });
      }
    }
    return out;
  };

  const NAMES: Record<string, string> = {
    sign: '符号位 S',
    exponent: '阶码',
    mantissa: '尾数 M',
    hex: '十六进制',
    binary: '|x| 的二进制',
    normal: '规格化写法',
    e: '指数 e',
    E: teach ? '阶码' : '阶码 E',
    hidden: '隐藏位',
    kind: '属于哪一种',
    rounded: '舍去的位',
    value: '真值',
    decimal: '十进制',
  };
  const names = (path: string) => NAMES[path] ?? path;
  const values = (path: string, value: string) => (path === 'e' ? value.replace('-', MINUS) : path === 'decimal' || path === 'value' || path === 'binary' || path === 'rounded' ? clip(value, 24) : value);

  const stepAt = (index: number) => trace.steps[index];
  const flipPart = (ask: Ask, index: number): string | null => {
    if (ask.kind !== 'bits') return null;
    const step = stepAt(index);
    if (!step) return null;
    if (changed(step, 'sign')) return 'S';
    if (changed(step, 'exponent')) return 'E';
    if (changed(step, 'mantissa') && rows.length === 1) return 'M1';
    return null;
  };
  const askFrame = (ask: Ask, index: number): string[] => {
    const step = stepAt(index);
    if (!step) return [];
    if (ask.kind === 'choice' && kinds.length) return W ? kinds.map((_, i) => `kind-${i}`) : ['E', 'M1', ...kinds.map((_, i) => `kind-${i}`)];
    // 窄屏：出题时镜头留在刚做完的那一步上（要翻的位片除外），上一步写出的值不会被跳过。
    if (W) {
      const flip = flipPart(ask, index);
      if (flip) return [flip];
      const done = index > 0 ? trace.steps[index - 1] : undefined;
      return (done ? frame(done) : null) ?? ['x'];
    }
    if (changed(step, 'exponent')) return W ? ['e', 'Edec'] : ['e', 'bias', 'Edec', 'E'].filter((id) => parts.some((p) => p.id === id));
    if (changed(step, 'e')) return ['bin', 'normal'];
    if (changed(step, 'sign')) return ['x', 'S'];
    if (changed(step, 'mantissa')) return ['normal', 'M1'];
    return [];
  };

  /** 窄屏一列排开：每一步只看挨在一起的几行，整组都留在画面里。宽屏按焦点自动取景。 */
  function frame(step: Step<IeeeState>): string[] | null {
    if (!W) return null;
    const mRows = rows.map((_, r) => `M${r + 1}`);
    const row = ['e', ...(bias !== null ? ['bias'] : []), 'Edec'];
    if (mode === 'encode') {
      if (changed(step, 'sign')) return ['S'];
      if (changed(step, 'binary')) return ['x', 'bin'];
      if (changed(step, 'rounded')) return ['normal'];
      // 写阶码这一步：值先在 e、偏移量、E 那一排走（镜头跟着去），落定后看尺子上 e、E 两行刻度。
      if (changed(step, 'exponent')) return bias !== null ? ['ruler'] : row;
      if (changed(step, 'e')) return ['bin', 'normal'];
      if (changed(step, 'mantissa')) return teach ? mRows.slice(0, 3) : [...mRows.slice(-2), 'hid'];
      if (changed(step, 'hex')) return ['hex'];
      return null;
    }
    if (changed(step, 'mantissa') && changed(step, 'exponent')) return ['S', 'E', 'M1'];
    if (changed(step, 'kind')) return kinds.length ? kinds.map((_, i) => `kind-${i}`) : ['E'];
    if (changed(step, 'E') || changed(step, 'e')) return row;
    if (changed(step, 'hidden')) return teach ? ['normal'] : ['ruler'];
    if (changed(step, 'decimal')) return ['x', 'bin'];
    return ['normal'];
  }

  /** 学生给的 e、E 让指针挪几段：数乘 2 的几次方。 */
  const shifted = (state: IeeeState, d: number, extra: Breakage['patch']): Breakage['patch'] => ({ ...extra, ruler: { shift: Math.max(-1, Math.min(1, d)), pin: d === 0 ? undefined : `× 2^${d}` } });

  const wrong = (ask: Ask, value: string, state: IeeeState, next: Step<IeeeState> | null): Breakage | null => {
    if (!next) return null;
    const s = next.state;
    if (ask.kind === 'number' && changed(next, 'e') && !changed(next, 'E')) {
      const v = Number(value.replace(MINUS, '-'));
      const e = Number(s.e.replace(MINUS, '-'));
      if (!Number.isFinite(v)) return null;
      const d = v - e;
      return {
        label: '',
        patch: shifted(state, d, { e: { value: String(v).replace('-', MINUS) } }),
        moves: [{ value: `e = ${String(v).replace('-', MINUS)}`, from: 'normal', to: 'ruler', arc: true }],
        message: `按 e = ${String(v).replace('-', MINUS)}，数落在 2^${v} 到 2^${v + 1} 那一段，${d > 0 ? `是 |x| 的 2^${d} 倍` : `只有 |x| 的 2^${d}`}。数一数小数点移了几位、往哪边移。`,
      };
    }
    if (ask.kind === 'number' && changed(next, 'E') && bias !== null) {
      const v = Number(value);
      const E = Number(s.E);
      if (!Number.isFinite(v)) return null;
      const d = v - E;
      const used = v - Number(s.e.replace(MINUS, '-'));
      return {
        label: '',
        patch: shifted(state, d, { Edec: { value: String(v) } }),
        moves: [{ value: String(v), from: 'Edec', to: 'ruler', arc: true }],
        message:
          used === 128 && bias === 127
            ? `这是按 128 加的。机器按 E − 127 读回来，e 多了 1，数变成 2 倍：指针跳到右边一段。`
            : `按 E = ${v} 存，读的时候 e = ${v} − ${bias}，${d === 0 ? '' : `指针往${d > 0 ? '右' : '左'}挪，数乘 2^${d}`}。`,
      };
    }
    if (ask.kind === 'choice' && kinds.includes(value)) {
      const i = kinds.indexOf(value);
      return {
        label: '',
        patch: { [`kind-${i}`]: { focus: true } },
        moves: [{ value: s.exponent, from: 'E', to: `kind-${i}`, arc: true }],
        message: `${value}要 ${RULES[value] ?? ''}。这里阶码是 ${s.exponent}，尾数${/1/.test(s.mantissa) ? '不全 0' : '全 0'}。`,
      };
    }
    if (ask.kind === 'bits' || ask.kind === 'text') {
      const got = value.replace(/[\s_]/g, '').toUpperCase();
      const want = ask.answer.replace(/[\s_]/g, '').toUpperCase();
      const at = [...want].findIndex((ch, i) => got[i] !== ch);
      if (at < 0 && got.length === want.length) return null;
      const target = changed(next, 'hex') ? 'hex' : changed(next, 'sign') ? 'S' : changed(next, 'exponent') ? 'E' : 'M1';
      const where = got.length !== want.length ? `应写 ${want.replace(/H$/, '').length} 位，写了 ${got.replace(/H$/, '').length} 位。` : target === 'hex' ? `左起第 ${at + 1} 位十六进制不对，它对应机器码的第 ${at * 4 + 1}–${at * 4 + 4} 位。` : `左起第 ${at + 1} 位不对。`;
      return {
        label: '',
        patch: { [target]: target === 'hex' ? { value: value.toUpperCase() } : {} },
        moves: [{ value: clip(value, 12), from: 'normal', to: target, arc: true }],
        message: where,
      };
    }
    return null;
  };

  // 常见错误：都在写阶码、尾数（或补隐藏位）那一步演。
  const iE = trace.steps.findIndex((step) => !!changed(step, 'E'));
  const iM = trace.steps.findIndex((step) => !!changed(step, mode === 'encode' ? 'mantissa' : 'hidden'));
  const final = trace.steps[trace.steps.length - 1]?.state ?? trace.initial;
  const mistakes: Mistake<IeeeState>[] = [];
  if (bias === 127 && iE >= 0 && final.kind === '规格化数') {
    mistakes.push({
      text: '容易把 E 写成 e + 128，因为 2.1.2 的 8 位移码偏移是 2^7',
      at: iE + 1,
      act: (st) => ({
        label: '',
        patch: { Edec: { value: String(Number(st.E) + 1) }, bias: { value: '128？' }, ruler: { shift: 1, pin: '× 2', bias: 128 } },
        moves: [{ value: '+128', from: 'bias', to: 'Edec', arc: true }],
        message: `IEEE 754 的偏移量是 127。多加 1，机器按 E − 127 读回来 e 大 1，数变成 2 倍，指针跳到右边一段。E − 128 只在例 2.10 那种格式里用。`,
      }),
    });
  }
  if (!teach && iM >= 0 && final.kind === '规格化数') {
    mistakes.push({
      text: mode === 'encode' ? '容易把 1.M 的 1 也存进尾数，因为写出来就有它' : '容易读的时候忘了补隐藏的 1，因为机器码里看不见它',
      at: iM + 1,
      act: (st) =>
        mode === 'encode'
          ? {
              label: '',
              patch: { M1: { bits: `1${st.mantissa}`.slice(0, rows[0]) }, hid: { value: '没拿走' }, cut: { value: st.mantissa.slice(-1), hidden: false } },
              moves: [{ value: '1', from: 'normal', to: 'M1', arc: true }],
              message: `尾数只有 ${mantBits} 位，1 挤进最左边，整段右移一位，最后一位被挤掉。机器读的时候还会再补一个 1，读出来是 1.1M，数变大了。`,
            }
          : {
              label: '',
              patch: { hid: { value: '忘了' }, ruler: { shift: -1, pin: '0.M？' } },
              moves: [{ value: '0.', from: 'hid', to: 'normal', arc: true }],
              message: '不补 1 就是 0.M × 2^e，比 2^e 还小，指针掉到左边一段以外。规格化数读出来一定在 2^e 到 2^(e+1) 之间。',
            },
    });
  }
  const iKind = trace.steps.findIndex((step) => !!changed(step, 'kind'));
  if (mode === 'decode' && kinds.length && iKind >= 0) {
    mistakes.push({
      text: '容易把阶码全 0 的都当成 0，因为忘了看尾数',
      at: iKind + 1,
      act: () => ({
        label: '',
        patch: { [`kind-${Math.max(0, kinds.indexOf('非规格化数'))}`]: { focus: true } },
        moves: [{ value: 'E = 0', from: 'E', to: `kind-${Math.max(0, kinds.indexOf('非规格化数'))}`, arc: true }],
        message: '阶码全 0 时还要看尾数：尾数全 0 才是 ±0，不全 0 是非规格化数 0.M × 2^-126（p28）。',
      }),
    });
  }

  const convention = (step: Step<IeeeState>): string | null => {
    if (teach && changed(step, 'rounded')) return '教学格式的尾数按 0 舍 1 入（教材 p67）；教材没有说转换时用哪一种舍入。';
    if (!teach && changed(step, 'rounded')) return '十进制转 IEEE 754 时这里用就近舍入（教材 p64）；教材没有说转换时用哪一种。';
    return null;
  };

  const question = { text: mode === 'encode' ? '规格化以后最前面那个 1 存在哪；阶码 E 是 e 加 127 还是加 128' : '机器码里看不见的那个 1 从哪来；阶码 E 减去多少才是指数 e', at: W ? ['normal', 'E'] : ['normal', ...(bias !== null ? ['bias'] : []), 'Edec', 'ruler'] };
  return { scene, bind, moves, names, values, flipPart, wrong, askFrame, frame, mistakes, convention, question };
}
