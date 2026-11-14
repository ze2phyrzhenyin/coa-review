/**
 * 数据相关判别：对每一对指令（i 在 j 之前进入流水线）列出读集合、写集合，
 * 后读∩前写 → RAW，后写∩前读 → WAR，后写∩前写 → WAW（教材 5.6.3，p190–192，例 5.6）。
 * 再看在五段按序流水线（表 5.4）里哪一对真会读错。
 */
import { TraceBuilder, type Ask, type Trace } from '../trace';
import { generator, parseInstruction, registersOf, type InstructionInput, type PipeInstruction } from './instr';

export const HAZARD_ENGINE = 'pipeline-hazard';
export const MAX_HAZARD_INSTRUCTIONS = 6;

export type Kind = 'RAW' | 'WAR' | 'WAW';
export const KINDS: readonly Kind[] = ['RAW', 'WAR', 'WAW'];

export interface HazardParams {
  /** 2–6 条指令，按进入流水线的先后。 */
  instructions: InstructionInput[];
}

export interface PairState {
  /** 前一条、后一条的编号，从 1 起。 */
  i: number;
  j: number;
  raw: string[];
  war: string[];
  waw: string[];
  /** 在五段按序流水线里不做处理会不会读错。 */
  wrong: boolean;
}

export interface HazardState {
  instructions: { text: string; meaning: string; reads: string[] | null; writes: string[] | null }[];
  pairs: PairState[];
  /** 当前在看的一对，0 起的下标；没有是 null。 */
  current: number | null;
}

export interface PairResult {
  i: number;
  j: number;
  raw: string[];
  war: string[];
  waw: string[];
  kinds: Kind[];
  /** 五段按序流水线、不做处理时，后一条会不会读到旧值。 */
  wrong: boolean;
  /** 读错的寄存器：RAW 里的寄存器，且中间没有别的指令再写它。 */
  wrongRegs: string[];
}

/** 相关类型的写法：没有写「无」，几种并存用顿号连。 */
export function kindsText(kinds: Kind[]): string {
  return kinds.length ? kinds.join('、') : '无';
}

/** 五段流水线（IF ID EX MEM WB）里 i 在第 i+4 个周期写回，j 在第 j+1 个周期读寄存器。按教材的口径，写回之后的下一个周期才读得到。 */
export function readsTooEarly(i: number, j: number): boolean {
  return j + 1 <= i + 4;
}

/** 只算两条指令之间的相关。 */
export function classifyPair(a: PipeInstruction, b: PipeInstruction): { raw: string[]; war: string[]; waw: string[]; kinds: Kind[] } {
  const raw = b.reads.filter((x) => a.writes.includes(x));
  const war = b.writes.filter((x) => a.reads.includes(x));
  const waw = b.writes.filter((x) => a.writes.includes(x));
  const kinds: Kind[] = [];
  if (raw.length) kinds.push('RAW');
  if (war.length) kinds.push('WAR');
  if (waw.length) kinds.push('WAW');
  return { raw, war, waw, kinds };
}

/** 所有指令对的结果，不出 Trace。 */
export function hazards(params: HazardParams): PairResult[] {
  const list = checkedInstructions(params);
  const out: PairResult[] = [];
  for (let j = 1; j < list.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const c = classifyPair(list[i]!, list[j]!);
      const between = list.slice(i + 1, j);
      const regRaw = registersOf(c.raw).filter((x) => !between.some((m) => m.writes.includes(x)));
      const wrongRegs = readsTooEarly(i + 1, j + 1) ? regRaw : [];
      out.push({ i: i + 1, j: j + 1, ...c, wrong: wrongRegs.length > 0, wrongRegs });
    }
  }
  return out;
}

function checkedInstructions(params: HazardParams): PipeInstruction[] {
  const n = params.instructions.length;
  if (n < 2 || n > MAX_HAZARD_INSTRUCTIONS) throw new Error(`相关判别要 2 到 ${MAX_HAZARD_INSTRUCTIONS} 条指令`);
  return params.instructions.map(parseInstruction);
}

const set = (xs: string[]): string => (xs.length ? `{${xs.join(', ')}}` : '∅');

/** 逐对判断相关类型。参数不合法时抛出错误。 */
export function runHazard(params: HazardParams): Trace<HazardParams, HazardState> {
  const list = checkedInstructions(params);
  const results = hazards(params);
  const initial: HazardState = {
    instructions: list.map((x) => ({ text: x.text, meaning: x.meaning, reads: null, writes: null })),
    pairs: [],
    current: null,
  };
  const conditions = [
    { label: '指令', value: list.map((x, i) => `I${i + 1} ${x.text}（${x.meaning}）`).join('；') },
    { label: '写法', value: '按教材 5.6 节：目标写在最前，两地址指令的结果回到第一个寄存器' },
    { label: '先后', value: '编号小的先进入流水线' },
  ];
  const b = new TraceBuilder<HazardParams, HazardState>(HAZARD_ENGINE, params, initial, conditions);

  list.forEach((x, idx) => {
    b.step({
      level: 'instruction',
      title: `I${idx + 1} ${x.text}：读 ${set(x.reads)}，写 ${set(x.writes)}`,
      why: `${x.meaning}。箭头左边的是要读的，箭头右边的是要写的。`,
      ref: '教材 p190–191',
      focus: [`instructions.${idx}`],
      update: (d) => {
        d.instructions[idx]!.reads = [...x.reads];
        d.instructions[idx]!.writes = [...x.writes];
      },
    });
  });

  let asked = 0;
  results.forEach((r, idx) => {
    const text = kindsText(r.kinds);
    const pieces: string[] = [];
    pieces.push(`后读∩前写 = ${set(r.raw)}`);
    pieces.push(`后写∩前读 = ${set(r.war)}`);
    pieces.push(`后写∩前写 = ${set(r.waw)}`);
    const meaningParts: string[] = [];
    if (r.raw.length) meaningParts.push(`I${r.j} 要读 I${r.i} 写的 ${r.raw.join('、')}，若先读了就拿到旧值，是写后读`);
    if (r.war.length) meaningParts.push(`I${r.j} 要写 I${r.i} 还要读的 ${r.war.join('、')}，若先写了 I${r.i} 就读到新值，是读后写`);
    if (r.waw.length) meaningParts.push(`两条都写 ${r.waw.join('、')}，若 I${r.j} 先写完，最后留下的是 I${r.i} 的结果，是写后写`);
    const why = meaningParts.length ? `${meaningParts.join('；')}。` : '三个交集都是空的，这两条指令互不影响。';
    let ask: Ask | undefined;
    if (r.j - r.i === 1 && asked < 3) {
      asked += 1;
      const options = ['无', 'RAW', 'WAR', 'WAW'];
      if (!options.includes(text)) options.push(text);
      ask = { prompt: `I${r.i} 和 I${r.j} 之间是哪种数据相关`, kind: 'choice', options, answer: text, hint: '先写出两条指令各自读哪些、写哪些，再看三组交集。' };
    }
    b.step({
      level: 'explain',
      title: `I${r.i} 与 I${r.j}：${text}`,
      why: `${pieces.join('，')}。${why}`,
      ref: '教材 p190–192，例 5.6',
      focus: [`instructions.${r.i - 1}`, `instructions.${r.j - 1}`, `pairs.${idx}`],
      ...(ask ? { ask } : {}),
      update: (d) => {
        d.pairs.push({ i: r.i, j: r.j, raw: r.raw, war: r.war, waw: r.waw, wrong: r.wrong });
        d.current = idx;
      },
    });
  });

  const wrong = results.filter((r) => r.wrong);
  b.step({
    level: 'explain',
    title: wrong.length ? `五段流水线里会读错：${wrong.map((r) => `I${r.j} 读 ${r.wrongRegs.join('、')}`).join('；')}` : '五段按序流水线里不会读错',
    why:
      '按表 5.4 的五段流水线，第 i 条在第 i+4 个周期写回寄存器，第 j 条在第 j+1 个周期读寄存器；写回的下一个周期才读得到新值，所以只有相隔不到 4 条、中间没有别的指令再写的寄存器 RAW 会读错。按序流水线里读总在前一条写之前、写也按顺序，WAR 和 WAW 不会出错，它们在超标量、乱序执行时才要处理。',
    ref: '教材 p190–192，表 5.4，例 5.7',
    focus: wrong.map((r) => `pairs.${results.indexOf(r)}`),
    update: (d) => {
      d.current = null;
    },
  });

  const result: Record<string, string> = {};
  for (const r of results) result[`I${r.i}–I${r.j}`] = kindsText(r.kinds);
  result['会读错'] = wrong.length ? wrong.map((r) => `I${r.i}–I${r.j}`).join('、') : '无';
  const pairStep = (idx: number): string => `s${list.length + idx + 1}`;
  return b.finish(result, {
    columns: ['指令对', '后读∩前写（RAW）', '后写∩前读（WAR）', '后写∩前写（WAW）', '相关'],
    rows: results.map((r, idx) => ({
      cells: [`I${r.i}–I${r.j}`, set(r.raw), set(r.war), set(r.waw), kindsText(r.kinds)],
      step: pairStep(idx),
    })),
  });
}

const OPS3 = ['ADD', 'SUB', 'MUL', 'AND', 'OR'] as const;

/** 随机出一组指令，寄存器从少数几个里挑，好让相关出现。 */
export function generateHazard(seed: number): HazardParams {
  const r = generator(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const regs = ['R1', 'R2', 'R3', 'R4', 'R5'];
  const n = 2 + Math.floor(r() * 3);
  const instructions: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const roll = r();
    if (roll < 0.15) instructions.push(`LAD ${pick(regs)},M(${pick(['x', 'y'])})`);
    else if (roll < 0.25) instructions.push(`STO M(${pick(['x', 'y'])}),${pick(regs)}`);
    else instructions.push(`${pick(OPS3)} ${pick(regs)},${pick(regs)},${pick(regs)}`);
  }
  return { instructions };
}
