/**
 * cache 命中率、平均访问时间、访问效率引擎（教材 3.6.1 式(3.4)–(3.6)，例 3.4；3.6.5 例 3.8）。
 * 规格见 specs/3-cache-perf.md。
 *
 * 四种问法：正向求 h、r、e、t_a；由 t_a 反求 h；由 e 反求 h；二级 cache 的总 CPI。
 * 状态是各量的数值，求出之前为 null。键名与 result 相同（h、r、e、t_a、一级CPI …），是页面引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'cacheperf';

export type Params =
  | { kind: '正向'; nc?: number; nm?: number; h?: number; tc: number; tm: number; order?: '例3.4' | '先求ta' }
  | { kind: '由ta求h'; tc: number; tm: number; ta: number }
  | { kind: '由e求h'; e: number; r?: number; tc?: number; tm?: number }
  | { kind: '二级cache'; clockGHz: number; baseCpi: number; memoryNs: number; l1Miss: number; l2Ns: number; l2Miss: number };

/** 状态：各量的数值，没求出时为 null。 */
export type State = Record<string, number | null>;

const EPS = 1e-9;
const isPos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isRate = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;

/** 参数有什么问题。空表示可以运行。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const p = params as Partial<Record<string, unknown>>;
  const times = (): void => {
    if (!isPos(p['tc']) || !isPos(p['tm'])) problems.push('t_c 和 t_m 必须是正数');
    else if (p['tc'] >= p['tm']) problems.push('t_c 必须小于 t_m：cache 比主存快');
  };
  switch (p['kind']) {
    case '正向': {
      const counts = p['nc'] !== undefined || p['nm'] !== undefined;
      if (counts === (p['h'] !== undefined)) problems.push('Nc、Nm 和 h 只能给一种');
      if (counts) {
        if (!isNat(p['nc']) || !isNat(p['nm'])) problems.push('Nc 和 Nm 必须是非负整数');
        else if (p['nc'] + p['nm'] === 0) problems.push('Nc + Nm 不能为 0');
      } else if (p['h'] !== undefined && !isRate(p['h'])) problems.push('h 必须在 0 到 1 之间');
      if (p['order'] !== undefined && p['order'] !== '例3.4' && p['order'] !== '先求ta') problems.push('顺序只能是 例3.4 或 先求ta');
      times();
      break;
    }
    case '由ta求h':
      times();
      if (!isPos(p['ta'])) problems.push('t_a 必须是正数');
      else if (problems.length === 0 && (p['ta'] < (p['tc'] as number) - EPS || p['ta'] > (p['tm'] as number) + EPS)) {
        problems.push('t_a 必须在 t_c 和 t_m 之间');
      }
      break;
    case '由e求h': {
      const hasR = p['r'] !== undefined;
      const hasT = p['tc'] !== undefined || p['tm'] !== undefined;
      if (hasR === hasT) problems.push('r 和 t_c、t_m 只能给一种');
      if (hasT) times();
      if (hasR && (!isPos(p['r']) || p['r'] <= 1)) problems.push('r 必须大于 1');
      if (!isPos(p['e']) || p['e'] > 1) problems.push('e 必须在 0 到 1 之间');
      if (problems.length === 0) {
        const r = hasR ? (p['r'] as number) : (p['tm'] as number) / (p['tc'] as number);
        if ((p['e'] as number) < 1 / r - EPS) problems.push(`e 不能小于 1/r = ${fmt(1 / r)}：h 为 0 时 e 最小`);
      }
      break;
    }
    case '二级cache':
      for (const key of ['clockGHz', 'memoryNs', 'l2Ns'] as const) if (!isPos(p[key])) problems.push(`${key} 必须是正数`);
      if (!isPos(p['baseCpi'])) problems.push('基本 CPI 必须是正数');
      if (!isRate(p['l1Miss']) || !isRate(p['l2Miss'])) problems.push('缺失率必须在 0 到 1 之间');
      else if ((p['l2Miss'] as number) > (p['l1Miss'] as number)) problems.push('必须访问主存的缺失率不能大于一级 cache 的缺失率');
      break;
    default:
      problems.push('题型只能是 正向、由ta求h、由e求h、二级cache');
  }
  return problems;
}

// ---------- 数值 ----------

/** 各量的数值，键与 result 相同。参数要先通过 validateParams。 */
export function compute(params: Params): Record<string, number> {
  switch (params.kind) {
    case '正向': {
      const h = params.h ?? (params.nc ?? 0) / ((params.nc ?? 0) + (params.nm ?? 0));
      const r = params.tm / params.tc;
      const e = 1 / (r + (1 - r) * h);
      return { h, r, e, t_a: params.tc / e };
    }
    case '由ta求h': {
      const h = (params.tm - params.ta) / (params.tm - params.tc);
      return { h, r: params.tm / params.tc, e: params.tc / params.ta };
    }
    case '由e求h': {
      const r = params.r ?? (params.tm ?? 1) / (params.tc ?? 1);
      const h = (r - 1 / params.e) / (r - 1);
      const out: Record<string, number> = params.r === undefined ? { r, h } : { h };
      if (params.tc !== undefined) out['t_a'] = params.tc / params.e;
      return out;
    }
    case '二级cache': {
      const memoryPenalty = params.memoryNs * params.clockGHz;
      const l2Penalty = params.l2Ns * params.clockGHz;
      const cpi1 = params.baseCpi + params.l1Miss * memoryPenalty;
      const cpi2 = params.baseCpi + params.l1Miss * l2Penalty + params.l2Miss * memoryPenalty;
      return {
        时钟周期: 1 / params.clockGHz,
        主存缺失损失: memoryPenalty,
        一级CPI: cpi1,
        二级缺失损失: l2Penalty,
        两级CPI: cpi2,
        性能比: cpi1 / cpi2,
      };
    }
  }
}

// ---------- 写法 ----------

/** 去掉浮点尾差后，最多 digits 位小数，去掉末尾 0。 */
export function fmt(x: number, digits = 4): string {
  const clean = Number(x.toPrecision(12));
  const text = clean.toFixed(digits);
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
}

/** 写到 digits 位小数时是否不丢数。 */
function exact(x: number, digits: number): boolean {
  return Math.abs(Number(fmt(x, digits)) - x) < 1e-9 * Math.max(1, Math.abs(x));
}

/** 「= 0.95」或「≈ 0.9677」。 */
function eq(x: number, digits = 4): string {
  return `${exact(x, digits) ? '=' : '≈'} ${fmt(x, digits)}`;
}

/** 百分数，1 位小数。 */
export function pct(x: number): string {
  return `${fmt(x * 100, 1)}%`;
}

function eqPct(x: number): string {
  return `${exact(x * 100, 1) ? '=' : '≈'} ${pct(x)}`;
}

const ns = (x: number): string => `${fmt(x)} ns`;

interface Row {
  key: string;
  name: string;
  formula: string;
  plug: string;
  value: string;
  ref: string;
  why: string;
  title?: string;
  ask?: Ask;
}

const REF = {
  h: '教材 p101 式(3.4)',
  ta: '教材 p101 式(3.5)',
  re: '教材 p101 式(3.6)',
  ex: '教材 p101–102 例 3.4',
  cpi: '教材 p110 例 3.8',
};

function rowsOf(params: Params, v: Record<string, number>): { rows: Row[]; conditions: Condition[] } {
  const val = (key: string): number => v[key] ?? 0;
  const rows: Row[] = [];
  const conditions: Condition[] = [];
  const add = (row: Row): void => {
    rows.push(row);
  };
  const h = val('h');
  const r = val('r');
  const e = val('e');

  if (params.kind === '二级cache') {
    const g = params.clockGHz;
    conditions.push(
      { label: '时钟频率', value: `${fmt(g)} GHz` },
      { label: '基本 CPI', value: fmt(params.baseCpi) },
      { label: '访问主存', value: ns(params.memoryNs) },
      { label: '一级 cache 缺失率', value: pct(params.l1Miss) },
      { label: '二级 cache 访问', value: `${ns(params.l2Ns)}（命中、缺失相同）` },
      { label: '必须访问主存的缺失率', value: pct(params.l2Miss) },
    );
    const cycle = val('时钟周期');
    const mp = val('主存缺失损失');
    const lp = val('二级缺失损失');
    const c1 = val('一级CPI');
    const c2 = val('两级CPI');
    add({
      key: '时钟周期', name: '时钟周期', formula: '1 / 时钟频率', plug: `1 / ${fmt(g)} GHz`, value: ns(cycle), ref: REF.cpi,
      why: `频率 ${fmt(g)} GHz，每个时钟周期 1 ÷ ${fmt(g)} ${eq(cycle)} ns。损失要折成时钟周期数才能和 CPI 相加。`,
    });
    add({
      key: '主存缺失损失', name: '主存缺失损失', formula: '访问主存时间 / 时钟周期', plug: `${ns(params.memoryNs)} / ${ns(cycle)}`, value: `${fmt(mp)} 个周期`, ref: REF.cpi,
      why: `访问一次主存 ${ns(params.memoryNs)}，折成 ${fmt(mp)} 个时钟周期，处理器要停这么久。`,
    });
    add({
      key: '一级CPI', name: '只有一级时的 CPI', formula: '基本 CPI + 缺失率 × 主存缺失损失', plug: `${fmt(params.baseCpi)} + ${pct(params.l1Miss)} × ${fmt(mp)}`, value: fmt(c1), ref: REF.cpi,
      why: `总的 CPI 是基本 CPI 加上每条指令平均的存储器停顿周期。每条指令有 ${pct(params.l1Miss)} 的机会缺失，每次停 ${fmt(mp)} 个周期。`,
    });
    add({
      key: '二级缺失损失', name: '二级 cache 缺失损失', formula: '二级 cache 访问时间 / 时钟周期', plug: `${ns(params.l2Ns)} / ${ns(cycle)}`, value: `${fmt(lp)} 个周期`, ref: REF.cpi,
      why: `一级缺失后先找二级 cache，访问 ${ns(params.l2Ns)}，折成 ${fmt(lp)} 个周期。`,
    });
    add({
      key: '两级CPI', name: '有两级时的 CPI', formula: '基本 CPI + 一级缺失率 × 二级损失 + 访问主存的缺失率 × 主存损失', plug: `${fmt(params.baseCpi)} + ${pct(params.l1Miss)} × ${fmt(lp)} + ${pct(params.l2Miss)} × ${fmt(mp)}`, value: fmt(c2), ref: REF.cpi,
      why: `一级缺失的访问都要先花二级 cache 的 ${fmt(lp)} 个周期；其中二级也没有的那 ${pct(params.l2Miss)} 还要再加上访问主存的 ${fmt(mp)} 个周期。`,
    });
    add({
      key: '性能比', name: '性能比', formula: '一级 CPI / 两级 CPI', plug: `${fmt(c1)} / ${fmt(c2)}`, value: fmt(val('性能比')), ref: REF.cpi,
      why: `指令数和时钟相同，CPI 之比就是速度之比：${fmt(c1)} ÷ ${fmt(c2)} ${eq(val('性能比'))}。`,
    });
    return { rows, conditions };
  }

  const tc = params.kind === '由e求h' ? params.tc : params.tc;
  const tm = params.kind === '由e求h' ? params.tm : params.tm;
  if (tc !== undefined && tm !== undefined) conditions.push({ label: '访问时间', value: `t_c = ${ns(tc)}，t_m = ${ns(tm)}` });

  const hRow = (): Row => {
    if (params.kind === '正向' && params.h === undefined) {
      const nc = params.nc ?? 0;
      const nm = params.nm ?? 0;
      return {
        key: 'h', name: '命中率 h', formula: 'Nc / (Nc + Nm)', plug: `${nc} / (${nc} + ${nm})`, value: fmt(h), ref: REF.h,
        why: `cache 完成 ${nc} 次，主存完成 ${nm} 次，共 ${nc + nm} 次访问。h = ${nc}/${nc + nm} ${eq(h)}。`,
      };
    }
    return { key: 'h', name: '命中率 h', formula: '已知', plug: '', value: fmt(h), ref: REF.h, why: `题目给出 h = ${fmt(h)}。` };
  };
  const rRow = (): Row => {
    if (params.kind === '由e求h' && params.r !== undefined) {
      return { key: 'r', name: 'r', formula: '已知', plug: '', value: fmt(r), ref: REF.re, why: `题目给出主存与 cache 的访问时间之比 r = ${fmt(r)}。` };
    }
    return {
      key: 'r', name: 'r', formula: 't_m / t_c', plug: `${ns(tm ?? 0)} / ${ns(tc ?? 0)}`, value: fmt(r), ref: REF.re,
      why: `r 是主存比 cache 慢几倍：${fmt(tm ?? 0)} ÷ ${fmt(tc ?? 0)} ${eq(r)}。`,
    };
  };
  const eAsk: Ask = { prompt: 'e 是多少', kind: 'number', answer: fmt(e * 100, 1), hint: '把 h 和 r 代进 e = 1/[r + (1−r)h]，写成百分数。' };

  if (params.kind === '正向') {
    conditions.unshift(
      params.h === undefined
        ? { label: '访问次数', value: `cache 完成 Nc = ${params.nc ?? 0} 次，主存完成 Nm = ${params.nm ?? 0} 次` }
        : { label: '命中率', value: `h = ${fmt(params.h)}` },
    );
    const ta = val('t_a');
    add(hRow());
    if ((params.order ?? '例3.4') === '例3.4') {
      conditions.push({ label: '顺序', value: '按例 3.4 的次序：h、r、e、t_a' });
      add(rRow());
      add({
        key: 'e', name: '访问效率 e', formula: '1 / [r + (1 − r)h]', plug: `1 / [${fmt(r)} + (1 − ${fmt(r)}) × ${fmt(h)}]`, value: pct(e), ref: REF.re,
        why: `把 r 和 h 代进去：分母 ${fmt(r)} + (1 − ${fmt(r)}) × ${fmt(h)} = ${fmt(r + (1 - r) * h)}，e ${eqPct(e)}。`, ask: eAsk,
      });
      add({
        key: 't_a', name: '平均访问时间 t_a', formula: 't_c / e', plug: `${ns(params.tc)} / ${fmt(e)}`, value: ns(ta), ref: REF.ex,
        why: `由 e = t_c/t_a 倒过来，t_a = ${fmt(params.tc)} ÷ ${fmt(e)} ${eq(ta)} ns。用式(3.5) 验算：${fmt(h)} × ${fmt(params.tc)} + ${fmt(1 - h)} × ${fmt(params.tm)} 也是 ${fmt(ta)} ns。`,
      });
    } else {
      conditions.push({ label: '顺序', value: '先用式(3.5) 求 t_a，再求 e 和 r' });
      add({
        key: 't_a', name: '平均访问时间 t_a', formula: 'h·t_c + (1 − h)·t_m', plug: `${fmt(h)} × ${ns(params.tc)} + ${fmt(1 - h)} × ${ns(params.tm)}`, value: ns(ta), ref: REF.ta,
        why: `命中的 ${fmt(h)} 只花 t_c，没命中的 ${fmt(1 - h)} 花 t_m，按比例加权：t_a ${eq(ta)} ns。`,
      });
      add({
        key: 'e', name: '访问效率 e', formula: 't_c / t_a', plug: `${ns(params.tc)} / ${ns(ta)}`, value: pct(e), ref: REF.re,
        why: `e 是 cache 的访问时间占平均访问时间的比例：${fmt(params.tc)} ÷ ${fmt(ta)}，e ${eqPct(e)}。`, ask: eAsk,
      });
      add(rRow());
    }
    return { rows, conditions };
  }

  if (params.kind === '由ta求h') {
    conditions.unshift({ label: '平均访问时间', value: `t_a = ${ns(params.ta)}` });
    add({
      key: 'h', name: '命中率 h', formula: '(t_m − t_a) / (t_m − t_c)', plug: `(${fmt(params.tm)} − ${fmt(params.ta)}) / (${fmt(params.tm)} − ${fmt(params.tc)})`, value: fmt(h), ref: REF.ta,
      why: `式(3.5) t_a = h·t_c + (1 − h)·t_m 里只有 h 未知。移项得 h = (t_m − t_a)/(t_m − t_c) = ${fmt(params.tm - params.ta)} ÷ ${fmt(params.tm - params.tc)} ${eq(h)}。`,
    });
    add(rRow());
    add({
      key: 'e', name: '访问效率 e', formula: 't_c / t_a', plug: `${ns(params.tc)} / ${ns(params.ta)}`, value: pct(e), ref: REF.re,
      why: `t_a 已知，直接用 e = t_c/t_a：${fmt(params.tc)} ÷ ${fmt(params.ta)}，e ${eqPct(e)}。`,
    });
    return { rows, conditions };
  }

  // 由e求h
  conditions.unshift({ label: '访问效率', value: `e = ${pct(params.e)}` });
  if (params.r !== undefined) conditions.push({ label: 'r', value: `t_m/t_c = ${fmt(params.r)}` });
  else add(rRow());
  add({
    key: 'h', name: '命中率 h', formula: '(r − 1/e) / (r − 1)', plug: `(${fmt(r)} − 1/${fmt(params.e)}) / (${fmt(r)} − 1)`, value: fmt(h), ref: REF.re,
    why: `由 e = 1/[r + (1 − r)h] 得 r + (1 − r)h = 1/e ${eq(1 / params.e)}，所以 h = (r − 1/e)/(r − 1) ${eq(h)}。`,
  });
  if (params.tc !== undefined) {
    const ta = val('t_a');
    add({
      key: 't_a', name: '平均访问时间 t_a', formula: 't_c / e', plug: `${ns(params.tc)} / ${fmt(params.e)}`, value: ns(ta), ref: REF.ex,
      why: `由 e = t_c/t_a，t_a = ${fmt(params.tc)} ÷ ${fmt(params.e)} ${eq(ta)} ns。`,
    });
  }
  return { rows, conditions };
}

/** 按教材的顺序逐个求量。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`cache 性能参数不对：${problems.join('；')}`);
  const values = compute(params);
  const { rows, conditions } = rowsOf(params, values);
  const initial: State = {};
  for (const row of rows) initial[row.key] = null;
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditions);
  const table: SolutionTable = { columns: ['量', '公式', '代入', '结果'], rows: [] };
  const result: Record<string, string> = {};
  rows.forEach((row, i) => {
    const key = row.key;
    builder.step({
      title: row.title ?? `${row.name} = ${row.value}`,
      why: row.why,
      ref: row.ref,
      focus: [key],
      ...(row.ask ? { ask: row.ask } : {}),
      update: (s) => {
        s[key] = values[row.key] ?? null;
      },
    });
    table.rows.push({ cells: [row.name, row.formula, row.plug, row.value], step: `s${i + 1}` });
    result[row.key] = row.value;
  });
  return builder.finish(result, table);
}

/** 种子 → 32 位无符号数序列（mulberry32）。 */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** 随机出一道题：四种问法轮着出，数取整十，命中率 0.80–0.99。 */
export function generate(seed: number): Params {
  const next = generator(seed);
  const pick = (n: number): number => next() % n;
  const tc = 10 * (1 + pick(5));
  const r = 4 + pick(7);
  const tm = tc * r;
  const total = 100 * (10 + pick(41));
  const nm = Math.round((total * (1 + pick(20))) / 100);
  const nc = total - nm;
  const h = nc / total;
  switch (pick(4)) {
    case 0:
      return { kind: '正向', nc, nm, tc, tm, order: pick(2) === 0 ? '例3.4' : '先求ta' };
    case 1:
      return { kind: '由ta求h', tc, tm, ta: Number((h * tc + (1 - h) * tm).toFixed(2)) };
    case 2:
      return { kind: '由e求h', e: Number((1 / (r + (1 - r) * h)).toFixed(4)), tc, tm };
    default:
      return {
        kind: '二级cache',
        clockGHz: 1 + pick(5),
        baseCpi: 1,
        memoryNs: 50 * (1 + pick(4)),
        l1Miss: (1 + pick(5)) / 100,
        l2Ns: 2 + pick(9),
        l2Miss: (1 + pick(5)) / 1000,
      };
  }
}
