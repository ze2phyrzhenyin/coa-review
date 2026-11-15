/**
 * 微程序控制器的台面：左边是控制器（图 5.24），右边是它控制的运算器（图 5.21）。
 * 不含计算：数都取自引擎 src/engines/micro 的状态；「弄坏它」和常见错误的后果也由引擎重跑得出。
 *
 * 台面（x 向右，z 朝向观看的人）：
 *   后排：控制存储器（抽屉柜，一个微地址一格）、微命令读数；Cy、ALU。
 *   中排：微指令寄存器 μIR（23 位的条：1–12、13–17、P_{1}P_{2}）；X、Y 两个多路开关。
 *   前排：μAR、地址转移逻辑、下地址字段，下面是 IR、PC；DR、R1、R2、R3，最前是公共总线。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { COMMANDS, FETCH_ADDRESS, decode, run } from '../../engines/micro/model';
import type { MicroParams, MicroState, StoreWord } from '../../engines/micro/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Move, PartSpec, SceneSpec, WireSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

type Ctx = BindContext<MicroState>;
type Reg = 'R1' | 'R2' | 'R3' | 'DR';

const bin = (v: number): string => v.toString(2).padStart(4, '0');
const clean = (word: string): string => word.replace(/\s+/g, '');

/** 多路开关：X 端可接 DR、R1、R2，Y 端可接 R1、R2、R3（图 5.21）。 */
export const MUX = { X: { id: 'MX', inputs: ['DR', 'R1', 'R2'] as Reg[] }, Y: { id: 'MY', inputs: ['R1', 'R2', 'R3'] as Reg[] } } as const;
/** 选通某个输入的微命令落在哪个开关上：'R1→X' → MX。 */
const muxOf = (name: string): string | null => {
  const m = /^(R1|R2|R3|DR)→([XY])$/.exec(name);
  return m && (MUX[m[2] as 'X' | 'Y'].inputs as string[]).includes(m[1]!) ? MUX[m[2] as 'X' | 'Y'].id : null;
};
/** 输入线的名字：寄存器 → 开关。 */
export const inputWire = (reg: string, side: 'X' | 'Y'): string => `${reg}-${MUX[side].id}`;

interface Layout {
  pos: Record<string, [number, number]>;
  fan: Record<string, number>;
  feed: number;
  aluX: number;
  aluY: number;
  outX: number;
  busZ: number;
  leftX: number;
}

/** 运算器（图 5.21）各部件相对 DR 的位置。 */
function datapath(ox: number, oz: number) {
  const p = (x: number, z: number): [number, number] => [x + ox, z + oz];
  return {
    pos: {
      Cy: p(-0.4, -4.6),
      ALU: p(2.6, -4.6),
      MX: p(0.9, -1.0),
      MY: p(4.9, -1.0),
      DR: p(0, 2.6),
      R1: p(1.9, 2.6),
      R2: p(3.8, 2.6),
      R3: p(5.7, 2.6),
      BUS: p(3.0, 4.6),
    },
    // 寄存器到开关的线先往上走到各自的一条横线，再拐到开关的口：错开高度，不在拐角处相碰。
    fan: { 'R1-MX': 1.2 + oz, 'R2-MX': 1.55 + oz, 'R1-MY': 0.3 + oz, 'R2-MY': 0.75 + oz },
    feed: -2.65 + oz,
    aluX: 2.0 + ox,
    aluY: 3.2 + ox,
    outX: 7.0 + ox,
    busZ: 4.6 + oz,
  };
}

/** 两套位置：宽屏控制器在左、运算器在右；窄屏控制器排成一列，运算器挪到下面，台面变窄变高。 */
function layout(narrow: boolean): Layout & { narrow: boolean } {
  const controller: Record<string, [number, number]> = narrow
    ? {
        CM: [0, -6.2],
        uC1: [0, -2.6],
        uC2: [-1.6, -0.4],
        uP: [2.0, -0.4],
        CMD: [0, 2.0],
        uN: [-2.0, 4.6],
        ATL: [1.9, 4.6],
        uAR: [-2.0, 7.2],
        IR: [1.9, 7.2],
        PC: [1.9, 9.4],
      }
    : {
        CM: [-7.0, -5.4],
        CMD: [0.0, -5.4],
        uC1: [-6.77, -1.7],
        uC2: [-1.07, -1.7],
        uP: [1.53, -1.7],
        uAR: [-9.3, 2.4],
        ATL: [-5.8, 2.4],
        uN: [-2.0, 2.4],
        IR: [-5.8, 4.8],
        PC: [-2.0, 4.8],
      };
  const d = narrow ? datapath(-3.0, 17.0) : datapath(4.3, 0);
  return { narrow, pos: { ...controller, ...d.pos }, fan: d.fan, feed: d.feed, aluX: d.aluX, aluY: d.aluY, outX: d.outX, busZ: d.busZ, leftX: narrow ? -4.4 : -11.2 };
}

/** 控存的一行：1–17 位（按图 5.22 分成 3、3、3、3、5）、P_{1}P_{2}、下地址。 */
function cmRow(word: string): string[] {
  const parts = word.split(' ');
  return [parts.slice(0, 5).join(' '), parts[5] ?? '', parts[6] ?? ''];
}

/** marked：控存里要标成强调色的格子（弄坏它改过的那一格），写成 '行.列'。 */
export function microScene(trace: Trace<MicroParams, MicroState>, narrow: boolean, notes = false, marked: string[] = []): SceneSpec {
  const L = layout(narrow);
  const at = (id: string): [number, number] => L.pos[id]!;
  const above = (id: string, dz = 0.85): [number, number] => [at(id)[0], at(id)[1] - dz];
  const cm = trace.initial.cm;
  const reg = (id: string, name: string, width: number, extra: Partial<PartSpec> = {}): PartSpec =>
    ({ id, kind: 'register', position: at(id), props: { name, value: '', width }, pick: true, ...extra }) as PartSpec;
  const label = (id: string, text: string, position: [number, number]): PartSpec => ({ id, kind: 'label', position, props: { text, tone: 'muted' } });
  const parts: PartSpec[] = [
    {
      id: 'CM',
      kind: 'memory',
      position: at('CM'),
      title: '控制存储器',
      props: {
        name: '控制存储器',
        columns: [
          { title: '1–17 位', width: 4.3 },
          { title: 'P_{1}P_{2}', width: 1.05, ink: 'ctrl' },
          { title: '下地址', width: 1.25, ink: 'addr' },
          ...(notes ? [{ title: '做什么', width: 1.9 }] : []),
        ],
        rows: cm.map((row) => [...cmRow(row.word), ...(notes ? [row.note] : [])]),
        labels: cm.map((row) => row.addr),
        changedCells: marked,
      },
      pick: true,
    },
    reg('CMD', '微命令', 4.2, { title: '这条微指令发出的微命令' }),
    label('L-uC1', 'μIR 第 1–12 位', above('uC1')),
    label('L-uC2', '13–17 位', above('uC2')),
    label('L-uP', 'P_{1}P_{2}', above('uP')),
    { id: 'uC1', kind: 'bits', position: at('uC1'), props: { bits: ' '.repeat(12), group: 3 }, title: 'μIR 第 1–12 位', pick: true },
    { id: 'uC2', kind: 'bits', position: at('uC2'), props: { bits: ' '.repeat(5), group: 5 }, title: 'μIR 第 13–17 位', pick: true },
    { id: 'uP', kind: 'bits', position: at('uP'), props: { bits: '  ', group: 2, ink: 'ctrl' }, title: '判别字段 P_{1}P_{2}', pick: true },
    label('L-uAR', 'μAR', above('uAR')),
    label('L-uN', '下地址字段', above('uN')),
    { id: 'uN', kind: 'bits', position: at('uN'), props: { bits: '    ', ink: 'addr' }, title: '下地址字段', pick: true },
    { id: 'uAR', kind: 'bits', position: at('uAR'), props: { bits: FETCH_ADDRESS, ink: 'addr' }, title: '微地址寄存器 μAR', pick: true },
    reg('ATL', '地址转移逻辑', L.narrow ? 3.6 : 4.0),
    reg('IR', 'IR', 2.0, { title: 'IR 的操作码' }),
    reg('PC', 'PC', 1.6),
    reg('Cy', 'Cy', 1.3),
    reg('ALU', 'ALU', 2.8),
    reg('DR', 'DR', 1.5),
    reg('R1', 'R1', 1.5),
    reg('R2', 'R2', 1.5),
    reg('R3', 'R3', 1.5),
    { id: 'MX', kind: '5-micro:mux', position: at('MX'), props: { name: 'X', inputs: MUX.X.inputs, selected: '' }, title: 'X 端多路开关', pick: true, describe: (p) => `X 端${p['selected'] ? `接 ${String(p['selected'])}` : '没有选通'}` },
    { id: 'MY', kind: '5-micro:mux', position: at('MY'), props: { name: 'Y', inputs: MUX.Y.inputs, selected: '' }, title: 'Y 端多路开关', pick: true, describe: (p) => `Y 端${p['selected'] ? `接 ${String(p['selected'])}` : '没有选通'}` },
    { id: 'BUS', kind: 'bus', position: at('BUS'), props: { name: '总线', length: 7.4, value: '', showDriver: false, idleText: '' }, title: '公共总线' },
  ];
  const [, cmZ] = at('CM');
  const inputs: WireSpec[] = (['X', 'Y'] as const).flatMap((side) =>
    MUX[side].inputs.map((r): WireSpec => {
      const id = inputWire(r, side);
      const fan = L.fan[id];
      const pin = `${MUX[side].id}.${r}`;
      return fan === undefined ? { id, from: `${r}.n`, to: pin } : { id, from: `${r}.n`, to: pin, via: [[at(r)[0], fan], [pinX(at(MUX[side].id)[0], MUX[side].inputs.indexOf(r), MUX[side].inputs.length), fan]] };
    }),
  );
  const wires: WireSpec[] = [
    // μAR 送地址到控存（地址译码在抽屉柜左边）。
    { id: 'uar-cm', from: 'uAR.w', to: 'CM.w', via: [[L.leftX, at('uAR')[1]], [L.leftX, cmZ]], ink: 'addr' },
    ...(L.narrow
      ? [
          { id: 'un-atl', from: 'uN.e', to: 'ATL.w', ink: 'addr' as const },
          { id: 'up-atl', from: 'uP.s', to: 'ATL.n', via: [[at('uP')[0], at('ATL')[1] - 1.5], [at('ATL')[0] + 1.0, at('ATL')[1] - 1.5]] as [number, number][], ink: 'ctrl' as const },
          { id: 'atl-uar', from: 'ATL.s', to: 'uAR.e', via: [[at('ATL')[0] - 1.3, at('ATL')[1] + 1.1], [at('uAR')[0] + 1.75, at('ATL')[1] + 1.1], [at('uAR')[0] + 1.75, at('uAR')[1]]] as [number, number][], ink: 'addr' as const },
        ]
      : [
          { id: 'un-atl', from: 'uN.w', to: 'ATL.e', ink: 'addr' as const },
          { id: 'up-atl', from: 'uP.s', to: 'ATL.n', via: [[at('uP')[0], at('ATL')[1] - 1.25], [at('ATL')[0] + 1.0, at('ATL')[1] - 1.25]] as [number, number][], ink: 'ctrl' as const },
          { id: 'atl-uar', from: 'ATL.w', to: 'uAR.e', ink: 'addr' as const },
        ]),
    { id: 'ir-atl', from: 'IR.n', to: 'ATL.s', ink: 'ctrl' },
    // 运算器：各寄存器接到开关的口，开关接 ALU 的 X、Y 两端；ALU 的结果经总线回到寄存器。
    ...inputs,
    { id: 'MX-alu', from: 'MX.n', to: 'ALU.s', via: [[at('MX')[0], L.feed], [L.aluX, L.feed]] },
    { id: 'MY-alu', from: 'MY.n', to: 'ALU.s', via: [[at('MY')[0], L.feed], [L.aluY, L.feed]] },
    { id: 'alu-cy', from: 'ALU.w', to: 'Cy.e', ink: 'ctrl' },
    { id: 'alu-bus', from: 'ALU.e', to: 'BUS', via: [[L.outX, at('ALU')[1]], [L.outX, L.busZ]] },
    ...(['R1', 'R2', 'R3'] as const).map((r): WireSpec => ({ id: `bus-${r}`, from: 'BUS', to: `${r}.s` })),
  ];
  return { parts, wires, kinds: () => import('./parts') };
}

/** 开关第 i 个口的 x（和 parts.ts 的 PITCH 一致）。 */
const pinX = (center: number, i: number, n: number): number => center + (i - (n - 1) / 2) * 0.86;

/** 正在执行的那条微指令在控存的第几行：μIR 里的 23 位和哪一行相同。 */
function executing(state: MicroState): number {
  if (!state.uIR) return -1;
  const word = `${state.uIR.control}${state.uIR.p1}${state.uIR.p2}${state.uIR.next}`;
  return state.cm.findIndex((row) => clean(row.word) === word);
}
const rowOf = (state: MicroState, addr: string): number => state.cm.findIndex((row) => row.addr === addr);

export function microBind() {
  return bindTable<MicroState>({
    CM: {
      active: from('uAR', (c: Ctx) => rowOf(c.state, c.state.uAR)),
      open: from(['uIR.control', 'uIR.next'], (c: Ctx) => executing(c.state)),
    },
    CMD: { value: from('commands', (c: Ctx) => c.state.commands.join(' ')) },
    uC1: { bits: from('uIR.control', (c: Ctx) => (c.state.uIR ? c.state.uIR.control.slice(0, 12) : ' '.repeat(12))) },
    uC2: { bits: from('uIR.control', (c: Ctx) => (c.state.uIR ? c.state.uIR.control.slice(12) : ' '.repeat(5))) },
    uP: { bits: from(['uIR.p1', 'uIR.p2'], (c: Ctx) => (c.state.uIR ? `${c.state.uIR.p1}${c.state.uIR.p2}` : '  ')) },
    uN: { bits: from('uIR.next', (c: Ctx) => (c.state.uIR ? c.state.uIR.next : '    ')) },
    uAR: { bits: 'uAR' },
    // 地址转移逻辑这一拍做了什么：短写，数取自状态（P 字段、IR 的 OP、Cy）。
    ATL: {
      value: from('branch', (c: Ctx) => {
        const { branch, uIR, reg, Cy } = c.state;
        if (!branch || !uIR) return '';
        const parts: string[] = [];
        if (uIR.p1) parts.push(`P_1：并入 OP ${reg.IR ?? ''}`);
        if (uIR.p2) parts.push(`P_2：Cy=${Cy}${Cy === 0 ? '，末位置 1' : '，不改'}`);
        return parts.join('；') || '不测试';
      }),
    },
    IR: { value: from('reg.IR', (c: Ctx) => (c.state.reg.IR ? `OP ${c.state.reg.IR}` : '')) },
    PC: { value: from('reg.PC', (c: Ctx) => String(c.state.reg.PC)) },
    Cy: { value: from('Cy', (c: Ctx) => String(c.state.Cy)) },
    ALU: {
      value: from(['alu.fn', 'alu.out', 'commands'], (c: Ctx) => {
        const { alu, commands } = c.state;
        if (alu.fn && alu.out !== null) return `${alu.fn} → ${bin(alu.out)}`;
        return commands.find((name) => name === '+' || name === 'M' || name === '−') ?? '';
      }),
    },
    DR: { value: from('reg.DR', (c: Ctx) => bin(c.state.reg.DR)) },
    R1: { value: from('reg.R1', (c: Ctx) => bin(c.state.reg.R1)) },
    R2: { value: from('reg.R2', (c: Ctx) => bin(c.state.reg.R2)) },
    R3: { value: from('reg.R3', (c: Ctx) => bin(c.state.reg.R3)) },
    ...Object.fromEntries(
      (['X', 'Y'] as const).map((side) => [
        MUX[side].id,
        { selected: from('commands', (c: Ctx) => MUX[side].inputs.find((r) => c.state.commands.includes(`${r}→${side}`)) ?? '') },
      ]),
    ),
    BUS: {
      value: from('loaded', (c: Ctx) => (c.state.loaded.length && c.state.alu.out !== null ? bin(c.state.alu.out) : '')),
      drivers: (c: Ctx) => (c.state.loaded.length ? 'ALU' : ''),
    },
  });
}

/** 一条微指令的 1–17 位里，哪一位发哪个微命令落在哪个部件上。 */
const commandTarget = (name: string): string | null => {
  const mux = muxOf(name);
  if (mux) return mux;
  if (name === '+' || name === 'M' || name === '−') return 'ALU';
  return null;
};
const fromField = (name: string): string => (COMMANDS.indexOf(name) < 12 ? 'uC1' : 'uC2');

/** 一步里哪个值从哪走到哪。只看这一步的变化和状态。 */
export function microMoves(step: Step<MicroState>): Move[] {
  const s = step.state;
  const changed = new Set(step.changes.map((change) => change.at));
  const has = (prefix: string) => [...changed].some((path) => path === prefix || path.startsWith(`${prefix}.`));
  const out: Move[] = [];
  if (step.level === 'cycle' && s.uIR) {
    const row = executing(s);
    const word = s.cm[row]?.word.split(' ') ?? [];
    out.push({ value: s.uAR, from: 'uAR', to: `CM.${row}.0`, via: ['uar-cm'], ink: 'addr' });
    // 抽屉拉出，微指令条滑进 μIR：四段一起落下。
    out.push({ value: word.slice(0, 4).join(' '), from: `CM.${row}.0`, to: 'uC1', arc: true, phase: 1 });
    out.push({ value: word[4] ?? '', from: `CM.${row}.0`, to: 'uC2', arc: true, phase: 1 });
    out.push({ value: word[5] ?? '', from: `CM.${row}.1`, to: 'uP', arc: true, phase: 1, ink: 'ctrl' });
    out.push({ value: word[6] ?? '', from: `CM.${row}.2`, to: 'uN', arc: true, phase: 1, ink: 'addr' });
    // 1–17 位里为 1 的位发出微命令：电位沿控制线跑到门和 ALU。
    for (const name of s.commands) {
      const target = commandTarget(name);
      if (target) out.push({ value: name, from: fromField(name), to: target, arc: true, shape: 'level', phase: 2 });
    }
    return out;
  }
  if (has('reg.IR')) out.push({ value: 'LDIR', from: 'uC2', to: 'IR', arc: true, shape: 'pulse' });
  if (has('alu.out') && s.alu.fn && s.alu.out !== null) {
    // T1–T3：两个输入经打开的门进 ALU。数取自这一步的寄存器（打入要等 T4）。
    const sides: ['X' | 'Y', Reg | null][] = [['X', s.alu.x as Reg | null], ['Y', s.alu.y as Reg | null]];
    for (const [side, src] of sides) {
      if (!src) continue;
      out.push({ value: bin(s.reg[src]), from: src, to: 'ALU', via: [inputWire(src, side), `${MUX[side].id}-alu`] });
    }
  }
  if (has('loaded') && s.loaded.length && s.alu.out !== null) {
    for (const r of s.loaded) {
      out.push({ value: bin(s.alu.out), from: 'ALU', to: r, via: ['alu-bus', `bus-${r}`] });
      out.push({ value: `LD${r}`, from: 'uC1', to: r, arc: true, shape: 'pulse' });
    }
  }
  if (has('reg.PC') && !has('reg.IR')) out.push({ value: 'PC+1', from: 'uC2', to: 'PC', arc: true, shape: 'pulse' });
  if (has('branch') && s.branch && s.uIR) {
    const { p1, p2 } = s.uIR;
    out.push({ value: s.branch.field, from: 'uN', to: 'ATL', via: ['un-atl'], ink: 'addr' });
    out.push({ value: `${p1}${p2}`, from: 'uP', to: 'ATL', via: ['up-atl'], ink: 'ctrl' });
    if (p1 && s.reg.IR) out.push({ value: s.reg.IR, from: 'IR', to: 'ATL', via: ['ir-atl'], ink: 'ctrl' });
    if (p2) out.push({ value: `Cy=${s.Cy}`, from: 'Cy', to: 'ATL', arc: true, ink: 'ctrl' });
    out.push({ value: s.branch.modified, from: 'ATL', to: 'uAR', via: ['atl-uar'], ink: 'addr', phase: 1 });
  }
  return out;
}

/** 状态里整块从 null 变成对象（或反过来）的那一条变化不列：它的各个字段另有一条。 */
export function tidy(trace: Trace<MicroParams, MicroState>): Trace<MicroParams, MicroState> {
  return { ...trace, steps: trace.steps.map((step) => ({ ...step, changes: step.changes.filter((change) => change.at !== 'uIR' && change.at !== 'branch') })) };
}

/**
 * 控存不是图 5.25 时（练习、试一试里改过控存）：引擎的条件和 P_2 那一步的说明是按十进制加法写的，
 * 换成只讲这台机器的说法。只删改文字，不动状态。
 */
export function generalize(trace: Trace<MicroParams, MicroState>): Trace<MicroParams, MicroState> {
  const r = trace.initial.reg;
  const conditions = trace.conditions.map((c) => {
    if (c.label === '机器指令') return { label: '机器指令', value: `操作码 ${trace.params.op ?? '1010'}，控存按下面的抽屉柜` };
    if (c.label === '执行前') return { label: '执行前', value: `R1=${r.R1}，R2=${r.R2}，R3=${r.R3}，DR=${r.DR}，Cy=0` };
    return c;
  });
  const plain = (text: string) =>
    text
      .split('。')
      .filter((sentence) => !/a\+b|十进制/.test(sentence))
      .join('。');
  return { ...trace, conditions, steps: trace.steps.map((step) => ({ ...step, title: step.title.replace('十进制加法指令', '指令'), why: plain(step.why) })) };
}

/** 窄屏的镜头：每一步只看这一拍的主角，装得下 12 像素的字。宽屏看全景，不用它。 */
export function microFrame(step: Step<MicroState>): string[] | null {
  const s = step.state;
  const changed = (prefix: string) => step.changes.some((change) => change.at === prefix || change.at.startsWith(`${prefix}.`));
  if (step.level === 'cycle') return ['CM', 'uC1'];
  if (changed('branch')) return ['uAR', 'ATL', 'uN'];
  if (changed('reg.IR')) return ['IR', 'uC2'];
  if (changed('loaded') && s.loaded.length) return [...s.loaded, 'BUS'];
  if (changed('alu.out')) return ['ALU', 'MX'];
  if (changed('reg.PC')) return ['PC', 'uC2'];
  return null;
}

/** 舞台上方的读数。 */
export function microCaption(state: MicroState): string {
  if (!state.cycle) return '';
  const parts = [`第 ${state.cycle} 条微指令`, `μAR ${state.uAR}`];
  if (state.commands.length) parts.push(state.commands.join(' '));
  if (state.done) parts.push('回到取指');
  return parts.join('  ');
}

const pathNames: Record<string, string> = {
  uAR: '微地址寄存器 μAR',
  'uIR.control': 'μIR 第 1–17 位',
  'uIR.p1': 'P_1',
  'uIR.p2': 'P_2',
  'uIR.next': '下地址字段',
  uIR: '微指令寄存器 μIR',
  'alu.x': 'X 端',
  'alu.y': 'Y 端',
  'alu.fn': 'ALU 操作',
  'alu.out': 'ALU 输出',
  Cy: 'Cy',
  cycle: '第几条微指令',
  'branch.field': '下地址字段',
  'branch.test': 'P 测试',
  'branch.modified': '修改后的微地址',
  branch: '地址转移逻辑',
  done: '回到取指微指令',
  'reg.IR': 'IR 的 OP',
};

export function microNames(path: string): string {
  if (pathNames[path]) return pathNames[path];
  let m = /^reg\.(\w+)$/.exec(path);
  if (m) return m[1]!;
  m = /^commands(\.\d+)?$/.exec(path);
  if (m) return '微命令';
  m = /^loaded(\.\d+)?$/.exec(path);
  if (m) return 'T4 打入';
  return path;
}

export function microValues(path: string, value: string): string {
  if (path === 'done') return value === 'true' ? '是' : '否';
  if (/^reg\.(R\d|DR)$/.test(path) && /^\d+$/.test(value)) return `${bin(Number(value))}（${value}）`;
  return value;
}

/** 第 0 步：问题落在哪。 */
export function microQuestion(trace: Trace<MicroParams, MicroState>, narrow = false) {
  const fetch = trace.initial.cm.find((row) => row.addr === FETCH_ADDRESS);
  const field = fetch ? cmRow(fetch.word)[2] : FETCH_ADDRESS;
  return { text: `取指微指令的下地址字段写着 ${field}，下一条微指令却要去这条机器指令自己的微程序：看 P 字段、地址转移逻辑和 μAR`, at: narrow ? ['CM'] : ['CM', 'ATL', 'uAR'] };
}
export const MICRO_CONCLUSION =
  '下一条微地址 = 下地址字段，再按 P 字段改：P_1=1 把 IR 里的 OP 并进去，转到这条机器指令的微程序；P_2=1 按 Cy 改最低位；P_1、P_2 都是 0 就照下地址字段走。';
export const MICRO_NEEDS = [
  { href: '/5-cycle', text: '指令周期和 CPU 周期' },
  { href: '/5-timing', text: 'T1–T4 节拍' },
];

/** 本站约定：书上没说 − 和 M 改不改 Cy。 */
export function microConvention(step: Step<MicroState>): string | null {
  const fn = step.state.alu.fn;
  if (step.changes.some((change) => change.at === 'alu.fn') && (fn === '−' || fn === 'M')) {
    return `教材没说 ${fn} 改不改 Cy。本站按不改：Cy 留着上一次加法的进位。`;
  }
  return null;
}

// ---------- 改一位，交给引擎重跑 ----------

/** 把控存里 addr 号的微指令改一处，交给引擎重跑。跑不下去时返回引擎的说法。 */
export function rerun(params: MicroParams, addr: string, edit: (bits: string) => string): { trace: Trace<MicroParams, MicroState> | null; error: string; store: StoreWord[] } {
  const base = params.store ?? (run(params).initial.cm.map((row) => ({ addr: row.addr, word: row.word, note: row.note })) as StoreWord[]);
  const store = base.map((w) => (w.addr === addr ? { ...w, word: edit(clean(w.word)) } : { ...w }));
  try {
    return { trace: run({ ...params, store }), error: '', store };
  } catch (error) {
    return { trace: null, error: error instanceof Error ? error.message : String(error), store };
  }
}

const setBit = (bits: string, position: number, value: '0' | '1'): string => bits.slice(0, position - 1) + value + bits.slice(position);

/** 正确跑完和改坏以后，R2、Cy、路径各是什么（都由引擎算）。 */
function outcome(trace: Trace<MicroParams, MicroState> | null, error: string): string {
  if (!trace) return error;
  return `走 ${trace.result['执行路径']}，R2 = ${trace.result['R2']}，Cy = ${trace.result['Cy']}`;
}

/**
 * 弄坏它：P 测试的那一步把这条微指令的 P 字段写成 00，地址转移逻辑不改地址，μAR 照抄下地址字段。
 * 学生点地址转移逻辑、P 字段，或按按钮。
 */
export function microBreak(trace: Trace<MicroParams, MicroState>) {
  return (state: MicroState, part: string | null): Breakage | null => {
    if (!state.branch || !state.uIR || state.cycle === 0) return null;
    if (part !== null && part !== 'ATL' && part !== 'uP' && part !== 'uAR') return null;
    const { p1, p2 } = state.uIR;
    if (!p1 && !p2) return null;
    const row = state.cm[executing(state)];
    if (!row) return null;
    const broken = rerun(trace.params, row.addr, (bits) => setBit(setBit(bits, 18, '0'), 19, '0'));
    const field = state.branch.field;
    const into = rowOf(state, field);
    return {
      label: `弄坏它：把 ${row.addr} 号的 P 字段写成 00`,
      patch: { uAR: { bits: field }, uP: { bits: '00' }, ATL: { value: '不测试' }, CM: { active: into } },
      moves: [{ value: field, from: 'uN', to: 'uAR', via: ['un-atl', 'atl-uar'], ink: 'addr' }],
      message: `P 字段写成 00，地址转移逻辑不改地址，μAR 照抄下地址 ${field}，${into >= 0 ? `下一条读 ${field} 号单元` : `可 ${field} 号单元是空的`}。引擎重跑：${outcome(broken.trace, broken.error)}；原来${outcome(trace, '')}。`,
    };
  };
}

/** 答错下一微地址（位串题）时演后果：μAR 变成学生写的地址，控存里那一格亮起来（或是空的）。 */
export function microWrong(ask: Ask, value: string, state: MicroState, next: Step<MicroState> | null): Breakage | null {
  if (ask.kind !== 'bits' || !next?.state.branch || !state.uIR) return null;
  const said = value.replace(/[\s_]/g, '');
  if (!/^[01]{4}$/.test(said)) return null;
  const { field } = next.state.branch;
  const { p1, p2 } = state.uIR;
  const row = rowOf(state, said);
  let why: string;
  if (said === field && (p1 || p2)) why = `你照抄了下地址字段 ${field}，没做 P 测试。`;
  else if (p1) {
    const op = state.reg.IR ?? '';
    const bad = [...said].findIndex((bit, i) => bit !== next.state.branch!.modified[i]);
    why = `P_1=1 要把 OP ${op} 按位并进下地址 ${field}。从左数第 ${bad + 1} 位不对。`;
  } else if (p2) {
    why = said.slice(0, 3) !== field.slice(0, 3) ? `P_2 只动最低位，前三位照抄下地址 ${field}。` : `Cy=${state.Cy}：按图 5.25 的约定，Cy=0 才把最低位置 1。`;
  } else why = `P_1、P_2 都是 0，下地址字段 ${field} 原样送进 μAR。`;
  return {
    label: '',
    patch: { uAR: { bits: said }, CM: { active: row } },
    moves: [{ value: said, from: 'ATL', to: 'uAR', via: ['atl-uar'], ink: 'addr' }],
    message: `${why}${row >= 0 ? `μAR 是 ${said} 的话，下一条去读 ${said} 号单元${state.cm[row]!.note ? `「${state.cm[row]!.note}」` : ''}，走错了路。` : `μAR 是 ${said} 的话，控存 ${said} 号单元是空的，微程序跑丢了。`}`,
  };
}

/** 常见错误，每条在场景里演一遍。步数按这份 Trace 找，数都取自 Trace 或引擎重跑。 */
export function microMistakes(trace: Trace<MicroParams, MicroState>): Mistake<MicroState>[] {
  const steps = trace.steps;
  const out: Mistake<MicroState>[] = [];
  const p1At = steps.findIndex((step) => step.state.branch && step.state.uIR?.p1 === 1);
  if (p1At >= 0) {
    out.push({
      text: '容易以为下地址字段就是下一条微地址，因为没去看 P_1 那一位',
      at: p1At + 1,
      act: (state) => {
        const field = state.branch?.field ?? FETCH_ADDRESS;
        return {
          label: '',
          patch: { uAR: { bits: field }, ATL: { value: '不测试' }, CM: { active: rowOf(state, field) } },
          moves: [{ value: field, from: 'uN', to: 'uAR', via: ['un-atl', 'atl-uar'], ink: 'addr' }],
          message: `照抄下地址 ${field}，取指之后又回到 ${field} 号的取指微指令：机器一遍遍取指，永远进不了这条指令的微程序。P_1=1 时地址转移逻辑要把 IR 里的 OP 并进下地址。`,
        };
      },
    });
  }
  const p2At = steps.findIndex((step) => step.state.branch && step.state.uIR?.p2 === 1);
  if (p2At >= 0) {
    const st = steps[p2At]!.state;
    const row = st.cm[executing(st)];
    if (row) {
      // 记反了：Cy=0 时不置位，Cy=1 时置位。等于把最低位换成另一支，由引擎重跑。
      const wrong = st.branch!.modified.slice(0, 3) + (st.branch!.modified[3] === '1' ? '0' : '1');
      const broken = rerun(trace.params, row.addr, (bits) => setBit(bits.slice(0, 19) + wrong, 19, '0'));
      out.push({
        text: '容易把 P_2 的两支记反，以为 Cy=1 才去减 6，因为进位看着像「多了」',
        at: p2At + 1,
        act: (state) => ({
          label: '',
          patch: { uAR: { bits: wrong }, CM: { active: rowOf(state, wrong) } },
          moves: [{ value: wrong, from: 'ATL', to: 'uAR', via: ['atl-uar'], ink: 'addr' }],
          message: `记反了就去 ${wrong}。引擎按这一支重跑：${outcome(broken.trace, broken.error)}；正确的是${outcome(trace, '')}。Cy=1 说明 a+b+6 超过 15，即 a+b 大于 9，加 6 修正正好；Cy=0 才要把多加的 6 减回去。`,
        }),
      });
    }
  }
  const aluAt = steps.findIndex((step) => step.changes.some((change) => change.at === 'alu.out') && step.state.alu.out !== null && steps[steps.indexOf(step) + 1]?.state.loaded.length);
  if (aluAt >= 0) {
    const st = steps[aluAt]!.state;
    const target = steps[aluAt + 1]!.state.loaded[0] as Reg;
    out.push({
      text: `容易以为 LD${target}′ 一发出 ${target} 就变，因为它和 ${st.alu.fn} 写在同一条微指令里`,
      at: aluAt + 1,
      act: (state) => ({
        label: '',
        patch: { [target]: { value: '????' } },
        moves: [{ value: '????', from: 'ALU', to: target, via: ['alu-bus', `bus-${target}`] }],
        message: `LD${target}′ 是电位，要和 T4 相与才成为打入脉冲。T1 时 ALU 的输出还没稳定，这时打入 ${target} 的是没算完的数；${state.alu.x === target || state.alu.y === target ? `${target} 又正是 ALU 的输入，提前改掉它，ALU 算的就不是原来的数。` : '所以打入放在 T4。'}`,
      }),
    });
  }
  return out;
}

/** 预测题的镜头：问下一微地址时看 μAR、地址转移逻辑和它的输入。 */
export function microAskFrame(trace: Trace<MicroParams, MicroState>, narrow = false) {
  return (ask: Ask, index: number): string[] => {
    if (ask.kind !== 'bits') return [];
    const st = index > 0 ? trace.steps[index - 1]!.state : trace.initial;
    const ids = ['uAR', 'ATL', 'uN', 'uP'];
    if (st.uIR?.p1) ids.push('IR');
    // 窄屏上 Cy 在运算器那边，离得远；Cy 的值题面里已经写了。
    if (st.uIR?.p2 && !narrow) ids.push('Cy');
    return ids;
  };
}

/** μIR 里第 i 位（1 起）是哪个微命令。给练习的提示用。 */
export const commandAt = (position: number): string => COMMANDS[position - 1] ?? '';
export const positionOf = (name: string): number => COMMANDS.indexOf(name) + 1;
export { decode };
