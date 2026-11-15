/**
 * 8-mask 的台面。左边是屏蔽字表：每个处理程序一排翻片，深色面是 1（屏蔽），白面是 0（允许），
 * 表下面同一列对齐着请求寄存器、屏蔽寄存器和「送排队器」（请求 ∧ ¬屏蔽）；中间是一叠程序卡，
 * 被压住的卡角写着它存下的屏蔽字；右边是 CPU 运行轨迹。
 * 画面只取决于引擎 Trace 的状态，页面不算轨迹、不算屏蔽字。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import type { Params, State } from '../../engines/mask/model';
import { MAIN } from '../../engines/mask/model';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export const MASK_QUESTION = {
  text: '响应次序由排队器定死，改了屏蔽字，处理完成的先后为什么会变',
  at: ['m-0', 'imr', 'pass'],
};
export const MASK_CONCLUSION =
  '排队器只在没被屏蔽的请求里按响应次序挑。屏蔽字定的是正在运行的程序让谁打断它：放进来的级先做完，挡住的级等它返回再排队。改屏蔽字，改的是谁能打断谁，响应次序没有变，处理完成的先后跟着屏蔽字走。';
export const MASK_NEEDS = [{ href: '/8-intr', text: '单级中断的一次过程' }];

const PITCH = 0.56;
const ROW = 1.15;

export const levelName = (who: number): string => (who === MAIN ? '主程序' : `L${who}`);
const programName = (who: number): string => (who === MAIN ? '主程序' : `L${who} 程序`);

/** 送排队器的位：请求为 1 且没被屏蔽。只是把台面上两排翻片逐位对照，结果仍以引擎的 why 为准。 */
const passBits = (irr: string, imr: string): string =>
  irr
    .split('')
    .map((bit, i) => (bit === '1' && imr[i] === '0' ? '1' : '0'))
    .join('');

export interface MaskStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  caption: (state: State) => string;
  flipPart: (ask: Ask, index: number) => string | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
  wrong: (ask: Ask, value: string, state: State, next: Step<State> | null) => Breakage | null;
  mistakes: Mistake<State>[];
  convention: (step: Step<State>) => string | null;
}

/** 这一步是哪一种：写屏蔽字、排次序、请求到达、进入、运行、返回。 */
export function kindOf(step: Step<State>): 'mask' | 'order' | 'arrive' | 'enter' | 'run' | 'finish' {
  if (step.focus[0]?.startsWith('masks.')) return 'mask';
  if (step.focus[0] === 'order') return 'order';
  if (step.focus[0] === 'irr') return 'arrive';
  if (step.level === 'cycle') return 'enter';
  if (step.level === 'instruction') return 'run';
  return 'finish';
}

export function maskStage(trace: Trace<Params, State>, narrow: boolean): MaskStage {
  const n = trace.params.levels;
  const final = trace.steps.at(-1)?.state ?? trace.initial;
  const end = Math.max(1, final.t);
  const blankRow = ' '.repeat(n);

  // 版式。宽屏：表在左，程序卡居中，轨迹在右。窄屏：从上往下排。
  const TX = narrow ? 0.7 : -6;
  const Z0 = narrow ? 0 : -4.4;
  const ZB = Z0 + n * ROW + 0.45;
  const xs = (j: number) => TX + (j - (n - 1) / 2) * PITCH;
  const right = xs(n - 1) + 0.45;
  const SX = narrow ? 0 : right + 2.6;
  // 窄屏上程序卡在寄存器下面：卡越叠越高，往上长时不能压住「送排队器」那一排。
  const maxCards = Math.max(1, ...trace.steps.map((step) => step.state.stack.length + 1));
  const stackHeight = 0.92 + (maxCards - 1) * 0.5 + 0.48;
  const SZ = narrow ? ZB + 2 * ROW + 1.3 + 1.05 * stackHeight : Z0 + (n - 1) * ROW;
  const trackLength = narrow ? 6.2 : 7.4;
  const lanes = [...Array.from({ length: n }, (_, i) => `L${i}`), '主程序'];
  const trackDepth = lanes.length * 1.25 + 0.5;
  const TRX = narrow ? 0.45 : SX + 1.6 + 1.2 + trackLength / 2;
  const TRZ = narrow ? SZ + 1.5 + trackDepth / 2 : (Z0 - 1.2 + ZB + 2 * ROW) / 2;

  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<State>>[0] = {};

  parts.push({ id: 'order', kind: 'label', position: [narrow ? 0 : TX - 0.4, Z0 - 1.75], props: { text: '', plate: true, size: 0.31, weight: 600 } });
  table.order = {
    text: from('order', (c) => (c.state.order ? `处理次序 ${c.state.order.map(levelName).join('→')}` : c.index > n ? '排不成一个处理次序' : '')),
    hidden: from('order', (c) => !c.state.order && c.index <= n),
  };
  for (let j = 0; j < n; j++) parts.push({ id: `h-${j}`, kind: 'label', position: [xs(j), Z0 - 0.9], props: { text: `L${j}`, size: 0.31, tone: 'muted', weight: 600 } });
  for (let i = 0; i < n; i++) {
    parts.push({ id: `m-${i}`, kind: 'bits', position: [TX, Z0 + i * ROW], props: { name: `L${i} 程序`, bits: blankRow, group: 8 }, pick: true, title: `L${i}` });
    table[`m-${i}`] = { bits: from(`masks.${i}`, (c) => c.state.masks[i] || blankRow) };
  }

  parts.push({ id: 'irr', kind: 'bits', position: [TX, ZB], props: { name: '请求', bits: '0'.repeat(n), group: 8 }, title: '中断请求寄存器' });
  parts.push({ id: 'imr', kind: 'bits', position: [TX, ZB + ROW], props: { name: '屏蔽', bits: '0'.repeat(n), group: 8 }, title: '屏蔽寄存器' });
  parts.push({ id: 'pass', kind: 'bits', position: [TX, ZB + 2 * ROW], props: { name: '送排队器', bits: '0'.repeat(n), group: 8 }, title: '送排队器（请求 ∧ ¬屏蔽）' });
  table.irr = { bits: 'irr' };
  table.imr = { bits: 'imr' };
  table.pass = { bits: from(['irr', 'imr'], (c) => passBits(c.state.irr, c.state.imr)) };

  parts.push({ id: 'queue', kind: 'register', position: [right + (narrow ? 1.25 : 1.9), ZB + 2 * ROW], props: { name: '排队器', value: '', width: 2.0 } });
  table.queue = {
    value: from('running', (c) => (c.step?.level === 'cycle' ? `选 ${levelName(c.state.running)}` : '')),
  };

  parts.push({ id: 'stack', kind: 'stack', position: [SX, SZ], props: { name: '程序卡', cards: [{ title: '主程序' }], width: 3.0 } });
  table.stack = {
    cards: from(['stack', 'running', 'remaining'], (c) => [
      ...c.state.stack.map((frame) => ({ title: programName(frame.who), note: `存 ${frame.imr}` })),
      { title: programName(c.state.running), note: c.state.remaining === null ? '' : `还要 ${c.state.remaining}` },
    ]),
  };

  // 请求到达的标记：到第 index 步为止已经登记过的时刻。
  const arrived: number[][] = [[]];
  for (const step of trace.steps) {
    const seen = [...(arrived.at(-1) ?? [])];
    if (kindOf(step) === 'arrive') seen.push(step.state.t);
    arrived.push(seen);
  }
  const every = end <= 8 ? 1 : end <= 20 ? 2 : end <= 50 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(end / every) + 1 }, (_, k) => ({ at: k * every, text: String(k * every) }));
  parts.push({
    id: 'track',
    kind: 'track',
    position: [TRX, TRZ],
    props: { name: 'CPU 运行轨迹', length: trackLength, span: [0, end], lanes, segments: [], ticks },
    title: 'CPU 运行轨迹',
  });
  const lane = (who: number) => (who === MAIN ? n : who);
  table.track = {
    segments: from('segments', (c) => c.state.segments.map((g) => ({ lane: lane(g.who), from: g.from, to: g.to, ink: g.who === MAIN ? 'muted' : 'data' }))),
    markers: from(['irr', 't'], (c) => {
      const times = new Set(arrived[c.index] ?? []);
      return trace.params.arrivals.filter((a) => times.has(a.at)).map((a) => ({ at: a.at, text: '请求', lane: lane(a.level), ink: 'accent' as const }));
    }),
    now: from('t', (c) => (c.index > n ? c.state.t : undefined)),
  };
  parts.push({ id: 'done', kind: 'register', position: [TRX, TRZ + trackDepth / 2 + 1.75], props: { name: '完成次序', value: '', width: narrow ? 4.4 : 4.8 } });
  table.done = { value: from('done', (c) => c.state.done.map(levelName).join('、')) };

  const scene: SceneSpec = { parts, wires: [] };
  const bind = bindTable<State>(table);

  const moves = (step: Step<State>): Move[] => {
    const kind = kindOf(step);
    const s = step.state;
    if (kind === 'enter') {
      const saved = s.stack.at(-1)!;
      return [
        { value: levelName(s.running), from: 'pass', to: 'queue', phase: 0 },
        { value: saved.imr, from: 'imr', to: 'stack', phase: 1, arc: true },
        { value: s.imr, from: `m-${s.running}`, to: 'imr', phase: 2, arc: true },
      ];
    }
    if (kind === 'finish') return [{ value: s.imr, from: 'stack', to: 'imr', arc: true }];
    if (kind === 'order' && s.order) return [{ value: s.order.map(levelName).join('→'), from: `m-${s.order[0]}`, to: 'order', arc: true }];
    return [];
  };

  const plain: Record<string, string> = { t: '时刻 t', running: '正在运行', imr: '屏蔽寄存器', irr: '请求寄存器', remaining: '还要运行', order: '处理次序' };
  const names = (path: string): string => {
    if (plain[path]) return plain[path]!;
    let m = /^masks\.(\d+)$/.exec(path);
    if (m) return `L${m[1]} 的屏蔽字`;
    m = /^order\.(\d+)$/.exec(path);
    if (m) return `处理次序第 ${Number(m[1]) + 1} 个`;
    m = /^done\.(\d+)$/.exec(path);
    if (m) return `第 ${Number(m[1]) + 1} 个完成`;
    m = /^stack\.(\d+)\.(\w+)$/.exec(path);
    if (m) return `栈第 ${Number(m[1]) + 1} 层 ${({ who: '程序', remaining: '还要运行', imr: '屏蔽字' } as Record<string, string>)[m[2] ?? ''] ?? m[2]}`;
    m = /^segments\.(\d+)\.(\w+)$/.exec(path);
    if (m) return `轨迹第 ${Number(m[1]) + 1} 段 ${({ who: '程序', from: '起', to: '止', depth: '嵌套层数' } as Record<string, string>)[m[2] ?? ''] ?? m[2]}`;
    return path;
  };
  const values = (path: string, value: string): string => {
    if (path === 'running' || /\.who$/.test(path) || /^done\.\d+$/.test(path) || /^order\.\d+$/.test(path)) {
      return value === '' ? value : levelName(Number(value));
    }
    return value;
  };
  const caption = (state: State): string => `t = ${state.t}　正在运行 ${levelName(state.running)}　栈里 ${state.stack.length} 张卡`;

  /** 第 index 屏出的题：屏蔽字题在那一排翻片上作答。 */
  const askedLevel = (index: number): number | null => {
    const focus = trace.steps[index]?.focus[0] ?? '';
    const m = /^masks\.(\d+)$/.exec(focus);
    return m ? Number(m[1]) : null;
  };
  const flipPart = (ask: Ask, index: number): string | null => {
    const level = askedLevel(index);
    return ask.kind === 'bits' && level !== null ? `m-${level}` : null;
  };
  const askFrame = (ask: Ask, index: number): string[] => {
    const level = askedLevel(index);
    if (ask.kind === 'bits' && level !== null) return [`h-0`, `h-${n - 1}`, ...Array.from({ length: n }, (_, i) => `m-${i}`)];
    return ['irr', 'imr', 'pass', ...Array.from({ length: n }, (_, i) => `m-${i}`)];
  };
  const frame = (step: Step<State>): string[] | null => {
    const kind = kindOf(step);
    if (kind === 'run') return ['track'];
    if (kind === 'arrive') return ['irr', 'imr', 'pass', 'track'];
    return null;
  };

  /** 答错时按学生的答案演一遍。 */
  const wrong = (ask: Ask, value: string, state: State, next: Step<State> | null): Breakage | null => {
    if (ask.kind === 'bits') {
      const level = next ? (/^masks\.(\d+)$/.exec(next.focus[0] ?? '')?.[1] ?? null) : null;
      const bits = value.replace(/[\s_]/g, '');
      if (level === null || !/^[01]+$/.test(bits) || bits.length !== n) return null;
      const right = ask.answer;
      const opened = [...bits].flatMap((bit, j) => (bit === '0' && right[j] === '1' ? [j] : []));
      const closed = [...bits].flatMap((bit, j) => (bit === '1' && right[j] === '0' ? [j] : []));
      const say: string[] = [];
      if (opened.length) say.push(`${opened.map(levelName).join('、')} 那一位写成 0，${opened.map(levelName).join('、')} 就能打断 L${level}，它们会抢在 L${level} 前面做完`);
      if (closed.length) say.push(`${closed.map(levelName).join('、')} 那一位写成 1，${closed.map(levelName).join('、')} 被 L${level} 挡住，只能等 L${level} 做完`);
      return {
        label: '',
        patch: { [`m-${level}`]: { bits } },
        moves: [{ value: bits, from: `h-${level}`, to: `m-${level}`, arc: true }],
        message: `按你写的 ${bits}：${say.join('；')}。和要求的处理次序对不上。`,
      };
    }
    if (ask.kind === 'choice' && next) {
      const picked = Number(value.replace(/^L/, ''));
      if (!Number.isInteger(picked)) return null;
      const before = state.imr;
      const blocked = before[picked] === '1';
      return {
        label: '',
        patch: {
          stack: { cards: [...state.stack.map((frame) => ({ title: programName(frame.who), note: `存 ${frame.imr}` })), { title: programName(state.running), note: `存 ${before}` }, { title: programName(picked) }] },
          queue: { value: `选 ${value}？` },
        },
        moves: [{ value, from: 'pass', to: 'queue' }],
        message: blocked
          ? `${value} 在现在的屏蔽字 ${before} 里是 1，被挡住了，送不进排队器，CPU 进不去。`
          : `${value} 没被挡住，但排队器在放过的请求里按响应次序挑，${next.state.running === MAIN ? '' : levelName(next.state.running)} 排在 ${value} 前面。`,
      };
    }
    return null;
  };

  // 常见错误：在这份 Trace 的步骤上演。
  const stepOf = (kind: ReturnType<typeof kindOf>, test: (step: Step<State>) => boolean = () => true): number =>
    trace.steps.findIndex((step) => kindOf(step) === kind && test(step)) + 1;
  const mistakes: Mistake<State>[] = [];
  const firstMask = stepOf('mask');
  if (firstMask > 0) {
    mistakes.push({
      text: '容易把 1 当成允许，因为「置 1」听上去像打开',
      at: firstMask,
      act: (state) => {
        const right = state.masks[0] ?? '';
        const flipped = [...right].map((bit) => (bit === '1' ? '0' : '1')).join('');
        return {
          label: '',
          patch: { 'm-0': { bits: flipped } },
          moves: [{ value: flipped, from: 'h-0', to: 'm-0', arc: true }],
          message: `教材规定屏蔽位 1 = 屏蔽（p270、p290）。写反成 ${flipped}，L0 那一位成了 0：L0 在处理中再来请求就会打断自己，而本该挡住的级全被放了进来，处理次序整个反过来。`,
        };
      },
    });
  }
  const nested = stepOf('enter', (step) => step.state.stack.length >= 2);
  if (nested > 0) {
    mistakes.push({
      text: '容易以为改了屏蔽字，排队器的响应次序也改了，因为处理次序变了',
      at: nested,
      act: (state) => ({
        label: '',
        patch: { queue: { value: '次序没变' } },
        moves: [{ value: '次序没变', from: 'pass', to: 'queue' }],
        message: `排队器的次序是硬件接死的，一直是 ${trace.conditions.find((c) => c.label === '响应优先次序')?.value ?? ''}。这一步能进 ${levelName(state.running)}，是因为被打断的程序的屏蔽字在 ${levelName(state.running)} 那一位是 0，它的请求才送得进排队器。`,
      }),
    });
  }
  const back = stepOf('finish', (step) => step.state.running !== MAIN);
  const backAny = back > 0 ? back : stepOf('finish');
  if (backAny > 0) {
    mistakes.push({
      text: '容易忘了屏蔽字也要进栈，因为保存现场时只想到了寄存器',
      at: backAny,
      act: (state) => {
        const finished = state.done.at(-1) ?? 0;
        const stale = state.masks[finished] ?? state.imr;
        return {
          label: '',
          patch: { imr: { bits: stale }, pass: { bits: passBits(state.irr, stale) } },
          moves: [{ value: stale, from: `m-${finished}`, to: 'imr', arc: true }],
          message: `返回 ${levelName(state.running)} 时屏蔽寄存器要换回 ${state.imr}（它进栈时存下的）。不恢复就还是刚做完的 ${levelName(finished)} 的 ${stale}，${levelName(state.running)} 会按别人的屏蔽字运行：该放进来的请求被挡住。屏蔽寄存器的内容是现场的一部分（教材 p270）。`,
        };
      },
    });
  }

  const convention = (step: Step<State>): string | null => {
    const kind = kindOf(step);
    if (kind === 'order') return '教材只给了置 1、清 0 的规则（p270）和习题 8 的题型，没有例题。按 1 的个数排处理次序是由规则推出来的。';
    if (kind === 'enter' || kind === 'finish') return '响应和返回按不占时间画，轨迹各段首尾相接；实际机器上中间还有中断周期和保存现场的时间。';
    return null;
  };

  return { scene, bind, moves, names, values, caption, flipPart, askFrame, frame, wrong, mistakes, convention };
}
