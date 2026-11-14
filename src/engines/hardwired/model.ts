/**
 * 硬布线控制器：从模型机的指令周期流程（图 5.30，取自 `src/engines/cpu` 的 flow()）推出某个控制信号的逻辑表达式，
 * 写法同例 5.3（p179）：把发出这个信号的（节拍电位 M、节拍脉冲 T、指令）都找出来，同一个 M·T 的指令相或，各项再相或；
 * 电位信号只与节拍电位，脉冲信号再与节拍脉冲；所有指令都有的项不写指令。
 * 反过来，给一个表达式，列出它在哪些节拍有效，并和流程图对照。
 */
import { TraceBuilder, type Condition, type Trace } from '../trace';
import { flow, type Instruction, type Op, type SignalNames } from '../cpu/model';

export const ENGINE = 'hardwired';
export const REVERSE_ENGINE = 'hardwired-reverse';

/** 例 5.3、图 5.30 的五条指令（p178–179）。 */
export const BOOK_OPS: readonly Op[] = ['MOV', 'LAD', 'ADD', 'STO', 'JMP'];
export const ALL_OPS: readonly Op[] = ['MOV', 'NOT', 'LAD', 'ADD', 'AND', 'STO', 'JMP'];
export const BEATS = [1, 2, 3, 4] as const;

/** 推导用的代表指令：Rx 是第一个寄存器，Ry 是第二个（图 5.30 的记法）。 */
export function canonical(op: Op): Instruction {
  switch (op) {
    case 'LAD':
      return { op, rx: 'R0', addr: 9 };
    case 'JMP':
      return { op, addr: 9 };
    default:
      return { op, rx: 'R0', ry: 'R1' } as Instruction;
  }
}

/** 把具体寄存器的信号名换成 Rx、Ry：LDR0→LDRx，SR1→SRy，LR0→LRx。 */
function generic(name: string): string {
  const m = /^(LD|S|L)R([0-3])$/.exec(name);
  if (!m) return name;
  return `${m[1]!}R${m[2] === '0' ? 'x' : 'y'}`;
}

/** 一个信号在某条指令的某个节拍有效。t 为 null 表示电位信号，整个 CPU 周期有效。 */
export interface Occurrence {
  op: Op;
  m: number;
  t: number | null;
  /** 那一拍做的事，「源→目的」写法。 */
  what: string;
}

export interface SignalInfo {
  name: string;
  kind: '电位' | '脉冲';
}

/** 指令集里每条指令的流程：M 号 → 各微操作。 */
function flows(ops: readonly Op[], names: SignalNames) {
  return ops.map((op) => ({ op, cycles: flow(canonical(op), names) }));
}

/** 指令集里出现的全部控制信号，按第一次出现的先后。 */
export function signals(ops: readonly Op[] = BOOK_OPS, names: SignalNames = 'book'): SignalInfo[] {
  const seen = new Map<string, SignalInfo['kind']>();
  for (const f of flows(ops, names)) {
    for (const c of f.cycles) {
      for (const micro of c.micros) {
        for (const s of micro.hold) if (!seen.has(generic(s))) seen.set(generic(s), '电位');
        for (const s of micro.pulse) if (!seen.has(generic(s))) seen.set(generic(s), '脉冲');
      }
    }
  }
  return [...seen].map(([name, kind]) => ({ name, kind }));
}

/** 某个信号在流程图上出现的全部位置，按指令、M、T 的先后。 */
export function occurrences(signal: string, ops: readonly Op[] = BOOK_OPS, names: SignalNames = 'book'): Occurrence[] {
  const out: Occurrence[] = [];
  for (const f of flows(ops, names)) {
    f.cycles.forEach((c, k) => {
      for (const micro of c.micros) {
        const beat = Number(micro.beat.slice(1));
        if (micro.hold.some((s) => generic(s) === signal)) {
          if (!out.some((o) => o.op === f.op && o.m === k + 1 && o.t === null)) out.push({ op: f.op, m: k + 1, t: null, what: micro.op });
        }
        if (micro.pulse.some((s) => generic(s) === signal)) out.push({ op: f.op, m: k + 1, t: beat, what: micro.op });
      }
    });
  }
  return out;
}

export interface Term {
  m: number;
  t: number | null;
  /** 空表示所有指令都有，不写指令。 */
  ops: Op[];
  text: string;
}

function termText(m: number, t: number | null, ops: Op[]): string {
  const parts = [`M${m}`];
  if (t !== null) parts.push(`T${t}`);
  if (ops.length === 1) parts.push(ops[0]!);
  else if (ops.length > 1) parts.push(`(${ops.join('+')})`);
  return parts.join('·');
}

/** 合并成例 5.3 的写法。 */
export function expression(signal: string, ops: readonly Op[] = BOOK_OPS, names: SignalNames = 'book'): { terms: Term[]; text: string; kind: SignalInfo['kind'] } {
  const info = signals(ops, names).find((s) => s.name === signal);
  if (!info) throw new Error(`指令 ${ops.join('、')} 的流程里没有信号 ${signal}`);
  const occ = occurrences(signal, ops, names);
  const keys: { m: number; t: number | null }[] = [];
  for (const o of occ) if (!keys.some((k) => k.m === o.m && k.t === o.t)) keys.push({ m: o.m, t: o.t });
  keys.sort((a, b) => a.m - b.m || (a.t ?? 0) - (b.t ?? 0));
  const terms = keys.map(({ m, t }) => {
    const who = ops.filter((op) => occ.some((o) => o.op === op && o.m === m && o.t === t));
    const all = who.length === ops.length;
    const list = all ? [] : who;
    return { m, t, ops: list, text: termText(m, t, list) };
  });
  return { terms, text: terms.map((t) => t.text).join('+'), kind: info.kind };
}

// ---------- 表达式求值 ----------

type Node = { kind: 'or' | 'and'; items: Node[] } | { kind: 'lit'; name: string };

const OP_NAMES = new Set<string>(ALL_OPS);

/** 解析「M2·T4·(LAD+STO)+M1·T4」这类表达式：· * × 是与，+ 是或，可加括号。 */
export function parseExpression(text: string): Node {
  const tokens = text.replace(/\s+/g, '').match(/M\d|T\d|[A-Z]{2,4}|[+·*×().]|./g) ?? [];
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const fail = (why: string): never => {
    throw new Error(`表达式「${text}」：${why}`);
  };
  const atom = (): Node => {
    const tok = peek();
    if (tok === undefined) return fail('写到一半就结束了');
    if (tok === '(') {
      i += 1;
      const inner = sum();
      if (peek() !== ')') fail('括号没有配对');
      i += 1;
      return inner;
    }
    if (/^M[1-3]$/.test(tok) || /^T[1-4]$/.test(tok) || OP_NAMES.has(tok)) {
      i += 1;
      return { kind: 'lit', name: tok };
    }
    return fail(`不认识「${tok}」；只能用 M1–M3、T1–T4 和指令名 ${ALL_OPS.join(' ')}`);
  };
  const product = (): Node => {
    const items = [atom()];
    while (peek() === '·' || peek() === '*' || peek() === '×' || peek() === '.') {
      i += 1;
      items.push(atom());
    }
    return items.length === 1 ? items[0]! : { kind: 'and', items };
  };
  const sum = (): Node => {
    const items = [product()];
    while (peek() === '+') {
      i += 1;
      items.push(product());
    }
    return items.length === 1 ? items[0]! : { kind: 'or', items };
  };
  if (tokens.length === 0) fail('是空的');
  const tree = sum();
  if (i !== tokens.length) fail(`多出了「${tokens.slice(i).join('')}」`);
  return tree;
}

function evaluate(node: Node, op: Op, m: number, t: number): boolean {
  if (node.kind === 'lit') {
    if (node.name.startsWith('M') && node.name.length === 2) return Number(node.name[1]) === m;
    if (node.name.startsWith('T') && node.name.length === 2) return Number(node.name[1]) === t;
    return node.name === op;
  }
  return node.kind === 'and' ? node.items.every((x) => evaluate(x, op, m, t)) : node.items.some((x) => evaluate(x, op, m, t));
}

/** 指令有几个 CPU 周期（M 的个数）。 */
function cyclesOf(op: Op): number {
  return flow(canonical(op), 'book').length;
}

/** 一个信号（或一个表达式）有效的全部（指令, M, T）。电位信号四拍都算。 */
export function pointsOfSignal(signal: string, ops: readonly Op[], names: SignalNames): string[] {
  const out: string[] = [];
  for (const o of occurrences(signal, ops, names)) {
    for (const t of o.t === null ? BEATS : [o.t]) out.push(`${o.op}·M${o.m}·T${t}`);
  }
  return [...new Set(out)].sort();
}

/** 同步控制下每条指令都走 M1–M3 三个节拍电位，两周期指令的 M3 空过（p179）。 */
export const POTENTIALS = 3;

export function pointsOfExpression(text: string, ops: readonly Op[]): string[] {
  const tree = parseExpression(text);
  const out: string[] = [];
  for (const op of ops) for (let m = 1; m <= POTENTIALS; m += 1) for (const t of BEATS) if (evaluate(tree, op, m, t)) out.push(`${op}·M${m}·T${t}`);
  return out.sort();
}

/** 两个写法在这组指令上是否等价（逐个节拍比较）。页面判分用。 */
export function equivalent(a: string, b: string, ops: readonly Op[] = BOOK_OPS): boolean {
  return JSON.stringify(pointsOfExpression(a, ops)) === JSON.stringify(pointsOfExpression(b, ops));
}

// ---------- 推导 ----------

export interface DeriveParams {
  signal: string;
  /** 指令集，缺省例 5.3 的五条。 */
  instructions?: Op[];
  names?: SignalNames;
}

export interface DeriveState {
  signal: string;
  kind: SignalInfo['kind'] | null;
  /** 已经找到的位置。 */
  marks: { op: Op; m: number; t: number | null; what: string }[];
  /** 当前扫到哪条指令。 */
  scanning: Op | null;
  terms: Term[];
  expression: string | null;
}

function checkOps(ops: Op[]): void {
  if (ops.length === 0) throw new Error('指令集不能为空');
  if (new Set(ops).size !== ops.length) throw new Error('指令集里有重复的指令');
  for (const op of ops) if (!ALL_OPS.includes(op)) throw new Error(`模型机没有指令 ${String(op)}`);
}

const where = (o: { m: number; t: number | null }): string => (o.t === null ? `M${o.m}` : `M${o.m}·T${o.t}`);

/** 推出一个控制信号的逻辑表达式。参数不合法时抛出错误。 */
export function run(params: DeriveParams): Trace<DeriveParams, DeriveState> {
  const ops = params.instructions ?? [...BOOK_OPS];
  checkOps(ops);
  const names = params.names ?? 'book';
  const ex = expression(params.signal, ops, names);
  const occ = occurrences(params.signal, ops, names);
  const conditions: Condition[] = [
    { label: '指令', value: ops.join('、') },
    { label: '时序', value: '每个 CPU 周期一个节拍电位 M1、M2、M3，每个节拍电位里 T1–T4 四个节拍脉冲（图 5.30）' },
    { label: '信号名', value: names === 'book' ? '教材（例 5.3）' : '解析书' },
    { label: '记法', value: 'Rx、Ry 是指令里第一个、第二个寄存器' },
  ];
  const initial: DeriveState = { signal: params.signal, kind: null, marks: [], scanning: null, terms: [], expression: null };
  const builder = new TraceBuilder<DeriveParams, DeriveState>(ENGINE, params, initial, conditions);
  let count = 0;
  const step = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };
  step({
    level: 'explain',
    title: `${params.signal} 是${ex.kind}信号`,
    why:
      ex.kind === '电位'
        ? '它在整个 CPU 周期里保持有效，把通路接好或让存储器一直读着，所以只与节拍电位 M，不与 T（p179）。'
        : '它是打入或写入的时刻，只能在某一拍发出，所以除了节拍电位 M，还要与那一拍的节拍脉冲 T（p179）。',
    ref: '教材 p178–179，例 5.3',
    update: (d) => {
      d.kind = ex.kind;
    },
  });
  const firstStep = new Map<string, string>();
  for (const op of ops) {
    const mine = occ.filter((o) => o.op === op);
    const id = step({
      level: 'explain',
      title: mine.length ? `${op}：${mine.map((o) => `${where(o)}（${o.what}）`).join('，')}` : `${op}：不发 ${params.signal}`,
      why: mine.length
        ? `在 ${op} 的流程里找到 ${params.signal}：${mine.map((o) => `第 ${o.m} 个 CPU 周期${o.t === null ? '整个周期有效，这时' : `的 T${o.t} `}做 ${o.what}`).join('；')}。`
        : `${op} 的 ${cyclesOf(op)} 个 CPU 周期里都没有用到 ${params.signal}。`,
      ref: '教材 p178 图 5.30',
      focus: [`marks`],
      update: (d) => {
        d.scanning = op;
        d.marks.push(...mine.map((o) => ({ op: o.op, m: o.m, t: o.t, what: o.what })));
      },
    });
    for (const o of mine) {
      const key = `${o.m}|${o.t}`;
      if (!firstStep.has(key)) firstStep.set(key, id);
    }
  }
  step({
    level: 'explain',
    title: `合并：${ex.terms.map((t) => t.text).join('，')}`,
    why: `同一个 ${ex.kind === '电位' ? 'M' : 'M·T'} 上的几条指令相或，写进一个括号；${ex.terms.some((t) => t.ops.length === 0) ? '取指周期所有指令都一样，这一项不写指令；' : ''}各项按节拍的先后排。`,
    ref: '教材 p179',
    update: (d) => {
      d.scanning = null;
      d.terms = ex.terms;
    },
  });
  step({
    level: 'explain',
    title: `${params.signal} = ${ex.text}`,
    why: '各项相或，就是这个信号的逻辑表达式。式子里每一项对应流程图上的一个位置，漏一项那一拍就不发，多一项就会在不该发的时候发。',
    ref: '教材 p179，式(5.1)',
    ask: { prompt: `写出 ${params.signal} 的逻辑表达式`, kind: 'text', answer: ex.text, hint: '电位信号只与 M，脉冲信号再与 T；同一拍的指令放进一个括号相或。' },
    update: (d) => {
      d.expression = ex.text;
    },
  });
  return builder.finish(
    { 信号: params.signal, 类型: `${ex.kind}信号`, 表达式: `${params.signal}=${ex.text}` },
    {
      columns: ['节拍电位', '节拍脉冲', '指令', '项'],
      rows: ex.terms.map((t) => ({
        cells: [`M${t.m}`, t.t === null ? '—' : `T${t.t}`, t.ops.length ? t.ops.join('、') : '全部', t.text],
        step: firstStep.get(`${t.m}|${t.t}`)!,
      })),
    },
  );
}

// ---------- 反过来：表达式 → 哪些节拍 ----------

export interface ReverseParams {
  expression: string;
  /** 给了就和流程图对照。 */
  signal?: string;
  instructions?: Op[];
  names?: SignalNames;
}

export interface ReverseState {
  /** 顶层各项。 */
  terms: string[];
  /** 每一项对应的位置：「LAD·M2·T4」。 */
  matches: string[][];
  missing: string[] | null;
  extra: string[] | null;
}

function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text.replace(/\s+/g, '')) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === '+' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 列出表达式在哪些节拍有效；给了信号名就指出漏掉和多出的节拍。参数不合法时抛出错误。 */
export function runReverse(params: ReverseParams): Trace<ReverseParams, ReverseState> {
  const ops = params.instructions ?? [...BOOK_OPS];
  checkOps(ops);
  const names = params.names ?? 'book';
  parseExpression(params.expression);
  const terms = splitTop(params.expression);
  const conditions: Condition[] = [
    { label: '表达式', value: params.expression },
    { label: '指令', value: ops.join('、') },
  ];
  if (params.signal) conditions.push({ label: '对照的信号', value: params.signal });
  const initial: ReverseState = { terms, matches: terms.map(() => []), missing: null, extra: null };
  const builder = new TraceBuilder<ReverseParams, ReverseState>(REVERSE_ENGINE, params, initial, conditions);
  let count = 0;
  const step = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };
  const rows: { cells: string[]; step: string }[] = [];
  const doing = new Map<string, string>();
  for (const op of ops) {
    flow(canonical(op), names).forEach((c, k) => {
      for (const micro of c.micros) {
        if (micro.op === '译码') continue;
        const key = `${op}·M${k + 1}·${micro.beat}`;
        doing.set(key, doing.has(key) ? `${doing.get(key)!}；${micro.op}` : micro.op);
      }
    });
  }
  terms.forEach((term, i) => {
    const pts = pointsOfExpression(term, ops);
    const id = step({
      level: 'explain',
      title: pts.length ? `${term}：${pts.length} 个节拍有效` : `${term}：没有一个节拍有效`,
      why: pts.length
        ? `${pts.map((p) => `${p}（${doing.get(p) ?? (Number(p.split('·')[1]!.slice(1)) > cyclesOf(p.split('·')[0] as Op) ? 'M3 空过' : '这一拍没有操作')}）`).join('，')}。同步控制下每条指令都走 M1–M3，两个 CPU 周期的指令在 M3 空过，式子在那里为 1 也会发出信号（p179）。`
        : '这一项的几个条件互相矛盾，永远为 0。',
      ref: '教材 p178–179',
      update: (d) => {
        d.matches[i] = pts;
      },
    });
    rows.push({ cells: [term, pts.map((p) => p.split('·')[0]!).filter((x, j, a) => a.indexOf(x) === j).join('、') || '—', pts.map((p) => p.split('·').slice(1).join('·')).filter((x, j, a) => a.indexOf(x) === j).join('、') || '—', pts.map((p) => doing.get(p) ?? '').filter((x, j, a) => x && a.indexOf(x) === j).join('；') || '—'], step: id });
  });
  const result: Record<string, string> = { 有效节拍数: String(pointsOfExpression(params.expression, ops).length) };
  if (params.signal) {
    const want = pointsOfSignal(params.signal, ops, names);
    const got = pointsOfExpression(params.expression, ops);
    const missing = want.filter((p) => !got.includes(p));
    const extra = got.filter((p) => !want.includes(p));
    const right = expression(params.signal, ops, names).text;
    step({
      level: 'explain',
      title: missing.length || extra.length ? `与流程图不一致：漏 ${missing.length} 拍，多 ${extra.length} 拍` : `与流程图一致`,
      why:
        missing.length || extra.length
          ? `${missing.length ? `流程图上 ${params.signal} 在 ${missing.join('、')} 有效，式子里没有。` : ''}${extra.length ? `式子在 ${extra.join('、')} 也为 1，可流程图上这几拍不发 ${params.signal}。` : ''}对照：${params.signal}=${right}。`
          : `逐拍比较，式子为 1 的节拍正好是流程图上发 ${params.signal} 的节拍。`,
      ref: '教材 p179，例 5.3',
      update: (d) => {
        d.missing = missing;
        d.extra = extra;
      },
    });
    result['一致'] = missing.length || extra.length ? '否' : '是';
    result['漏掉'] = missing.join('、') || '无';
    result['多出'] = extra.join('、') || '无';
  }
  return builder.finish(result, { columns: ['项', '指令', '节拍', '这一拍的操作'], rows });
}

// ---------- 出题 ----------

function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机出一道题：从例 5.3 的五条里留三到五条，挑一个出现过的信号。 */
export function generate(seed: number): DeriveParams {
  const r = generator(seed);
  const ops = BOOK_OPS.filter(() => r() < 0.8);
  const chosen = ops.length >= 3 ? ops : [...BOOK_OPS];
  const list = signals(chosen, 'book');
  return { signal: list[Math.floor(r() * list.length)]!.name, instructions: chosen };
}
