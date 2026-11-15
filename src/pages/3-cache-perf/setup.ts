/**
 * 这一页的参数：讲解的例题、试一试的写法、练习的判分。只拼参数、比对答案；各量的数值都由 src/engines/cacheperf 给出。
 */
import { compute, generate, run, validateParams } from '../../engines/cacheperf/model';
import type { Params } from '../../engines/cacheperf/model';

/** 讲解的例题（本站自拟）：t_c = 20 ns，t_m = 120 ns。正向求出 t_a 以后，第三题拿这个 t_a 倒回去求 h。 */
export const examples: { key: string; label: string; params: Params }[] = [
  { key: 'fwd', label: '正向', params: { kind: '正向', nc: 3880, nm: 120, tc: 20, tm: 120 } },
  { key: 'ta', label: '先求 t_a', params: { kind: '正向', nc: 3880, nm: 120, tc: 20, tm: 120, order: '先求ta' } },
  { key: 'back', label: '由 t_a 求 h', params: { kind: '由ta求h', tc: 20, tm: 120, ta: 23 } },
  { key: 'e', label: '由 e 求 h', params: { kind: '由e求h', e: 0.8, tc: 20, tm: 120 } },
];

export const kindKeys = [
  { key: 'fwd', kind: '正向', label: '正向' },
  { key: 'ta', kind: '由ta求h', label: '由 t_a 求 h' },
  { key: 'e', kind: '由e求h', label: '由 e 求 h' },
  { key: 'l2', kind: '二级cache', label: '二级 cache' },
] as const;

/** 试一试的输入（全部是网址里的字符串）。 */
export interface TryInput {
  kind: string;
  order: string;
  nc: string;
  nm: string;
  tc: string;
  tm: string;
  ta: string;
  e: string;
  ghz: string;
  cpi: string;
  mem: string;
  l1: string;
  l2ns: string;
  l2: string;
}
export const DEFAULT_TRY: TryInput = { kind: 'fwd', order: 'book', nc: '4750', nm: '250', tc: '20', tm: '120', ta: '30', e: '0.75', ghz: '2', cpi: '1.2', mem: '80', l1: '4', l2ns: '6', l2: '0.8' };

const num = (text: string): number => Number(text.trim().replace(/%$/, ''));
/** 百分数和小数都认：「87%」「87」「0.87」都是 0.87。 */
const rate = (text: string): number => {
  const t = text.trim();
  const n = num(t);
  return t.endsWith('%') || n > 1 ? n / 100 : n;
};

export function tryParams(input: TryInput): { params: Params | null; problem: string } {
  let params: Params;
  if (input.kind === 'ta') params = { kind: '由ta求h', tc: num(input.tc), tm: num(input.tm), ta: num(input.ta) };
  else if (input.kind === 'e') params = { kind: '由e求h', e: rate(input.e), tc: num(input.tc), tm: num(input.tm) };
  else if (input.kind === 'l2')
    params = { kind: '二级cache', clockGHz: num(input.ghz), baseCpi: num(input.cpi), memoryNs: num(input.mem), l1Miss: num(input.l1) / 100, l2Ns: num(input.l2ns), l2Miss: num(input.l2) / 100 };
  else params = { kind: '正向', nc: num(input.nc), nm: num(input.nm), tc: num(input.tc), tm: num(input.tm), order: input.order === 'ta' ? '先求ta' : '例3.4' };
  if (Object.values(params).some((v) => typeof v === 'number' && !Number.isFinite(v))) return { params: null, problem: '每一格写一个数' };
  const problems = validateParams(params);
  return problems.length ? { params: null, problem: problems[0]! } : { params, problem: '' };
}

/** 引擎参数 → 试一试的输入（练习里「看演示」用）。 */
export function inputOf(params: Params): TryInput {
  const out: TryInput = { ...DEFAULT_TRY };
  if (params.kind === '正向') Object.assign(out, { kind: 'fwd', order: params.order === '先求ta' ? 'ta' : 'book', nc: String(params.nc ?? ''), nm: String(params.nm ?? ''), tc: String(params.tc), tm: String(params.tm) });
  else if (params.kind === '由ta求h') Object.assign(out, { kind: 'ta', tc: String(params.tc), tm: String(params.tm), ta: String(params.ta) });
  else if (params.kind === '由e求h') Object.assign(out, { kind: 'e', e: String(params.e), tc: String(params.tc ?? ''), tm: String(params.tm ?? '') });
  else
    Object.assign(out, {
      kind: 'l2',
      ghz: String(params.clockGHz),
      cpi: String(params.baseCpi),
      mem: String(params.memoryNs),
      l1: String(Number((params.l1Miss * 100).toPrecision(6))),
      l2ns: String(params.l2Ns),
      l2: String(Number((params.l2Miss * 100).toPrecision(6))),
    });
  return out;
}

/** 练习：引擎按种子出题（四种问法轮着出）。 */
export const quizParams = (seed: number): Params => generate(seed);

/** 学生写的数：e 和缺失率可以写百分数，其余写小数；可以带单位。 */
function read(key: string, text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(/(ns|个周期|周期)$/, '');
  if (t === '') return null;
  const percent = t.endsWith('%');
  const n = Number(t.replace(/%$/, ''));
  if (!Number.isFinite(n)) return null;
  if (key === 'e') return percent || n > 1 ? n / 100 : n;
  return percent ? n / 100 : n;
}

/**
 * 判一格：按答案该写的位数比。h、r、CPI 最多 4 位小数；e 写到百分数的 1 位小数；时间写到 4 位小数。
 * 性能比教材写约数（2.8），按 2 位有效数字也算对。
 */
export function close(key: string, typed: string, truth: number): boolean {
  const n = read(key, typed);
  if (n === null) return false;
  if (key === 'e') return Math.abs(n * 100 - truth * 100) <= 0.051;
  if (key === '性能比' && Math.abs(Number(truth.toPrecision(2)) - n) < 1e-9) return true;
  const scale = Math.max(1, Math.abs(truth));
  return Math.abs(n - truth) <= Math.max(0.00051, scale * 0.0005);
}

export function grade(params: Params, typed: Record<string, string>): string[] {
  const truth = compute(params);
  const keys = Object.keys(run(params).result);
  return keys.filter((key) => !close(key, typed[key] ?? '', truth[key] ?? NaN));
}

export const answerOf = (params: Params): Record<string, string> => ({ ...run(params).result });
