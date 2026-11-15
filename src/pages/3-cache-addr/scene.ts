/**
 * 台面：最远一排是题目给的三样（块大小、cache、主存），下面一块算式牌写这一步的式子；
 * 中间是地址条，长度就是地址位数；它正下方是标记、行号或组号、字地址三段，宽度按位数排，
 * 地址条切开时三段二进制各自落进下面的格子，最近一排是每段的十六进制。
 * 部件位置固定。位数、切出的位串、十六进制都取自 Trace 的状态和引擎的解题表。
 */
import type { Step, Trace } from '../../engines/trace';
import { run, widths } from '../../engines/cacheaddr/model';
import type { Params, State } from '../../engines/cacheaddr/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import { indexName } from './setup';

export interface AddrStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  askFrame: (ask: unknown, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
}

/** 从右往左每 4 位空一格。 */
export function group4(bits: string): string {
  const out: string[] = [];
  for (let end = bits.length; end > 0; end -= 4) out.unshift(bits.slice(Math.max(0, end - 4), end));
  return out.join(' ');
}

/** 一段还没有值时，按位数画成一排小点：看得出这一段有几位。 */
const dots = (n: number): string => group4('·'.repeat(n));

const FIELDS = ['tag', 'idx', 'word'] as const;

/** 一份 Trace 对应一张台面。引用要稳定：同一份 Trace 请用 useMemo 缓存。 */
export function addrStage(trace: Trace<Params, State>, narrow: boolean): AddrStage {
  const params = trace.params;
  const g = widths(params);
  const full = params.mapping === '全相联';
  const iName = indexName(params.mapping);
  const count = [g.tag, g.index, g.w];
  const at = <T>(wide: T, small: T): T => (narrow ? small : wide);

  // 三段的宽度按位数排（每位 0.26，最窄 1.3），间隔 0.3；地址条正好盖住三段。
  const perBit = at(0.27, 0.22);
  // 名牌写「字地址 3 位」，格子再窄也要放得下它。
  const widthOf = (bits: number): number => Math.max(at(2.2, 1.95), bits * perBit + 0.5);
  const shown = FIELDS.filter((_, i) => !(full && i === 1));
  const ws = shown.map((id) => widthOf(count[FIELDS.indexOf(id)]!));
  const gap = at(0.3, 0.2);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  const xs: number[] = [];
  let x = -total / 2;
  for (const w of ws) {
    xs.push(x + w / 2);
    x += w + gap;
  }
  const xOf = (id: (typeof FIELDS)[number]): number => xs[shown.indexOf(id)] ?? 0;
  const wOf = (id: (typeof FIELDS)[number]): number => ws[shown.indexOf(id)] ?? 1.3;

  const zGiven = at(-5.3, -6.3);
  const zCalc = at(-3.8, -4.75);
  const zAddr = at(-1.9, -2.8);
  const zS = at(-0.6, -1.5);
  const zField = at(0.9, 0);
  const zHex = at(2.4, 1.5);
  const conditions = new Map(trace.conditions.map((c) => [c.label, c.value]));
  const givenW = at(2.6, 2.2);
  const givenX = at(3.2, 2.4);

  const parts: PartSpec[] = [];
  if (params.fields) {
    parts.push({ id: 'given', kind: 'label', position: [0, zGiven], props: { text: `给定格式：${conditions.get('给定格式') ?? ''}`, plate: true, size: 0.31 } });
  } else {
    const cacheText = (conditions.get('cache') ?? '').replace('（', ' ');
    parts.push(
      { id: 'blk', kind: 'register', position: [-givenX, zGiven], props: { name: '每块', value: (conditions.get('块大小') ?? '').replace(/^每块 /, '').replace(/，共 /, ' = '), width: givenW } },
      { id: 'cache', kind: 'register', position: [0, zGiven], props: { name: 'cache', value: cacheText, width: givenW } },
      { id: 'mem', kind: 'register', position: [givenX, zGiven], props: { name: '主存', value: conditions.get('主存') ?? '', width: givenW } },
    );
  }
  parts.push(
    { id: 'calc', kind: 'label', position: [0, zCalc], props: { text: '', plate: true, size: 0.31, mono: true } },
    { id: 'addr', kind: 'register', position: [0, zAddr], props: { name: '主存地址', value: '', ink: 'addr', width: total } },
    { id: 's', kind: 'label', position: [full ? xOf('tag') : (xOf('tag') - wOf('tag') / 2 + xOf('idx') + wOf('idx') / 2) / 2, zS], props: { text: '', plate: true, size: 0.31 } },
  );
  const fieldName = (id: (typeof FIELDS)[number]): string => (id === 'tag' ? '标记' : id === 'idx' ? iName : '字地址');
  for (const id of shown) {
    parts.push({ id, kind: 'register', position: [xOf(id), zField], props: { name: fieldName(id), value: '', ink: 'addr', width: wOf(id) } });
    parts.push({ id: `${id}H`, kind: 'label', position: [xOf(id), zHex], props: { text: '', plate: true, size: 0.34, mono: true, weight: 600 } });
  }
  const wires = shown.map((id) => ({ id: `cut-${id}`, from: 'addr', to: id, ink: 'addr' as const }));

  const known = (c: BindContext<State>, id: (typeof FIELDS)[number]): number | null => (id === 'tag' ? c.state.tag : id === 'word' ? c.state.w : full ? null : params.mapping === '直接' ? c.state.r : c.state.d);
  const pieceOf = (c: BindContext<State>, id: (typeof FIELDS)[number]): string => {
    const a = c.state.address;
    if (!a) return '';
    return id === 'tag' ? a.tagBits : id === 'idx' ? a.indexBits : a.wordBits;
  };
  const hexOf = (c: BindContext<State>, id: (typeof FIELDS)[number]): string => {
    const a = c.state.address;
    if (!a) return '';
    return id === 'tag' ? a.tagHex : id === 'idx' ? a.indexHex : a.wordHex;
  };
  const split = (c: BindContext<State>): boolean => !!c.state.address && c.state.address.tagBits + c.state.address.wordBits !== '';
  /** 解题表里指回这一步的行：算式牌就写它。 */
  const rowOf = (c: BindContext<State>): string[] | null => {
    if (!c.step) return null;
    return trace.table.rows.find((row) => row.step === c.step!.id)?.cells ?? null;
  };

  const table: Record<string, Record<string, unknown>> = {
    calc: {
      text: (c: BindContext<State>) => {
        const row = rowOf(c);
        if (!row) return '';
        const [item, how, value] = row;
        return tidy(how === '已知' || how === '已给出' ? `${item}：${value}` : `${item}：${how}，得 ${value}`);
      },
      hidden: (c: BindContext<State>) => !rowOf(c),
    },
    addr: {
      name: from<State>(['length'], (c) => (c.state.length === null ? '主存地址' : `主存地址 ${c.state.length} 位`)),
      value: from<State>(['length', 'address.bits', 'address.tagBits'], (c) => {
        const a = c.state.address;
        if (a && split(c)) return [a.tagBits, a.indexBits, a.wordBits].filter((piece) => piece !== '').join(' | ');
        if (a && a.bits) return group4(a.bits);
        return c.state.length === null ? '' : dots(c.state.length);
      }),
    },
    s: {
      text: from<State>(['s'], (c) => (c.state.s === null ? '' : `块号 s = ${c.state.s} 位`)),
      hidden: (c: BindContext<State>) => c.state.s === null,
    },
  };
  for (const id of shown) {
    const path = id === 'tag' ? 'tag' : id === 'word' ? 'w' : params.mapping === '直接' ? 'r' : 'd';
    table[id] = {
      name: from<State>([path], (c) => {
        const n = known(c, id);
        return n === null ? fieldName(id) : `${fieldName(id)} ${n} 位`;
      }),
      value: from<State>([path, `address.${id === 'tag' ? 'tagBits' : id === 'idx' ? 'indexBits' : 'wordBits'}`], (c) => {
        if (split(c)) return pieceOf(c, id) || '（0 位）';
        const n = known(c, id);
        return n === null ? '' : n === 0 ? '（0 位）' : dots(n);
      }),
    };
    table[`${id}H`] = {
      text: from<State>([`address.${id === 'tag' ? 'tagHex' : id === 'idx' ? 'indexHex' : 'wordHex'}`], (c) => hexOf(c, id)),
      hidden: (c: BindContext<State>) => hexOf(c, id) === '',
    };
  }
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  /** 切开的那一步：三段位串从地址条落进下面三格；换十六进制的那一步：每段的十六进制从格子落到下面的牌上。 */
  const moves = (step: Step<State>): Move[] => {
    const a = step.state.address;
    if (!a) return [];
    const changed = (path: string) => step.changes.some((change) => change.at === path);
    if (changed('address.tagBits')) {
      return shown.map((id) => ({ value: (id === 'tag' ? a.tagBits : id === 'idx' ? a.indexBits : a.wordBits) || '0 位', from: 'addr', to: id, via: [`cut-${id}`], ink: 'addr' as const }));
    }
    if (changed('address.tagHex')) {
      return shown.map((id) => ({ value: id === 'tag' ? a.tagHex : id === 'idx' ? a.indexHex : a.wordHex, from: id, to: `${id}H`, arc: true, ink: 'addr' as const }));
    }
    return [];
  };

  const names = (path: string): string => {
    const labels: Record<string, string> = {
      w: '字地址位数 w',
      v: '每组行数 v',
      r: '行号位数 r',
      d: '组号位数 d',
      u: '组数 u',
      s: '块号位数 s',
      tag: '标记位数',
      length: '地址位数',
      format: '地址格式',
      'address.bits': '地址的二进制',
      'address.tagBits': '标记字段',
      'address.indexBits': `${iName}字段`,
      'address.wordBits': '字地址字段',
      'address.tagHex': '标记',
      'address.indexHex': iName,
      'address.wordHex': '字地址',
      'address.hex': '地址',
    };
    return labels[path] ?? path;
  };

  // 出题时看整条地址和三段（手机上只看一段会把旁边的格子切掉一半）。
  const askFrame = (ask: unknown): string[] => ((ask as { prompt?: string }).prompt === '标记几位' ? ['calc', 'addr', ...shown] : ['addr', ...shown, ...shown.map((id) => `${id}H`)]);
  /** 手机上地址条和三段要一起看见。 */
  const frame = (step: Step<State>): string[] | null => {
    if (!narrow) return null;
    if (step.state.address) return ['addr', ...shown, ...shown.map((id) => `${id}H`)];
    return ['calc', 'addr', ...shown];
  };
  return { scene: { parts, wires }, bind, moves, names, askFrame, frame };
}

/** 引擎标题里「标记7位|行号8位」这样挤在一起的格式，换成状态里排好的写法。 */
/** 十六进制按本站写法加 H：「(2D6B5)16」写成「2D6B5H」。 */
export const tidy = (text: string): string => text.replace(/\(([0-9A-F]+)\)16/g, '$1H');

export function polish(trace: Trace<Params, State>): Trace<Params, State> {
  const conditions = trace.conditions.map((c) => ({ ...c, value: tidy(c.value) }));
  const steps = trace.steps.map((raw) => {
    const step = { ...raw, title: tidy(raw.title), why: tidy(raw.why) };
    const out = /^按 \S+ 切开$/.test(step.title) ? { ...step, title: `按 ${step.state.format} 切开` } : step;
    return out;
  });
  return { ...trace, steps, conditions };
}

/** 答错时按学生的答案演后果。位数、位串都取自引擎。 */
export function addrWrong(trace: Trace<Params, State>) {
  const g = widths(trace.params);
  const iName = indexName(trace.params.mapping);
  return (ask: { prompt: string; answer: string }, value: string, _state: State, next: Step<State> | null): Breakage | null => {
    if (ask.prompt === '标记几位') {
      const v = Number(value);
      if (!Number.isFinite(v)) return null;
      const sum = v + g.index + g.w;
      return {
        label: '',
        patch: { tag: { name: `标记 ${v} 位` }, addr: { name: `主存地址 ${sum} 位` } },
        moves: [{ value: `${v} 位`, from: 'calc', to: 'tag', arc: true }],
        message: `标记 ${v} 位，${trace.params.mapping === '全相联' ? '' : `加上${iName} ${g.index} 位、`}字地址 ${g.w} 位，地址一共 ${sum} 位。可主存要 s + w = ${g.s} + ${g.w} = ${g.length} 位地址才能把每个单元都编上号，${sum > g.length ? '多出来的位没有对应的单元' : '少了的位让一部分单元没有地址'}。`,
      };
    }
    const a = next?.state.address;
    if (!a) return null;
    return {
      label: '',
      patch: { tagH: { text: value.trim().toUpperCase() || '?', hidden: false } },
      moves: [{ value: value.trim().toUpperCase() || '?', from: 'tag', to: 'tagH', arc: true }],
      message: `标记那一段是 ${group4(a.tagBits)}（${a.tagBits.length} 位），从右往左 4 位一组换成十六进制，最左一组不足 4 位时高位补 0。${value.trim().toUpperCase().replace(/H$/, '') === '' ? '' : `写成 ${value.trim().toUpperCase()}，对不上这串位。`}`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。错的位数由引擎换一种映射算出，不在页面里算。 */
export function addrMistakes(trace: Trace<Params, State>): Mistake<State>[] {
  const params = trace.params;
  const g = widths(params);
  const steps = trace.steps;
  const out: Mistake<State>[] = [];
  const stepOf = (path: string) => steps.findIndex((step) => step.changes.some((change) => change.at === path));

  if (params.mapping === '组相联' && !params.fields) {
    // 1. 组相联按行数求组号位数。
    const { rowsPerSet: _ways, ...rest } = params;
    const direct = run({ ...rest, mapping: '直接' });
    const r = Number(direct.result['行号位数']);
    const tagWrong = Number(direct.result['标记位数']);
    const at = stepOf('d');
    if (at >= 0) {
      out.push({
        text: '容易拿 cache 的行数去求组号位数，因为和直接映射的行号混了',
        at: at + 1,
        act: () => ({
          label: '',
          patch: { idx: { name: `组号 ${r} 位` }, tag: { name: `标记 ${tagWrong} 位` } },
          moves: [{ value: `${r} 位`, from: 'cache', to: 'idx', arc: true }],
          message: `cache 有 ${g.m} 行，按行数算是 ${r} 位，那是直接映射的行号。组相联先分组：u = ${g.m} ÷ ${g.v} = ${g.u} 组，组号只要 ${g.d} 位；少分出去的位留给标记，标记是 ${g.tag} 位，不是 ${tagWrong} 位。`,
        }),
      });
    }
  }
  if (params.mapping === '直接' && !params.fields) {
    // 1. 标记写成整个块号。
    const at = stepOf('tag');
    if (at >= 0) {
      out.push({
        text: '容易把标记算成整个块号 s 位，因为忘了减去行号',
        at: at + 1,
        act: () => ({
          label: '',
          patch: { tag: { name: `标记 ${g.s} 位` }, addr: { name: `主存地址 ${g.s + g.index + g.w} 位` } },
          moves: [{ value: `${g.s} 位`, from: 's', to: 'tag', arc: true }],
          message: `块号 s = ${g.s} 位里，低 ${g.index} 位已经当了行号，硬件按它直接找到那一行，不用再比。标记只存剩下的高位：${g.s} − ${g.index} = ${g.tag} 位。写成 ${g.s} 位，地址就成了 ${g.s + g.index + g.w} 位，比主存的 ${g.length} 位多。`,
        }),
      });
    }
  }
  if (params.mapping === '全相联') {
    const direct = params.fields || (params.cacheRows === undefined && params.cacheUnits === undefined) ? null : run({ ...params, mapping: '直接' });
    const at = stepOf('tag');
    if (direct && at >= 0) {
      const r = Number(direct.result['行号位数']);
      out.push({
        text: '容易给全相联也切出一段行号，因为套了直接映射的格式',
        at: at + 1,
        act: () => ({
          label: '',
          patch: { tag: { name: `标记 ${g.s - r} 位` } },
          moves: [{ value: `行号 ${r} 位？`, from: 'cache', to: 'tag', arc: true }],
          message: `全相联的块可以放进任意一行，地址里不需要指出哪一行；访问时拿整个块号和每一行的标记比。所以块号 ${g.s} 位全是标记，地址只有标记和字地址两段。`,
        }),
      });
    }
  }
  // 2. 按十六进制位切字段。
  const cut = stepOf('address.tagBits');
  const hexStep = steps[cut];
  if (cut >= 0 && hexStep?.state.address) {
    const a = hexStep.state.address;
    const digits = Math.ceil(a.tagBits.length / 4);
    const wrongHex = a.hex.slice(0, digits);
    if (a.tagBits.length % 4 !== 0 || a.bits.length % 4 !== 0) {
      out.push({
        text: '容易直接从十六进制地址里截几位当标记，因为没先写成二进制',
        at: cut + 1,
        act: () => ({
          label: '',
          patch: { tag: { value: `${wrongHex}H？` } },
          moves: [{ value: `${wrongHex}H`, from: 'addr', to: 'tag', via: ['cut-tag'], ink: 'addr' }],
          message: `地址 ${a.bits.length} 位，标记 ${a.tagBits.length} 位，字段边界不在 4 位的整数倍上，十六进制的一位会被切成两半。截出 ${wrongHex}H 当标记是错的；要先写成二进制 ${group4(a.bits)}，从高位数 ${a.tagBits.length} 位，得标记 ${trace.result['标记'] ?? ''}。`,
        }),
      });
    }
  }
  return out;
}

export function addrConvention(params: Params) {
  return (step: Step<State>): string | null =>
    params.unit === '字节' && step.changes.some((change) => change.at === 'w') ? '按字节编址时，最低一段指的是块内第几个字节，本站照教材仍叫它字地址。' : null;
}

export const ADDR_QUESTION = { text: '这个地址从高位到低位切成哪几段，各几位', at: ['addr', 'tag', 'idx', 'word'] };
export const ADDR_CONCLUSION =
  '三种映射的地址都是 s + w 位，最低 w 位都是字地址，差别只在块号 s 位怎么分：直接映射分出 r 位行号（m = 2^r），组相联分出 d 位组号（u = 2^d = m/v），全相联不分，整个块号都是标记。所以同一个地址，标记位数全相联最多，组相联其次，直接映射最少；切的时候先写成二进制，再从高位按位数数。';
export const ADDR_NEEDS = [{ href: '/3-expand', text: '容量和地址位数' }];

