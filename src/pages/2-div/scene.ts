/**
 * 加减交替除法的场景：一台天平加一个竖式。部件位置只取决于 n，画面只取决于当前步的状态；
 * 位串、商位、进位、天平往哪边沉都取自引擎的 Trace（余数的符号位就是天平的读数）。
 *
 * 版式（台面坐标，z 朝向观看的人）：
 *   最上面一排是 [x]原、[y]原 和商符；下面一排是两个「砝码」：减 y 用的 [−|y|]补，加 y 用的 [|y|]原；
 *   中间是这一轮的竖式：部分余数、加数、和，一格一张翻片；和的左边一张小牌是符号位向外的进位；
 *   竖式下面是商 q_0.q_1…q_n，和余数的各列对齐；最下面是 [q]原 和余数。
 *   天平在竖式右边（窄屏在下面）：左盘是参加这一轮的余数，右盘是除数；和 ≥ 0 左边沉，商 1；和 < 0 右边沉，商 0。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import type { DivParams, DivState } from '../../engines/div/model';
import type { Binding, BindContext, Move, Patch, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export interface DivScene<S extends DivState> {
  scene: SceneSpec;
  bind: Binding<S>;
  moves: (step: Step<S>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  wrong: (ask: Ask, value: string, state: S, next: Step<S> | null) => Breakage | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<S>) => string[] | null;
  mistakes: Mistake<S>[];
}

export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text.replace(/[_^]/g, '')) w += /[　-鿿＀-￯]/.test(ch) ? size : size * 0.6;
  return w;
}

const bitsOf = (text: string) => text.replace('.', '');
const dotted = (bits: string) => (bits ? `${bits.charAt(0)}.${bits.slice(1)}` : '');

/** 竖式现在显示哪一轮：纠余时是最后的余数加 y；否则是最近一轮（左移之后、加减之前也算这一轮）。 */
export interface Work {
  round: number;
  left: string;
  addend: string;
  sum: string;
  carry: string;
  op: string;
  correcting: boolean;
}

export function workOf(s: DivState): Work {
  const n = s.q.length - 1;
  if (s.correction.needed === '1') {
    return { round: n + 1, left: bitsOf(s.rounds[n]!.sum), addend: bitsOf(s.absY), sum: bitsOf(s.correction.sum), carry: '', op: '加 y', correcting: true };
  }
  let round = -1;
  s.rounds.forEach((r, i) => {
    if (r.left || r.op) round = i;
  });
  if (round < 0) return { round: 0, left: bitsOf(s.absX), addend: '', sum: '', carry: '', op: '', correcting: false };
  const r = s.rounds[round]!;
  return { round, left: bitsOf(r.left || s.absX), addend: bitsOf(r.addend), sum: bitsOf(r.sum), carry: r.carry, op: r.op, correcting: false };
}

export function divScene<S extends DivState>(trace: Trace<DivParams, S>, compact = false): DivScene<S> {
  const { n } = trace.params;
  const W = n + 1;
  const P = compact ? 0.7 : 0.74;
  const DOT = 0.24;
  // 列：0 是符号位（商这一行是 q_0），1…n 是 2^-1…2^-n。
  const span = (W - 1) * P + DOT;
  const cx = (c: number) => c * P + (c >= 1 ? DOT : 0) - span / 2;
  const labelRight = cx(0) - P / 2 - 0.3;
  // 窄屏上天平放在和与商之间：加减那一步和上商那一步，天平都和竖式一起入画。
  const Z = compact ? { head: -0.8, r: 0, ad: 1.0, sum: 2.2, q: 7.4, res: 9.1 } : { head: -0.8, r: 0, ad: 1.0, sum: 2.2, q: 3.55, res: 5.25 };
  const zTop = -4.75;
  const zW = -2.65;

  const parts: PartSpec[] = [];
  const table: Record<string, (c: BindContext<DivState>) => Patch> = {};
  const cell = (id: string, x: number, z: number, title: string, variant: 'bit' | 'carry' = 'bit', extra: Partial<PartSpec> = {}) =>
    parts.push({ id, kind: '2-mul:cell', position: [x, z], props: { bits: ' ', variant }, title, describe: (p: Patch) => `${title}：${String(p.bits ?? '').trim() || '空'}`, ...extra } as PartSpec);
  const label = (id: string, text: string, z: number, size = 0.34, x?: number) =>
    parts.push({ id, kind: 'label', position: [x ?? labelRight - textWidth(text, size) / 2, z], props: { text, size, weight: 600 } });

  parts.push({ id: 'h-s', kind: 'label', position: [cx(0), Z.head], props: { text: '符号', size: 0.31, tone: 'muted' } });
  for (let c = 1; c <= n; c++) parts.push({ id: `h-${c}`, kind: 'label', position: [cx(c), Z.head], props: { text: `2^-${c}`, size: 0.31, tone: 'muted' } });

  const anyChanged = (c: BindContext<DivState>, pred: (at: string) => boolean) => [...c.changed].some(pred);
  const row = (key: 'r' | 'ad' | 's', z: number, name: string, pick: (w: Work) => string, changed: (at: string) => boolean) => {
    for (let c = 0; c < W; c++) {
      const id = `${key}-${c}`;
      cell(id, cx(c), z, `${name}的${c === 0 ? '符号位' : `2^-${c} 位`}`, 'bit', { delay: (W - 1 - c) * 25 } as Partial<PartSpec>);
      table[id] = (ctx) => {
        const bits = pick(workOf(ctx.state));
        const hit = !!bits && anyChanged(ctx, changed);
        return { bits: bits.charAt(c) || ' ', changed: hit, focus: hit };
      };
    }
    parts.push({ id: `${key}-dot`, kind: 'label', position: [(cx(0) + cx(1)) / 2, z + 0.16], props: { text: '.', size: 0.5, weight: 700 } });
  };
  row('r', Z.r, '部分余数', (w) => w.left, (at) => /^rounds\.\d+\.left$/.test(at) || at === 'absX' || at === 'correction.needed');
  row('ad', Z.ad, '加数', (w) => w.addend, (at) => /^rounds\.\d+\.addend$/.test(at) || at === 'correction.needed');
  row('s', Z.sum, '和', (w) => w.sum, (at) => /^rounds\.\d+\.sum$/.test(at) || at === 'correction.sum');
  parts.push({ id: 'l-r', kind: 'label', position: [labelRight - 0.75, Z.r], props: { text: '', size: 0.34, weight: 600 } });
  table['l-r'] = (ctx) => {
    const w = workOf(ctx.state);
    return { text: w.correcting ? '余数' : w.round === 0 ? '|x|' : w.left ? `2r_${w.round - 1}` : '' };
  };
  parts.push({ id: 'l-ad', kind: 'label', position: [labelRight - 0.75, Z.ad], props: { text: '', size: 0.34, weight: 600 } });
  table['l-ad'] = (ctx) => {
    const w = workOf(ctx.state);
    return { text: !w.addend ? '' : w.op === '减 y' ? '+[−|y|]补' : '+[|y|]原' };
  };
  parts.push({ id: 'l-s', kind: 'label', position: [labelRight - 0.75, Z.sum], props: { text: '', size: 0.34, weight: 600 } });
  table['l-s'] = (ctx) => {
    const w = workOf(ctx.state);
    return { text: !w.sum ? '' : w.correcting ? '纠余后' : `r_${w.round}` };
  };
  // 和的符号位向外的进位：就是这一轮的商位。
  cell('cout', cx(0) - P / 2 - 0.2, Z.sum + 0.62, '符号位向外的进位', 'carry');
  table.cout = (ctx) => {
    const w = workOf(ctx.state);
    return { bits: w.carry || ' ', hidden: !w.carry };
  };

  // 商 q_0.q_1…q_n，和余数的列对齐。
  for (let c = 0; c < W; c++) {
    const id = `q-${c}`;
    cell(id, cx(c), Z.q, `商 q_${c}`);
    table[id] = (ctx) => ({ bits: ctx.state.q[c] || ' ', changed: ctx.changed.has(`q.${c}`), focus: ctx.changed.has(`q.${c}`) });
  }
  parts.push({ id: 'q-dot', kind: 'label', position: [(cx(0) + cx(1)) / 2, Z.q + 0.16], props: { text: '.', size: 0.5, weight: 700 } });
  label('l-q', '商 q', Z.q);

  // 上面两排：题目、商符；两个砝码。
  const regW = compact ? 2.3 : 2.5;
  const topX = (k: number) => (k - 1) * (regW + 0.35);
  parts.push({ id: 'rx', kind: 'register', position: [topX(0), zTop], props: { name: '[x]原', value: '', width: regW } });
  parts.push({ id: 'ry', kind: 'register', position: [topX(1), zTop], props: { name: '[y]原', value: '', width: regW } });
  parts.push({ id: 'qf', kind: 'register', position: [topX(2), zTop], props: { name: 'q_f = x_f ⊕ y_f', value: '', width: regW } });
  table.rx = (ctx) => ({ value: ctx.state.x, changed: ctx.changed.has('x') });
  table.ry = (ctx) => ({ value: ctx.state.y, changed: ctx.changed.has('y') });
  table.qf = (ctx) => ({ value: ctx.state.sign.qf, changed: ctx.changed.has('sign.qf'), focus: ctx.changed.has('sign.qf') });
  const wW = compact ? 2.6 : 2.9;
  parts.push({ id: 'wsub', kind: 'register', position: [-(wW / 2 + 0.25), zW], props: { name: '减 y：加 [−|y|]补', value: '', width: wW }, pick: true, title: '减 y' });
  parts.push({ id: 'wadd', kind: 'register', position: [wW / 2 + 0.25, zW], props: { name: '加 y：加 [|y|]原', value: '', width: wW }, pick: true, title: '加 y' });
  table.wsub = (ctx) => ({ value: ctx.state.negY, changed: ctx.changed.has('negY'), focus: ctx.state.next === '减 y' });
  table.wadd = (ctx) => ({ value: ctx.state.absY, changed: ctx.changed.has('absY'), focus: ctx.state.next === '加 y' });

  // 天平。
  const balX = compact ? 0 : span / 2 + 3.4;
  const balZ = compact ? Z.sum + 2.9 : Z.ad + 0.2;
  parts.push({ id: 'bal', kind: 'balance', position: [balX, balZ], props: { name: '', left: '0.00000', right: '0.00000', leftName: '余数', rightName: '除数', tilt: 0 } });
  table.bal = (ctx) => {
    const w = workOf(ctx.state);
    const done = !!w.sum;
    return {
      name: '',
      left: dotted(w.left),
      right: ctx.state.absY,
      // 加 y 的那一轮，左盘是上一轮为负的余数左移的结果；减 y 的一轮即使最高位移进了符号位，也是正的 2r。
      leftName: (w.op || ctx.state.next) === '加 y' ? '余数（负）' : '余数',
      tilt: done ? (w.sum.charAt(0) === '0' ? -1 : 1) : 0,
      changed: done && anyChanged(ctx, (at) => at.endsWith('.sum')),
    };
  };
  parts.push({ id: 'verdict', kind: 'label', position: [balX, balZ + 1.35], props: { text: '', plate: true, size: 0.31 } });
  table.verdict = (ctx) => {
    const w = workOf(ctx.state);
    if (!w.sum) return { text: w.op || ctx.state.next || '', hidden: !(w.op || ctx.state.next) };
    if (w.correcting) return { text: '纠余：加 y', hidden: false };
    return { text: `${w.op}，${w.sum.charAt(0) === '0' ? '和 ≥ 0：左边沉，够减' : '和 < 0：右边沉，不够减'}`, hidden: false };
  };

  // 结果。
  const resW = compact ? 2.6 : 2.8;
  const remW = Math.max(3.4, textWidth(`−0.${'0'.repeat(2 * n)}`, 0.36) + 0.6);
  parts.push({ id: 'rq', kind: 'register', position: [cx(0) - P / 2 + resW / 2, Z.res], props: { name: '[q]原', value: '', width: resW } });
  parts.push({ id: 'rr', kind: 'register', position: [compact ? cx(0) - P / 2 + remW / 2 : cx(0) - P / 2 + resW + 0.35 + remW / 2, compact ? Z.res + 1.65 : Z.res], props: { name: '余数 r', value: '', width: remW } });
  table.rq = (ctx) => ({ value: ctx.state.quotient, changed: ctx.changed.has('quotient') });
  table.rr = (ctx) => ({ value: ctx.state.remainder, changed: ctx.changed.has('remainder') });

  const owner = (path: string): string[] => {
    if (path === 'x') return ['rx'];
    if (path === 'y') return ['ry'];
    if (path.startsWith('sign')) return ['qf'];
    if (path === 'negY') return ['wsub'];
    if (path === 'absY') return ['wadd'];
    if (path === 'absX') return ['r-0'];
    if (path === 'quotient') return ['rq'];
    if (path === 'remainder' || path === 'check') return ['rr'];
    const q = /^q\.(\d+)$/.exec(path);
    if (q) return [`q-${q[1]}`];
    if (/\.sum$/.test(path) || path === 'correction.sum') return ['bal'];
    return [];
  };
  const bind: Binding<S> = {
    props: (context) => Object.fromEntries(Object.entries(table).map(([id, fn]) => [id, fn(context as unknown as BindContext<DivState>)])),
    partsFor: owner,
  };

  const has = (step: Step<S>, pred: (at: string) => boolean) => step.changes.some((c) => pred(c.at));
  const cols = (key: string) => Array.from({ length: W }, (_, c) => `${key}-${c}`);
  const moves = (step: Step<S>): Move[] => {
    const s = step.state;
    const w = workOf(s);
    const out: Move[] = [];
    if (has(step, (at) => at === 'sign.qf')) out.push({ value: `${s.sign.xf} ⊕ ${s.sign.yf}`, from: 'rx', to: 'qf', arc: true });
    if (has(step, (at) => at === 'negY')) {
      out.push({ value: s.negY, from: 'ry', to: 'wsub', arc: true }, { value: s.absY, from: 'ry', to: 'wadd', arc: true });
    }
    const added = has(step, (at) => /^rounds\.\d+\.sum$/.test(at));
    const corrected = has(step, (at) => at === 'correction.sum');
    if (corrected) {
      // 纠余：上一轮的和原地成为被加数，再把 |y| 这个砝码放上去。
      for (let c = 0; c < W; c++) out.push({ value: w.left.charAt(c), from: `s-${c}`, to: `r-${c}` });
      for (let c = 0; c < W; c++) out.push({ value: w.addend.charAt(c), from: 'wadd', to: `ad-${c}`, phase: 1 });
    } else if (added) {
      const from = w.op === '减 y' ? 'wsub' : 'wadd';
      for (let c = 0; c < W; c++) out.push({ value: w.addend.charAt(c), from, to: `ad-${c}` });
    }
    if (has(step, (at) => /^q\.\d+$/.test(at))) out.push({ value: w.carry || s.q[w.round] || '', from: 'cout', to: `q-${w.round}`, arc: true });
    // 左移：和的每一位往左上跳一格进余数，最高位移出丢掉，最低位补 0。
    if (has(step, (at) => /^rounds\.\d+\.left$/.test(at)) && w.round > 0) {
      const before = bitsOf(s.rounds[w.round - 1]!.sum);
      for (let c = 0; c < W - 1; c++) out.push({ value: before.charAt(c + 1), from: `s-${c + 1}`, to: `r-${c}`, arc: true });
    }
    if (has(step, (at) => at === 'quotient')) {
      out.push({ value: s.quotient, from: 'q-0', to: 'rq', arc: true });
      out.push({ value: s.remainder, from: 'r-0', to: 'rr', arc: true });
    }
    return out;
  };

  const frame = (step: Step<S>): string[] | null => {
    if (has(step, (at) => /^rounds\.\d+\.left$/.test(at)) && workOf(step.state).round > 0) return [...cols('r'), ...cols('s')];
    if (has(step, (at) => /^rounds\.\d+\.sum$/.test(at) || at === 'correction.sum')) return [...cols('r'), ...cols('ad'), ...cols('s'), 'cout', 'bal'];
    if (has(step, (at) => /^q\.\d+$/.test(at))) return ['bal', 'cout', ...cols('q')];
    // 窄屏上最后一步看商和两个结果；余数从竖式落下来时镜头跟过去再回来。
    if (compact && has(step, (at) => at === 'quotient')) return [...cols('q'), 'rq', 'rr'];
    return null;
  };
  const askFrame = (ask: Ask): string[] => (ask.options?.includes('减 y') ? ['wsub', 'wadd', ...cols('r')] : [...cols('s'), ...cols('q'), 'cout']);

  const names = (path: string): string => {
    const plain: Record<string, string> = {
      x: '[x]原',
      y: '[y]原',
      'sign.xf': 'x_f',
      'sign.yf': 'y_f',
      'sign.qf': 'q_f',
      absX: '[|x|]原',
      absY: '[|y|]原',
      negY: '[−|y|]补',
      r: '部分余数寄存器',
      next: '下一轮做',
      'correction.needed': '要不要纠余',
      'correction.sum': '纠余后的余数',
      quotient: '[q]原',
      quotientValue: '商的真值',
      remainder: '余数',
      check: '验算',
    };
    if (plain[path]) return plain[path]!;
    const q = /^q\.(\d+)$/.exec(path);
    if (q) return `q_${q[1]}`;
    const m = /^rounds\.(\d+)\.(\w+)$/.exec(path);
    if (m) {
      const field = { op: '做什么', p: 'P', left: '参加加减的余数', addend: '加数', sum: '和', carry: '符号位向外的进位', q: '商位' }[m[2]!] ?? m[2];
      return `第 ${m[1]} 轮${field}`;
    }
    return path;
  };
  const values = (path: string, value: string): string => (path === 'correction.needed' ? (value === '1' ? '要' : value === '0' ? '不要' : value) : value);

  // 答错：按学生的选择把砝码放上去，说明会怎样；过一会儿退回。
  const wrong = (ask: Ask, value: string, state: S, next: Step<S> | null): Breakage | null => {
    if (!next) return null;
    if (value === '减 y' || value === '加 y') {
      const w = workOf(next.state);
      const addend = bitsOf(value === '减 y' ? next.state.negY : next.state.absY);
      const patch: Record<string, Patch> = {};
      for (let c = 0; c < W; c++) {
        patch[`ad-${c}`] = { bits: addend.charAt(c) };
        patch[`r-${c}`] = { bits: w.left.charAt(c) };
      }
      patch['l-ad'] = { text: value === '减 y' ? '+[−|y|]补' : '+[|y|]原' };
      patch.bal = { name: value, left: dotted(w.left), tilt: value === '减 y' ? 1 : -1 };
      const message =
        value === '减 y'
          ? `上一轮的余数已经是负的，再减 y 只会更负：${dotted(w.left)} 减去 |y| 小于 −|y|，以后每一轮都拉不回来。上一位商是 0 时，本该先加回 y 再左移减 y，两步并成「左移后加 y」。`
          : `上一位商是 1，余数 ${dotted(w.left)} 够减。这时加 y，结果不小于 |y|，跑出了余数该在的 −|y| ≤ r < |y|，这一位商也就错了。`;
      return { label: '', patch, moves: Array.from({ length: W }, (_, c) => ({ value: addend.charAt(c), from: value === '减 y' ? 'wsub' : 'wadd', to: `ad-${c}` })), message };
    }
    if (value === '不要' || value === '要，再加 y') {
      const last = state.rounds[n]!;
      if (value === '不要') {
        return {
          label: '',
          patch: { rr: { value: `${last.sum}（负）` } },
          moves: [{ value: last.sum, from: 's-0', to: 'rr', arc: true }],
          message: `q_${n} = 0，最后的余数 ${last.sum} 是负的，和被除数（这里按正数算）不同号，不能当余数。要再加 y 纠余。`,
        };
      }
      const patch: Record<string, Patch> = { 'l-ad': { text: '+[|y|]原' } };
      const y = bitsOf(state.absY);
      for (let c = 0; c < W; c++) patch[`ad-${c}`] = { bits: y.charAt(c) };
      return {
        label: '',
        patch,
        moves: Array.from({ length: W }, (_, c) => ({ value: y.charAt(c), from: 'wadd', to: `ad-${c}` })),
        message: `q_${n} = 1，余数 ${last.sum} 已经 ≥ 0。再加 y，余数就不小于 |y| 了，不再是余数。`,
      };
    }
    return null;
  };

  // 常见错误。
  const mistakes: Mistake<S>[] = [];
  const steps = trace.steps;
  const lastState = steps[steps.length - 1]?.state ?? trace.initial;
  const firstAdd = lastState.rounds.findIndex((r, i) => i > 0 && r.op === '加 y');
  if (firstAdd > 0) {
    const at = steps.findIndex((step) => step.changes.some((c) => c.at === `rounds.${firstAdd}.sum`)) + 1;
    const before = lastState.rounds[firstAdd - 1]!;
    const now = lastState.rounds[firstAdd]!;
    mistakes.push({
      text: '容易在余数为负时先加 y 恢复，再左移减 y，因为笔算时不够减就不减',
      at,
      act: () => {
        const patch: Record<string, Patch> = { 'l-r': { text: '恢复后' }, 'l-ad': { text: '' }, 'l-s': { text: '' } };
        const restored = bitsOf(before.left);
        for (let c = 0; c < W; c++) {
          patch[`r-${c}`] = { bits: restored.charAt(c) };
          patch[`ad-${c}`] = { bits: ' ' };
          patch[`s-${c}`] = { bits: ' ' };
        }
        patch.bal = { name: '恢复', left: before.left, tilt: 0 };
        return {
          label: '',
          patch,
          moves: [{ value: before.left, from: 'wadd', to: 'r-0', arc: true }],
          message: `恢复余数法：${before.sum} 加 y 回到 ${before.left}，左移，再减 y，得到的还是 ${now.sum}。2(r + |y|) − |y| = 2r + |y|，所以加减交替直接「左移后加 y」，少做一次加法，每轮步数也固定。`,
        };
      },
    });
  }
  const finalAt = steps.findIndex((step) => step.changes.some((c) => c.at === 'quotient')) + 1;
  if (finalAt > 0) {
    const finalRem = lastState.correction.needed === '1' ? lastState.correction.sum : lastState.rounds[n]!.sum;
    mistakes.push({
      text: '容易把最后的部分余数直接当余数，因为它就留在寄存器里',
      at: finalAt,
      act: () => ({
        label: '',
        patch: { rr: { value: finalRem } },
        moves: [{ value: finalRem, from: 'r-0', to: 'rr', arc: true }],
        message: `每轮左移都把余数放大一倍，${n} 轮放大了 2^${n} 倍。${finalRem} 要乘 2^-${n}，右移 ${n} 位，才是余数 ${lastState.remainder}。`,
      }),
    });
    const q = lastState.q.join('');
    mistakes.push({
      text: '容易把 q_0 当成商的符号位，因为它在小数点左边',
      at: finalAt,
      act: () => ({
        label: '',
        patch: { rq: { value: `${q.charAt(0)}.${q.slice(1)}` } },
        moves: [{ value: q.charAt(0), from: 'q-0', to: 'rq', arc: true }],
        message: `q_0 是第 0 轮试减得到的整数位，|x| < |y| 时总是 0。商的符号 q_f = x_f ⊕ y_f = ${lastState.sign.qf}，单独算出来再放到小数点左边：[q]原 = ${lastState.quotient}。`,
      }),
    });
  }

  const scene: SceneSpec = { parts, wires: [], kinds: () => import('../2-mul/parts') };
  return { scene, bind, moves, names, values, wrong, askFrame, frame, mistakes };
}
