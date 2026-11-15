/**
 * 方框图语言（教材 5.2.7，p161–162，图 5.15）：一个方框一个 CPU 周期，框里写「源→目的」，
 * 菱形是译码，依附在取指方框上不占周期，「～」是公操作。框旁边写这个周期的控制信号：
 * 电位信号直接写，脉冲信号注明在哪一拍（图 5.30，p178；解析书 设2–4 的写法）。
 * 每个周期里的微操作和信号都取自 `src/engines/cpu` 的 flow()。
 */
import { TraceBuilder, type Ask, type Condition, type Trace } from '../trace';
import { format, flow, meaning, type Instruction, type SignalNames } from '../cpu/model';

export const FLOW_ENGINE = 'flow-diagram';
export const MAX_FLOW_INSTRUCTIONS = 7;

export interface FlowParams {
  /** 1–7 条模型机指令，各画一条从取指到「～」的分支。 */
  instructions: Instruction[];
  names?: SignalNames;
}

export interface Box {
  /** 第几条指令，0 起。 */
  ins: number;
  /** 这个方框是该指令的第几个 CPU 周期（1 起，对应 M1、M2、M3）。 */
  m: number;
  cycle: string;
  /** 框里的操作，「源→目的」。 */
  ops: string[];
  /** 电位信号。 */
  level: string[];
  /** 脉冲信号，带节拍，如 LDDR(T3)。 */
  pulse: string[];
}

export interface FlowState {
  boxes: Box[];
  /** 画到第几条指令。 */
  current: number | null;
  /** 已经画了译码菱形的指令。 */
  decoded: number[];
  /** 已经画到「～」的指令。 */
  ended: number[];
}

/** 方框里的写法：把「选寄存器」「ALU 做什么」这类拆开讲的小步并到传送里。 */
function boxOps(micros: { op: string; level: string }[]): string[] {
  return micros.filter((m) => m.op !== '译码' && !/^选 /.test(m.op) && !/^ALU /.test(m.op)).map((m) => m.op);
}

/** 画出几条指令的方框图并标信号。参数不合法时抛出错误。 */
export function runFlow(params: FlowParams): Trace<FlowParams, FlowState> {
  const n = params.instructions.length;
  if (n < 1 || n > MAX_FLOW_INSTRUCTIONS) throw new Error(`方框图要 1 到 ${MAX_FLOW_INSTRUCTIONS} 条指令`);
  const names = params.names ?? 'book';
  const plans = params.instructions.map((ins) => flow(ins, names));
  const conditions: Condition[] = [
    { label: '机器', value: '图 5.1 模型机' },
    { label: '指令', value: params.instructions.map((ins) => `${format(ins)}（${meaning(ins)}）`).join('；') },
    { label: '信号名', value: names === 'book' ? '教材' : '解析书' },
  ];
  const initial: FlowState = { boxes: [], current: null, decoded: [], ended: [] };
  const builder = new TraceBuilder<FlowParams, FlowState>(FLOW_ENGINE, params, initial, conditions);
  let count = 0;
  const step = (input: Parameters<typeof builder.step>[0]): string => {
    builder.step(input);
    count += 1;
    return `s${count}`;
  };
  const rows: { cells: string[]; step: string }[] = [];
  let askedPulse = false;
  let askedCount = false;

  plans.forEach((cycles, i) => {
    const ins = params.instructions[i]!;
    cycles.forEach((c, k) => {
      const level = [...new Set(c.micros.flatMap((m) => m.hold))];
      const pulse = c.micros.flatMap((m) => m.pulse.map((p) => `${p}(${m.beat})`));
      const ops = boxOps(c.micros);
      const firstPulse = c.micros.find((m) => m.pulse.length > 0);
      let ask: Ask | null = null;
      if (k > 0 && firstPulse && !askedPulse) {
        askedPulse = true;
        ask = {
          prompt: `这个方框里的 ${firstPulse.pulse[0]!} 在哪一拍发`,
          kind: 'choice',
          options: ['T1', 'T2', 'T3', 'T4', '整个周期'],
          answer: firstPulse.beat,
          hint: '打入要等数据在总线上稳定：进 DR、IR 和写数存在 T3，进 AR、PC、通用寄存器在 T4（图 5.30）。',
        };
      }
      const id = step({
        level: 'cycle',
        title: `${format(ins)}，第 ${k + 1} 个方框（${c.cycle}）：${ops.join('；')}`,
        why: `${k === 0 ? '每条指令都从取指方框开始，取指走 IBUS，不占 DBUS。' : `${c.cycle}周期占一个方框。`}电位信号 ${level.join('、') || '无'} 整个周期有效，直接写在框旁；${pulse.length ? `${pulse.join('、')} 是打入或写入的时刻，要注明节拍` : '这个周期没有脉冲信号'}。`,
        ref: k === 0 ? '教材 p154–155，p162 图 5.15' : '教材 p161–162，p178 图 5.30',
        ...(ask ? { ask } : {}),
        update: (d) => {
          d.current = i;
          d.boxes.push({ ins: i, m: k + 1, cycle: c.cycle, ops, level, pulse });
        },
      });
      rows.push({ cells: [format(ins), `${c.cycle}（M${k + 1}）`, ops.join('；'), level.join('，') || '—', pulse.join('，') || '—'], step: id });
      if (k === 0) {
        step({
          level: 'explain',
          title: '译码（菱形）',
          why: '菱形表示按操作码分支，它在时间上依附于取指方框所在的 CPU 周期，不另占周期（p161）。',
          ref: '教材 p161',
          update: (d) => {
            d.decoded.push(i);
          },
        });
      }
    });
    const ask: Ask | null = !askedCount ? { prompt: `${format(ins)} 一共画几个方框`, kind: 'number', answer: String(cycles.length), hint: 'DBUS 一次只能送一个数，地址和数据要分在两个方框里。' } : null;
    askedCount = true;
    step({
      level: 'explain',
      title: `${format(ins)} 结束：～`,
      why: `这条指令共 ${cycles.length} 个方框，占 ${cycles.length} 个 CPU 周期。末尾的「～」是公操作：处理外设请求，没有请求就去取下一条指令（p161）。`,
      ref: '教材 p161–162',
      ...(ask ? { ask } : {}),
      update: (d) => {
        d.ended.push(i);
      },
    });
  });

  const result: Record<string, string> = {};
  plans.forEach((cycles, i) => {
    result[`${format(params.instructions[i]!)} 方框数`] = String(cycles.length);
  });
  return builder.finish(result, { columns: ['指令', 'CPU 周期', '方框里的操作', '电位信号', '脉冲信号'], rows });
}

/** 本站的样例：五条指令各一条，用自己的寄存器和地址。 */
export function sampleFlow(): FlowParams {
  return {
    instructions: [
      { op: 'MOV', rx: 'R2', ry: 'R3' },
      { op: 'LAD', rx: 'R0', addr: 9 },
      { op: 'ADD', rx: 'R0', ry: 'R1' },
      { op: 'STO', rx: 'R1', ry: 'R3' },
      { op: 'JMP', addr: 37 },
    ],
  };
}
