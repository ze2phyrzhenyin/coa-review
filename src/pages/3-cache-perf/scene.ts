/**
 * 台面：最远一排是题目给的量，下面一块算式牌写这一步的式子和代入的数，再下面一排是要求的量（求出一个填一个）。
 * 最近的是一把时间尺：t_c、t_a、t_m 各一条，长短就是时间。t_a 那一条由两段接成：命中那部分 h·t_c 和缺失那部分 (1 − h)·t_m，
 * 所以 t_a 一定落在 t_c 和 t_m 之间，e = t_c/t_a 就是 t_c 那条占 t_a 那条的比例。
 * 二级 cache 时尺子换成「每条指令的周期数」：基本 CPI 加上停顿。
 * 长短按引擎 compute 给的数画；牌上的字都取自引擎的状态、result 和解题表。
 */
import type { Step, Trace } from '../../engines/trace';
import { compute } from '../../engines/cacheperf/model';
import type { Params, State } from '../../engines/cacheperf/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec, TrackMarker, TrackSegment } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export interface PerfStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  askFrame: (ask: unknown, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
}

const NAMES: Record<string, string> = {
  h: '命中率 h',
  r: 'r = t_m/t_c',
  e: '访问效率 e',
  t_a: '平均访问时间 t_a',
  时钟周期: '时钟周期',
  主存缺失损失: '主存缺失损失',
  一级CPI: '只有一级 CPI',
  二级缺失损失: '二级缺失损失',
  两级CPI: '两级 CPI',
  性能比: '性能比',
};
export const nameOf = (key: string): string => NAMES[key] ?? key;
const id = (key: string): string => `q-${key}`;

/** 题目给的量：名字和写法。 */
function givens(params: Params): { key: string; name: string; value: string }[] {
  const ns = (x: number) => `${x} ns`;
  switch (params.kind) {
    case '正向':
      return [
        ...(params.h === undefined
          ? [
              { key: 'nc', name: 'N_c', value: `${params.nc ?? 0} 次` },
              { key: 'nm', name: 'N_m', value: `${params.nm ?? 0} 次` },
            ]
          : [{ key: 'hg', name: 'h', value: String(params.h) }]),
        { key: 'tc', name: 't_c', value: ns(params.tc) },
        { key: 'tm', name: 't_m', value: ns(params.tm) },
      ];
    case '由ta求h':
      return [
        { key: 'tc', name: 't_c', value: ns(params.tc) },
        { key: 'tm', name: 't_m', value: ns(params.tm) },
        { key: 'tag', name: 't_a', value: ns(params.ta) },
      ];
    case '由e求h':
      return [
        { key: 'eg', name: 'e', value: `${Number((params.e * 100).toPrecision(6))}%` },
        ...(params.r !== undefined
          ? [{ key: 'rg', name: 'r', value: String(params.r) }]
          : [
              { key: 'tc', name: 't_c', value: ns(params.tc ?? 0) },
              { key: 'tm', name: 't_m', value: ns(params.tm ?? 0) },
            ]),
      ];
    case '二级cache':
      return [
        { key: 'ghz', name: '时钟频率', value: `${params.clockGHz} GHz` },
        { key: 'mem', name: '访问主存', value: ns(params.memoryNs) },
        { key: 'l2ns', name: '访问二级 cache', value: ns(params.l2Ns) },
      ];
  }
}

/** 一份 Trace 对应一张台面。引用要稳定：同一份 Trace 请用 useMemo 缓存。 */
export function perfStage(trace: Trace<Params, State>, narrow: boolean): PerfStage {
  const params = trace.params;
  const v = compute(params);
  const keys = Object.keys(trace.initial);
  const l2 = params.kind === '二级cache';
  const at = <T>(wide: T, small: T): T => (narrow ? small : wide);

  // 结果牌：宽屏一排（二级 cache 两排各三个），手机两列。
  const perRow = narrow ? 2 : l2 ? 3 : keys.length;
  const cellW = at(l2 ? 3.4 : keys.length > 3 ? 2.9 : 3.3, 3.6);
  const regW = at(l2 ? 3.0 : 2.6, 3.3);
  const rowsOf = Math.ceil(keys.length / perRow);
  const zGiven = at(-6.9, -7.8 - (rowsOf - 2) * 1.9);
  const zCalc = at(-4.9, -6.2 - (rowsOf - 2) * 1.9);
  const zResult0 = at(-2.6, -3.9 - (rowsOf - 2) * 1.9);
  const rowGap = at(1.6, 1.9);
  const zTrack = zResult0 + rowsOf * rowGap + at(1.9, 0.9);
  const placeAt = (i: number): [number, number] => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, keys.length - row * perRow);
    const col = i % perRow;
    return [(col - (inRow - 1) / 2) * cellW, zResult0 + row * rowGap];
  };

  const given = givens(params);
  const gW = at(given.length > 3 ? 2.2 : 2.6, given.length > 2 ? 2.25 : 3.0);
  const gGap = at(gW + 0.5, gW + 0.2);
  const parts: PartSpec[] = given.map((g, i) => ({
    id: `g-${g.key}`,
    kind: 'register' as const,
    position: [(i - (given.length - 1) / 2) * gGap, zGiven] as [number, number],
    props: { name: g.name, value: g.value, width: gW },
  }));
  parts.push({ id: 'calc', kind: 'label', position: [0, zCalc], props: { text: '', plate: true, size: 0.31, mono: true } });
  keys.forEach((key, i) => parts.push({ id: id(key), kind: 'register', position: placeAt(i), props: { name: nameOf(key), value: '', width: regW } }));

  // 时间尺。
  const length = at(9.0, 6.4);
  if (l2) {
    const top = v['一级CPI'] ?? 1;
    parts.push({
      id: 'track',
      kind: 'track',
      position: [0.6, zTrack],
      title: '每条指令的周期数',
      props: { length, span: [0, top], lanes: ['只有一级', '有两级'], segments: [], ticks: [{ at: 0, text: '0' }, { at: top, text: `${Number(top.toFixed(2))}` }] },
    });
  } else {
    const tc = params.kind === '由e求h' && params.tc === undefined ? 1 : (params.tc ?? 1);
    const tm = params.kind === '由e求h' && params.tm === undefined ? (params.r ?? 1) : (params.tm ?? 1);
    const unit = params.kind === '由e求h' && params.tc === undefined ? '（以 t_c 为 1）' : ' ns';
    parts.push({
      id: 'track',
      kind: 'track',
      position: [0.6, zTrack],
      title: '时间尺',
      props: {
        ...(unit === ' ns' ? {} : { name: '以 t_c 为 1' }),
        length,
        span: [0, tm],
        lanes: ['t_c', 't_a', 't_m'],
        segments: [
          { lane: 0, from: 0, to: tc, ink: 'data' },
          { lane: 2, from: 0, to: tm, ink: 'data' },
        ],
        ticks: [
          { at: 0, text: '0' },
          { at: tc, text: unit === ' ns' ? String(tc) : '1' },
          { at: tm, text: unit === ' ns' ? String(tm) : String(tm) },
        ],
      },
    });
  }

  const wires = keys.map((key) => ({ id: `w-${key}`, from: 'calc', to: id(key) }));

  /** 解题表里指回这一步的行：算式牌就写它。 */
  const rowOf = (c: BindContext<State>): string[] | null => (c.step ? (trace.table.rows.find((row) => row.step === c.step!.id)?.cells ?? null) : null);
  const known = (c: BindContext<State>, key: string) => c.state[key] !== null && c.state[key] !== undefined;

  const table: Record<string, Record<string, unknown>> = {
    calc: {
      text: (c: BindContext<State>) => {
        const row = rowOf(c);
        if (!row) return '';
        const [, formula, plug] = row;
        const key = keys.find((k) => c.step?.changes.some((change) => change.at === k)) ?? '';
        const lhs = key === 'r' ? 'r' : key === 't_a' ? 't_a' : key === 'h' ? 'h' : key === 'e' ? 'e' : nameOf(key);
        // 手机上放不下整条式子：只写代入的那一半，式子本身在「为什么」里。
        return formula === '已知' ? `${lhs} 已知` : narrow ? `${lhs} = ${plug}` : `${lhs} = ${formula} = ${plug}`;
      },
      hidden: (c: BindContext<State>) => !rowOf(c),
    },
  };
  for (const key of keys) {
    table[id(key)] = { value: from<State>([key], (c) => (known(c, key) ? (trace.result[key] ?? '') : '')) };
  }
  table['track'] = {
    segments: from<State>(keys, (c) => {
      if (l2) {
        const segs: TrackSegment[] = [];
        const base = params.baseCpi;
        if (known(c, '一级CPI')) segs.push({ lane: 0, from: 0, to: base, ink: 'data' }, { lane: 0, from: base, to: v['一级CPI'] ?? base, ink: 'accent' });
        if (known(c, '两级CPI')) {
          const mid = base + params.l1Miss * (v['二级缺失损失'] ?? 0);
          segs.push({ lane: 1, from: 0, to: base, ink: 'data' }, { lane: 1, from: base, to: mid, ink: 'muted' }, { lane: 1, from: mid, to: v['两级CPI'] ?? mid, ink: 'accent' });
        }
        return segs;
      }
      const tc = params.kind === '由e求h' && params.tc === undefined ? 1 : (params.tc ?? 1);
      const tm = params.kind === '由e求h' && params.tm === undefined ? (params.r ?? 1) : (params.tm ?? 1);
      const segs: TrackSegment[] = [
        { lane: 0, from: 0, to: tc, ink: 'data' },
        { lane: 2, from: 0, to: tm, ink: 'data' },
      ];
      const h = known(c, 'h') ? v['h'] : params.kind === '正向' && params.h !== undefined ? params.h : undefined;
      const ta = params.kind === '由ta求h' ? params.ta : known(c, 't_a') ? v['t_a'] : undefined;
      if (h !== undefined && (ta !== undefined || params.kind !== '由ta求h')) {
        // 命中那部分和缺失那部分接起来，总长就是 t_a。只有求出 t_a（或题目给了 t_a）以后才画。
        if (ta !== undefined || known(c, 'e')) {
          const hit = h * tc;
          segs.push({ lane: 1, from: 0, to: hit, ink: 'data' }, { lane: 1, from: hit, to: hit + (1 - h) * tm, ink: 'accent' });
        }
      } else if (ta !== undefined) {
        segs.push({ lane: 1, from: 0, to: ta, ink: 'muted' });
      }
      return segs;
    }),
    markers: from<State>(keys, (c) => {
      const marks: TrackMarker[] = [];
      if (l2) {
        if (known(c, '两级CPI')) marks.push({ at: v['两级CPI'] ?? 0, lane: 1, text: `CPI ${trace.result['两级CPI'] ?? ''}` });
        return marks;
      }
      const ta = params.kind === '由ta求h' ? params.ta : known(c, 't_a') ? v['t_a'] : undefined;
      if (ta !== undefined && params.kind !== '由e求h') marks.push({ at: ta, lane: 1, text: `t_a = ${params.kind === '由ta求h' ? `${params.ta} ns` : (trace.result['t_a'] ?? '')}` });
      if (ta !== undefined && params.kind === '由e求h' && params.tc !== undefined) marks.push({ at: ta, lane: 1, text: `t_a = ${trace.result['t_a'] ?? ''}` });
      if (known(c, 'e')) {
        const tc = params.kind === '由e求h' && params.tc === undefined ? 1 : (params.tc ?? 1);
        marks.push({ at: tc, lane: 0, text: `e = t_c/t_a = ${trace.result['e'] ?? ''}` });
      }
      return marks;
    }),
  };
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  /** 每求出一个量：数从算式牌落进它的牌子。 */
  const moves = (step: Step<State>): Move[] => {
    const key = keys.find((k) => step.changes.some((change) => change.at === k));
    if (!key) return [];
    return [{ value: trace.result[key] ?? '', from: 'calc', to: id(key), via: [`w-${key}`] }];
  };
  const names = (path: string): string => nameOf(path);
  /** 「变化」里的数按引擎 result 的写法（百分数、带 ns）。 */
  const values = (path: string, value: string): string => (value === '' || value === 'null' ? value : (trace.result[path] ?? value));
  const askFrame = (): string[] => ['calc', id('e'), 'track'];
  const frame = (step: Step<State>): string[] | null => {
    if (!narrow) return null;
    const key = keys.find((k) => step.changes.some((change) => change.at === k));
    return key ? ['calc', id(key), 'track'] : null;
  };
  return { scene: { parts, wires }, bind, moves, names, values, askFrame, frame };
}

/** 答错时按学生的答案演后果。 */
export function perfWrong(trace: Trace<Params, State>) {
  const params = trace.params;
  return (ask: { prompt: string; answer: string }, value: string): Breakage | null => {
    if (ask.prompt !== 'e 是多少' || params.kind !== '正向') return null;
    const typed = Number(value.replace(/%$/, ''));
    if (!Number.isFinite(typed) || typed <= 0) return null;
    const e = typed > 1 ? typed / 100 : typed;
    const ta = params.tc / e;
    const text = `${Number(ta.toFixed(2))} ns`;
    return {
      label: '',
      patch: { [id('e')]: { value: `${Number((e * 100).toFixed(1))}%` } },
      moves: [{ value: `${Number((e * 100).toFixed(1))}%`, from: 'calc', to: id('e'), via: ['w-e'] }],
      message:
        e > 1
          ? `e 超过 100%，等于说平均一次访问比 cache 还快，不可能：t_a 至少是 t_c。`
          : `e 写成 ${Number((e * 100).toFixed(1))}%，倒推 t_a = t_c / e = ${text}。可 t_a 是 h·t_c 和 (1 − h)·t_m 两段接起来的长度，在尺子上量不出 ${text}。分母是 r + (1 − r)h，r 和 h 各代进去再算。`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。错的数由页面按错法算，对的数都取自引擎。 */
export function perfMistakes(trace: Trace<Params, State>): Mistake<State>[] {
  const params = trace.params;
  const steps = trace.steps;
  const out: Mistake<State>[] = [];
  const stepOf = (key: string) => steps.findIndex((step) => step.changes.some((change) => change.at === key));
  const v = compute(params);
  if (params.kind === '二级cache') {
    const at = stepOf('两级CPI');
    if (at >= 0) {
      const wrong = params.baseCpi + params.l1Miss * (v['二级缺失损失'] ?? 0) + params.l1Miss * (v['主存缺失损失'] ?? 0);
      out.push({
        text: '容易把一级缺失全都算成要访问主存，因为忘了二级 cache 已经接住了大部分',
        at: at + 1,
        act: () => ({
          label: '',
          patch: { [id('两级CPI')]: { value: Number(wrong.toFixed(4)).toString() } },
          moves: [{ value: Number(wrong.toFixed(4)).toString(), from: 'calc', to: id('两级CPI'), via: ['w-两级CPI'] }],
          message: `一级缺失的访问里，只有题目给的那一小部分（必须访问主存的缺失率）还要去主存；其余在二级 cache 就找到了。按一级缺失率乘主存损失，两级 CPI 比只有一级时还大，二级 cache 白加了。`,
        }),
      });
    }
    const p = stepOf('主存缺失损失');
    if (p >= 0) {
      out.push({
        text: '容易把访问主存的纳秒数直接加到 CPI 上，因为忘了折成时钟周期',
        at: p + 1,
        act: () => ({
          label: '',
          patch: { [id('主存缺失损失')]: { value: `${params.memoryNs} 个周期` } },
          moves: [{ value: `${params.memoryNs} 个周期`, from: 'calc', to: id('主存缺失损失'), via: ['w-主存缺失损失'] }],
          message: `CPI 数的是时钟周期。${params.memoryNs} ns 要除以时钟周期 ${trace.result['时钟周期'] ?? ''}，才是处理器停下的周期数；频率越高，同样的纳秒折出的周期越多。`,
        }),
      });
    }
    return out;
  }
  const tc = params.kind === '由e求h' ? params.tc : params.tc;
  const tm = params.kind === '由e求h' ? params.tm : params.tm;
  // 1. r 写反。
  const rAt = stepOf('r');
  if (rAt >= 0 && tc !== undefined && tm !== undefined) {
    const wrong = Number((tc / tm).toFixed(4));
    out.push({
      text: '容易把 r 写成 t_c/t_m，因为没记住 r 是主存比 cache 慢几倍',
      at: rAt + 1,
      act: () => ({
        label: '',
        patch: { [id('r')]: { value: String(wrong) } },
        moves: [{ value: String(wrong), from: 'calc', to: id('r'), via: ['w-r'] }],
        message: `r = t_m/t_c，主存比 cache 慢几倍，一定大于 1。写成 ${wrong} 小于 1，代进 e = 1/[r + (1 − r)h] 会得到大于 100% 的效率，不可能。尺子上 t_m 那条是 t_c 那条的 ${trace.result['r'] ?? ''} 倍长。`,
      }),
    });
  }
  // 2. 缺失时把 t_c 也加上（另一种模型）。
  const taAt = stepOf('t_a');
  if (taAt >= 0 && params.kind === '正向') {
    const h = v['h'] ?? 0;
    const wrong = params.tc + (1 - h) * params.tm;
    out.push({
      text: '容易在缺失那部分写成 (1 − h)(t_c + t_m)，因为以为要先查完 cache 再去主存',
      at: taAt + 1,
      act: () => ({
        label: '',
        patch: { [id('t_a')]: { value: `${Number(wrong.toFixed(4))} ns` } },
        moves: [{ value: `${Number(wrong.toFixed(4))} ns`, from: 'calc', to: id('t_a'), via: ['w-t_a'] }],
        message: `教材的式(3.5) 是 t_a = h·t_c + (1 − h)·t_m：缺失的那部分只算 t_m（p101）。多加一份 t_c 得 ${Number(wrong.toFixed(4))} ns，是另一种「先查 cache 再访存」的算法，题目没说就按教材的式子。`,
      }),
    });
  }
  // 3. 由 t_a 求 h 时分子分母写反。
  const hAt = stepOf('h');
  if (hAt >= 0 && params.kind === '由ta求h') {
    const wrong = Number(((params.ta - params.tc) / (params.tm - params.tc)).toFixed(4));
    out.push({
      text: '容易把 h 写成 (t_a − t_c)/(t_m − t_c)，因为移项时把命中和缺失弄反了',
      at: hAt + 1,
      act: () => ({
        label: '',
        patch: { [id('h')]: { value: String(wrong) } },
        moves: [{ value: String(wrong), from: 'calc', to: id('h'), via: ['w-h'] }],
        message: `(t_a − t_c)/(t_m − t_c) 求出的是缺失率 1 − h。t_a 离 t_c 越近，命中率越高：h = (t_m − t_a)/(t_m − t_c) = ${trace.result['h'] ?? ''}。`,
      }),
    });
  }
  // 4. e 的倒数关系记反（由 e 求 h）。
  if (hAt >= 0 && params.kind === '由e求h') {
    out.push({
      text: '容易把 e 当成命中率，直接写 h = e，因为两者都是百分数',
      at: hAt + 1,
      act: () => ({
        label: '',
        patch: { [id('h')]: { value: String(params.e) } },
        moves: [{ value: String(params.e), from: 'calc', to: id('h'), via: ['w-h'] }],
        message: `e 是 t_c 占 t_a 的比例，h 是 cache 完成的访问占总访问的比例。缺失一次要花 r 倍的时间，所以 e 总比 h 小得多：e = ${trace.conditions[0]?.value.replace(/^e = /, '') ?? ''} 时 h = ${trace.result['h'] ?? ''}。`,
      }),
    });
  }
  return out;
}

/** 引擎文字里的 Nc、Nm 写成带下标的 N_c、N_m，和教材、舞台上的名牌一致。 */
export const subscript = (text: string): string => text.replace(/\bN([cm])\b/g, 'N_$1');

export function polish(trace: Trace<Params, State>): Trace<Params, State> {
  return {
    ...trace,
    conditions: trace.conditions.map((c) => ({ label: subscript(c.label), value: subscript(c.value) })),
    steps: trace.steps.map((step) => ({ ...step, title: subscript(step.title), why: subscript(step.why) })),
    table: { columns: trace.table.columns, rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(subscript) })) },
  };
}

export const PERF_QUESTION = { text: 'h、r、e、t_a 四个量，知道哪两个就能求出其余的', at: ['calc', 'track'] };
export const PERF_CONCLUSION =
  '四个量靠三条式子连着：h = N_c/(N_c + N_m)，t_a = h·t_c + (1 − h)·t_m，e = t_c/t_a = 1/[r + (1 − r)h]，其中 r = t_m/t_c。正向按 h、r、e、t_a 的次序代；知道 t_a 就由式(3.5) 解出 h = (t_m − t_a)/(t_m − t_c)；知道 e 就由式(3.6) 解出 h = (r − 1/e)/(r − 1)。';
export const PERF_NEEDS = [{ href: '/3-cache-run', text: '命中和缺失' }];
