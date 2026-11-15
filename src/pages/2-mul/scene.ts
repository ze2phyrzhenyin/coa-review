/**
 * 阵列乘法的场景：位积方阵加全加器阵列，一格一张翻片，摆成教材图 2.6、2.7 的样子。
 * 部件位置只取决于 n 和有没有符号位，画面只取决于当前步的状态；位、和、进位都取自引擎的 Trace。
 *
 * 版式（台面坐标，z 朝向观看的人；列按权 2^w 对齐，左高右低）：
 *   最上面两行是 |x|、|y|（带符号时左边单独一列放符号位，右边是算前求补器）；
 *   下面 n 行位积，第 j 行左移 j 列，斜着排成平行四边形；
 *   再下面 n 行全加器（第 n 行是行波进位），每个全加器左下方一张小牌是它送出的进位，顺对角线流到下一行；
 *   最下面一行是积 p_2n−1…p_0，右边是算后求补器，再下面是积和乘法时间。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { flatten } from '../../engines/trace';
import type { MulParams, MulState } from '../../engines/mul/model';
import { complement, run } from '../../engines/mul/model';
import { decode } from '../../lib/bits';
import { bindTable, from } from '../../scene';
import type { Binding, Move, Patch, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

type Table = Parameters<typeof bindTable<MulState>>[0];

export interface MulScene<S extends MulState> {
  scene: SceneSpec;
  bind: Binding<S>;
  moves: (step: Step<S>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  flipPart: (ask: Ask, index: number) => string | null;
  wrong: (ask: Ask, value: string, state: S, next: Step<S> | null) => Breakage | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<S>) => string[] | null;
  mistakes: Mistake<S>[];
  convention: (step: Step<S>) => string | null;
  /** 第 0 步的问题落在哪：|x|、|y| 两行和它们的求补器。 */
  top: string[];
}

/** 粗估一行字在台面上的宽度：中文按字高算，其余按六成。 */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text.replace(/[_^]/g, '')) w += /[　-鿿＀-￯]/.test(ch) ? size : size * 0.6;
  return w;
}

const minus = (text: string) => text.replace(/^-/, '−');

export interface MulGeometry {
  P: number;
  colX: (w: number) => number;
  signX: number;
  labelRight: number;
}

export function geometry(n: number, signed: boolean, compact: boolean): MulGeometry {
  // 窄屏：格距收到位格刚好不相碰，行名贴着每行最左一格放，整张台面在 390 宽、12 像素字下装得下。
  const P = compact ? 0.64 : 0.76;
  const W = 2 * n;
  const colX = (w: number) => ((W - 1) / 2 - w) * P;
  const signX = colX(W - 1) - P - (compact ? 0.12 : 0.3);
  const labelRight = (signed ? signX : colX(W - 1)) - P / 2 - (compact ? 0.12 : 0.25);
  return { P, colX, signX, labelRight };
}

export function mulScene<S extends MulState>(trace: Trace<MulParams, S>, compact = false): MulScene<S> {
  const { n, mode } = trace.params;
  const signed = mode !== '无符号';
  const W = 2 * n;
  const code = mode === '原码' ? '原' : '补';
  const { P, colX, signX, labelRight } = geometry(n, signed, compact);
  // 带符号时 |x|、|y| 两行右边各有一个求补器，行距要放得下它。
  const zB = signed ? 1.6 : 0.95;
  const R = 0.92;
  const RF = 1.25;
  const zPP = zB + 1.05;
  const zFA = zPP + (n - 1) * R + 1.15;
  const zRow = (r: number) => zFA + r * RF;
  const zP = zRow(n - 1) + RF;
  const zRes = zP + (signed && compact ? 2.35 : 1.55);
  const last = trace.steps[trace.steps.length - 1]?.state ?? trace.initial;
  const productLabel = mode === '原码' ? '[x×y]原' : mode === '补码' ? '[x·y]补' : 'P';

  // 出题的那一屏（第 i 屏出 steps[i] 的题）。
  const askAt = (pred: (step: Step<S>) => boolean) => trace.steps.findIndex((step) => !!step.ask && pred(step));
  const askP1 = askAt((step) => step.ask?.kind === 'bits' && step.changes.some((c) => c.at === 'rows.0.0.sum'));
  const askTop = askAt((step) => step.ask?.kind === 'bits' && step.changes.some((c) => c.at === `rows.${n - 1}.${n - 2}.sum`));
  const askPost = askAt((step) => step.ask?.kind === 'choice');

  const parts: PartSpec[] = [];
  const table: Table = {};
  const cell = (id: string, x: number, z: number, title: string, variant: 'bit' | 'fa' | 'carry' = 'bit', extra: Partial<PartSpec> = {}) =>
    parts.push({
      id,
      kind: '2-mul:cell',
      position: [x, z],
      props: { bits: ' ', variant },
      title,
      describe: (p: Patch) => `${title}：${String(p.bits ?? '').trim() || '空'}`,
      ...extra,
    } as PartSpec);
  const LS = compact ? 0.31 : 0.34;
  /** 行名的右边界：宽屏是固定的一列；窄屏贴着这一行最左一格（最高权 top 那一列）。 */
  const rightOf = (top: number | null) => (compact && top !== null ? colX(top) - P / 2 - 0.12 : labelRight);
  const label = (id: string, text: string, z: number, top: number | null = null, size = LS) => {
    parts.push({ id, kind: 'label', position: [rightOf(top) - textWidth(text, size) / 2, z], props: { text, size, tone: 'text', weight: 600 } });
  };

  // 列头。
  for (let w = 0; w < W; w++) parts.push({ id: `head-${w}`, kind: 'label', position: [colX(w), -0.85], props: { text: `2^${w}`, size: LS, tone: 'muted' } });
  if (signed) parts.push({ id: 'head-s', kind: 'label', position: [signX, -0.85], props: { text: '符号', size: LS, tone: 'muted' } });

  // |x|、|y|：带符号时，写出 [x] 以后先显示它的数值位，过算前求补器时就地翻成绝对值，翻过的位是强调色。
  const operandRow = (key: 'a' | 'b', machine: 'x' | 'y', z: number) => {
    for (let i = 0; i < n; i++) {
      const at = n - 1 - i;
      const id = `${key}-${i}`;
      const name = signed ? `|${machine}| 的 2^${i} 位` : `${key.toUpperCase()} 的 2^${i} 位`;
      cell(id, colX(i), z, name, 'bit', { delay: i * 30 } as Partial<PartSpec>);
      if (signed) {
        table[id] = {
          bits: (c) => c.state[key].charAt(at) || c.state[machine].slice(1).charAt(at) || ' ',
          changed: (c) => c.changed.has(key) && c.state[key].charAt(at) !== c.state[machine].slice(1).charAt(at),
          focus: (c) => c.changed.has(machine),
        };
      } else table[id] = { bits: from(key, (c) => c.state[key].charAt(at) || ' ') };
    }
  };
  operandRow('a', 'x', 0);
  operandRow('b', 'y', zB);
  if (signed) {
    cell('sx', signX, 0, 'x 的符号位 x_f');
    cell('sy', signX, zB, 'y 的符号位 y_f');
    table.sx = { bits: from('sign.xf', (c) => c.state.sign?.xf || ' ') };
    table.sy = { bits: from('sign.yf', (c) => c.state.sign?.yf || ' ') };
    parts.push({ id: 'l-a', kind: 'label', position: [labelRight - (compact ? 0.4 : 0.35), 0], props: { text: '', size: LS, weight: 600 } });
    parts.push({ id: 'l-b', kind: 'label', position: [labelRight - (compact ? 0.5 : 0.42), zB], props: { text: '', size: LS, weight: 600 } });
    table['l-a'] = { text: from('a', (c) => (c.state.a ? '|x|' : `[x]${code}`)) };
    table['l-b'] = { text: from('b', (c) => (c.state.b ? '× |y|' : `× [y]${code}`)) };
  } else {
    label('l-a', 'A', 0, n - 1);
    label('l-b', '× B', zB, n - 1);
  }

  // 求补器：牌上写 E 和它做了什么。
  // 求补器是一块小牌，贴在这一行右边；窄屏上字短一点也放得下。
  const plateW = 2.9;
  const plateX = colX(0) + P / 2 + 0.3 + plateW / 2;
  const plate = (e: string) => (e === '1' ? 'E = 1 求补' : e === '0' ? 'E = 0 直通' : '求补器');
  // 算前求补器的牌放在这一行左边空着的高位列上（|x|、|y| 只占低 n 列），窄屏上也不加宽台面。
  const preX = n >= 3 ? (colX(W - 1) + colX(n)) / 2 : colX(0) + P / 2 + 1.4;
  if (signed) {
    parts.push({ id: 'cx', kind: 'label', position: [preX, 0], props: { text: '求补器', plate: true, size: 0.31 }, title: 'x 的算前求补器' });
    parts.push({ id: 'cy', kind: 'label', position: [preX, zB], props: { text: '求补器', plate: true, size: 0.31 }, title: 'y 的算前求补器' });
    table.cx = { text: from('pre.x', (c) => plate(c.state.pre?.x.e ?? '')) };
    table.cy = { text: from('pre.y', (c) => plate(c.state.pre?.y.e ?? '')) };
  }

  // 位积方阵：第 j 行是 a_i·b_j，落在 2^(i+j) 那一列。
  for (let j = 0; j < n; j++) {
    const z = zPP + j * R;
    for (let i = 0; i < n; i++) {
      const id = `pp-${j}-${i}`;
      cell(id, colX(i + j), z, `位积 a_${i}·b_${j}`);
      table[id] = { bits: from(`products.${j}.${i}`, (c) => c.state.products[j]?.[i] || ' ') };
    }
    const text = `b_${j}`;
    parts.push({ id: `l-pp-${j}`, kind: 'label', position: [rightOf(j + n - 1) - textWidth(`${text} = 1`, LS) / 2, z], props: { text, size: LS, tone: 'muted' } });
    table[`l-pp-${j}`] = { text: (c) => (c.state.b ? `b_${j} = ${c.state.b.charAt(n - 1 - j)}` : text) };
  }

  // 全加器阵列：rows[r][k] 的权是 r+1+k；进位牌在它左下方，正好在去下一行（或左边一格）的路上。
  for (let r = 0; r < n; r++) {
    const z = zRow(r);
    for (let k = 0; k < n - 1; k++) {
      const w = r + 1 + k;
      const id = `fa-${r}-${k}`;
      const where = r === n - 1 ? `最后一行第 ${k + 1} 个全加器` : `第 ${r + 1} 行第 ${k + 1} 个全加器`;
      // p_1 就是第 1 行最右那个全加器的和：预测 p_1 时直接在这个全加器上翻片，输入就在它上面两行。
      cell(id, colX(w), z, `${where}（权 2^${w}）的和`, 'fa', { pick: r === 0 && k === 0 } as Partial<PartSpec>);
      table[id] = { bits: from(`rows.${r}.${k}`, (c) => c.state.rows[r]?.[k]?.sum || ' ') };
      const cid = `c-${r}-${k}`;
      cell(cid, colX(w) - P / 2, z + 0.45, `${where}送出的进位`, 'carry');
      table[cid] = {
        bits: from(`rows.${r}.${k}.carry`, (c) => c.state.rows[r]?.[k]?.carry || ' '),
        hidden: from(`rows.${r}.${k}.carry`, (c) => !c.state.rows[r]?.[k]?.carry),
      };
    }
    label(`l-fa-${r}`, `第 ${r + 1} 行`, z, r + n - 1);
  }

  // 积：p_k 在 2^k 那一列；带符号时符号位 p_2n 在左边单独一列，算后求补器在右边，就地翻位。
  for (let k = 0; k < W; k++) {
    const id = `p-${k}`;
    const at = W - 1 - k;
    cell(id, colX(k), zP, `积的 p_${k}`, 'bit', { pick: k === 1 || k === W - 1, delay: k * 25 } as Partial<PartSpec>);
    table[id] = signed
      ? {
          bits: from(`p.${k}`, (c) => c.state.post?.output.charAt(at) || c.state.p[k] || ' '),
          changed: (c) => c.changed.has('post.output') && (c.state.post?.output.charAt(at) ?? '') !== (c.state.p[k] ?? ''),
        }
      : { bits: from(`p.${k}`, (c) => c.state.p[k] || ' ') };
  }
  label('l-p', signed ? '积' : 'P', zP, signed ? null : W - 1);
  if (signed) {
    cell('sp', signX, zP, `积的符号位 p_${W}`);
    table.sp = { bits: from('sign.pf', (c) => c.state.sign?.pf || ' ') };
    parts.push({ id: 'xor', kind: 'label', position: [signX, zP - 0.78], props: { text: 'x_f ⊕ y_f', size: 0.31, tone: 'muted' } });
    // 算后求补器：宽屏在积的右边；窄屏在积的下面靠左，E 的两个位置在它右边。
    const postX = compact ? colX(W - 1) + 0.6 : plateX;
    const postZ = compact ? zP + 1.0 : zP;
    const swZ = compact ? postZ : zP + 0.95;
    const swX = compact ? postX + 2.4 : plateX;
    parts.push({ id: 'cp', kind: 'label', position: [postX, postZ], props: { text: '求补器', plate: true, size: 0.31 }, title: '算后求补器' });
    table.cp = { text: from('post', (c) => plate(c.state.post?.e ?? '')) };
    if (mode === '补码') {
      // 回答「算后求补器求补还是直通」时，点 E 的两个位置之一。
      const swW = 1.0;
      parts.push({ id: 'sw-1', kind: 'label', position: [swX - swW / 2 - 0.15, swZ], props: { text: '求补', plate: true, size: 0.31 }, pick: true, title: '求补' });
      parts.push({ id: 'sw-0', kind: 'label', position: [swX + swW / 2 + 0.15, swZ], props: { text: '直通', plate: true, size: 0.31 }, pick: true, title: '直通' });
      table['sw-1'] = { hidden: (c) => !(c.index === askPost || c.state.post?.e === '1') };
      table['sw-0'] = { hidden: (c) => !(c.index === askPost || c.state.post?.e === '0') };
    }
  }

  // 积和乘法时间。
  const resW = Math.max(2.6, textWidth(last.product || '0'.repeat(W + 1), 0.36) + 0.8);
  const resX = colX(0) + P / 2 - resW / 2;
  parts.push({ id: 'res', kind: 'register', position: [resX, zRes], props: { name: productLabel, value: '', width: resW } });
  table.res = { value: 'product' };
  parts.push({ id: 'dec', kind: 'label', position: [resX - resW / 2 - 0.25 - 0.9, zRes + 0.1], props: { text: '', size: 0.34, weight: 600 } });
  table.dec = { text: from('decimal', (c) => (c.state.decimal ? `= ${c.state.decimal}` : '')), hidden: from('decimal', (c) => !c.state.decimal) };
  const tmW = compact ? 2.8 : 3.0;
  const tmX = compact ? resX : resX - resW / 2 - 2.2 - tmW / 2;
  parts.push({ id: 'tm', kind: 'register', position: [tmX, compact ? zRes + 1.65 : zRes], props: { name: '乘法时间 t_m', value: '', width: tmW } });
  table.tm = { value: from('delay', (c) => c.state.delay.replace(/^\(8n−4\)T = /, '')) };

  // 窄屏：每一行左右两头各放一个不写字的占位，镜头看某几行时把它们一起装进画面，
  // 整行连同左边的行名、符号位都在画面里，不会被左右缘切掉。
  const rowZ: Record<string, number> = { a: 0, b: zB, p: zP };
  for (let j = 0; j < n; j++) rowZ[`pp${j}`] = zPP + j * R;
  for (let r = 0; r < n; r++) rowZ[`fa${r}`] = zRow(r);
  if (compact) {
    for (const [key, z] of Object.entries(rowZ)) {
      parts.push({ id: `eL-${key}`, kind: 'label', position: [labelRight - 0.65, z], props: { text: '' } });
      parts.push({ id: `eR-${key}`, kind: 'label', position: [colX(0), z], props: { text: '' } });
    }
  }
  const rowKey = (id: string): string | null => {
    const m = /^(a|b|p|pp|fa|c)-(\d+)/.exec(id);
    if (m) return m[1] === 'pp' ? `pp${m[2]}` : m[1] === 'fa' || m[1] === 'c' ? `fa${m[2]}` : m[1]!;
    return id === 'sx' || id === 'cx' ? 'a' : id === 'sy' || id === 'cy' ? 'b' : id === 'sp' ? 'p' : null;
  };
  const widen = (ids: string[] | null): string[] | null => {
    if (!compact || !ids) return ids;
    const keys = new Set(ids.map(rowKey).filter((key): key is string => !!key && key in rowZ));
    return [...ids, ...[...keys].flatMap((key) => [`eL-${key}`, `eR-${key}`])];
  };
  const scene: SceneSpec = { parts, wires: [], kinds: () => import('./parts') };
  const bind = bindTable<MulState>(table) as unknown as Binding<S>;

  const has = (step: Step<S>, at: string) => step.changes.some((c) => c.at === at);
  const moves = (step: Step<S>): Move[] => {
    const s = step.state;
    const out: Move[] = [];
    if (has(step, 'sign.pf') && s.sign) {
      out.push({ value: s.sign.xf, from: 'sx', to: 'sp', arc: true }, { value: s.sign.yf, from: 'sy', to: 'sp', arc: true });
    }
    if (has(step, 'pre.x.e')) out.push({ value: `E = ${s.pre?.x.e}`, from: 'sx', to: 'cx', arc: true, shape: 'level', ink: 'ctrl' });
    if (has(step, 'pre.y.e')) out.push({ value: `E = ${s.pre?.y.e}`, from: 'sy', to: 'cy', arc: true, shape: 'level', ink: 'ctrl' });
    if (has(step, 'post.e')) out.push({ value: `E = ${s.post?.e}`, from: 'sp', to: 'cp', arc: true, shape: 'level', ink: 'ctrl' });
    // 与门同时给出全部位积：a_i 的值沿斜线落到 2^(i+j) 那一列。
    if (step.changes.some((c) => c.at.startsWith('products.'))) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push({ value: s.products[j]![i]!, from: `a-${i}`, to: `pp-${j}-${i}` });
      out.push({ value: s.p[0]!, from: 'pp-0-0', to: 'p-0', arc: true, phase: 1 });
    }
    for (let r = 0; r < n - 1; r++) {
      if (!has(step, `rows.${r}.0.sum`)) continue;
      for (let k = 0; k < n - 1; k++) {
        const to = `fa-${r}-${k}`;
        out.push({ value: s.products[r + 1]![k]!, from: `pp-${r + 1}-${k}`, to });
        if (r === 0) out.push({ value: s.products[0]![k + 1]!, from: `pp-0-${k + 1}`, to });
        else if (k === n - 2) out.push({ value: s.products[r]![n - 1]!, from: `pp-${r}-${n - 1}`, to });
        else out.push({ value: s.rows[r - 1]![k + 1]!.sum, from: `fa-${r - 1}-${k + 1}`, to });
        if (r > 0) out.push({ value: s.rows[r - 1]![k]!.carry, from: `c-${r - 1}-${k}`, to, arc: true });
      }
      out.push({ value: s.rows[r]![0]!.sum, from: `fa-${r}-0`, to: `p-${r + 1}`, arc: true, phase: 1 });
    }
    const ripple = n - 1;
    for (let k = 0; k < n - 1; k++) {
      if (!has(step, `rows.${ripple}.${k}.sum`)) continue;
      const to = `fa-${ripple}-${k}`;
      if (k === n - 2) out.push({ value: s.products[ripple]![n - 1]!, from: `pp-${ripple}-${n - 1}`, to });
      else out.push({ value: s.rows[ripple - 1]![k + 1]!.sum, from: `fa-${ripple - 1}-${k + 1}`, to });
      out.push({ value: s.rows[ripple - 1]![k]!.carry, from: `c-${ripple - 1}-${k}`, to, arc: true });
      if (k > 0) out.push({ value: s.rows[ripple]![k - 1]!.carry, from: `c-${ripple}-${k - 1}`, to, arc: true });
      const fa = s.rows[ripple]![k]!;
      out.push({ value: fa.sum, from: to, to: `p-${fa.weight}`, arc: true, phase: 1 });
      if (k === n - 2) out.push({ value: fa.carry, from: to, to: `p-${W - 1}`, arc: true, phase: 1 });
    }
    if (has(step, 'product')) out.push({ value: s.product, from: `p-${n}`, to: 'res', arc: true });
    return out;
  };

  const rowsOf = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
  const frameOf = (step: Step<S>): string[] | null => {
    // 开头几步都看 |x|、|y| 两行连同列头；窄屏上整两行装得进画面，不会切掉低位两列。
    const top = [...rowsOf('a', n), ...rowsOf('b', n), ...Array.from({ length: n }, (_, w) => `head-${w}`), ...(signed ? ['sx', 'sy', 'cx', 'cy', 'head-s'] : []), 'l-a', 'l-b'];
    // 窄屏上算符号位那一步也停在这两行：符号落到积那一行时镜头跟过去再回来。
    if (has(step, 'x') || has(step, 'pre.x.e') || has(step, 'pre.y.e') || (compact && has(step, 'sign.pf'))) return top;
    if (has(step, 'post.e')) return [...rowsOf('p', W), 'sp', 'cp'];
    if (has(step, 'product')) return [...rowsOf('p', W), 'res', 'dec', ...(signed ? ['sp'] : [])];
    if (has(step, 'delay') && compact) return ['tm', 'res', ...rowsOf(`fa-${n - 1}`, n - 1)];
    // 位积落下、前几行相加：只看送出位积的行和接收的行，p 那一位落下时镜头会跟过去。
    if (step.changes.some((c) => c.at.startsWith('products.'))) return [...rowsOf('a', n), ...Array.from({ length: n }, (_, j) => rowsOf(`pp-${j}`, n)).flat()];
    for (let r = 0; r < n - 1; r++) {
      if (has(step, `rows.${r}.0.sum`)) return [...rowsOf(`pp-${r + 1}`, n), ...rowsOf(`fa-${r}`, n - 1), ...(r > 0 ? rowsOf(`fa-${r - 1}`, n - 1) : rowsOf('pp-0', n))];
    }
    return null;
  };

  const frame = (step: Step<S>): string[] | null => {
    const chosen = frameOf(step);
    if (chosen || !compact) return widen(chosen);
    // 窄屏上行波进位的每一步：看最后一行全加器和积那一行。
    for (let k = 0; k < n - 1; k++) if (has(step, `rows.${n - 1}.${k}.sum`)) return widen([...rowsOf(`fa-${n - 1}`, n - 1), ...rowsOf('p', W)]);
    return null;
  };
  const flipPart = (_ask: Ask, index: number): string | null => (index === askP1 ? 'fa-0-0' : index === askTop ? `p-${W - 1}` : null);
  const askFrameOf = (_ask: Ask, index: number): string[] => {
    if (index === askP1) return ['pp-0-1', 'pp-1-0', 'fa-0-0'];
    if (index === askTop) return [`fa-${n - 1}-${n - 2}`, `c-${n - 2}-${n - 2}`, `c-${n - 1}-${n - 3 < 0 ? 0 : n - 3}`, `p-${W - 1}`, `p-${W - 2}`];
    if (index === askPost) return ['sp', 'cp', 'sw-1', 'sw-0', `p-${n}`];
    return [];
  };

  const askFrame = (ask: Ask, index: number): string[] => widen(askFrameOf(ask, index)) ?? [];

  const counted = (path: string): string => {
    const m = /^rows\.(\d+)\.(\d+)(?:\.(\w+))?$/.exec(path);
    if (!m) return path;
    const r = Number(m[1]);
    const k = Number(m[2]);
    const where = r === n - 1 ? `最后一行第 ${k + 1} 个全加器` : `第 ${r + 1} 行第 ${k + 1} 个全加器`;
    const field = { top: '上方输入', right: '右方输入', diag: '斜入口', sum: '和', carry: '进位' }[m[3] ?? ''] ?? '';
    return `${where}${field ? `的${field}` : ''}`;
  };
  const plain: Record<string, string> = {
    x: `[x]${code}`,
    y: `[y]${code}`,
    a: signed ? '|x|' : 'A',
    b: signed ? '|y|' : 'B',
    'sign.xf': 'x_f',
    'sign.yf': 'y_f',
    'sign.pf': `p_${W}`,
    product: productLabel,
    value: '真值',
    decimal: '十进制',
    delay: 't_m',
  };
  const FIELD: Record<string, string> = { input: '输入', e: 'E', chain: '扫描链 C', output: '输出' };
  const names = (path: string): string => {
    if (plain[path]) return plain[path]!;
    let m = /^products\.(\d+)\.(\d+)$/.exec(path);
    if (m) return `a_${m[2]}·b_${m[1]}`;
    m = /^p\.(\d+)$/.exec(path);
    if (m) return `p_${m[1]}`;
    m = /^pre\.(x|y)\.(\w+)$/.exec(path);
    if (m) return `${m[1]} 的算前求补器 ${FIELD[m[2] ?? ''] ?? m[2]}`;
    m = /^post\.(\w+)$/.exec(path);
    if (m) return `算后求补器 ${FIELD[m[1] ?? ''] ?? m[1]}`;
    m = /^path\.(\d+)$/.exec(path);
    if (m) return `最长路径第 ${Number(m[1]) + 1} 站`;
    if (path.startsWith('rows.')) return counted(path);
    return path;
  };
  const values = (path: string, value: string): string => (path.startsWith('path.') ? counted(value) : value);

  // 答错时：学生的值先落到格子里，或者按他选的 E 把积演出来，过一会儿退回。
  const productText = (pf: string, magnitude: string) => `${pf}${magnitude}`;
  const wrong = (ask: Ask, value: string, _state: S, next: Step<S> | null): Breakage | null => {
    if (!next) return null;
    const s = next.state;
    if (ask.kind === 'bits' && /^[01]$/.test(value)) {
      if (has(next, 'rows.0.0.sum')) {
        const fa = s.rows[0]![0]!;
        return {
          label: '',
          patch: { 'fa-0-0': { bits: value }, 'p-1': { bits: value } },
          moves: [{ value, from: 'pp-1-0', to: 'fa-0-0' }, { value, from: 'fa-0-0', to: 'p-1', arc: true, phase: 1 }],
          message: `p_1 是第 1 行最右那个全加器的和。它的三个输入是 a_1·b_0 = ${fa.top}、a_0·b_1 = ${fa.right}、进位 ${fa.diag}：1 的个数是奇数，和才是 1。`,
        };
      }
      const fa = s.rows[n - 1]![n - 2]!;
      return {
        label: '',
        patch: { [`p-${W - 1}`]: { bits: value } },
        moves: [{ value, from: `fa-${n - 1}-${n - 2}`, to: `p-${W - 1}`, arc: true }],
        message: `p_${W - 1} 是这个全加器送出的进位。它的三个输入是上方 ${fa.top}、斜入口 ${fa.diag}、右边来的进位 ${fa.right}：至少两个 1 才有进位。`,
      };
    }
    if (ask.kind === 'choice' && s.post && s.sign && (value === '求补' || value === '直通')) {
      const raw = [...s.p].reverse().join('');
      const pf = s.sign.pf;
      // 学生选的 E 下，算后求补器会送出什么：直通就是 raw；求补由引擎的求补器算。
      const out = value === '直通' ? raw : complement(raw, '1').output;
      const bits = productText(pf, out);
      const read = String(decode('补码', bits)).replace('-', '−');
      const patch: Record<string, Patch> = { cp: { text: plate(value === '求补' ? '1' : '0') }, res: { value: bits }, dec: { text: `= ${read}`, hidden: false } };
      for (let k = 0; k < W; k++) patch[`p-${k}`] = { bits: out.charAt(W - 1 - k) };
      return {
        label: '',
        patch,
        moves: [{ value: bits, from: `p-${n}`, to: 'res', arc: true }],
        message: `按「${value}」，积是 ${bits}，按补码读是 ${read}；${trace.result['十进制'] ? `x·y = ${trace.result['十进制']}` : ''}。`,
      };
    }
    return null;
  };

  // 常见错误：都在场景里演，数取自引擎（同一组机器数按原码送进阵列，就是不经过求补器）。
  const finalAt = trace.steps.findIndex((step) => has(step, 'product')) + 1;
  const delayAt = trace.steps.findIndex((step) => has(step, 'delay')) + 1;
  const mistakes: Mistake<S>[] = [];
  const truth = trace.result['十进制'] ?? '';
  if (mode === '补码' && (last.x.charAt(0) === '1' || last.y.charAt(0) === '1')) {
    const alt = run({ mode: '原码', n, x: { as: '机器数', bits: last.x }, y: { as: '机器数', bits: last.y } });
    const altState = alt.steps[alt.steps.length - 1]!.state;
    const altProduct = altState.product;
    const read = String(decode('补码', altProduct)).replace('-', '−');
    mistakes.push({
      text: '容易把负数补码的数值位直接送进阵列，因为补码相加时符号位和数值位一起算就行',
      at: finalAt,
      act: () => {
        const patch = bind.props({ state: altState as S, flat: flatten(altState), index: finalAt, step: null, changed: new Set() });
        for (const id of ['cx', 'cy', 'cp']) patch[id] = { text: '求补器拆掉' };
        patch['l-a'] = { text: `[x]${code} 数值位` };
        patch['l-b'] = { text: `× [y]${code} 数值位` };
        patch.dec = { text: `= ${read}`, hidden: false };
        return {
          label: '',
          patch,
          moves: [{ value: altProduct, from: `p-${n}`, to: 'res', arc: true }],
          message: `阵列只会做无符号乘法。负数补码的数值位按无符号读是 2^${n} − |x|，乘出来拼上符号位是 ${altProduct}，按补码读是 ${read}，而 x·y = ${truth}。所以先用算前求补器取绝对值。`,
        };
      },
    });
  }
  if (mode === '补码' && last.sign?.pf === '1' && last.post) {
    const raw = [...last.p].reverse().join('');
    const bits = productText('1', raw);
    const read = String(decode('补码', bits)).replace('-', '−');
    mistakes.push({
      text: '容易漏掉算后求补，因为两个算前求补器已经把负号去掉了',
      at: finalAt,
      act: () => {
        const patch: Record<string, Patch> = { cp: { text: '求补器拆掉' }, res: { value: bits }, dec: { text: `= ${read}`, hidden: false } };
        for (let k = 0; k < W; k++) patch[`p-${k}`] = { bits: raw.charAt(W - 1 - k), changed: false };
        return {
          label: '',
          patch,
          moves: [{ value: bits, from: `p-${n}`, to: 'res', arc: true }],
          message: `阵列送出的 ${raw} 是 |x|·|y|。直接拼上符号位 1，按补码读成 ${read}，而 x·y = ${truth}。两数异号时 E = 1，算后求补器把它变回补码。`,
        };
      },
    });
  }
  if (delayAt > 0) {
    mistakes.push({
      text: `容易把 t_m 只算到竖直穿过 ${n - 1} 行全加器为止，因为前几行都是一行同时出结果`,
      at: delayAt,
      act: () => {
        const patch: Record<string, Patch> = { tm: { value: `T + ${n - 1}×6T + 3T` } };
        for (let k = 0; k < n - 1; k++) patch[`fa-${n - 1}-${k}`] = { focus: false };
        return {
          label: '',
          patch,
          moves: [],
          message: `漏了最后一行。第 ${n} 行是行波进位加法器，最左的全加器要等进位从右边传 ${n - 1} 次，每次 T_f = 2T，这一段也在最长路径上。`,
        };
      },
    });
  }

  const convention = (step: Step<S>): string | null => {
    if (mode !== '原码') return null;
    if (has(step, 'pre.x.e') || has(step, 'pre.y.e') || has(step, 'post.e')) return '教材说原码乘法用不着算前、算后求补。这里仍画出三个求补器，E 接 0，原样通过，和补码的电路对照着看。';
    return null;
  };

  return { scene, bind, moves, names, values, flipPart, wrong, askFrame, frame, mistakes, convention, top: [...rowsOf('a', n), ...rowsOf('b', n), ...(signed ? ['sx', 'sy', 'cx', 'cy'] : []), 'l-a', 'l-b'] };
}

export { minus };
