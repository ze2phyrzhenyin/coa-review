/**
 * ROM、RAM 地址译码引擎（教材 3.2.4 与图 3.8，p77；习题 7，p122；解析书设计题 3、4）。规格见 specs/3-decode.md。
 *
 * 做法跟解析书的顺序：画地址空间分布 → 选片 → 按相同大小分组 → 选译码器、接使能 → 定每个 Y 输出的去向
 * （不足一组的小芯片加门电路局部译码）→ 接控制线。另可反查一个地址选中哪组芯片。
 * 状态路径（regions.0.chips、outputs.3.target、decoder.inputs …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Ask, type Condition, type SolutionTable, type Trace } from '../trace';

export const ENGINE = 'decode';
export const MAX_REGIONS = 8;
export const MAX_CHIP_GROUPS = 32;

export interface Region {
  kind: 'ROM' | 'RAM';
  /** 首地址、尾地址（含）。 */
  start: number;
  end: number;
  /** 所用芯片；ROM 可不给，表示已有的一整块。 */
  chip?: { words: number | string; bits: number };
}

export interface Params {
  addressBits: number;
  dataBits: number;
  regions: Region[];
  decoder?: '74138' | '74139';
  groupWords?: number;
  probe?: number;
}

/** 一组芯片：组内做位扩展，共用一个片选。 */
export interface ChipGroup {
  name: string;
  kind: 'ROM' | 'RAM';
  region: number;
  start: number;
  words: number;
  /** 芯片规格，如 8K×8 位。 */
  chip: string;
  perGroup: number;
  /** 各片接的数据线。 */
  data: string[];
  /** 片选怎么来，如 Y3、Y0 和 Y1 经与门。 */
  select: string;
}

export interface Output {
  y: string;
  from: string;
  to: string;
  target: string;
  gate: string;
}

export interface Design {
  n: number;
  groupWords: number;
  k: number;
  decoder: '74138' | '74139';
  inputs: string[];
  enables: string[];
  base: number;
  groups: ChipGroup[];
  outputs: Output[];
  /** 每个区域的芯片说明，按地址顺序。 */
  regions: { index: number; kind: 'ROM' | 'RAM'; start: number; end: number; size: number; chip: string; chipWords: number; count: number; groups: number; perGroup: number }[];
}

export interface Located {
  /** 选中的芯片组名；没有芯片为 null。 */
  chip: string | null;
  /** 有效的译码输出；地址不在译码范围里为 null。 */
  output: string | null;
  /** 片内地址；没有芯片为 null。 */
  inner: number | null;
}

export interface RegionView {
  kind: string;
  from: string;
  to: string;
  size: string;
  chips: string;
}

export interface State {
  regions: RegionView[];
  groupWords: string;
  groupLines: string;
  decoder: { type: string; inputs: string[]; enables: string[] };
  outputs: Output[];
  control: string[];
  probe: { address: string; bits: string; output: string; chip: string; inner: string } | null;
}

// ---------- 小工具 ----------

const UNITS: Record<string, number> = { '': 1, K: 2 ** 10, M: 2 ** 20 };

function parseWords(words: unknown): number | null {
  if (typeof words === 'number') return Number.isInteger(words) && words > 0 ? words : null;
  if (typeof words !== 'string') return null;
  const m = /^\s*(\d+)\s*([KM]?)\s*$/i.exec(words);
  if (!m) return null;
  const value = Number(m[1]) * (UNITS[(m[2] ?? '').toUpperCase()] ?? 1);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isPowerOfTwo(n: number): boolean {
  if (!Number.isInteger(n) || n < 1) return false;
  let x = n;
  while (x % 2 === 0) x /= 2;
  return x === 1;
}

function log2(n: number): number {
  let bits = 0;
  for (let x = n; x > 1; x /= 2) bits += 1;
  return bits;
}

const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** 1K、8K、64 这样的写法。 */
export function sizeText(n: number): string {
  if (n >= 2 ** 20 && n % 2 ** 20 === 0) return `${n / 2 ** 20}M`;
  if (n >= 2 ** 10 && n % 2 ** 10 === 0) return `${n / 2 ** 10}K`;
  return String(n);
}

export function hex(value: number, bits: number): string {
  return `${value.toString(16).toUpperCase().padStart(Math.max(1, Math.ceil(bits / 4)), '0')}H`;
}

function lines(prefix: string, high: number, low: number): string {
  if (high < low) return '';
  return high === low ? `${prefix}${high}` : `${prefix}${high}–${prefix}${low}`;
}

const bit = (value: number, b: number): number => Math.floor(value / 2 ** b) % 2;

// ---------- 设计 ----------

interface Prepared {
  index: number;
  region: Region;
  size: number;
  chipWords: number;
  chipBits: number;
}

function prepare(params: Params): Prepared[] {
  return params.regions
    .map((region, index) => {
      const size = region.end - region.start + 1;
      const chipWords = region.chip ? (parseWords(region.chip.words) ?? 0) : size;
      const chipBits = region.chip ? region.chip.bits : params.dataBits;
      return { index, region, size, chipWords, chipBits };
    })
    .sort((a, b) => a.region.start - b.region.start);
}

function defaultGroupWords(prepared: Prepared[]): number | null {
  const sizes = prepared.filter((p) => p.region.chip).map((p) => p.chipWords);
  return sizes.length === 0 ? null : Math.max(...sizes);
}

/** 参数有什么问题。空表示可以运行。 */
export function validateParams(params: Params): string[] {
  const problems: string[] = [];
  const p = params as Partial<Record<keyof Params, unknown>>;
  if (!isNat(p.addressBits) || p.addressBits < 8 || p.addressBits > 24) problems.push('地址线条数必须是 8 到 24');
  if (!isNat(p.dataBits) || p.dataBits < 1 || p.dataBits > 64) problems.push('数据线条数必须是 1 到 64');
  if (p.decoder !== undefined && p.decoder !== '74138' && p.decoder !== '74139') problems.push('译码器只能是 74138 或 74139');
  if (p.groupWords !== undefined && (!isNat(p.groupWords) || !isPowerOfTwo(p.groupWords))) problems.push('每组地址数必须是 2 的幂');
  if (!Array.isArray(p.regions) || p.regions.length < 1 || p.regions.length > MAX_REGIONS) problems.push(`区域要有 1 到 ${MAX_REGIONS} 个`);
  if (problems.length > 0) return problems;
  const n = params.addressBits;
  const space = 2 ** n;
  params.regions.forEach((r, i) => {
    const name = `第 ${i + 1} 个区域`;
    const q = r as Partial<Record<keyof Region, unknown>> | null;
    if (q === null || typeof q !== 'object') {
      problems.push(`${name}不完整`);
      return;
    }
    if (q.kind !== 'ROM' && q.kind !== 'RAM') problems.push(`${name}只能是 ROM 或 RAM`);
    if (!isNat(q.start) || !isNat(q.end) || q.start > q.end || q.end >= space) {
      problems.push(`${name}的首尾地址必须在 0 到 ${hex(space - 1, n)} 之间，且首地址不大于尾地址`);
      return;
    }
    const size = q.end - q.start + 1;
    if (q.chip === undefined) {
      if (q.kind === 'RAM') problems.push(`${name}是 RAM，要给芯片规格`);
      return;
    }
    const chip = q.chip as Partial<Record<'words' | 'bits', unknown>>;
    const words = parseWords(chip.words);
    if (words === null || !isPowerOfTwo(words)) {
      problems.push(`${name}的芯片字数必须是 2 的幂`);
      return;
    }
    if (!isNat(chip.bits) || chip.bits < 1 || params.dataBits % chip.bits !== 0) problems.push(`${name}的芯片位数必须整除数据线条数 ${params.dataBits}`);
    if (size % words !== 0) problems.push(`${name}的长度 ${sizeText(size)} 不是芯片字数 ${sizeText(words)} 的整数倍`);
    if (q.start % words !== 0) problems.push(`${name}的首地址要按芯片字数 ${sizeText(words)} 对齐`);
  });
  if (problems.length > 0) return problems;

  const prepared = prepare(params);
  for (let i = 1; i < prepared.length; i += 1) {
    const a = prepared[i - 1];
    const b = prepared[i];
    if (a && b && b.region.start <= a.region.end) problems.push(`区域 ${hex(a.region.start, n)}–${hex(a.region.end, n)} 与 ${hex(b.region.start, n)}–${hex(b.region.end, n)} 重叠`);
  }
  if (problems.length > 0) return problems;
  const total = prepared.reduce((sum, r) => sum + r.size / r.chipWords, 0);
  if (total > MAX_CHIP_GROUPS) problems.push(`芯片组太多，不能超过 ${MAX_CHIP_GROUPS} 组`);

  const g = params.groupWords ?? defaultGroupWords(prepared);
  if (g === null) {
    problems.push('所有区域都没给芯片，要给每组地址数');
    return problems;
  }
  const k = log2(g);
  const h = n - k;
  if (h < 2) problems.push('每组地址数太大，译码位数不到 2 位');
  for (const r of prepared) {
    const where = `区域 ${hex(r.region.start, n)}–${hex(r.region.end, n)}`;
    if (!r.region.chip) {
      if (r.size >= g) {
        if (r.size % g !== 0 || r.region.start % g !== 0) problems.push(`${where}要按每组 ${sizeText(g)} 对齐并且是整数组`);
      } else if (!isPowerOfTwo(r.size) || r.region.start % r.size !== 0) {
        problems.push(`${where}比一组小，长度要是 2 的幂并按长度对齐`);
      }
    } else if (r.chipWords > g && r.chipWords % g !== 0) {
      problems.push(`${where}的芯片字数不是每组地址数的整数倍`);
    }
  }
  if (problems.length > 0) return problems;
  const decoder = params.decoder ?? (h === 2 ? '74139' : '74138');
  const inputs = decoder === '74138' ? 3 : 2;
  if (h < inputs) {
    problems.push(`只有 ${h} 位要译码，${decoder} 有 ${inputs} 个输入，换 74139 或减小每组地址数`);
    return problems;
  }
  const extras = extraLines(n, k + inputs, prepared);
  for (const e of extras) if (e.value === null) problems.push(`A${e.line} 在不同区域里取值不同，要另加门电路，不在本题范围内`);
  if (problems.length > 0) return problems;
  if (decoder === '74139' && extras.length > 0) problems.push(`74139 只有一个使能端，接了 MREQ 后放不下 ${extras.map((e) => `A${e.line}`).join('、')}`);
  if (decoder === '74138') {
    const zeros = extras.filter((e) => e.value === 0).length;
    const ones = extras.filter((e) => e.value === 1).length;
    if (zeros > 1 || ones > 1) problems.push(`74138 除去 MREQ 只剩 G2B（接恒为 0 的线）和 G1（接恒为 1 的线），放不下 ${extras.map((e) => `A${e.line}`).join('、')}`);
  }
  if (params.probe !== undefined && (!isNat(params.probe) || params.probe >= space)) problems.push(`要查的地址必须在 0 到 ${hex(space - 1, n)} 之间`);
  return problems;
}

/** 译码器输入以上的地址线，在所有区域里的取值；不统一时为 null。 */
function extraLines(n: number, from: number, prepared: Prepared[]): { line: number; value: number | null }[] {
  const out: { line: number; value: number | null }[] = [];
  for (let line = n - 1; line >= from; line -= 1) {
    let value: number | null | undefined;
    for (const r of prepared) {
      const a = Math.floor(r.region.start / 2 ** line);
      const b = Math.floor(r.region.end / 2 ** line);
      const v = a === b ? a % 2 : null;
      if (v === null || (value !== undefined && value !== v)) {
        value = null;
        break;
      }
      value = v;
    }
    out.push({ line, value: value ?? null });
  }
  return out;
}

const chipText = (words: number, bits: number): string => `${sizeText(words)}×${bits} 位`;

/** 选片、分组、译码器接法、每个 Y 的去向。参数要先通过 validateParams。 */
export function design(params: Params): Design {
  const n = params.addressBits;
  const prepared = prepare(params);
  const g = params.groupWords ?? defaultGroupWords(prepared) ?? 1;
  const k = log2(g);
  const h = n - k;
  const decoder = params.decoder ?? (h === 2 ? '74139' : '74138');
  const count = decoder === '74138' ? 3 : 2;
  const inputNames = decoder === '74138' ? ['C', 'B', 'A'] : ['B', 'A'];
  const inputs = inputNames.map((name, i) => `${name} ← A${k + count - 1 - i}`);
  const extras = extraLines(n, k + count, prepared);
  const base = extras.reduce((sum, e) => sum + (e.value ?? 0) * 2 ** e.line, 0);
  const enables: string[] = [];
  if (decoder === '74139') enables.push('G ← MREQ');
  else {
    const one = extras.find((e) => e.value === 1);
    const zero = extras.find((e) => e.value === 0);
    enables.push(one ? `G1 ← A${one.line}` : 'G1 ← 高电平');
    enables.push('G2A ← MREQ');
    enables.push(zero ? `G2B ← A${zero.line}` : 'G2B ← 接地');
  }

  // 芯片组，按地址顺序命名。
  const totals = { ROM: 0, RAM: 0 };
  for (const r of prepared) totals[r.region.kind] += r.size / r.chipWords;
  const seen = { ROM: 0, RAM: 0 };
  const groups: ChipGroup[] = [];
  const regions: Design['regions'] = [];
  for (const r of prepared) {
    const perGroup = params.dataBits / r.chipBits;
    const inRegion = r.size / r.chipWords;
    const chip = chipText(r.chipWords, r.chipBits);
    regions.push({ index: r.index, kind: r.region.kind, start: r.region.start, end: r.region.end, size: r.size, chip, chipWords: r.chipWords, count: inRegion * perGroup, groups: inRegion, perGroup });
    for (let t = 0; t < inRegion; t += 1) {
      const kind = r.region.kind;
      seen[kind] += 1;
      groups.push({
        name: totals[kind] === 1 ? kind : `${kind}${seen[kind]}`,
        kind,
        region: r.index,
        start: r.region.start + t * r.chipWords,
        words: r.chipWords,
        chip,
        perGroup,
        data: Array.from({ length: perGroup }, (_, j) => lines('D', (j + 1) * r.chipBits - 1, j * r.chipBits)),
        select: '',
      });
    }
  }

  const outputs: Output[] = [];
  for (let i = 0; i < 2 ** count; i += 1) {
    const from = base + i * g;
    const to = from + g - 1;
    const y = `Y${i}`;
    const whole = groups.find((c) => c.words >= g && c.start <= from && to <= c.start + c.words - 1);
    let target = '空';
    let gate = '';
    if (whole) {
      target = whole.name;
      if (whole.words > g) {
        const first = (whole.start - base) / g;
        const ys = Array.from({ length: whole.words / g }, (_, t) => `Y${first + t}`);
        gate = `${ys.join('、')} 进与门`;
        whole.select = gate;
      } else whole.select = y;
    } else {
      const small = groups.filter((c) => c.words < g && c.start >= from && c.start <= to);
      if (small.length > 0) {
        target = small.map((c) => c.name).join('、');
        const gates = small.map((c) => {
          const c0 = log2(c.words);
          const parts: string[] = [];
          for (let line = k - 1; line >= c0; line -= 1) parts.push(bit(c.start, line) === 1 ? `A${line}` : `A${line} 经非门`);
          const text = `${y} 经非门，与 ${parts.join('、')} 进与非门`;
          c.select = text;
          return small.length > 1 ? `${c.name}：${text}` : text;
        });
        gate = gates.join('；');
      }
    }
    outputs.push({ y, from: hex(from, n), to: hex(to, n), target, gate });
  }
  return { n, groupWords: g, k, decoder, inputs, enables, base, groups, outputs, regions };
}

/** 一个地址选中哪组芯片。参数要先通过 validateParams。 */
export function locate(params: Params, address: number): Located {
  const d = design(params);
  const count = d.decoder === '74138' ? 3 : 2;
  const span = 2 ** count * d.groupWords;
  const output = address >= d.base && address < d.base + span ? `Y${Math.floor((address - d.base) / d.groupWords)}` : null;
  const hit = d.groups.find((c) => address >= c.start && address < c.start + c.words);
  if (!hit) return { chip: null, output, inner: null };
  return { chip: hit.name, output, inner: address - hit.start };
}

// ---------- Trace ----------

function decoderName(type: '74138' | '74139'): string {
  return type === '74138' ? '74138（3:8 译码器）' : '74139（2:4 译码器）';
}

/** 由地址空间分配推出译码方案。参数不合格时抛出错误，信息同 validateParams。 */
export function run(params: Params): Trace<Params, State> {
  const problems = validateParams(params);
  if (problems.length > 0) throw new Error(`地址译码参数不对：${problems.join('；')}`);
  const d = design(params);
  const n = d.n;
  const conditions: Condition[] = [
    { label: 'CPU', value: `地址线 ${lines('A', n - 1, 0)}，数据线 ${lines('D', params.dataBits - 1, 0)}，控制线 MREQ、R/W` },
    { label: '信号', value: 'MREQ 低电平表示访存；R/W 高读低写；芯片片选 CS 低电平有效' },
    {
      label: '地址空间',
      value: d.regions.map((r) => `${r.kind} ${hex(r.start, n)}–${hex(r.end, n)}${params.regions[r.index]?.chip ? `，用 ${r.chip} 芯片` : '（已有）'}`).join('；'),
    },
    { label: '译码器', value: d.decoder === '74138' ? '74138：输入 C、B、A，使能 G1 高有效、G2A 和 G2B 低有效，输出 Y0–Y7 低有效' : '74139：输入 B、A，使能 G 低有效，输出 Y0–Y3 低有效' },
  ];
  const initial: State = {
    regions: [],
    groupWords: '',
    groupLines: '',
    decoder: { type: '', inputs: [], enables: [] },
    outputs: [],
    control: [],
    probe: null,
  };
  const builder = new TraceBuilder<Params, State>(ENGINE, params, initial, conditions);
  const table: SolutionTable = { columns: ['译码输出', '地址范围', '接到', '门电路'], rows: [] };
  let stepCount = 0;
  const names = [...new Set(d.groups.map((c) => c.name)), '空'];

  // 1. 地址空间分布
  const views: RegionView[] = d.regions.map((r) => ({ kind: r.kind, from: hex(r.start, n), to: hex(r.end, n), size: sizeText(r.size), chips: '' }));
  const gaps: string[] = [];
  let cursor = 0;
  for (const r of d.regions) {
    if (r.start > cursor) gaps.push(`${hex(cursor, n)}–${hex(r.start - 1, n)}`);
    cursor = r.end + 1;
  }
  if (cursor < 2 ** n) gaps.push(`${hex(cursor, n)}–${hex(2 ** n - 1, n)}`);
  builder.step({
    title: '画出地址空间分布',
    why:
      `${n} 根地址线共 ${sizeText(2 ** n)} 个地址。` +
      d.regions.map((r) => `${r.kind} 占 ${hex(r.start, n)}–${hex(r.end, n)}，共 ${sizeText(r.size)}`).join('；') +
      (gaps.length > 0 ? `；${gaps.join('、')} 空着。` : '。') +
      '大小 = 尾地址 − 首地址 + 1。',
    ref: '解析书 p51',
    focus: views.map((_, i) => `regions.${i}`),
    update: (s) => {
      s.regions = views.map((v) => ({ ...v }));
    },
  });
  stepCount += 1;

  // 2. 每个区域选片
  d.regions.forEach((r, i) => {
    const given = params.regions[r.index]?.chip !== undefined;
    const chips = given ? `${r.chip} × ${r.count} 片（${r.groups} 组，每组 ${r.perGroup} 片）` : `已有 ${r.chip}，1 块`;
    const data = d.groups.find((c) => c.region === r.index)?.data ?? [];
    builder.step({
      title: `${r.kind} ${hex(r.start, n)}–${hex(r.end, n)}：${chips}`,
      why: given
        ? `${sizeText(r.size)} ÷ ${sizeText(r.chipWords)} = ${r.groups} 组；字长 ${params.dataBits} 位 ÷ 芯片 ${r.chip.split('×')[1] ?? ''} = 每组 ${r.perGroup} 片。` +
          (r.perGroup > 1 ? `组内位扩展，各片分别接 ${data.join('、')}。` : '一片就是一组，接全部数据线。')
        : `这块 ROM 已经配好，按一整块看，接全部 ${params.dataBits} 根数据线。`,
      ref: given ? '教材 p76–77' : '教材 p122 习题 7',
      focus: [`regions.${i}.chips`],
      update: (s) => {
        const view = s.regions[i];
        if (view) view.chips = chips;
      },
    });
    stepCount += 1;
  });

  // 3. 组大小
  const groupLines = lines('A', d.k - 1, 0);
  const g = d.groupWords;
  builder.step({
    title: `按 ${sizeText(g)} 分组，组内地址 ${groupLines}`,
    why:
      `${params.groupWords !== undefined ? '题目指定' : '取最大的芯片字数'}每组 ${sizeText(g)} 个地址 = 2^${d.k}，低 ${d.k} 位 ${groupLines} 送到芯片，不参加译码。` +
      `剩下 ${n - d.k} 位用来区分各组。`,
    ref: '解析书 p51',
    focus: ['groupWords', 'groupLines'],
    update: (s) => {
      s.groupWords = sizeText(g);
      s.groupLines = groupLines;
    },
  });
  stepCount += 1;

  // 4. 译码器
  const count = d.decoder === '74138' ? 3 : 2;
  const inLines = lines('A', d.k + count - 1, d.k);
  const extraNote =
    n - d.k > count
      ? `更高的 ${lines('A', n - 1, d.k + count)} 在所有区域里取值不变，接到使能端，只有取值对上时译码器才工作。`
      : '';
  builder.step({
    title: `${decoderName(d.decoder)}，输入 ${inLines}`,
    why:
      `紧挨着组内地址的 ${count} 位 ${inLines} 送进译码器，高位接 ${d.decoder === '74138' ? 'C' : 'B'}。${extraNote}` +
      `MREQ 接低有效的使能端，不访存时所有输出都无效，芯片都不选中。${d.enables.filter((e) => /高电平|接地/.test(e)).length > 0 ? '用不上的使能端接成有效电平。' : ''}`,
    ref: '解析书 p51–53',
    focus: ['decoder.type', 'decoder.inputs', 'decoder.enables'],
    update: (s) => {
      s.decoder = { type: decoderName(d.decoder), inputs: [...d.inputs], enables: [...d.enables] };
    },
  });
  stepCount += 1;

  // 5. 每个 Y
  const inputBits = (i: number): string => i.toString(2).padStart(count, '0');
  d.outputs.forEach((o, i) => {
    let why = `${inLines} = ${inputBits(i)} 时 ${o.y} 为低，对应 ${o.from}–${o.to}。`;
    const whole = d.groups.find((c) => c.name === o.target);
    if (o.target === '空') why += '这段地址没有芯片，输出空着不接。';
    else if (whole && whole.words > g) why += `${whole.name} 有 ${sizeText(whole.words)}，占好几个 Y；这几个输出低有效，任一为低都要选中它，所以经与门合成一个片选。`;
    else if (whole && whole.words === g) why += `${whole.name} 正好 ${sizeText(g)}，${o.y} 直接接它的片选。`;
    else why += `芯片只有 ${sizeText(d.groups.find((c) => o.target.split('、').includes(c.name))?.words ?? 0)}，比一组小，还要用组内的高几位地址再分一次，否则同一片会在这一组里重复出现。`;
    const ask: Ask | undefined = names.includes(o.target)
      ? { prompt: `${o.y} 接到哪里`, kind: 'choice', options: names, answer: o.target, hint: `看 ${o.from}–${o.to} 落在地址空间的哪一段。` }
      : undefined;
    builder.step({
      title: `${o.y}：${o.target === '空' ? '空' : `接 ${o.target}`}${o.gate ? `（${o.gate}）` : ''}`,
      why,
      ref: o.gate.includes('与非门') ? '解析书 p52–53' : '教材 p77 图 3.8',
      focus: [`outputs.${i}`],
      ...(ask ? { ask } : {}),
      update: (s) => {
        s.outputs.push({ ...o });
      },
    });
    stepCount += 1;
    table.rows.push({ cells: [o.y, `${o.from}–${o.to}`, o.target, o.gate], step: `s${stepCount}` });
  });

  // 6. 控制线
  const hasRom = d.regions.some((r) => r.kind === 'ROM');
  const hasRam = d.regions.some((r) => r.kind === 'RAM');
  const control = [
    `MREQ 接译码器的 ${d.decoder === '74138' ? 'G2A' : 'G'}`,
    ...(hasRam ? ['R/W 接各片 RAM 的 WE'] : []),
    ...(hasRom ? ['ROM 不接 R/W'] : []),
    `${groupLines} 接各片的片内地址（小芯片只接自己的低位）`,
  ];
  builder.step({
    title: '接控制线',
    why: `${hasRam ? 'RAM 要能写，R/W 接它的 WE：高电平读，低电平写。' : ''}${hasRom ? 'ROM 只读，不接 R/W。' : ''}MREQ 只接译码器，由它统一控制片选。`,
    ref: '解析书 p51',
    focus: ['control'],
    update: (s) => {
      s.control = control;
    },
  });
  stepCount += 1;

  const result: Record<string, string> = {
    芯片: d.regions.map((r) => `${r.kind}：${r.chip} ${r.count} 片`).join('；'),
    芯片总数: String(d.regions.reduce((sum, r) => sum + r.count, 0)),
    译码器: decoderName(d.decoder),
    译码输入: Array.from({ length: count }, (_, i) => `A${d.k + count - 1 - i}`).join('、'),
  };
  for (const o of d.outputs) result[o.y] = o.target;
  const gates = d.outputs.filter((o) => o.gate).map((o) => `${o.y}：${o.gate}`);
  result['门电路'] = gates.length > 0 ? gates.join('；') : '无';

  // 7. 查地址
  if (params.probe !== undefined) {
    const address = params.probe;
    const at = locate(params, address);
    const bits = address.toString(2).padStart(n, '0');
    const chip = at.chip ?? '没有芯片';
    const group = d.groups.find((c) => c.name === at.chip);
    const inner = at.inner === null || !group ? '' : hex(at.inner, log2(group.words));
    const high = bits.slice(0, n - d.k);
    builder.step({
      title: at.chip ? `地址 ${hex(address, n)} 选中 ${at.chip}` : `地址 ${hex(address, n)} 没有芯片`,
      why:
        `${hex(address, n)} = ${bits}。高 ${n - d.k} 位 ${high} ` +
        (at.output ? `让 ${at.output} 有效` : '与使能端要求的取值对不上，译码器不工作') +
        (at.chip && group
          ? `，${group.select === at.output ? '' : `再经${group.select.includes('与非门') ? '局部译码' : '与门'}，`}选中 ${at.chip}；片内地址 ${inner}。`
          : '，这个地址上没有芯片。'),
      ref: '教材 p77',
      focus: ['probe'],
      ask: { prompt: '选中哪一组', kind: 'choice', options: [...names.filter((x) => x !== '空'), '没有芯片'], answer: chip, hint: '先看高位地址让哪个 Y 有效。' },
      update: (s) => {
        s.probe = { address: hex(address, n), bits, output: at.output ?? '', chip, inner };
      },
    });
    result['选中'] = at.chip ? `${at.chip}（${at.output ?? ''}），片内地址 ${inner}` : '没有芯片';
  }

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

/** 随机出一道题：16 位地址，ROM 在低端，RAM 在中间，可能再有一小块高端 RAM。 */
export function generate(seed: number): Params {
  const next = generator(seed);
  const pick = (n: number): number => next() % n;
  const n = 16;
  const dataBits = [8, 16][pick(2)] ?? 16;
  const g = 2 ** (12 + pick(2)); // 4K 或 8K
  const slots = 2 ** n / g;
  const romSlots = 1 + pick(2);
  const gap = pick(2);
  const ramSlots = Math.min(1 + pick(4), slots - romSlots - gap - 1);
  const regions: Region[] = [{ kind: 'ROM', start: 0, end: romSlots * g - 1 }];
  const ramStart = (romSlots + gap) * g;
  regions.push({ kind: 'RAM', start: ramStart, end: ramStart + ramSlots * g - 1, chip: { words: g, bits: dataBits === 16 && pick(2) === 0 ? 8 : dataBits } });
  if (pick(2) === 0) {
    const small = g / 4;
    regions.push({ kind: 'RAM', start: 2 ** n - small, end: 2 ** n - 1, chip: { words: small, bits: dataBits } });
  }
  const params: Params = { addressBits: n, dataBits, regions };
  // 4K 一组时 16 位地址要译 4 位，最高位放到 74138 的使能端，只能用前一半地址空间。
  if (g === 2 ** 12) {
    const last = regions[regions.length - 1];
    if (last && last.end >= 2 ** 15) regions.pop();
  }
  params.probe = pick(2 ** n);
  return params;
}
