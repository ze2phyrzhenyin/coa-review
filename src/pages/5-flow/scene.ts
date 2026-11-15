/**
 * 方框图和模型机放在同一张台面上：上面一排是当前这条指令的方框图（方框、译码菱形、「～」），
 * 每个方框写着框里的操作、电位信号、带节拍的脉冲信号；下面是 5-cycle 页的图 5.1 模型机。
 * 画一个方框，模型机就把这个 CPU 周期走一遍：门落下、值沿总线走、脉冲打入。
 * 方框的内容取自 src/engines/hardwired/flow.ts 的 Trace，模型机的状态取自 src/engines/cpu 的 Trace（按 CPU 周期并步）。
 */
import { flatten } from '../../engines/trace';
import type { Step, Trace } from '../../engines/trace';
import { run as runCpu, sampleParams } from '../../engines/cpu/model';
import type { Instruction, Params as CpuParams, SignalNames, State as CpuState } from '../../engines/cpu/model';
import type { FlowParams, FlowState } from '../../engines/hardwired/flow';
import { coarseMoves, coarsen } from '../../player/coarsen';
import type { Binding, BindContext, Move, Patch, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import { machineBind, machineBreak, machineCaption, machineMoves, machineScene } from '../5-cycle/machine';

export const START = 32;
/** 方框图横着排在模型机上方一排：取指方框、译码菱形和分出的各支、执行方框、「～」，连线带箭头（图 5.15 的画法转成横排）。 */
const FLOW_Z0 = -12.0;
const BOX_W = 6.3;
const BOX_X = [-9.3, 0.5, 7.5];
const DIAMOND_X = -5.15;
const TAG_X = -3.8;
const END_X = 11.8;
export const BEATS = ['T1', 'T2', 'T3', 'T4', '整个周期'];

/** 让模型机按顺序执行这几条指令：从 32 号单元放起；JMP 的目标改成下一条，方框图和模型机一一对上。 */
export function cpuParams(instructions: Instruction[], names: SignalNames): CpuParams {
  const base = sampleParams(names);
  const program = instructions.map((ins, i) => ({ addr: START + i, ins: ins.op === 'JMP' ? { ...ins, addr: START + i + 1 } : ins }));
  return { ...base, program, limit: instructions.length, names };
}

export interface Linked {
  flow: Trace<FlowParams, FlowState>;
  cpu: Trace<CpuParams, CpuState>;
  /** 第 k 个方框（0 起）对应的那个 CPU 周期（并步后的一步）。 */
  cycles: Step<CpuState>[];
  cycleMoves: (step: Step<CpuState>) => Move[];
  /** 每条指令有几个方框。 */
  counts: number[];
  maxOps: number[];
}

/** 「哪一拍」那道题出在方框画出来之前：题面写清问的是接下来要画的哪个方框。 */
function withClearAsk(flow: Trace<FlowParams, FlowState>): Trace<FlowParams, FlowState> {
  return {
    ...flow,
    steps: flow.steps.map((step) => {
      if (step.ask?.kind !== 'choice') return step;
      const box = step.state.boxes[step.state.boxes.length - 1]!;
      const signal = /(\S+) 在哪一拍发/.exec(step.ask.prompt)?.[1] ?? '';
      return { ...step, ask: { ...step.ask, prompt: `接下来画${box.cycle}方框（${box.ops.join('；')}）。打入用的 ${signal} 在哪一拍发` } };
    }),
  };
}

export function link(raw: Trace<FlowParams, FlowState>): Linked {
  const flow = withClearAsk(raw);
  const cpu = runCpu(cpuParams(flow.params.instructions, flow.params.names ?? 'book'));
  const coarse = coarsen(cpu, 'cycle');
  const cycles = coarse.trace.steps.filter((s) => s.level === 'cycle');
  const final = flow.steps[flow.steps.length - 1]!.state;
  const counts = flow.params.instructions.map((_, i) => final.boxes.filter((b) => b.ins === i).length);
  const maxOps = [0, 1, 2].map((m) => Math.max(1, ...final.boxes.filter((b) => b.m === m + 1).map((b) => b.ops.length)));
  return { flow, cpu, cycles, cycleMoves: coarseMoves(coarse.members, machineMoves), counts, maxOps };
}

/** 这一步之后模型机处在哪个状态：画到第几个方框，就是第几个 CPU 周期结束时。 */
function cpuAt(L: Linked, s: FlowState): { state: CpuState; step: Step<CpuState> | null } {
  const k = s.boxes.length;
  if (k === 0) return { state: L.cpu.initial, step: null };
  const step = L.cycles[k - 1]!;
  return { state: step.state, step };
}

/** 一个方框三行：框里的操作（几条并排写，分号隔开，同图 5.15）、电位信号、脉冲信号。 */
const boxRows = (ops: string[], level: string[], pulse: string[]): string[][] => [[ops.map((op) => op.split('，')[0]!).join('；').replace(/IR\(地址码\)/g, 'IR')], [level.join('，')], [pulse.join('，')]];

export function flowScene(L: Linked): SceneSpec {
  const machine = machineScene(L.cpu);
  // 指存里的程序越长，指存那块越高：方框图那一排跟着往后让。
  const FLOW_Z = FLOW_Z0 - 0.5 * (L.flow.params.instructions.length - 1);
  const asks = L.flow.steps.some((s) => s.ask?.kind === 'choice');
  const ins = L.flow.params.instructions;
  const tagStep = Math.min(0.62, 2.5 / Math.max(1, ins.length - 1));
  const parts: PartSpec[] = [
    ...machine.parts,
    ...[0, 1, 2].map(
      (m): PartSpec => ({
        id: `BOX_${m}`,
        kind: 'memory',
        position: [BOX_X[m]!, FLOW_Z],
        title: `第 ${m + 1} 个方框`,
        props: {
          name: `方框 ${m + 1}`,
          columns: [{ title: m === 0 ? '取指' : '执行', width: BOX_W - 1.0 }],
          rows: boxRows([], [], []),
          labels: ['操作', '电位', '脉冲'],
        },
        pick: true,
      }),
    ),
    { id: 'DIAMOND', kind: '5-flow:diamond', position: [DIAMOND_X, FLOW_Z - 1.0], title: '译码菱形', props: { text: '译码', drawn: false }, describe: (p) => (p.drawn ? '译码菱形：按操作码分支，不占 CPU 周期' : '译码菱形（还没画）') },
    // 从菱形分出的各支：一条指令一块牌，正在画的那一支亮着。
    ...ins.map((x, i): PartSpec => ({ id: `TAG_${i}`, kind: 'label', position: [TAG_X, FLOW_Z - 0.1 - (ins.length - 1 - i) * tagStep], title: `${x.op} 这一支`, props: { text: x.op, size: 0.31, plate: true, mono: true } })),
    { id: 'END', kind: 'label', position: [END_X, FLOW_Z - 1.0], title: '公操作', props: { text: '～', size: 0.56, plate: true, hidden: true } },
    { id: 'A0', kind: 'signal', position: [0, 0], props: { from: 'BOX_0.e', to: 'DIAMOND.w', text: '', ink: 'ctrl' } },
    { id: 'A1', kind: 'signal', position: [0, 0], props: { from: 'DIAMOND.e', to: 'BOX_1.w', text: '', ink: 'ctrl' } },
    { id: 'A2', kind: 'signal', position: [0, 0], props: { from: 'BOX_1.e', to: 'BOX_2.w', text: '', ink: 'ctrl' } },
    { id: 'A3', kind: 'signal', position: [0, 0], props: { from: 'BOX_2.e', to: 'END.w', text: '', ink: 'ctrl' } },
    { id: 'A4', kind: 'signal', position: [0, 0], props: { from: 'BOX_1.e', to: 'END.w', text: '', ink: 'ctrl' } },
    ...(asks ? BEATS.map((b, i): PartSpec => ({ id: `CHIP_${i}`, kind: 'label', position: [BOX_X[1]! - 2.6 + i * 1.25 + (i === 4 ? 0.45 : 0), FLOW_Z + 1.0], title: b, props: { text: b, size: 0.38, plate: true, mono: i < 4, hidden: true }, pick: true })) : []),
  ];
  return { parts, wires: machine.wires, kinds: () => import('./parts') };
}

const forIns = (s: FlowState): FlowState['boxes'] => (s.current === null ? [] : s.boxes.filter((b) => b.ins === s.current));

/** 方框图这一部分的属性：当前指令的方框依次画出来，没用到的槽藏起来。 */
function flowProps(L: Linked, s: FlowState, changed: ReadonlySet<string>, index: number): Record<string, Patch> {
  const out: Record<string, Patch> = {};
  const mine = forIns(s);
  const count = L.counts[s.current ?? 0]!;
  const lastBox = s.boxes.length - 1;
  [0, 1, 2].forEach((m) => {
    const box = mine[m];
    const fresh = box !== undefined && changed.has(`boxes.${lastBox}.cycle`) && s.boxes[lastBox] === box;
    out[`BOX_${m}`] = {
      hidden: m >= count,
      columns: [{ title: box ? `${box.cycle}（M${box.m}）` : m === 0 ? '取指' : '执行', width: BOX_W - 1.0 }],
      rows: box ? boxRows(box.ops, box.level, box.pulse) : boxRows([], [], []),
      active: fresh ? 0 : -1,
      changedCells: fresh ? ['1.0', '2.0'] : [],
      focus: fresh,
    };
  });
  const cur = s.current ?? 0;
  const decoded = s.current !== null && s.decoded.includes(s.current);
  const ended = s.current !== null && s.ended.includes(s.current);
  out.DIAMOND = { drawn: decoded || s.decoded.length > 0, changed: [...changed].some((x) => x.startsWith('decoded')) };
  L.flow.params.instructions.forEach((_, i) => {
    out[`TAG_${i}`] = { focus: i === cur && decoded, changed: i === cur && [...changed].some((x) => x.startsWith('decoded')), tone: s.ended.includes(i) || (i === cur && decoded) ? 'text' : 'muted' };
  });
  out.END = { hidden: !ended, changed: [...changed].some((x) => x.startsWith('ended')) };
  out.A0 = { on: decoded };
  out.A1 = { on: mine.length >= 2 };
  out.A2 = { on: mine.length >= 3, hidden: count < 3 };
  out.A3 = { on: ended, hidden: count < 3 };
  out.A4 = { on: ended, hidden: count >= 3 };
  const ask = L.flow.steps[index]?.ask;
  BEATS.forEach((_, i) => (out[`CHIP_${i}`] = { hidden: !(ask && ask.kind === 'choice') }));
  return out;
}

const formatIns = (ins: Instruction): string => {
  switch (ins.op) {
    case 'LAD':
      return `LAD ${ins.rx},${ins.addr}`;
    case 'JMP':
      return `JMP ${ins.addr}`;
    case 'STO':
      return `STO ${ins.rx},(${ins.ry})`;
    default:
      return `${ins.op} ${ins.rx},${ins.ry}`;
  }
};

/** 方框图的状态 → 方框图的部件属性 + 模型机的部件属性。 */
export function flowBind(L: Linked): Binding<FlowState> {
  const machine = machineBind(L.cpu);
  return {
    props(c: BindContext<FlowState>) {
      const { state, step } = cpuAt(L, c.state);
      const boxStep = c.step?.level === 'cycle';
      const cpuChanged = new Set(boxStep && step ? step.changes.map((x) => x.at) : []);
      const m = machine.props({ state, flat: flatten(state), index: c.index, step: boxStep ? step : null, changed: cpuChanged });
      // 方框画出来时，这一拍变了的模型机部件也标强调色。
      if (boxStep && step) for (const path of cpuChanged) for (const id of machine.partsFor(path)) m[id] = { ...m[id], changed: true };
      return { ...m, ...flowProps(L, c.state, c.changed, c.index) };
    },
    partsFor(path: string) {
      if (path.startsWith('boxes')) return [];
      if (path.startsWith('decoded')) return ['DIAMOND'];
      if (path.startsWith('ended')) return ['END'];
      return [];
    },
  };
}

/** 画方框的那一步：模型机把这个 CPU 周期走一遍。 */
export function flowMoves(L: Linked) {
  return (step: Step<FlowState>): Move[] => {
    if (step.level !== 'cycle') return [];
    const k = step.state.boxes.length - 1;
    const cycle = L.cycles[k];
    return cycle ? L.cycleMoves(cycle) : [];
  };
}

/** 画方框的那一步看方框和模型机里动的部件；译码、「～」只看方框图。 */
export function flowFrame(L: Linked, narrow: boolean) {
  const moves = flowMoves(L);
  return (step: Step<FlowState>): string[] | null => {
    if (step.level === 'cycle') {
      // 宽屏整张台面都在画面里，不用指定。手机上装不下：停在模型机里收值的部件上，方框的内容在步骤文字里。
      if (!narrow) return null;
      const planned = moves(step);
      const last = Math.max(0, ...planned.map((m) => m.phase ?? 0));
      const targets = [...new Set(planned.filter((m) => (m.phase ?? 0) === last && (m.shape ?? 'card') === 'card').map((m) => m.to.split('.')[0]!))];
      return targets.length ? targets : null;
    }
    if (step.changes.some((x) => x.at.startsWith('decoded'))) return narrow ? ['DIAMOND', ...L.flow.params.instructions.map((_, i) => `TAG_${i}`)] : null;
    if (step.changes.some((x) => x.at.startsWith('ended'))) return narrow ? ['END'] : null;
    return null;
  };
}

export function flowCaption(L: Linked) {
  return (s: FlowState): string => machineCaption(cpuAt(L, s).state);
}

export const flowAskFrame = () => (): string[] => BEATS.map((_, i) => `CHIP_${i}`);

export function flowNames(path: string): string {
  const m = /^boxes\.(\d+)\.(\w+)(?:\.(\d+))?$/.exec(path);
  const words: Record<string, string> = { ins: '指令', m: '周期号', cycle: 'CPU 周期', ops: '操作', level: '电位信号', pulse: '脉冲信号' };
  if (m) return `第 ${Number(m[1]) + 1} 个方框的${words[m[2] ?? ''] ?? m[2]}`;
  if (path === 'current') return '正在画的指令';
  if (path.startsWith('decoded')) return '译码菱形';
  if (path.startsWith('ended')) return '公操作「～」';
  return path;
}

export function flowValues(L: Linked) {
  return (path: string, value: string): string => {
    if (path === 'current' || /^(decoded|ended)\.\d+$/.test(path) || /^boxes\.\d+\.ins$/.test(path)) {
      const ins = L.flow.params.instructions[Number(value)];
      return ins ? formatIns(ins) : value;
    }
    if (/^boxes\.\d+\.m$/.test(path)) return `M${value}`;
    return value;
  };
}


/**
 * 点方框：把模型机拨回这个方框那个 CPU 周期，再走一遍。弄坏它：三个方框的指令，把执行一、执行二并成一个方框，
 * 两个数同时上 DBUS；两个方框的指令，用 5-cycle 的演法（DBUS 有数时再开一道门）。
 */
export function flowBreak(L: Linked) {
  const machine = machineBind(L.cpu);
  return (s: FlowState, part: string | null): Breakage | null => {
    const mine = forIns(s);
    if (part?.startsWith('BOX_')) {
      const m = Number(part.slice(4));
      const box = mine[m];
      if (!box) return null;
      const k = s.boxes.indexOf(box);
      const step = L.cycles[k];
      if (!step) return null;
      const props = machine.props({ state: step.state, flat: flatten(step.state), index: 0, step, changed: new Set(step.changes.map((x) => x.at)) });
      return {
        label: '',
        patch: { ...props, [part]: { focus: true, active: 0 } },
        moves: L.cycleMoves(step),
        message: `${box.cycle}周期（M${box.m}）：${box.ops.join('；')}。电位信号 ${box.level.join('、') || '无'} 整个周期有效；${box.pulse.length ? `${box.pulse.join('、')} 在注明的那一拍打入` : '这个周期没有打入'}。`,
      };
    }
    if (part !== null) return null;
    if (s.current === null || !s.ended.includes(s.current)) return null;
    const count = L.counts[s.current]!;
    if (count === 3) {
      const first = s.boxes.findIndex((b) => b.ins === s.current && b.m === 2);
      const a = L.cycles[first]?.state.bus.DBUS;
      const b = L.cycles[first + 1]?.state.bus.DBUS;
      if (!a?.driver || !b?.driver) return null;
      const from = (d: string) => (d === 'IR' || d === 'ALU' || d === 'DMEM' ? d : 'C2');
      return {
        label: '弄坏它：把两个执行方框并成一个',
        patch: { DBUS: { drivers: [a.driver, b.driver], value: String(b.value) }, BOX_2: { hidden: true } },
        moves: [
          { value: String(a.value), from: from(a.driver), to: 'DBUS', arc: true },
          { value: String(b.value), from: from(b.driver), to: 'DBUS', arc: true },
        ],
        message: `并成一个方框就是一个 CPU 周期。${a.value} 和 ${b.value} 要在同一个周期里上 DBUS，两个来源同时驱动总线，总线上的值是乱的，打入 AR、DR 的都不对。方框数必须等于 DBUS 要送数的次数。`,
      };
    }
    const k = s.boxes.length - 1;
    const step = L.cycles[k];
    return step ? machineBreak(step.state, null) : null;
  };
}

/** 答错「几个方框」或「哪一拍」时演后果：脉冲真的在学生选的那一拍飞过去，或者两个数一起上 DBUS。 */
export function flowWrong(L: Linked) {
  const fromOf = (d: string) => (d === 'IR' || d === 'ALU' || d === 'DMEM' ? d : 'C2');
  return (ask: { kind: string; answer: string; prompt: string }, value: string, s: FlowState, next: Step<FlowState> | null): Breakage | null => {
    if (ask.kind === 'choice') {
      const signal = /打入用的 (\S+) 在/.exec(ask.prompt)?.[1] ?? '';
      const target = /^LD(\w+)$/.exec(signal)?.[1] ?? /^S(\w+)$/.exec(signal)?.[1] ?? '';
      const k = next ? next.state.boxes.length - 1 : -1;
      const after = L.cycles[k]?.state;
      const got = after && target && target in after.reg ? String((after.reg as unknown as Record<string, unknown>)[target]) : '';
      const hasTarget = target !== '' && after !== undefined && target in after.reg;
      const right = Number(ask.answer.slice(1));
      if (value === '整个周期') {
        return {
          label: '',
          patch: { BEAT: { pointer: 0 }, ...(hasTarget ? { [target]: { value: '不定' } } : {}) },
          moves: hasTarget ? [{ value: signal, from: 'OC', to: target, arc: true, shape: 'level' }] : [],
          message: `${signal} 要是整个周期都有效，T1 通路刚接通、总线上的数还没稳定，${target || '寄存器'} 就开始收，收进去的数不定。打入只能是某一拍里的一个脉冲。`,
        };
      }
      const said = Number(value.slice(1));
      const early = said <= 2;
      const message = early
        ? `${value} 时通路才接通不久，数还在总线上走，${target || '寄存器'} 这时打入，收进去的数不定。图 5.30 里 T1、T2 都不打入寄存器。`
        : said < right
          ? `T3 时总线上的数已经稳定，可图 5.30 把 T3 留给 DR、IR 和写数存，${target || '这个寄存器'} 排在这个周期的最后一拍。按教材的安排写。`
          : `${value} 太晚。${target || '这个寄存器'} 要在 T3 收好，T4 留给后面的打入（DR 的数 T4 还要再打进通用寄存器）。`;
      return {
        label: '',
        patch: { BEAT: { pointer: said - 1 }, ...(hasTarget ? { [target]: { value: early ? '不定' : got } } : {}) },
        moves: hasTarget ? [{ value: signal, from: 'OC', to: target, arc: true, shape: 'pulse' }] : [],
        message,
      };
    }
    const said = Number(value);
    const right = Number(ask.answer);
    if (!Number.isFinite(said)) return null;
    const mine = forIns(s);
    if (said < right) {
      const first = s.boxes.findIndex((b) => b.ins === s.current && b.m === 2);
      const a = L.cycles[first]?.state.bus.DBUS;
      const b = right === 3 ? L.cycles[first + 1]?.state.bus.DBUS : undefined;
      if (a?.driver && b?.driver) {
        return {
          label: '',
          patch: { DBUS: { drivers: [a.driver, b.driver], value: String(b.value) }, BOX_2: { hidden: true }, A2: { hidden: true }, A3: { hidden: true } },
          moves: [
            { value: String(a.value), from: fromOf(a.driver), to: 'DBUS', arc: true },
            { value: String(b.value), from: fromOf(b.driver), to: 'DBUS', arc: true },
          ],
          message: `画 ${said} 个方框就只有 ${said} 个 CPU 周期：${a.value} 和 ${b.value} 要挤在同一个周期里上 DBUS，两个来源同时驱动总线。`,
        };
      }
      return {
        label: '',
        patch: { [`BOX_${right - 1}`]: { hidden: true }, IR: { value: '' } },
        moves: a?.driver ? [{ value: String(a.value), from: fromOf(a.driver), to: 'DBUS', arc: true }] : [],
        message: `画 ${said} 个方框就只有 ${said} 个 CPU 周期：取指和执行挤在一起，IR 里还没有这条指令，控制器不知道该发什么信号（${mine.slice(1).map((x) => x.ops[0]).join('；')}）。`,
      };
    }
    return {
      label: '',
      patch: { TIMING: { value: `第 ${said} 个周期：空` }, DBUS: { value: '', drivers: '' } },
      moves: [{ value: '空', from: 'OC', to: 'DBUS', arc: true, shape: 'level' }],
      message: `多出来的方框里 DBUS 没有数要送，也没有寄存器要打入，机器白等一个周期。`,
    };
  };
}

/** 常见错误：每条都在场景里演一遍。 */
export function flowMistakes(L: Linked): Mistake<FlowState>[] {
  const steps = L.flow.steps;
  const out: Mistake<FlowState>[] = [];
  const fetch = steps.findIndex((s) => s.level === 'cycle');
  if (fetch >= 0) {
    const box = steps[fetch]!.state.boxes[0]!;
    const level = box.level[0];
    if (level) {
      out.push({
        text: `容易给 ${level} 也注上节拍，写成 ${level}(T1)，因为同一个方框里的脉冲信号都注了`,
        at: fetch + 1,
        act: () => ({
          label: '',
          patch: { BOX_0: { rows: boxRows(box.ops, [`${level}(T1)`], box.pulse), changedCells: ['1.0'] }, IR: { value: '' } },
          moves: [],
          message: `${level} 是电位信号，要从 T1 一直保持到这个周期结束。只给 T1 的话，到 T3 打入 IR 时存储器已经不读了，IR 收不到这条指令。电位信号在方框旁直接写，不注节拍。`,
        }),
      });
    }
  }
  const three = L.counts.findIndex((n) => n === 3);
  if (three >= 0) {
    const endStep = steps.findIndex((s) => s.state.ended.includes(three));
    const first = steps[endStep]!.state.boxes.findIndex((b) => b.ins === three && b.m === 2);
    const a = L.cycles[first]?.state.bus.DBUS;
    const b = L.cycles[first + 1]?.state.bus.DBUS;
    if (a?.driver && b?.driver) {
      const from = (d: string) => (d === 'IR' || d === 'ALU' || d === 'DMEM' ? d : 'C2');
      out.push({
        text: `容易把 ${L.flow.params.instructions[three]!.op} 的两个执行方框画成一个，因为它们都在为同一个操作数忙`,
        at: endStep + 1,
        act: () => ({
          label: '',
          patch: { DBUS: { drivers: [a.driver!, b.driver!], value: String(b.value) }, BOX_2: { hidden: true } },
          moves: [
            { value: String(a.value), from: from(a.driver!), to: 'DBUS', arc: true },
            { value: String(b.value), from: from(b.driver!), to: 'DBUS', arc: true },
          ],
          message: `一个方框是一个 CPU 周期，DBUS 一个周期只能送一个数。先送地址进 AR，再送数据，要两个方框。`,
        }),
      });
    }
  }
  const decode = steps.findIndex((s) => s.changes.some((x) => x.at.startsWith('decoded')));
  if (decode >= 0) {
    out.push({
      text: '容易把译码画成一个方框，因为它也是一步要做的事',
      at: decode + 1,
      act: () => ({
        label: '',
        patch: { DIAMOND: { text: '方框？', changed: true }, TIMING: { value: '多出一个周期' } },
        moves: [],
        message: '译码是菱形，在取指周期的末尾按操作码分支，不占 CPU 周期。画成方框就多算了一个周期，所有指令的周期数都错一个。',
      }),
    });
  }
  return out.slice(0, 3);
}

export const FLOW_QUESTION = { text: '一个方框是一个 CPU 周期；框旁的信号哪些直接写，哪些要注 T', at: ['BOX_0'] };
export const FLOW_CONCLUSION =
  '一个方框就是一个 CPU 周期，框里写这个周期的「源→目的」；框旁的电位信号（RD、C1–C3 这类开通路、保持整个周期的）直接写，脉冲信号（LDxx、PC+1、WE(D) 这类打入、写入的）要注明在哪一拍：进 DR、IR 和写数存在 T3，进 AR、PC 和通用寄存器在 T4。';
export const FLOW_NEEDS = [{ href: '/5-cycle', text: '模型机的指令周期' }];
