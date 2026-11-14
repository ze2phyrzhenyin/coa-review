/**
 * 图 5.1 模型机的场景：部件摆在哪、怎么连、引擎的状态怎么落到部件上、每一步哪个值走哪条线。
 * 不含计算：数都从引擎的状态里取，冲突的后果用引擎的 checkTransfer。
 *
 * 台面布局（x 向右，z 朝向观看的人）：
 *   后排左：指存，前面是 ABUS(I)、IBUS，再前是 PC、IR；后排中：指令译码器、操作控制器、时序；
 *   后排右：数存，前面是 ABUS(D)，再前是 AR。中间一条横贯的 DBUS。
 *   前排：DR、R0–R3、ALU、PSWR；三态门 C3 在 IR 和 DBUS 之间，C2 在通用寄存器和 DBUS 之间，C1 在 ALU 和 DBUS 之间。
 */
import type { Step, Trace } from '../../engines/trace';
import { GENERAL_REGISTERS, PART_LABEL, checkTransfer } from '../../engines/cpu/model';
import type { GeneralRegister, Params, PartId, State } from '../../engines/cpu/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Move, PartSpec, SceneSpec, WireSpec } from '../../scene';
import type { Breakage } from '../../player/Player';

type Ctx = BindContext<State>;
const DBUS_X = -0.6;
const DBUS_Z = -1.0;
const REG_X: Record<GeneralRegister, number> = { R0: -5.9, R1: -3.6, R2: -1.3, R3: 1.0 };
const REG_Z = 3.1;
const COLLECT_BACK = 1.75;
const COLLECT_FRONT = 4.75;

/** 各部件在台面上的 x，DBUS 的值牌停在驱动者正对的地方。 */
const X: Partial<Record<PartId, number>> = { IR: -5.8, ALU: 5.4, DMEM: 8.4, ...REG_X, C2: -2.45, C1: 5.4, C3: -5.8 };

const clean = (text: string | undefined): string => (text === undefined || text === 'null' ? '' : text);

function rowsOf(trace: Trace<Params, State>): { imem: string[]; dmem: string[] } {
  const imem = Object.keys(trace.initial.imem);
  const dmem = new Set(Object.keys(trace.initial.dmem));
  for (const step of trace.steps) for (const key of Object.keys(step.state.dmem)) dmem.add(key);
  const byNumber = (a: string, b: string) => Number(a) - Number(b);
  // 数存一个单元都没列出时也画出数存（没列出的单元读出 0），连线才有落点。
  if (dmem.size === 0) dmem.add('0');
  return { imem: imem.sort(byNumber), dmem: [...dmem].sort(byNumber) };
}

export function machineScene(trace: Trace<Params, State>): SceneSpec {
  const { imem, dmem } = rowsOf(trace);
  const reg = (id: PartId, x: number, z: number, width = 2.2): PartSpec => ({ id, kind: 'register', position: [x, z], props: { name: PART_LABEL[id], value: '', width }, pick: true });
  const bus = (id: PartId, x: number, z: number, length: number, extra: Record<string, unknown> = {}): PartSpec => ({
    id,
    kind: 'bus',
    position: [x, z],
    props: { name: PART_LABEL[id], length, value: '', ...extra },
    pick: true,
  });
  // 门尖指向 DBUS：C3 在 DBUS 后面，尖朝前（s）；C1、C2 在 DBUS 前面，尖朝后（n）。
  const gate = (id: 'C1' | 'C2' | 'C3', x: number, z: number): PartSpec => ({ id, kind: 'gate', position: [x, z], props: { name: id, open: false, dir: z < DBUS_Z ? 's' : 'n', states: ['关', '开'] }, pick: true });
  const parts: PartSpec[] = [
    {
      id: 'IMEM',
      kind: 'memory',
      position: [-7.6, -7.1],
      props: { name: PART_LABEL.IMEM, columns: [{ title: '指令', width: 3.3 }], rows: imem.map((addr) => [`${trace.initial.imem[addr]!.op} ${trace.initial.imem[addr]!.operands}`]), labels: imem },
      pick: true,
    },
    bus('ABUS_I', -9.4, -5.5, 2.8, { ink: 'addr', showDriver: false }),
    bus('IBUS', -5.8, -5.5, 3.8, { showDriver: false }),
    reg('PC', -9.4, -3.9),
    { ...reg('IR', -5.8, -3.9, 2.8) },
    { ...reg('DECODER', -2.2, -3.9, 2.4), title: PART_LABEL.DECODER },
    { id: 'OC', kind: 'register', position: [1.5, -3.9], props: { name: PART_LABEL.OC, value: '', width: 3.4 }, pick: true },
    { id: 'TIMING', kind: 'register', position: [1.5, -6.1], props: { name: '时序', value: '', width: 2.6 }, title: '时序' },
    {
      id: 'DMEM',
      kind: 'memory',
      position: [7.4, -7.1],
      props: { name: PART_LABEL.DMEM, columns: [{ title: '内容', width: 2.6 }], rows: dmem.map(() => ['']), labels: dmem },
      pick: true,
    },
    bus('ABUS_D', 6.2, -5.5, 3.0, { ink: 'addr', showDriver: false }),
    reg('AR', 6.2, -3.9),
    gate('C3', -5.8, -2.35),
    bus('DBUS', DBUS_X, DBUS_Z, 20.6),
    reg('DR', -9.0, 1.3),
    ...GENERAL_REGISTERS.map((r) => reg(r, REG_X[r], REG_Z, 2.0)),
    gate('C2', X.C2!, 0.15),
    reg('ALU', 5.4, 3.0, 2.6),
    gate('C1', 5.4, 0.3),
    reg('PSWR', 8.6, 3.0, 2.6),
  ];
  const wires: WireSpec[] = [
    { id: 'pc-abusi', from: 'PC.n', to: 'ABUS_I.s', ink: 'addr' },
    { id: 'abusi-imem', from: 'ABUS_I.n', to: 'IMEM.s', ink: 'addr' },
    { id: 'imem-ibus', from: 'IMEM.s', to: 'IBUS.n' },
    { id: 'ibus-ir', from: 'IBUS.s', to: 'IR.n' },
    { id: 'ir-dec', from: 'IR.e', to: 'DECODER.w', ink: 'ctrl' },
    { id: 'dec-oc', from: 'DECODER.e', to: 'OC.w', ink: 'ctrl' },
    { id: 'ir-c3', from: 'IR.s', to: 'C3.n', ink: 'addr' },
    { id: 'c3-dbus', from: 'C3.s', to: 'DBUS', ink: 'addr' },
    { id: 'dbus-pc', from: 'DBUS', to: 'PC.s', ink: 'addr' },
    { id: 'dbus-ar', from: 'DBUS', to: 'AR.s', ink: 'addr' },
    { id: 'ar-abusd', from: 'AR.n', to: 'ABUS_D.s', ink: 'addr' },
    { id: 'abusd-dmem', from: 'ABUS_D.n', to: 'DMEM.s', ink: 'addr' },
    { id: 'dmem-dbus', from: 'DMEM.s', to: 'DBUS', via: [[8.4, -4.2]] },
    { id: 'dbus-dr', from: 'DBUS', to: 'DR.n' },
    { id: 'c2-dbus', from: 'C2.n', to: 'DBUS' },
    { id: 'alu-c1', from: 'ALU.n', to: 'C1.s' },
    { id: 'c1-dbus', from: 'C1.n', to: 'DBUS' },
    { id: 'alu-psw', from: 'ALU.e', to: 'PSWR.w', ink: 'ctrl' },
    ...GENERAL_REGISTERS.flatMap((r): WireSpec[] => [
      { id: `${r}-c2`, from: `${r}.n`, to: 'C2.s', via: [[REG_X[r], COLLECT_BACK], [X.C2!, COLLECT_BACK]] },
      { id: `${r}-alu`, from: `${r}.n`, to: 'ALU.w', via: [[REG_X[r], COLLECT_BACK], [3.6, COLLECT_BACK], [3.6, 3.0]] },
      { id: `dr-${r}`, from: 'DR.s', to: `${r}.s`, via: [[-9.0, COLLECT_FRONT], [REG_X[r], COLLECT_FRONT]] },
    ]),
  ];
  return { parts, wires };
}

const busValue = (id: 'ABUS_I' | 'IBUS' | 'DBUS' | 'ABUS_D') =>
  from<State>([`bus.${id}.value`, `bus.${id}.driver`], (c: Ctx) => clean(c.flat[`bus.${id}.value`]));
const busDriver = (id: 'ABUS_I' | 'IBUS' | 'DBUS' | 'ABUS_D') => (c: Ctx) => {
  const driver = c.state.bus[id].driver;
  return driver ? PART_LABEL[driver] : '';
};

const signalsOf = (state: State): string => [...state.signals.level, ...state.signals.pulse].join(' ');

export function machineBind(trace: Trace<Params, State>) {
  const { imem, dmem } = rowsOf(trace);
  const rowOf = (rows: string[], value: number | null) => (value === null ? -1 : rows.indexOf(String(value)));
  return bindTable<State>({
    PC: { value: from('reg.PC', (c) => String(c.state.reg.PC)) },
    IR: { value: from(['reg.IR.op', 'reg.IR.operands'], (c) => (c.state.reg.IR.op ? `${c.state.reg.IR.op} ${c.state.reg.IR.operands ?? ''}` : '')) },
    AR: { value: from('reg.AR', (c) => clean(c.flat['reg.AR'])) },
    DR: { value: from('reg.DR', (c) => clean(c.flat['reg.DR'])) },
    R0: { value: 'reg.R0' },
    R1: { value: 'reg.R1' },
    R2: { value: 'reg.R2' },
    R3: { value: 'reg.R3' },
    PSWR: {
      value: from('reg.PSWR', (c) => {
        const f = c.state.reg.PSWR;
        return f.C === null ? '' : `C${f.C} V${f.V} Z${f.Z} N${f.N}`;
      }),
    },
    ALU: { value: from(['alu.fn', 'alu.out'], (c) => (c.state.alu.fn ? `${c.state.alu.fn} ${c.state.alu.out ?? ''}`.trim() : '')) },
    DECODER: { value: from('decoder', (c) => c.state.decoder ?? '') },
    // 信号和时序每一步都变，不登记路径：它们不进镜头要看住的范围。
    OC: { value: (c: Ctx) => signalsOf(c.state), changed: (c: Ctx) => [...c.changed].some((path) => path.startsWith('signals.')) },
    TIMING: {
      value: (c: Ctx) => [c.state.timing.cycle ?? '', c.state.timing.beat ?? ''].filter(Boolean).join(' '),
      changed: (c: Ctx) => c.changed.has('timing.beat') || c.changed.has('timing.cycle'),
    },
    ABUS_I: { value: busValue('ABUS_I'), drivers: busDriver('ABUS_I') },
    IBUS: { value: busValue('IBUS'), drivers: busDriver('IBUS') },
    DBUS: {
      value: busValue('DBUS'),
      drivers: busDriver('DBUS'),
      tileAt: (c: Ctx) => {
        const driver = c.state.bus.DBUS.driver;
        // 寄存器经 C2 上 DBUS，牌停在 C2 正对的地方。
        const x = driver === null ? undefined : (GENERAL_REGISTERS as readonly string[]).includes(driver) ? X.C2 : X[driver];
        return x === undefined ? undefined : x - DBUS_X;
      },
    },
    ABUS_D: { value: busValue('ABUS_D'), drivers: busDriver('ABUS_D') },
    C1: { open: 'gate.C1' },
    C2: { open: 'gate.C2' },
    C3: { open: 'gate.C3' },
    IMEM: { active: from('bus.ABUS_I.value', (c) => rowOf(imem, c.state.bus.ABUS_I.value)) },
    DMEM: {
      rows: from('dmem', (c) => dmem.map((addr) => [String(c.state.dmem[addr] ?? 0)])),
      active: from('bus.ABUS_D.value', (c) => rowOf(dmem, c.state.bus.ABUS_D.value)),
      changedCells: (c: Ctx) => [...c.changed].filter((path) => path.startsWith('dmem.')).map((path) => `${dmem.indexOf(path.slice(5))}.0`),
    },
  });
}

/** 一步里哪个值从哪走到哪。只看这一步的变化，不看步骤编号。 */
export function machineMoves(step: Step<State>): Move[] {
  const changed = new Set(step.changes.map((change) => change.at));
  const has = (path: string) => changed.has(path);
  const s = step.state;
  const out: Move[] = [];
  const text = (value: unknown) => String(value);

  if (has('bus.ABUS_I.driver') && s.bus.ABUS_I.driver === 'PC') out.push({ value: text(s.bus.ABUS_I.value), from: 'PC', to: 'ABUS_I', via: ['pc-abusi'], ink: 'addr' });
  if (has('bus.IBUS.driver') && s.bus.IBUS.driver === 'IMEM') out.push({ value: text(s.bus.IBUS.value), from: 'IMEM', to: 'IBUS', via: ['imem-ibus'] });
  if (has('reg.IR.op') && s.reg.IR.op) out.push({ value: `${s.reg.IR.op} ${s.reg.IR.operands ?? ''}`, from: 'IBUS', to: 'IR', via: ['ibus-ir'], phase: 1 });
  if (has('decoder') && s.decoder) out.push({ value: s.decoder, from: 'IR', to: 'DECODER', via: ['ir-dec'], ink: 'ctrl' });

  // 选寄存器：送到 ALU 的输入端，或者送到 C2 的输入端。
  const toC2 = step.focus.includes('C2');
  for (const side of ['left', 'right'] as const) {
    const r = s.sel[side];
    if (!has(`sel.${side}`) || !r) continue;
    if (side === 'left' && s.sel.right === r && has('sel.right')) continue;
    out.push(toC2 ? { value: text(s.reg[r]), from: r, to: 'C2', via: [`${r}-c2`] } : { value: text(s.reg[r]), from: r, to: 'ALU', via: [`${r}-alu`] });
  }

  if (has('bus.DBUS.driver') && s.bus.DBUS.driver) {
    const driver = s.bus.DBUS.driver;
    const value = text(s.bus.DBUS.value);
    if (driver === 'IR') out.push({ value, from: 'IR', to: 'DBUS', via: ['ir-c3', 'c3-dbus'], ink: 'addr' });
    else if (driver === 'ALU') out.push({ value, from: 'ALU', to: 'DBUS', via: ['alu-c1', 'c1-dbus'] });
    else if ((GENERAL_REGISTERS as readonly string[]).includes(driver)) {
      // 选寄存器那一步已经把数送到 C2 门口；没有那一步时从寄存器出发。
      const selected = step.changes.some((change) => change.at === 'sel.right');
      out.push(selected ? { value, from: driver, to: 'DBUS', via: [`${driver}-c2`, 'c2-dbus'] } : { value, from: 'C2', to: 'DBUS', via: ['c2-dbus'] });
    } else if (driver === 'DMEM') {
      if (has('bus.ABUS_D.driver')) out.push({ value: text(s.bus.ABUS_D.value), from: 'AR', to: 'ABUS_D', via: ['ar-abusd'], ink: 'addr' });
      out.push({ value, from: 'DMEM', to: 'DBUS', via: ['dmem-dbus'], phase: 1 });
    }
  }
  // STO 的执行二：AR 在 T1 单独一步送上 ABUS(D)（数存读写的那一步就不再重复送）。
  if (has('bus.ABUS_D.driver') && s.bus.ABUS_D.driver === 'AR' && !out.some((move) => move.to === 'ABUS_D') && !has('bus.DBUS.driver') && ![...changed].some((path) => path.startsWith('dmem.'))) {
    out.push({ value: text(s.bus.ABUS_D.value), from: 'AR', to: 'ABUS_D', via: ['ar-abusd'], ink: 'addr' });
  }
  if (has('reg.AR') && s.reg.AR !== null) out.push({ value: text(s.reg.AR), from: 'DBUS', to: 'AR', via: ['dbus-ar'], ink: 'addr' });
  if (has('reg.DR') && s.reg.DR !== null) out.push({ value: text(s.reg.DR), from: 'DBUS', to: 'DR', via: ['dbus-dr'] });
  if (['C', 'V', 'Z', 'N'].some((flag) => has(`reg.PSWR.${flag}`))) {
    const f = s.reg.PSWR;
    out.push({ value: `C${f.C} V${f.V} Z${f.Z} N${f.N}`, from: 'ALU', to: 'PSWR', via: ['alu-psw'], ink: 'ctrl' });
  }
  for (const r of GENERAL_REGISTERS) if (has(`reg.${r}`)) out.push({ value: text(s.reg[r]), from: 'DR', to: r, via: [`dr-${r}`] });
  if (has('reg.PC') && s.bus.DBUS.driver !== null && s.bus.DBUS.value === s.reg.PC) out.push({ value: text(s.reg.PC), from: 'DBUS', to: 'PC', via: ['dbus-pc'], ink: 'addr' });
  if ([...changed].some((path) => path.startsWith('dmem.'))) {
    if (has('bus.ABUS_D.driver')) out.push({ value: text(s.bus.ABUS_D.value), from: 'AR', to: 'ABUS_D', via: ['ar-abusd'], ink: 'addr' });
    out.push({ value: text(s.bus.DBUS.value), from: 'DBUS', to: 'DMEM', via: ['dmem-dbus'], phase: 1 });
  }
  return out;
}

/** 舞台角上的读数：哪个 CPU 周期、哪个节拍、哪些信号有效。 */
export function machineCaption(state: State): string {
  if (state.halted) return '停机';
  const { cycle, beat } = state.timing;
  const signals = signalsOf(state);
  return [cycle ? `${cycle}周期` : '', beat ?? '', signals].filter(Boolean).join('  ');
}

const gateDriver = (state: State, gate: 'C1' | 'C2' | 'C3'): PartId => (gate === 'C1' ? 'ALU' : gate === 'C3' ? 'IR' : (state.sel.right ?? state.sel.left ?? 'R0'));
const gateWires: Record<'C1' | 'C2' | 'C3', (driver: PartId) => string[]> = {
  C1: () => ['alu-c1', 'c1-dbus'],
  C2: (driver) => [`${driver}-c2`, 'c2-dbus'],
  C3: () => ['ir-c3', 'c3-dbus'],
};

/**
 * 弄坏它：DBUS 上已经有一个数时，再打开一个三态门。学生可以点场景里关着的门，也可以按按钮。
 * 后果和说明都来自引擎的 checkTransfer。
 */
export function machineBreak(state: State, part: string | null): Breakage | null {
  const current = state.bus.DBUS.driver;
  if (current === null || state.halted) return null;
  const closed = (['C2', 'C1', 'C3'] as const).filter((gate) => !state.gate[gate] && (part === null || gate === part));
  // 只演第二个驱动者手里真有数的情况，后果才看得清。
  const options = closed
    .map((gate) => ({ gate, driver: gateDriver(state, gate) }))
    .filter(({ driver }) => driver !== current)
    .map((item) => ({ ...item, check: checkTransfer(state, { bus: 'DBUS', driver: item.driver }) }))
    .filter(({ check }) => check.verdict === 'conflict' && typeof check.values[1] === 'number');
  const chosen = options[0];
  if (!chosen) return null;
  const { gate, driver, check } = chosen;
  const [first, second] = check.drivers.map((id) => PART_LABEL[id]);
  return {
    label: `弄坏它：再打开 ${gate}`,
    patch: {
      [gate]: { open: true },
      // 冲突的牌停在新打开的门正对的地方，镜头能同时看到门、第二个驱动者和冲突。
      DBUS: { drivers: [first, second], value: String(check.values[1]), tileAt: (X[gate] ?? 0) - DBUS_X },
    },
    moves: [{ value: String(check.values[1]), from: driver, to: 'DBUS', via: gateWires[gate](driver) }],
    message: check.message,
  };
}

const pathNames: Record<string, string> = {
  decoder: '指令译码器',
  'alu.fn': 'ALU 的功能',
  'alu.out': 'ALU 的输出',
  'sel.left': '送 ALU 左输入的寄存器',
  'sel.right': '右路选中的寄存器（送 ALU 右输入，也接 C2 的输入端）',
  'sel.write': '接收 DR 的寄存器',
  'reg.IR.op': 'IR 操作码',
  'reg.IR.operands': 'IR 地址码',
  'timing.cycle': 'CPU 周期',
  'timing.cycleNo': '第几个 CPU 周期',
  'timing.cycles': '本条指令的 CPU 周期数',
  'timing.beat': '节拍',
  'timing.instruction': '第几条指令',
  'timing.addr': '本条指令的地址',
  halted: '停机',
};

/** 状态路径的读法，用在「变化」里。 */
export function machineNames(path: string): string {
  if (pathNames[path]) return pathNames[path];
  let m = /^reg\.(\w+)$/.exec(path);
  if (m) return m[1]!;
  m = /^reg\.PSWR\.(\w)$/.exec(path);
  if (m) return `PSWR 的 ${m[1]} 标志`;
  m = /^bus\.(\w+)\.(value|driver)$/.exec(path);
  if (m) return `${PART_LABEL[m[1] as PartId]} ${m[2] === 'value' ? '上的数' : '的驱动者'}`;
  m = /^gate\.(C\d)$/.exec(path);
  if (m) return `三态门 ${m[1]}`;
  m = /^dmem\.(\d+)$/.exec(path);
  if (m) return `数存 ${m[1]} 号单元`;
  m = /^signals\.(level|pulse)\.\d+$/.exec(path);
  if (m) return m[1] === 'level' ? '电位信号' : '脉冲信号';
  return path;
}

/** 「变化」里的值：门写开、关，驱动者写部件名。 */
export function machineValues(path: string, value: string): string {
  if (path.startsWith('gate.') || path === 'halted') return value === 'true' ? (path === 'halted' ? '是' : '开') : value === 'false' ? (path === 'halted' ? '否' : '关') : value;
  if (/^bus\.\w+\.driver$/.test(path)) return PART_LABEL[value as PartId] ?? value;
  return value;
}

/**
 * 页面补充的条件：读图要用、引擎的「为什么」里没有展开的几条。只是说明，不含答案。
 * 依据：教材 p150 图 5.1、p156、p178 图 5.30。
 */
export const MACHINE_NOTES: { label: string; value: string }[] = [
  { label: '四条总线', value: 'ABUS(I)：PC 送指令地址到指存（指令存储器）；IBUS：指存读出的指令送 IR；DBUS：其余的数和地址都走它；ABUS(D)：AR 送数据地址到数存（数据存储器）。指存和数存是两个存储器。DBUS 和通用寄存器之间没有直接的连线：送进 R0–R3 的数先进 DR' },
  { label: '三态门', value: '能往 DBUS 送数的部件各有一道门：C1 管 ALU 的输出，C2 管通用寄存器的输出（不经 ALU），C3 管 IR 的地址码。门关着时输出端像断开一样（高阻），不影响总线。同一时刻最多开一道，数存读出也算一个来源' },
  { label: '电位和脉冲', value: '电位信号从 T1 起保持整个 CPU 周期，打开通路：RD(I)、RD(D)（统称 RD）和 C1–C3。脉冲信号只在某一拍出现，把总线上的数打入寄存器：LDxx 打入 xx（LDIR、LDAR、LDDR、LDPC，LDR0–LDR3 打入通用寄存器），表里注上节拍，例如 LDDR(T3)。PC+1 让 PC 加 1，LDPC 把结果打入 PC，取指的 T4 两个都写' },
  { label: '选哪个寄存器', value: '让哪个通用寄存器送出（送 C2 或送 ALU）由 IR 的寄存器字段直接选，教材不给信号名，表里写「（由 IR 的寄存器字段选中）」；解析书（教材配套的习题解析）把读出写成 LRi、打入写成 SRi。打入 R0 的 LDR0 是另一回事：它是把 DR 的数打入 R0 的脉冲' },
  { label: 'T2 和 T3、T4', value: '电位信号在 T1 打开通路，数经过总线要一段时间才稳定，所以 T2 不打入任何寄存器，表里 T2 这一格不写（图 5.30）。DR 和数存写入 WE(D) 在 T3；AR、PC 和通用寄存器在 T4，是这个 CPU 周期的最后一拍。DR 在 T3 打入，T4 才能再从 DR 打入通用寄存器' },
  { label: 'PSWR', value: '程序状态字寄存器，存运算结果的标志：C 进位、V 溢出、Z 结果为 0、N 结果为负' },
  { label: '操作数的先后', value: 'MOV Rx,Ry：Ry→Rx；NOT Rx,Ry：Ry 取反→Rx；ADD Rx,Ry：Rx+Ry→Ry；LAD Rx,A：数存 A→Rx；STO Rx,(Ry)：Rx→数存 (Ry)；JMP A：A→PC' },
  { label: '数 CPU 周期', value: '数一数这条指令要让 DBUS 送几次数，每次占一个 CPU 周期，另加取指的一个' },
];

/** 在 Trace 的条件后面接上页面的说明。不改步骤。 */
export function withNotes(trace: Trace<Params, State>): Trace<Params, State> {
  const listing = Object.entries(trace.initial.imem)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([addr, cell]) => `${addr} 号 ${cell.op} ${cell.operands}`)
    .join('；');
  return { ...trace, conditions: [...trace.conditions, { label: '指存里的程序', value: listing }, ...MACHINE_NOTES] };
}

/**
 * 答错「几个 CPU 周期」时演后果：少算了，就是把两次 DBUS 传送挤进同一个 CPU 周期，两个数同时上 DBUS；
 * 多算了，多出的 CPU 周期里 DBUS 没有数可送。数和驱动者都取自 Trace 的状态。
 */
export function machineWrong(trace: Trace<Params, State>) {
  return (ask: { kind: string; answer: string }, value: string): Breakage | null => {
    if (ask.kind !== 'number') return null;
    const said = Number(value);
    const right = Number(ask.answer);
    if (!Number.isFinite(said) || !Number.isFinite(right) || said === right) return null;
    const sends: { driver: PartId; value: string }[] = [];
    for (const step of trace.steps) {
      const bus = step.state.bus.DBUS;
      if (bus.driver && !sends.some((item) => item.driver === bus.driver && item.value === String(bus.value))) sends.push({ driver: bus.driver, value: String(bus.value) });
      if (step.state.halted) break;
    }
    if (said < right && sends.length >= 2) {
      const [a, b] = sends as [{ driver: PartId; value: string }, { driver: PartId; value: string }];
      return {
        label: '',
        patch: { DBUS: { drivers: [PART_LABEL[a.driver], PART_LABEL[b.driver]], value: b.value }, TIMING: { value: `只有 ${said} 个周期` } },
        moves: [
          { value: a.value, from: a.driver === 'IR' || a.driver === 'ALU' || a.driver === 'DMEM' ? a.driver : 'C2', to: 'DBUS', arc: true },
          { value: b.value, from: b.driver === 'IR' || b.driver === 'ALU' || b.driver === 'DMEM' ? b.driver : 'C2', to: 'DBUS', arc: true },
        ],
        message: `按 ${said} 个 CPU 周期算，${PART_LABEL[a.driver]} 送的 ${a.value} 和 ${PART_LABEL[b.driver]} 送的 ${b.value} 要在同一个 CPU 周期里同时上 DBUS，DBUS 上就有两个数，打架。`,
      };
    }
    if (said < right) {
      return {
        label: '',
        patch: { TIMING: { value: `只有 ${said} 个周期` }, IR: { value: '' } },
        moves: [],
        message: `按 ${said} 个 CPU 周期算，取指和执行挤在一起：IR 里还没有这条指令，控制器不知道该发什么信号。`,
      };
    }
    return {
      label: '',
      patch: { TIMING: { value: `第 ${said} 个周期：空` }, DBUS: { value: '', drivers: '' } },
      moves: [],
      message: `按 ${said} 个 CPU 周期算，多出来的 CPU 周期里 DBUS 没有数要送，机器白等。`,
    };
  };
}
