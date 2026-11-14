/**
 * 扩展操作码：等长指令字里，地址越少的指令把空出来的地址字段并进操作码。
 * 从地址最多的一类排起，每类按编码从小到大取，剩下的最大的几个码留作下一类的前缀（教材 4.2.3，p129–130，例 4.1、表 4.2；习题 17，p148）。
 */
import { TraceBuilder, type Ask, type Condition, type Trace } from '../trace';

export const ENGINE = 'opcode';

export interface Level {
  /** 这一类指令有几个地址码。 */
  addresses: number;
  /** 要几条。不给表示求这一类最多能有几条（至多一类不给）。 */
  count?: number;
}

export interface OpcodeParams {
  /** 指令字长（位），4–32。 */
  wordBits: number;
  /** 每个地址码的位数。 */
  addressBits: number;
  /** 各类指令，地址数从多到少，不能重复。 */
  levels: Level[];
}

export interface LevelState {
  name: string;
  addresses: number;
  /** 操作码位数 = 字长 − 地址数 × 地址码位数。 */
  opBits: number;
  /** 这一级可用的编码个数（上一级留下的码 × 2^扩展位数）。 */
  available: number | null;
  used: number | null;
  /** 留给下一级作前缀的码数。 */
  reserved: number | null;
  /** 用掉的编码范围，例如 1111,0000～1111,1101；一条也不用是 null。 */
  range: [string, string] | null;
  /** 留作扩展的编码范围。 */
  reservedRange: [string, string] | null;
}

export interface OpcodeState {
  levels: LevelState[];
  /** 当前在排第几类，0 起。 */
  current: number | null;
  feasible: boolean | null;
}

const NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八'];

export function levelName(addresses: number): string {
  return `${NUMERALS[addresses] ?? String(addresses)}地址`;
}

export function checkOpcode(p: OpcodeParams): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(p.wordBits) || p.wordBits < 4 || p.wordBits > 32) problems.push('字长要是 4 到 32 的整数');
  if (!Number.isInteger(p.addressBits) || p.addressBits < 1 || p.addressBits > 16) problems.push('地址码位数要是 1 到 16 的整数');
  if (!Array.isArray(p.levels) || p.levels.length < 1 || p.levels.length > 8) problems.push('要有 1 到 8 类指令');
  else {
    for (let i = 0; i < p.levels.length; i += 1) {
      const l = p.levels[i]!;
      if (!Number.isInteger(l.addresses) || l.addresses < 0) problems.push('地址数要是非负整数');
      if (i > 0 && !(l.addresses < p.levels[i - 1]!.addresses)) problems.push('各类按地址数从多到少排，不能重复');
      if (l.count !== undefined && (!Number.isInteger(l.count) || l.count < 0)) problems.push('条数要是非负整数');
      if (Number.isInteger(l.addresses) && Number.isInteger(p.addressBits) && p.wordBits - l.addresses * p.addressBits < 1) {
        problems.push(`${levelName(l.addresses)}指令：${l.addresses} 个地址码已占满字长，没有位置放操作码`);
      }
    }
    if (p.levels.filter((l) => l.count === undefined).length > 1) problems.push('至多一类不给条数（求最多）');
  }
  return problems;
}

export interface Plan {
  opBits: number[];
  available: number[];
  used: number[];
  reserved: number[];
  /** 每一级可用编码的第一个（作 opBits 位的数）。 */
  start: number[];
  feasible: boolean;
  /** 不可行时卡在第几级。 */
  failAt: number | null;
  /** 求最多的那一级及其结果。 */
  maxLevel: number | null;
  maxCount: number | null;
}

/** 后面各级至少要上一级留下几个码作前缀。 */
function prefixesNeeded(levels: Level[], opBits: number[], from: number): number {
  let need = 0;
  for (let j = levels.length - 1; j >= from; j -= 1) {
    const prefixes = need === 0 ? 0 : Math.ceil(need / 2 ** (opBits[j + 1]! - opBits[j]!));
    need = (levels[j]!.count ?? 0) + prefixes;
  }
  return need === 0 ? 0 : Math.ceil(need / 2 ** (opBits[from]! - opBits[from - 1]!));
}

/** 只算数，不出 Trace。 */
export function plan(p: OpcodeParams): Plan {
  const problems = checkOpcode(p);
  if (problems.length) throw new Error(`扩展操作码参数有问题：${problems.join('；')}`);
  const opBits = p.levels.map((l) => p.wordBits - l.addresses * p.addressBits);
  const out: Plan = { opBits, available: [], used: [], reserved: [], start: [], feasible: true, failAt: null, maxLevel: null, maxCount: null };
  let prevReserved = 1;
  let prevStart = 0;
  for (let i = 0; i < p.levels.length; i += 1) {
    const grow = i === 0 ? opBits[0]! : opBits[i]! - opBits[i - 1]!;
    const available = prevReserved * 2 ** grow;
    const start = i === 0 ? 0 : prevStart * 2 ** grow;
    let used = p.levels[i]!.count;
    if (used === undefined) {
      const keep = i + 1 < p.levels.length ? prefixesNeeded(p.levels, opBits, i + 1) : 0;
      used = Math.max(0, available - keep);
      out.maxLevel = i;
      out.maxCount = used;
    }
    out.available.push(available);
    out.start.push(start);
    const laterNeed = i + 1 < p.levels.length ? prefixesNeeded(p.levels, opBits, i + 1) : 0;
    if (used > available || available - used < laterNeed) {
      out.used.push(Math.min(used, available));
      out.reserved.push(Math.max(0, available - used));
      out.feasible = false;
      out.failAt = used > available ? i : i + 1;
      break;
    }
    out.used.push(used);
    out.reserved.push(available - used);
    prevReserved = available - used;
    prevStart = start + used;
  }
  return out;
}

/** 按 opBits 位写成二进制，第一组是最长那一级以前的基本操作码位数，后面按地址码位数分组，用逗号隔开（表 4.2 的写法）。 */
export function codeText(value: number, bits: number, firstBits: number, groupBits: number): string {
  const s = value.toString(2).padStart(bits, '0');
  const parts = [s.slice(0, firstBits)];
  for (let at = firstBits; at < bits; at += groupBits) parts.push(s.slice(at, at + groupBits));
  return parts.join(',');
}

/** 逐级分配操作码。不可行时不抛错，Trace 停在卡住的那一级；参数不合法时抛出错误。 */
export function run(params: OpcodeParams): Trace<OpcodeParams, OpcodeState> {
  const pl = plan(params);
  const a = params.addressBits;
  const first = pl.opBits[0]!;
  const text = (v: number, i: number): string => codeText(v, pl.opBits[i]!, first, a);
  const span = (from: number, n: number, i: number): string => (n === 1 ? text(from, i) : `${text(from, i)}～${text(from + n - 1, i)}`);
  const conditions: Condition[] = [
    { label: '指令字长', value: `${params.wordBits} 位，等长` },
    { label: '地址码', value: `每个 ${a} 位` },
    { label: '要求', value: params.levels.map((l) => `${levelName(l.addresses)}${l.count === undefined ? '尽量多' : ` ${l.count} 条`}`).join('，') },
  ];
  const initial: OpcodeState = {
    levels: params.levels.map((l, i) => ({
      name: levelName(l.addresses),
      addresses: l.addresses,
      opBits: pl.opBits[i]!,
      available: null,
      used: null,
      reserved: null,
      range: null,
      reservedRange: null,
    })),
    current: null,
    feasible: null,
  };
  const builder = new TraceBuilder<OpcodeParams, OpcodeState>(ENGINE, params, initial, conditions);
  let count = 0;
  const step = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };
  const rowSteps: string[] = [];

  for (let i = 0; i < pl.available.length; i += 1) {
    const l = params.levels[i]!;
    const name = levelName(l.addresses);
    const available = pl.available[i]!;
    const grow = i === 0 ? first : pl.opBits[i]! - pl.opBits[i - 1]!;
    const capWhy =
      i === 0
        ? `${l.addresses} 个地址码占 ${l.addresses * a} 位，剩下 ${first} 位作操作码，最多 2^${first} = ${available} 种编码。`
        : `上一级留下 ${pl.reserved[i - 1]!} 个码作前缀，${name}指令少用 ${(params.levels[i - 1]!.addresses - l.addresses)} 个地址码，操作码多出 ${grow} 位，每个前缀后面接 2^${grow} 种，共 ${pl.reserved[i - 1]!} × ${2 ** grow} = ${available} 种。`;
    const capAsk: Ask | null = i > 0 ? { prompt: `${name}指令一共有多少个编码可用`, kind: 'number', answer: String(available), hint: '上一级留下的码数乘以 2 的「多出的操作码位数」次方。' } : null;
    step({
      level: 'explain',
      title: `${name}：操作码 ${pl.opBits[i]!} 位，可用 ${available} 种编码`,
      why: capWhy,
      ref: '教材 p129–130，表 4.2',
      focus: [`levels.${i}`],
      ...(capAsk ? { ask: capAsk } : {}),
      update: (d) => {
        d.current = i;
        d.levels[i]!.available = available;
      },
    });
    const want = l.count;
    const used = pl.used[i]!;
    const reserved = pl.reserved[i]!;
    const start = pl.start[i]!;
    const later = i + 1 < params.levels.length;
    const failsHere = !pl.feasible && pl.failAt === i;
    const failsNext = !pl.feasible && pl.failAt === i + 1;
    let title: string;
    let why: string;
    if (failsHere) {
      title = `${name}要 ${want!} 条，只有 ${available} 种编码，不够`;
      why = '这一级的编码空间装不下要求的条数，方案不可行。要么减少前面几类的条数，多留些码作扩展，要么加长指令字。';
    } else {
      const usedRange = used > 0 ? span(start, used, i) : '不用';
      title = `${name} ${used} 条：${usedRange}${later ? `，留 ${reserved} 个作扩展` : ''}`;
      if (pl.maxLevel === i) {
        const keep = available - used;
        why = later
          ? `要让${name}尽量多，只给后面几类留下刚好够用的前缀：后面一共要 ${keep} 个前缀，${available} − ${keep} = ${used}。`
          : `这是最后一类，可用的 ${available} 种编码全部给它，所以最多 ${used} 条。`;
      } else if (later) {
        why = `从小到大取 ${used} 个码，最大的 ${reserved} 个码留给后面几类作前缀；留下的码一个也不能给本级用，否则译码时分不清它是本级指令还是更长操作码的开头。`;
      } else {
        why = `最后一类，从小到大取 ${used} 个码${reserved > 0 ? `，还空着 ${reserved} 个` : '，正好用完'}。`;
      }
      if (failsNext) {
        why += ` 可是后面几类至少要 ${prefixesNeeded(params.levels, pl.opBits, i + 1)} 个前缀，只留得下 ${reserved} 个，方案不可行。`;
      }
    }
    const rowStep = step({
      level: 'explain',
      title,
      why,
      ref: '教材 p129–130，表 4.2',
      focus: [`levels.${i}`],
      ...(pl.maxLevel === i
        ? { ask: { prompt: `${name}指令最多能有几条`, kind: 'number' as const, answer: String(used), hint: '后面几类要的前缀先扣下来，其余都给这一类。' } }
        : {}),
      update: (d) => {
        const s = d.levels[i]!;
        s.used = used;
        s.reserved = reserved;
        s.range = used > 0 && !failsHere ? [text(start, i), text(start + used - 1, i)] : null;
        s.reservedRange = reserved > 0 && !failsHere ? [text(start + used, i), text(start + available - 1, i)] : null;
        if (failsHere || failsNext) d.feasible = false;
      },
    });
    rowSteps.push(rowStep);
    if (failsHere || failsNext) break;
  }
  if (pl.feasible) {
    step({
      level: 'explain',
      title: '方案可行',
      why: '每一类都放得下，留作扩展的码都只当前缀用，所有操作码互相不是对方的开头，译码不会混淆。',
      ref: '教材 p130',
      update: (d) => {
        d.feasible = true;
        d.current = null;
      },
    });
  }

  const result: Record<string, string> = { 可行: pl.feasible ? '是' : '否' };
  pl.used.forEach((u, i) => {
    const name = levelName(params.levels[i]!.addresses);
    if (pl.feasible || i < (pl.failAt ?? 0)) {
      result[`${name}指令`] = u > 0 ? `${u} 条，${span(pl.start[i]!, u, i)}` : '0 条';
    }
  });
  if (pl.maxLevel !== null && pl.feasible) result[`${levelName(params.levels[pl.maxLevel]!.addresses)}指令最多`] = `${pl.maxCount!} 条`;
  if (!pl.feasible) result['卡在'] = levelName(params.levels[pl.failAt!]!.addresses);
  return builder.finish(result, {
    columns: ['类别', '操作码位数', '可用编码数', '操作码编码范围', '条数', '留作扩展'],
    rows: pl.used.map((u, i) => {
      const start = pl.start[i]!;
      const ok = !(!pl.feasible && pl.failAt === i);
      return {
        cells: [
          `${levelName(params.levels[i]!.addresses)}`,
          String(pl.opBits[i]!),
          String(pl.available[i]!),
          ok && u > 0 ? span(start, u, i) : '—',
          ok ? String(u) : `要 ${params.levels[i]!.count!}，不够`,
          ok && pl.reserved[i]! > 0 && i + 1 < params.levels.length ? `${span(start + u, pl.reserved[i]!, i)}（${pl.reserved[i]!} 个）` : '—',
        ],
        step: rowSteps[i]!,
      };
    }),
  });
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

/** 随机出一道题：三类或四类，条数取在可行的范围里，有一半要求最后一类求最多。 */
export function generate(seed: number): OpcodeParams {
  const r = generator(seed);
  const pick = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const addressBits = pick(3, 5);
  const top = pick(2, 3);
  const wordBits = addressBits * top + pick(3, 5);
  const addresses = Array.from({ length: top + 1 }, (_, i) => top - i).filter((m, i) => i === 0 || m === 0 || r() < 0.8);
  const levels: Level[] = [];
  let reserved = 1;
  let prevOp = 0;
  for (let i = 0; i < addresses.length; i += 1) {
    const op = wordBits - addresses[i]! * addressBits;
    const available = reserved * 2 ** (op - prevOp);
    const last = i === addresses.length - 1;
    if (last && r() < 0.5) {
      levels.push({ addresses: addresses[i]! });
      break;
    }
    const count = last ? pick(1, available) : pick(1, Math.max(1, available - 1));
    levels.push({ addresses: addresses[i]!, count: Math.min(count, available) });
    reserved = available - Math.min(count, available);
    prevOp = op;
    if (reserved === 0) break;
  }
  return { wordBits, addressBits, levels };
}
