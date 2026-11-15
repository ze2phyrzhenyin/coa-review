/**
 * 练习：按题号出一条随机的运算微指令，放在 OP 对应的微地址上，前面是图 5.25 的取指微指令。
 * 页面只挑参数；微指令合不合法、每一步的状态、下一微地址都由引擎 run 算出，题目的答案取自 Trace 的状态。
 */
import { BOOK_STORE, COMMANDS, FETCH_ADDRESS, WORD_BITS, fields, generate, generateFields, runFields } from '../../engines/micro/model';
import type { FieldParams, MicroParams, MicroState, StoreWord } from '../../engines/micro/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import type { Breakage } from '../../player/Player';
import { MUX, inputWire, microWrong, positionOf } from './scene';

/** 种子随机数（mulberry32），只用来挑参数。 */
function random(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bin4 = (n: number): string => n.toString(2).padStart(4, '0');

export function practiceParams(seed: number): MicroParams {
  const { a, b } = generate(seed);
  const r = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const opNum = 1 + Math.floor(r() * 15);
  const op = bin4(opNum);
  const x = pick(['R1', 'R2', 'DR'] as const);
  const fn = pick(['+', '+', '−', 'M'] as const);
  const y = fn === 'M' ? null : pick(['R1', 'R2', 'R3'] as const);
  const load = pick(['R1', 'R2', 'R3'] as const);
  const p2 = fn === '+' && r() < 0.7;
  let next = 0;
  for (let k = 0; k < 64; k++) {
    next = Math.floor(r() * 16);
    if (p2) next &= 0b1110;
    if (next !== opNum && !(p2 && (next | 1) === opNum)) break;
  }
  const bits = Array.from({ length: WORD_BITS }, () => '0');
  for (const name of [`${x}→X`, y ? `${y}→Y` : '', fn, `LD${load}′`]) if (name) bits[COMMANDS.indexOf(name)] = '1';
  if (p2) bits[18] = '1';
  const word = bits.slice(0, 19).join('') + bin4(next);
  const store: StoreWord[] = [{ ...BOOK_STORE[0]!, note: '' }, { addr: op, word, note: '' }];
  // 下一条（P_2 时两支）放一条什么也不做、回到取指的微指令。
  for (const target of new Set([next, p2 ? next | 1 : next])) {
    const addr = bin4(target);
    if (addr !== FETCH_ADDRESS && !store.some((w) => w.addr === addr)) store.push({ addr, word: '0'.repeat(WORD_BITS), note: '' });
  }
  return { a, b, op, store, r1: 1 + Math.floor(r() * 9), dr: Math.floor(r() * 16) };
}

/**
 * 在引擎的 Trace 上加两道点选题：哪个寄存器经 X 端进 ALU、T4 打入哪个寄存器。
 * 答案取自引擎这一步的状态（alu.x、loaded），题面不含答案。
 */
export function withAsks(trace: Trace<MicroParams, MicroState>): Trace<MicroParams, MicroState> {
  const steps = trace.steps.map((step): Step<MicroState> => {
    if (step.ask) return step;
    const s = step.state;
    const changed = (path: string) => step.changes.some((change) => change.at === path || change.at.startsWith(`${path}.`));
    if (s.cycle === 2 && changed('alu.out') && s.alu.x) {
      const where = s.cm.find((row) => row.addr === s.uAR)?.addr ?? s.uAR;
      return {
        ...step,
        ask: {
          prompt: `μIR 里是 ${where} 号微指令。T1 到 T3，哪个寄存器的数经 X 端进 ALU`,
          kind: 'choice',
          options: ['R1', 'R2', 'DR'],
          answer: s.alu.x,
          hint: `看第 ${positionOf('R1→X')}、${positionOf('R2→X')}、${positionOf('DR→X')} 位：R1→X、R2→X、DR→X 哪一位是 1。`,
        },
      };
    }
    if (s.cycle === 2 && changed('loaded') && s.loaded.length === 1) {
      return {
        ...step,
        ask: {
          prompt: 'T4 到了，ALU 的结果打入哪个寄存器',
          kind: 'choice',
          options: ['R1', 'R2', 'R3'],
          answer: s.loaded[0]!,
          hint: `看第 ${positionOf('LDR1′')}–${positionOf('LDR3′')} 位：LDR1′、LDR2′、LDR3′ 哪一位是 1。`,
        },
      };
    }
    return step;
  });
  return { ...trace, steps };
}

const bin = (v: number): string => v.toString(2).padStart(4, '0');

/** 点错寄存器时演后果：学生选的那道门打开，数从他选的寄存器走过去；指出他选的那一位其实是 0。 */
export function practiceWrong(ask: Ask, value: string, state: MicroState, next: Step<MicroState> | null): Breakage | null {
  const bits = microWrong(ask, value, state, next);
  if (bits) return bits;
  if (ask.kind !== 'choice' || !next || value === ask.answer) return null;
  const s = next.state;
  if (ask.options?.includes('DR')) {
    const reg = value as 'R1' | 'R2' | 'DR';
    return {
      label: '',
      patch: { [MUX.X.id]: { selected: reg } },
      moves: [{ value: bin(s.reg[reg]), from: reg, to: 'ALU', via: [inputWire(reg, 'X'), `${MUX.X.id}-alu`] }],
      message: `第 ${positionOf(`${reg}→X`)} 位 ${reg}→X 在这条微指令里是 0，X 端的开关不会接到 ${reg}，${reg} 的数进不了 ALU。`,
    };
  }
  const reg = value as 'R1' | 'R2' | 'R3';
  if (s.alu.out === null) return null;
  return {
    label: '',
    patch: { [reg]: { value: `${bin(s.alu.out)}（${s.alu.out}）` } },
    moves: [
      { value: bin(s.alu.out), from: 'ALU', to: reg, via: ['alu-bus', `bus-${reg}`] },
      { value: `LD${reg}`, from: 'uC1', to: reg, arc: true, shape: 'pulse' },
    ],
    message: `第 ${positionOf(`LD${reg}′`)} 位 LD${reg}′ 是 0，T4 不会给 ${reg} 打入脉冲，${reg} 保持原值。`,
  };
}

/** 答题纸：字段位数和控存。题目参数由引擎出（generateFields），答案取自引擎的表和 fields()。 */
export function fieldsExercise(seed: number) {
  const params: FieldParams = generateFields(seed);
  const trace = runFields(params);
  const f = fields(params);
  return { params, trace, words: f.words };
}
