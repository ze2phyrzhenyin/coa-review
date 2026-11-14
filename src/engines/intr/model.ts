/**
 * 单级中断一次完整过程引擎（教材 8.3.1–8.3.4，p263–270）。规格见 specs/8-intr.md。
 *
 * 次序跟图 8.6：指令执行完 → 中断？ → 响应中断 → 关中断 → 找出中断源、保存 PC → 取入口地址并转移（以上硬件）
 * → 保存现场 → 设备服务 → 恢复现场 → 开中断 → 中断返回（以上软件）。接口的 BS、RD、EI 和 CPU 的 IR、IM 按图 8.9。
 * IM=1 表示关中断。状态路径（im、ir、pc、stack.0.value、devices.1.rd …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Condition, type SolutionTable, type StepInput, type Trace } from '../trace';

export const ENGINE = 'intr';
export const MAX_DEVICES = 4;
export const MAX_ADDRESS = 0xffff;

export interface Device {
  name: string;
  /** 允许中断触发器。 */
  ei: 0 | 1;
  /** 这条指令执行期间设备是否准备好。 */
  rd: 0 | 1;
  /** 向量地址。 */
  vector: number;
  /** 服务程序入口地址。 */
  entry: number;
}

export interface Params {
  /** 链上次序，第 0 个离 CPU 最近。 */
  devices: Device[];
  /** 请求到来时的 IM；1 = 关中断。 */
  im: 0 | 1;
  /** 正在执行的那条指令的地址。 */
  pc: number;
  /** 服务程序要用、因而要保存的寄存器。 */
  regs: { name: string; value: number }[];
  /** 设备缓冲寄存器里的数据。 */
  data: number;
}

export type Phase = '主程序' | '中断周期' | '服务程序';

export interface DeviceState {
  bs: 0 | 1;
  rd: 0 | 1;
  ei: 0 | 1;
  /** INTA 到没到这个接口。 */
  chain: 0 | 1;
}

export interface State {
  phase: Phase;
  pc: number;
  im: 0 | 1;
  ir: 0 | 1;
  /** 公共的中断请求线。 */
  line: 0 | 1;
  inta: 0 | 1;
  devices: DeviceState[];
  selected: number | null;
  vector: number | null;
  regs: Record<string, number>;
  /** 栈顶在末尾。 */
  stack: { what: string; value: number }[];
  /** 当前这一步的名字。 */
  box: string;
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

export function validateParams(p: Params): string[] {
  const problems: string[] = [];
  if (!p || !Array.isArray(p.devices) || p.devices.length < 1 || p.devices.length > MAX_DEVICES) return [`设备必须有 1–${MAX_DEVICES} 台`];
  p.devices.forEach((d, i) => {
    if (!d.name || typeof d.name !== 'string') problems.push(`第 ${i + 1} 台设备缺名字`);
    if (d.ei !== 0 && d.ei !== 1) problems.push(`第 ${i + 1} 台设备的 EI 必须是 0 或 1`);
    if (d.rd !== 0 && d.rd !== 1) problems.push(`第 ${i + 1} 台设备的 RD 必须是 0 或 1`);
    if (!isInt(d.vector) || d.vector < 0 || d.vector > MAX_ADDRESS) problems.push(`第 ${i + 1} 台设备的向量地址必须在 0–FFFFH`);
    if (!isInt(d.entry) || d.entry < 0 || d.entry > MAX_ADDRESS) problems.push(`第 ${i + 1} 台设备的入口地址必须在 0–FFFFH`);
  });
  if (new Set(p.devices.map((d) => d.name)).size !== p.devices.length) problems.push('设备名字不能重复');
  if (p.im !== 0 && p.im !== 1) problems.push('IM 必须是 0 或 1');
  if (!isInt(p.pc) || p.pc < 0 || p.pc > MAX_ADDRESS - 2) problems.push('PC 必须在 0–FFFDH');
  if (!Array.isArray(p.regs) || p.regs.length < 1 || p.regs.length > 3) problems.push('要保存的寄存器必须有 1–3 个');
  else {
    if (new Set(p.regs.map((r) => r.name)).size !== p.regs.length) problems.push('寄存器名字不能重复');
    p.regs.forEach((r, i) => {
      if (!r.name || typeof r.name !== 'string') problems.push(`第 ${i + 1} 个寄存器缺名字`);
      if (!isInt(r.value) || r.value < 0 || r.value > MAX_ADDRESS) problems.push(`第 ${i + 1} 个寄存器的值必须在 0–FFFFH`);
    });
  }
  if (!isInt(p.data) || p.data < 0 || p.data > 255) problems.push('数据必须是 0–255');
  return problems;
}

/** 地址写成大写十六进制加 H。 */
export function hex(n: number): string {
  return `${n.toString(16).toUpperCase().padStart(4, '0')}H`;
}

/** 服务程序里 PC 往后走，超过 FFFFH 回绕。 */
const next = (pc: number, k: number) => (pc + k) & MAX_ADDRESS;

const HW_INSTR = '硬件（指令周期）';
const HW_INTR = '硬件（中断周期）';
const SW = '软件（服务程序）';

export function run(p: Params): Trace<Params, State> {
  const problems = validateParams(p);
  if (problems.length) throw new Error(problems.join('；'));
  const requesting = p.devices.map((d, i) => (d.rd === 1 && d.ei === 1 ? i : -1)).filter((i) => i >= 0);
  const chosen = requesting.length ? requesting[0]! : null;

  const conditions: Condition[] = [
    { label: '设备', value: p.devices.map((d, i) => `${i}. ${d.name}：EI=${d.ei}${d.rd ? '，这条指令里准备好' : ''}，向量地址 ${hex(d.vector)}，入口 ${hex(d.entry)}`).join('；') },
    { label: '链上次序', value: '第 0 个离 CPU 最近，INTA 从它开始往下传（教材 p268–269）' },
    { label: 'IM', value: `${p.im}（1 = 关中断，0 = 开中断，教材 p267）` },
    { label: '当前指令', value: `地址 ${hex(p.pc)}，一条指令占一个地址` },
    { label: '现场', value: p.regs.map((r) => `${r.name} = ${hex(r.value)}`).join('，') },
    { label: '缓冲寄存器', value: String(p.data) },
  ];
  const regs: Record<string, number> = {};
  for (const r of p.regs) regs[r.name] = r.value;
  const initial: State = {
    phase: '主程序',
    pc: p.pc,
    im: p.im,
    ir: 0,
    line: 0,
    inta: 0,
    devices: p.devices.map((d) => ({ bs: d.rd, rd: 0, ei: d.ei, chain: 0 })),
    selected: null,
    vector: null,
    regs,
    stack: [],
    box: '主程序',
  };
  const b = new TraceBuilder<Params, State>(ENGINE, p, initial, conditions);
  let count = 0;
  const rows: SolutionTable['rows'] = [];
  const hardware: string[] = [];
  const software: string[] = [];
  const step = (input: StepInput<State>, row?: { op: string; who: string }): string => {
    b.step(input);
    count += 1;
    const id = `s${count}`;
    if (row) {
      const s = b.state;
      const top = s.stack.at(-1);
      rows.push({ cells: [String(rows.length + 1), row.op, row.who, String(s.im), hex(s.pc), top ? `${top.what} = ${hex(top.value)}` : '空'], step: id });
      if (row.who === HW_INTR) hardware.push(row.op);
      if (row.who === SW) software.push(row.op);
    }
    return id;
  };
  const ready = p.devices.map((d, i) => (d.rd ? i : -1)).filter((i) => i >= 0);
  const names = (is: number[]) => is.map((i) => p.devices[i]!.name).join('、');
  const whoAsk = (answer: '硬件' | '软件') => ({
    prompt: '这一步由谁完成？',
    kind: 'choice' as const,
    options: ['硬件', '软件'],
    answer,
    hint: '看图 8.6：中断周期一栏是硬件，服务子程序一栏是软件。',
  });

  step({
    title: ready.length ? `${names(ready)} 准备好了，RD 置 1` : '没有设备准备好',
    why: ready.length
      ? '设备动作结束，数据已进接口的缓冲寄存器，接口把准备就绪标志置 1（图 8.9 的 ④）。'
      : '启动过的设备都还在工作，RD 仍是 0，接口没有数据可交。',
    ref: '教材 p268',
    update: (s) => {
      s.box = '设备就绪';
      for (const i of ready) s.devices[i]!.rd = 1;
    },
  });
  step({
    title: requesting.length ? `${names(requesting)} 发出中断请求` : '没有接口发出请求',
    why: requesting.length
      ? `RD=1 而且 EI=1 的接口才会把请求送上请求线（图 8.9 的 ⑤）。${ready.length > requesting.length ? `${names(ready.filter((i) => !requesting.includes(i)))} 的 EI=0，请求被禁止。` : ''}`
      : ready.length
        ? '准备好的接口 EI 都是 0，程序禁止了它们发请求，请求线保持 0。'
        : '没有接口的 RD 是 1，请求线保持 0。',
    ref: '教材 p268',
    focus: ['line'],
    update: (s) => {
      s.box = '发出请求';
      s.line = requesting.length ? 1 : 0;
    },
  });

  // 指令周期和公操作。IM=1 时多走一轮：下一条是开中断指令。
  const instructionEnd = (first: boolean) => {
    step(
      {
        level: 'instruction',
        title: first ? `执行完地址 ${hex(p.pc)} 的指令` : `执行开中断指令，IM 清 0`,
        why: first
          ? '请求来得再早，也要等当前这条指令做完，CPU 只在指令结束后才查请求（教材 p265）。'
          : '主程序原先关着中断，它的下一条指令把 IM 清 0，中断才开放。',
        ref: first ? '教材 p265' : '教材 p265、p267',
        update: (s) => {
          s.box = first ? '执行指令' : '开中断指令';
          s.pc += 1;
          if (!first) s.im = 0;
        },
      },
      { op: first ? '执行完当前指令' : '执行开中断指令', who: first ? HW_INSTR : '软件（主程序）' },
    );
    step(
      {
        title: requesting.length ? '查请求线：有请求，IR 置 1' : '查请求线：没有请求',
        why: '每条指令执行到末尾，CPU 把请求线的状态收进中断请求触发器 IR（图 8.9 的 ⑥）。',
        ref: '教材 p265、p268',
        focus: ['ir'],
        update: (s) => {
          s.box = '中断？';
          s.ir = s.line;
        },
      },
      { op: '公操作：查中断请求', who: HW_INSTR },
    );
  };

  instructionEnd(true);
  if (chosen === null) {
    return b.finish({ 响应的设备: '无', PC: hex(p.pc + 1) }, { columns: ['次序', '操作', '谁做', 'IM', 'PC', '栈顶'], rows });
  }

  const condition = (im: 0 | 1) =>
    step({
      title: im === 0 ? '响应条件都满足' : '这次不响应：IM=1',
      why:
        im === 0
          ? 'IR=1，IM=0（中断开放），当前指令已经执行完，三条都满足。'
          : 'IR=1，指令也执行完了，但 IM=1 表示中断被关闭，CPU 不受理请求，请求先挂着。',
      ref: '教材 p265、p268',
      focus: ['ir', 'im'],
      ask: { prompt: 'CPU 这时响应中断吗？', kind: 'choice', options: ['响应', '不响应'], answer: im === 0 ? '响应' : '不响应', hint: '看 IR、IM 和指令有没有执行完。IM=1 是关中断。' },
      update: (s) => {
        s.box = '响应条件';
      },
    }, { op: im === 0 ? '查响应条件：满足' : '查响应条件：IM=1，不响应', who: HW_INSTR });
  condition(p.im);
  if (p.im === 1) {
    instructionEnd(false);
    condition(0);
  }
  const breakpoint = p.im === 1 ? p.pc + 2 : p.pc + 1;
  const dev = p.devices[chosen]!;

  // ---- 中断周期（硬件，隐操作） ----
  step(
    {
      title: '响应中断，发出 INTA',
      why: '条件满足，CPU 进入中断周期，向接口发中断响应信号；请求已被接受，IR 清 0。',
      ref: '教材 p265 图 8.6',
      focus: ['inta', 'phase'],
      update: (s) => {
        s.box = '响应中断';
        s.phase = '中断周期';
        s.inta = 1;
        s.ir = 0;
      },
    },
    { op: '响应中断，发 INTA', who: HW_INTR },
  );
  step(
    {
      title: '关中断：IM 置 1',
      why: '在转去服务程序之前先把中断关上，免得别的请求插进来打乱断点和现场。单级中断里服务期间谁都不能打断。',
      ref: '教材 p265、p268',
      focus: ['im'],
      ask: whoAsk('硬件'),
      update: (s) => {
        s.box = '关中断';
        s.im = 1;
      },
    },
    { op: '关中断（IM 置 1）', who: HW_INTR },
  );
  step(
    {
      title: `找出中断源：${dev.name}`,
      why:
        `INTA 从离 CPU 最近的接口 0 往下传，传到第一个有请求的接口就被截住，它把向量地址 ${hex(dev.vector)} 送上数据总线。`
        + (requesting.length > 1 ? `${names(requesting.slice(1))} 也在请求，但排在后面，INTA 到不了。` : ''),
      ref: '教材 p269 图 8.11',
      focus: ['selected', 'vector', ...Array.from({ length: chosen + 1 }, (_, i) => `devices.${i}.chain`)],
      ...(requesting.length > 1
        ? { ask: { prompt: '哪个接口截住 INTA？', kind: 'choice' as const, options: requesting.map((i) => p.devices[i]!.name), answer: dev.name, hint: '链上离 CPU 近的优先。' } }
        : {}),
      update: (s) => {
        s.box = '找出中断源';
        for (let i = 0; i <= chosen; i++) s.devices[i]!.chain = 1;
        s.selected = chosen;
        s.vector = dev.vector;
      },
    },
    { op: `找出中断源（${dev.name}）`, who: HW_INTR },
  );
  step(
    {
      title: `保存断点：PC = ${hex(breakpoint)} 进栈`,
      why: '返回时要回到被打断的下一条指令，所以把 PC 存进堆栈。这一步程序里看不到，由硬件做。',
      ref: '教材 p265–266',
      focus: ['stack'],
      ask: whoAsk('硬件'),
      update: (s) => {
        s.box = '保存断点';
        s.stack.push({ what: '断点', value: s.pc });
      },
    },
    { op: '保存断点（PC 进栈）', who: HW_INTR },
  );
  step(
    {
      level: 'cycle',
      title: `转移：PC ← ${hex(dev.entry)}`,
      why: `按向量地址 ${hex(dev.vector)} 从中断向量表取出服务程序入口 ${hex(dev.entry)} 送 PC，中断周期结束。`,
      ref: '教材 p265–266 图 8.6、图 8.7',
      focus: ['pc', 'phase'],
      update: (s) => {
        s.box = '转移';
        s.pc = dev.entry;
        s.inta = 0;
        s.phase = '服务程序';
        s.devices.forEach((d) => (d.chain = 0));
      },
    },
    { op: '取入口地址并转移', who: HW_INTR },
  );

  // ---- 服务程序（软件） ----
  const savedNames = p.regs.map((r) => r.name);
  step(
    {
      level: 'instruction',
      title: `保存现场：${savedNames.join('、')} 进栈`,
      why: '服务程序马上要用这些寄存器，先把主程序留在里面的值存起来。这是服务程序开头的指令做的。',
      ref: '教材 p265 图 8.6',
      focus: ['stack'],
      ask: whoAsk('软件'),
      update: (s) => {
        s.box = '保存现场';
        for (const r of p.regs) s.stack.push({ what: r.name, value: s.regs[r.name]! });
        s.pc = next(s.pc, p.regs.length);
      },
    },
    { op: '保存现场', who: SW },
  );
  const first = p.regs[0]!.name;
  step(
    {
      level: 'instruction',
      title: `设备服务：读入数据 ${p.data}，BS、RD 复位`,
      why: `输入指令把缓冲寄存器的数据读进 ${first}（图 8.9 的 ⑨）；随后 CPU 发出控制信号把接口的 BS 和 RD 清 0（⑩），这台设备的请求随之撤销。`,
      ref: '教材 p268',
      update: (s) => {
        s.box = '设备服务';
        s.regs[first] = p.data;
        s.devices[chosen]!.bs = 0;
        s.devices[chosen]!.rd = 0;
        s.line = requesting.length > 1 ? 1 : 0;
        s.pc = next(s.pc, 2);
      },
    },
    { op: '设备服务', who: SW },
  );
  step(
    {
      level: 'instruction',
      title: `恢复现场：${[...savedNames].reverse().join('、')} 出栈`,
      why: '按进栈的相反次序把寄存器取回，主程序的值原样还给它。',
      ref: '教材 p265 图 8.6',
      focus: ['stack', 'regs'],
      update: (s) => {
        s.box = '恢复现场';
        for (let i = p.regs.length - 1; i >= 0; i--) {
          const top = s.stack.pop()!;
          s.regs[top.what] = top.value;
        }
        s.pc = next(s.pc, p.regs.length);
      },
    },
    { op: '恢复现场', who: SW },
  );
  step(
    {
      level: 'instruction',
      title: '开中断：IM 清 0',
      why: '服务做完、现场已恢复，服务程序末尾的开中断指令把 IM 清 0。单级中断里这是唯一一次开中断。',
      ref: '教材 p265 图 8.6',
      focus: ['im'],
      update: (s) => {
        s.box = '开中断';
        s.im = 0;
        s.pc = next(s.pc, 1);
      },
    },
    { op: '开中断（IM 清 0）', who: SW },
  );
  step(
    {
      level: 'instruction',
      title: `中断返回：PC ← ${hex(breakpoint)}`,
      why: '返回指令把断点从栈里弹回 PC，主程序从被打断的下一条指令接着执行。硬件保证这条指令做完之后才受理新的请求。',
      ref: '教材 p265',
      focus: ['pc', 'stack', 'phase'],
      update: (s) => {
        s.box = '中断返回';
        s.pc = s.stack.pop()!.value;
        s.phase = '主程序';
        s.selected = null;
        s.vector = null;
      },
    },
    { op: '中断返回', who: SW },
  );
  const others = requesting.slice(1);
  if (others.length) {
    step({
      title: `${names(others)} 还在请求`,
      why: '它们的 RD、EI 仍是 1，请求线还是 1。等主程序下一条指令执行完，IR 会再置 1，再走一遍同样的过程。',
      ref: '教材 p268–269',
      update: (s) => {
        s.box = '还有请求';
      },
    }, { op: `${names(others)} 仍在请求`, who: '接口' });
  }

  const result: Record<string, string> = {
    响应的设备: dev.name,
    断点: hex(breakpoint),
    向量地址: hex(dev.vector),
    入口地址: hex(dev.entry),
    硬件完成: hardware.join('，'),
    软件完成: software.join('，'),
    '返回后 PC': hex(breakpoint),
    '返回后 IM': '0',
  };
  if (others.length) result['仍在请求'] = names(others);
  return b.finish(result, { columns: ['次序', '操作', '谁做', 'IM', 'PC', '栈顶'], rows });
}

/** mulberry32：同一个种子给出同一串数。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['键盘', '打印机', '磁盘', '采样器'];

/** 按种子出一道题：2–3 台设备，至少一台既准备好又允许中断。 */
export function generate(seed: number): Params {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const n = int(2, 3);
  const devices: Device[] = Array.from({ length: n }, (_, i) => ({
    name: NAMES[i]!,
    ei: r() < 0.75 ? 1 : 0,
    rd: r() < 0.6 ? 1 : 0,
    vector: 0x0010 + 2 * i,
    entry: 0x1000 * (i + 2) + 16 * int(0, 15),
  }));
  const k = int(0, n - 1);
  devices[k] = { ...devices[k]!, ei: 1, rd: 1 };
  const regNames = ['R0', 'R1', 'R2'].slice(0, int(1, 3));
  return {
    devices,
    im: r() < 0.25 ? 1 : 0,
    pc: 0x0100 + int(0, 255),
    regs: regNames.map((name) => ({ name, value: int(0, 0xffff) })),
    data: int(0, 255),
  };
}
