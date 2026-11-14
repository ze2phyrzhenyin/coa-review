/**
 * 部件样张：每种部件摆一个，手写几步，看它们怎么变、怎么动。给写页面的人对照用，不是给学生的页面。
 * 打开 /5-cycle?demo=parts（浅色、深色跟随系统）；g= 选哪一组。
 */
import { useMemo } from 'preact/hooks';
import { useParam } from '../app/url-state';
import { TraceBuilder } from '../engines/trace';
import type { Step, Trace } from '../engines/trace';
import type { Binding, Move, Patch, SceneSpec } from '../scene';
import { Player } from './Player';

type State = Record<string, Patch>;

interface Group {
  id: string;
  name: string;
  scene: SceneSpec;
  steps: { title: string; why: string; set: State }[];
  moves?: Record<number, Move[]>;
}

const groups: Group[] = [
  {
    id: 'basic',
    name: '寄存器、总线、门',
    scene: {
      parts: [
        { id: 'OC', kind: 'register', position: [-3.6, -3.4], props: { name: '控制器', value: '', width: 2.2 } },
        { id: 'R1', kind: 'register', position: [-3.6, -0.6], props: { name: 'R1', value: '0011', width: 2.2 } },
        { id: 'R2', kind: 'register', position: [3.6, -0.6], props: { name: 'R2', value: '1100', width: 2.2 } },
        { id: 'C1', kind: 'gate', position: [-3.6, 1.2], props: { name: 'C1', open: false, dir: 's' } },
        { id: 'C2', kind: 'gate', position: [3.6, 1.2], props: { name: 'C2', open: false, dir: 's' } },
        { id: 'BUS', kind: 'bus', position: [0, 2.6], props: { name: '总线', length: 10, value: '' } },
        { id: 'DR', kind: 'register', position: [0, 4.6], props: { name: 'DR', value: '', width: 2.2 } },
      ],
      wires: [
        { id: 'r1-c1', from: 'R1.s', to: 'C1.n' },
        { id: 'r2-c2', from: 'R2.s', to: 'C2.n' },
        { id: 'c1-bus', from: 'C1.s', to: 'BUS' },
        { id: 'c2-bus', from: 'C2.s', to: 'BUS' },
        { id: 'bus-dr', from: 'BUS', to: 'DR.n' },
        { id: 'oc-c1', from: 'OC.s', to: 'C1.w', ink: 'ctrl', via: [[-5.2, -2.4], [-5.2, 1.2]] },
      ],
    },
    steps: [
      { title: '电位信号到门，门落下导通', why: '电位是一段扁平的条，沿控制线走到门；门落下搭上线时回弹一下。', set: { C1: { open: true }, BUS: { value: '0011', drivers: 'R1' } } },
      { title: '脉冲到 DR，值落进去，盖板合上', why: '脉冲是一根窄而高的尖块。值落进 DR 时旧值被顶出，盖板掀开再合上。', set: { DR: { value: '0011' } } },
      { title: '弄坏它：两个门同时导通', why: '第二张牌从右边撞上来，崩出碎片：总线冲突。', set: { C2: { open: true }, BUS: { value: '1100', drivers: 'R1、R2' } } },
    ],
    moves: {
      1: [
        { value: 'C1', from: 'OC', to: 'C1', via: ['oc-c1'], shape: 'level', phase: 0 },
        { value: '0011', from: 'R1', to: 'BUS', via: ['r1-c1', 'c1-bus'], phase: 1 },
      ],
      2: [
        { value: '0011', from: 'BUS', to: 'DR', via: ['bus-dr'], phase: 0 },
        { value: 'LDDR', from: 'OC', to: 'DR', arc: true, shape: 'pulse', phase: 0 },
      ],
    },
  },
  {
    id: 'table',
    name: '存储阵列、位片、比较',
    scene: {
      parts: [
        { id: 'MEM', kind: 'memory', position: [-3.2, -1.2], props: { name: '主存', columns: [{ title: '内容', width: 1.6 }], rows: [['块 0'], ['块 1'], ['块 2'], ['块 3']], labels: ['0', '1', '2', '3'] } },
        { id: 'CMP', kind: 'compare', position: [3.4, -1.6], props: { name: '比标记', left: '101', right: '101', leftName: '地址', rightName: '行' } },
        { id: 'SUM', kind: 'bits', position: [3.4, 2.4], props: { name: '和', bits: '0111' } },
      ],
      wires: [],
    },
    steps: [
      { title: '抽屉拉开：读第 2 块', why: 'memory 的 open 让这一行向前滑出。', set: { MEM: { open: 2, active: 2 } } },
      { title: '标记一致：两张卡扣上', why: 'compare 的 result 为 match。', set: { CMP: { result: 'match' } } },
      { title: '标记不一致：碰一下弹开', why: 'result 为 mismatch。', set: { CMP: { right: '110', result: 'mismatch' }, MEM: { open: -1, active: -1 } } },
      { title: '加 1，进位跳到左边一列', why: 'bits 的 carry 是产生进位的列。', set: { SUM: { bits: '1000', carry: 1 } } },
    ],
  },
  {
    id: 'chip',
    name: '芯片、译码器、信号线',
    scene: {
      parts: [
        { id: 'DEC', kind: 'decoder', position: [-4.6, 0], props: { inputs: ['A_11', 'A_10'], input: '', enable: false, low: true } },
        { id: 'U0', kind: 'chip', position: [2.4, -2.2], props: { name: '1K×8', label: '芯片 0', pins: [{ id: 'addr', name: 'A_9–A_0', side: 'w', lines: 4 }, { id: 'cs', name: 'CS', side: 's', ink: 'ctrl' }] } },
        { id: 'U1', kind: 'chip', position: [2.4, 2.2], props: { name: '1K×8', label: '芯片 1', pins: [{ id: 'addr', name: 'A_9–A_0', side: 'w', lines: 4 }, { id: 'cs', name: 'CS', side: 'n', ink: 'ctrl' }] } },
        { id: 'S0', kind: 'signal', position: [0, 0], props: { from: 'DEC.y0', to: 'U0.cs', text: 'Y_0', via: [[-1.4, -0.93], [-1.4, -0.4], [2.4, -0.4]] } },
        { id: 'S1', kind: 'signal', position: [0, 0], props: { from: 'DEC.y1', to: 'U1.cs', text: 'Y_1', via: [[-0.6, -0.31], [-0.6, 0.4], [2.4, 0.4]] } },
      ],
      wires: [],
    },
    steps: [
      { title: '地址高两位给译码器', why: 'decoder 的 input 是输入位串；哪根输出有效由引擎给（active）。', set: { DEC: { input: '01', enable: true, active: 1 } } },
      { title: 'Y_1 有效，片选线从译码器伸到芯片 1', why: 'signal 的 on 为真时，实色从起点走到终点。', set: { S1: { on: true } } },
      { title: '芯片 1 被选中，从板上抬起', why: 'chip 的 selected 为真时抬起，落定回弹一下。', set: { U1: { selected: true, pins: [{ id: 'addr', name: 'A_9–A_0', side: 'w', lines: 4, value: '0000000101' }, { id: 'cs', name: 'CS', side: 'n', ink: 'ctrl', value: '0' }] } } },
    ],
  },
  {
    id: 'grid',
    name: '时空格',
    scene: {
      parts: [
        {
          id: 'PIPE',
          kind: 'grid',
          position: [0, 0],
          props: { name: '时空图', columns: ['1', '2', '3', '4', '5', '6', '7'], rows: ['IF', 'ID', 'EX', 'WB'], cells: [[], [], [], []], cellWidth: 0.78 },
        },
      ],
      wires: [],
    },
    steps: [
      { title: '第 1 个周期：I_1 取指', why: 'cells 里填上的格子从空槽翻成白牌；current 框出当前列。', set: { PIPE: { cells: [['I_1'], [], [], []], current: 0 } } },
      { title: '第 2 个周期：I_1 译码，I_2 取指', why: '同一列从上往下错开翻。', set: { PIPE: { cells: [['I_1', 'I_2'], ['', 'I_1'], [], []], current: 1 } } },
      { title: '第 3 个周期：I_2 停一拍', why: 'bubbles 里的格子放一个空泡。', set: { PIPE: { cells: [['I_1', 'I_2', 'I_3'], ['', 'I_1', ''], ['', '', 'I_1'], []], current: 2, bubbles: ['1.2'] } } },
    ],
  },
  {
    id: 'track',
    name: '时间轴、程序卡',
    scene: {
      parts: [
        {
          id: 'T',
          kind: 'track',
          position: [0, -1.6],
          props: { name: '中断嵌套', length: 7.2, span: [0, 12], lanes: ['主程序', 'A', 'B'], segments: [], ticks: [{ at: 0, text: '0' }, { at: 4, text: '4' }, { at: 8, text: '8' }, { at: 12, text: '12' }] },
        },
        { id: 'STK', kind: 'stack', position: [0, 3.0], props: { name: '程序卡', cards: [{ title: '主程序' }] } },
      ],
      wires: [],
    },
    steps: [
      { title: '主程序运行到 3', why: 'track 的 segments 是一段段条，新出现的从左往右长出来；now 是竖线。', set: { T: { segments: [{ lane: 0, from: 0, to: 3, ink: 'data' }], now: 3 } } },
      {
        title: 'A 请求，响应中断',
        why: '新卡从上方落下，压住主程序那张；卡角写着断点。',
        set: { T: { segments: [{ lane: 0, from: 0, to: 3, ink: 'data' }, { lane: 1, from: 3, to: 6, ink: 'data', text: 'A 服务' }], markers: [{ at: 3, text: 'A 请求', lane: 1 }], now: 6 }, STK: { cards: [{ title: '主程序', note: '断点 1003' }, { title: 'A 服务程序' }] } },
      },
      {
        title: 'A 返回',
        why: '最上面那张被抽走，下面那张重新露出来。',
        set: { T: { segments: [{ lane: 0, from: 0, to: 3, ink: 'data' }, { lane: 1, from: 3, to: 6, ink: 'data', text: 'A 服务' }, { lane: 0, from: 6, to: 9, ink: 'data' }], markers: [{ at: 3, text: 'A 请求', lane: 1 }], now: 9 }, STK: { cards: [{ title: '主程序' }] } },
      },
    ],
  },
  {
    id: 'dial',
    name: '刻度盘、节拍盘',
    scene: {
      parts: [
        {
          id: 'D',
          kind: 'dial',
          position: [-2.4, 0],
          props: { name: '模 16', size: 16, pointer: 3, seam: 8, marks: [[0, '0'], [3, '+3'], [7, '+7'], [8, '−8'], [12, '−4']] },
        },
        { id: 'BEAT', kind: 'dial', position: [3.4, 0], props: { name: '节拍', size: 4, pointer: 0, sectors: true, marks: [[0, 'T_1'], [1, 'T_2'], [2, 'T_3'], [3, 'T_4']] } },
      ],
      wires: [],
    },
    steps: [
      { title: '3 加 2：指针顺时针转两格', why: 'from 是起点，转过的那段画成弧。', set: { D: { from: 3, pointer: 5 }, BEAT: { pointer: 1 } } },
      { title: '5 加 4：越过 +7 和 −8 之间的接缝', why: 'crossed 为真时，指针经过接缝的那一刻接缝亮起：溢出。', set: { D: { from: 5, pointer: 9, crossed: true }, BEAT: { pointer: 2 } } },
    ],
  },
  {
    id: 'move',
    name: '天平、传送带',
    scene: {
      parts: [
        { id: 'BAL', kind: 'balance', position: [-3.2, -0.4], props: { name: '比较', left: '0110', right: '0101', leftName: '余数', rightName: '除数', tilt: 0 } },
        { id: 'CONV', kind: 'conveyor', position: [3.2, 0], props: { name: '页框', slots: 3, items: ['', '', ''] } },
      ],
      wires: [],
    },
    steps: [
      { title: '余数比除数大：左边沉', why: 'balance 的 tilt 为 -1。', set: { BAL: { tilt: -1 }, CONV: { items: ['2', '', ''] } } },
      { title: '新页 3 从 a 端进', why: 'conveyor 按字认出谁挪到了哪：新的落进来，其余往 c 端让。', set: { CONV: { items: ['3', '2', ''] }, BAL: { left: '0001', tilt: 1 } } },
      { title: '再进两页，2 从 c 端掉下去', why: '不在 items 里的那张从 c 端掉下去。', set: { CONV: { items: ['5', '4', '3'] } } },
      { title: '命中 4：拎回 a 端', why: '往 a 端回去的那张抬起来从上面过。', set: { CONV: { items: ['4', '5', '3'] } } },
    ],
  },
  {
    id: 'local',
    name: '页面自带部件',
    scene: {
      parts: [
        { id: 'L', kind: 'gallery:lamp', position: [-1.6, 0], props: { name: '中断请求', on: false } },
        { id: 'R', kind: 'register', position: [1.8, 0], props: { name: 'IM', value: '000', width: 2.2 } },
      ],
      wires: [{ id: 'l-r', from: 'L', to: 'R', ink: 'ctrl' }],
      kinds: () => import('./gallery-parts'),
    },
    steps: [{ title: '灯亮', why: '这盏灯是用 definePart 登记的部件（src/player/gallery-parts.ts）。', set: { L: { on: true }, R: { value: '011' } } }],
    moves: { 1: [{ value: 'INTR', from: 'L', to: 'R', via: ['l-r'], shape: 'pulse' }] },
  },
];

function merge(target: State, patch: State): void {
  for (const [id, props] of Object.entries(patch)) target[id] = { ...(target[id] ?? {}), ...props };
}

function traceOf(group: Group): Trace<null, State> {
  // 初始状态就是各部件声明的属性：「变化」里只列出真正变了的那几项。
  const initial: State = Object.fromEntries(group.scene.parts.map((part) => [part.id, JSON.parse(JSON.stringify(part.props)) as Patch]));
  const builder = new TraceBuilder<null, State>(`gallery-${group.id}`, null, initial, [{ label: '部件', value: group.name }]);
  for (const step of group.steps) builder.step({ level: 'explain', title: step.title, why: step.why, update: (s) => merge(s, step.set) });
  return builder.finish({}, { columns: [], rows: [] });
}

const bind: Binding<State> = {
  props: (context) => context.state,
  partsFor: (path) => [path.split('.')[0] ?? path],
};

export function Gallery() {
  const [chosen, setChosen] = useParam('g', 'basic', (raw) => (groups.some((group) => group.id === raw) ? raw : 'basic'));
  const group = groups.find((item) => item.id === chosen) ?? groups[0]!;
  const trace = useMemo(() => traceOf(group), [group]);
  const moves = useMemo(() => (step: Step<State>) => group.moves?.[trace.steps.indexOf(step) + 1] ?? [], [group, trace]);
  return (
    <Player key={group.id} trace={trace} scene={group.scene} bind={bind} moves={moves}>
      <label class="pl-select is-always">
        <span class="pl-choice-label">部件</span>
        <select value={group.id} onChange={(event) => setChosen(event.currentTarget.value)}>
          {groups.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
    </Player>
  );
}
