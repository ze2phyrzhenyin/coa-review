/**
 * Trace：每个引擎的唯一输出。动画、解题表、预测题、答案都读它，不各算各的。
 * 规则见 docs/INTERACTION.md「三件事」和 specs/_engine-contract.md。
 *
 * 状态 S 必须是纯数据（对象、数组、字符串、数字、布尔、null），这样才能比较、回退、写进网址。
 */

/** 一步的粒度。单个 CPU 周期里为了讲清楚而拆开的小步用 explain，不许冒充多个时钟。 */
export type StepLevel = 'explain' | 'beat' | 'cycle' | 'instruction' | 'access';

/** 状态里某个位置的值变了。at 是状态的路径，例如 `reg.DR`、`rows.2.tag`。 */
export interface Change {
  at: string;
  from: string;
  to: string;
}

/** 推进这一步之前先让学生预测。答案由引擎给出，页面不自己算。 */
export interface Ask {
  prompt: string;
  kind: 'choice' | 'bits' | 'number' | 'text';
  options?: string[];
  answer: string;
  /** 答错时指出该看哪里，不重复答案。 */
  hint?: string;
}

export interface Step<S> {
  id: string;
  level: StepLevel;
  /** 做了什么。 */
  title: string;
  /** 为什么这一步能发生：触发条件或用到的规则。 */
  why: string;
  /** 教材出处，例如「教材 p37 式(2.20)」。 */
  ref?: string;
  /** 这一步之后的完整状态。 */
  state: S;
  /** 相对上一步的全部变化，由 TraceBuilder 自动算出。 */
  changes: Change[];
  /** 要高亮的位置（状态路径或部件 id）。 */
  focus: string[];
  ask?: Ask;
}

/** 题目的前提：位宽、编址单位、初始状态、约定。页面原样列出。 */
export interface Condition {
  label: string;
  value: string;
}

/** 纸面解题表。每行可指回一步，点行即跳到那一步。 */
export interface SolutionTable {
  columns: string[];
  rows: { cells: string[]; step?: string }[];
}

export interface Trace<P, S> {
  engine: string;
  params: P;
  conditions: Condition[];
  initial: S;
  steps: Step<S>[];
  /** 最终答案，键是题目要求的量。 */
  result: Record<string, string>;
  table: SolutionTable;
}

type Leaf = string | number | boolean | null;

/** 把状态摊平成「路径 → 字符串」。 */
export function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'undefined' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new Error(`状态里有不能序列化的值：${prefix || '(根)'}`);
    }
    out[prefix] = String(value as Leaf);
    return out;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  for (const [key, child] of entries) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

/** 两个状态之间的全部变化。新增或消失的位置用空串表示另一侧。 */
export function diffStates(before: unknown, after: unknown): Change[] {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const changes: Change[] = [];
  for (const at of keys) {
    const from = a[at] ?? '';
    const to = b[at] ?? '';
    if (from !== to) changes.push({ at, from, to });
  }
  return changes;
}

function freeze<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface StepInput<S> {
  level?: StepLevel;
  title: string;
  why: string;
  ref?: string;
  focus?: string[];
  ask?: Ask;
  /** 在上一步状态的副本上直接改。 */
  update: (draft: S) => void;
}

/** 引擎用它产生 Trace：只写「改了什么、为什么」，变化列表自动得出。 */
export class TraceBuilder<P, S> {
  private readonly steps: Step<S>[] = [];
  private current: S;
  private readonly initial: S;

  constructor(
    private readonly engine: string,
    private readonly params: P,
    initial: S,
    private readonly conditions: Condition[] = [],
  ) {
    this.initial = freeze(initial);
    this.current = freeze(initial);
  }

  get state(): S {
    return freeze(this.current);
  }

  step(input: StepInput<S>): this {
    const next = freeze(this.current);
    input.update(next);
    const changes = diffStates(this.current, next);
    const step: Step<S> = {
      id: `s${this.steps.length + 1}`,
      level: input.level ?? 'explain',
      title: input.title,
      why: input.why,
      state: freeze(next),
      changes,
      focus: input.focus ?? changes.map((c) => c.at),
    };
    if (input.ref) step.ref = input.ref;
    if (input.ask) step.ask = input.ask;
    this.steps.push(step);
    this.current = next;
    return this;
  }

  finish(result: Record<string, string>, table: SolutionTable): Trace<P, S> {
    return {
      engine: this.engine,
      params: freeze(this.params),
      conditions: this.conditions,
      initial: this.initial,
      steps: this.steps,
      result,
      table,
    };
  }
}

/** Trace 的通用不变量。每个引擎的测试都要对自己的输出跑一遍。返回问题列表，空表示合格。 */
export function validateTrace<P, S>(trace: Trace<P, S>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  if (!trace.engine) problems.push('缺 engine 名');
  if (trace.steps.length === 0) problems.push('没有任何一步');
  let previous: unknown = trace.initial;
  for (const step of trace.steps) {
    const where = `步 ${step.id}`;
    if (ids.has(step.id)) problems.push(`${where}：id 重复`);
    ids.add(step.id);
    if (!step.title.trim()) problems.push(`${where}：缺「做了什么」`);
    if (!step.why.trim()) problems.push(`${where}：缺「为什么」`);
    const expected = diffStates(previous, step.state);
    if (JSON.stringify(expected) !== JSON.stringify(step.changes)) {
      problems.push(`${where}：changes 与前后状态之差不一致`);
    }
    if (step.changes.length === 0 && step.level !== 'explain') {
      problems.push(`${where}：状态没变，却不是讲解步`);
    }
    if (step.ask) {
      if (!step.ask.prompt.trim() || !step.ask.answer.trim()) problems.push(`${where}：预测题缺题面或答案`);
      if (step.ask.kind === 'choice') {
        const options = step.ask.options ?? [];
        if (options.length < 2) problems.push(`${where}：选择题少于两个选项`);
        if (!options.includes(step.ask.answer)) problems.push(`${where}：答案不在选项里`);
        if (new Set(options).size !== options.length) problems.push(`${where}：选项重复`);
      }
    }
    previous = step.state;
  }
  for (const [index, row] of trace.table.rows.entries()) {
    if (row.cells.length !== trace.table.columns.length) problems.push(`解题表第 ${index + 1} 行列数不对`);
    if (row.step && !ids.has(row.step)) problems.push(`解题表第 ${index + 1} 行指向不存在的步 ${row.step}`);
  }
  if (Object.keys(trace.result).length === 0) problems.push('缺最终答案 result');
  return problems;
}
