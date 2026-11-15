/**
 * 场景的声明式描述。页面只写：有哪些部件、摆在哪、怎么连、状态怎么变成部件的属性。
 * 画面是当前步状态的纯函数。这个文件不引用 three.js，页面和播放器可以直接引用。
 * 约定见 specs/_scene-contract.md。
 */
import type { Step } from '../engines/trace';
import type { Ink, Tone } from './theme';

/** 台面上的位置 [x, z]：x 向右，z 朝向观看的人。 */
export type Vec2 = readonly [number, number];

/** 每个部件都认的属性。focus、changed 由播放器按当前步填，页面一般不写。 */
export interface CommonProps {
  /** 当前步的焦点：台面上画一圈框。 */
  focus?: boolean;
  /** 这一步变了：强调色。 */
  changed?: boolean;
  /** 正在等学生点选：画虚线框。 */
  pickable?: boolean;
  hidden?: boolean;
}

export interface RegisterProps extends CommonProps {
  name: string;
  value: string;
  ink?: Ink;
  /** 本体宽度，默认 2.4。 */
  width?: number;
}

export interface BusProps extends CommonProps {
  name: string;
  /** 沿 x 方向的长度。 */
  length: number;
  /** 总线上的值。空串表示没有部件驱动。 */
  value: string;
  /** 正在驱动总线的部件名。数组，或用顿号、逗号隔开的字符串。两个以上是冲突。 */
  drivers?: string[] | string;
  ink?: Ink;
  /** 值牌停在总线上的位置（相对中心的 x）。默认靠中间，并避开左端的名牌。可以随状态变：让牌停在驱动者正对的地方。 */
  tileAt?: number;
  /** 在值牌旁写「X 驱动」，默认写。 */
  showDriver?: boolean;
  /** 没有部件驱动时导轨左端的字，默认「没有部件驱动」；空串不写。 */
  idleText?: string;
}

export interface GateProps extends CommonProps {
  name: string;
  /** 导通。也接受 '1'、'true'。 */
  open: boolean | string;
  /** 数据流向：n 远离观看者，s 朝向观看者，e 向右，w 向左。 */
  dir?: 'n' | 's' | 'e' | 'w';
  ink?: Ink;
  /** 状态文字，[关, 开]。 */
  states?: readonly [string, string];
}

export interface MemoryColumn {
  title: string;
  /** 列宽，默认按内容。 */
  width?: number;
  ink?: Ink;
}

export interface MemoryProps extends CommonProps {
  /** 单独框出一个格子，写成 '行.列'。 */
  cell?: string;
  name: string;
  columns: MemoryColumn[];
  /** 每行各列的文字。 */
  rows: string[][];
  /** 行左侧的标号（行号、地址）。 */
  labels?: string[];
  /** 正在访问的行，-1 或不写表示没有。 */
  active?: number;
  /** 这一步变了的格子，写成 '行.列'。 */
  changedCells?: string[];
  /** 拉开的抽屉：这几行向前滑出（读出、写回的那一块），-1、空数组或不写表示都关着。 */
  open?: number | number[];
}

export interface BitsProps extends CommonProps {
  name?: string;
  /** 位串，左边是高位。0、1 以外的字符（空格、下划线）是还没写的空槽。 */
  bits: string;
  /** 相邻两位的中心距，默认 0.56。要和别的部件的列对齐时用。 */
  pitch?: number;
  /** 产生进位的列（从左数，0 起）。进位牌落在它左边一列的上方。 */
  carry?: number | null;
  /** 每几位空一格，默认 4。 */
  group?: number;
  /** 多位同时翻时从哪边开始，默认从右（低位）开始。 */
  from?: 'right' | 'left';
  ink?: Ink;
}

export interface TokenProps extends CommonProps {
  value: string;
  /** 停在哪个部件上。变了就沿 via 的连线走过去。 */
  at: string;
  via?: string[];
  ink?: Ink;
}

export interface SheetProps extends CommonProps {
  title?: string;
  columns: string[];
  rows: string[][];
  /** 已填的行数。 */
  shown: number;
  /** 当前步对应的行，-1 表示没有。 */
  current?: number;
}

export interface LabelProps extends CommonProps {
  text: string;
  /** 字高，世界单位。 */
  size?: number;
  tone?: Tone;
  weight?: number;
  /** 画在一块小牌上。 */
  plate?: boolean;
  mono?: boolean;
}

/** 芯片的一组引脚：地址线、数据线、片选、读写。 */
export interface PinGroup {
  /** 连线端点用：'U1.addr'。 */
  id: string;
  /** 名牌上的字，例如 'A_0–A_9'、'CS'、'WE'。 */
  name: string;
  side: 'n' | 's' | 'e' | 'w';
  /** 引脚上现在的值（电平、地址），空串不画值牌。 */
  value?: string;
  /** 一束有几根线（画几根腿），默认 1。 */
  lines?: number;
  /** 在这条边上的位置（相对部件中心，沿边的方向，世界单位）。不写时同一边的几组均匀排开。 */
  at?: number;
  ink?: Ink;
}

export interface ChipProps extends CommonProps {
  /** 芯片型号或容量，例如 '1K×4'。 */
  name: string;
  /** 芯片中间的大字，例如 '芯片 3'。 */
  label?: string;
  pins: PinGroup[];
  /** 被片选选中：芯片从板上抬起。 */
  selected?: boolean | string;
  width?: number;
  depth?: number;
}

export interface DecoderProps extends CommonProps {
  /** 默认「n-2^n 译码器」。 */
  name?: string;
  /** 输入线的名字，高位在前，例如 ['A_15', 'A_14', 'A_13']。 */
  inputs: string[];
  /** 输入现在的值，与 inputs 一一对应的位串，例如 '101'；空串表示还没给。 */
  input?: string;
  /** 使能端的名字，默认 'G'；空串表示没有使能端。 */
  enableName?: string;
  /** 使能端是否有效。 */
  enable?: boolean | string;
  /** 输出个数，默认 2^inputs.length。 */
  outputs?: number;
  /** 输出名，默认 Y_0、Y_1…… */
  outputNames?: string[];
  /** 有效的输出（0 起），-1 或不写表示没有。由引擎给出，部件不自己译码。 */
  active?: number;
  /** 输出低电平有效：有效的那根写 0，其余写 1；默认高电平有效。 */
  low?: boolean;
}

export interface GridProps extends CommonProps {
  name?: string;
  /** 列头（时间、时钟周期、访问次序）。 */
  columns: string[];
  /** 行头（流水段、页框、设备）。 */
  rows: string[];
  /** cells[行][列]，空串是还没填的空格。 */
  cells: string[][];
  /** 当前列，框出来；-1 或不写表示没有。 */
  current?: number;
  /** 这一步变了的格子 '行.列'。 */
  changedCells?: string[];
  /** 停顿（空泡）的格子 '行.列'：格子里放一个空泡，不写字。 */
  bubbles?: string[];
  /** 格子宽度，默认按全部格子里最长的字估。整个 Trace 里最长的字要放得下（字放不下会缩小）。 */
  cellWidth?: number;
  /** 每列的墨色或强调：'行.列' → 'data' | 'addr' | 'ctrl' | 'accent'。 */
  tones?: Record<string, Ink | 'accent'>;
}

export interface TrackSegment {
  /** 第几条道（0 起）。 */
  lane: number;
  from: number;
  to: number;
  text?: string;
  ink?: Ink | 'accent' | 'muted';
  /** 画成高电平（抬起的一段），总线时序用。 */
  high?: boolean;
}

export interface TrackMarker {
  at: number;
  text: string;
  /** 落在哪条道上，默认第 0 条。 */
  lane?: number;
  ink?: Ink | 'accent';
}

export interface TrackProps extends CommonProps {
  name?: string;
  /** 时间轴在台面上的长度（世界单位）。 */
  length: number;
  /** 时间范围 [起, 止]。 */
  span: [number, number];
  /** 每条道左边的名字。 */
  lanes: string[];
  segments: TrackSegment[];
  markers?: TrackMarker[];
  /** 刻度：位置和文字。 */
  ticks?: { at: number; text: string }[];
  /** 现在的时刻：一根竖线，随步平滑移动；不写不画。 */
  now?: number;
  /** 画进入、返回的竖线：一段结束、另一条道上的一段在同一时刻开始的地方，把两条道连起来（中断的运行轨迹）。 */
  connect?: boolean;
}

export interface SignalProps extends CommonProps {
  /** 起点部件，可带边或引脚：'ARB.e'、'U1.cs'。 */
  from: string;
  to: string;
  /** 线旁的字，例如 'BR'、'BG'。 */
  text: string;
  /** 信号有效：线换成实色，从起点往终点走一遍。 */
  on?: boolean | string;
  ink?: Ink;
  /** 中途的拐点。 */
  via?: Vec2[];
  /** 两端都往线的切向挪多少，几条平行线（BR、BG、BS）用它错开。 */
  offset?: number;
  /** 字放在线上的哪里，0 是起点，1 是终点，默认 0.5。 */
  labelAt?: number;
  /** 'both' 画两头的箭头。默认只画终点。 */
  heads?: 'end' | 'both' | 'none';
}

export interface DialProps extends CommonProps {
  name?: string;
  /** 一圈有几格（模）。大于 32 时只画有字的刻度。 */
  size: number;
  /** 指针指的格（0 起，顺时针，0 在正上方）。 */
  pointer: number;
  /** 这一步从哪一格转过来：从 from 到 pointer 之间画一段弧，转的方向由 dir 定。不写不画弧。 */
  from?: number;
  /** 1 顺时针（加），-1 逆时针（减）。默认 1。 */
  dir?: 1 | -1;
  /** 刻度上的字：[格, 字]。 */
  marks?: [number, string][];
  /** 接缝在第几格之前（例如 +最大 和 −最小 之间）。不写不画。 */
  seam?: number;
  /** 指针越过了接缝：接缝亮起强调色。 */
  crossed?: boolean | string;
  /** 扇区模式（节拍盘）：每格是一块扇形，指针那一格亮起。 */
  sectors?: boolean;
  /** 盘的半径，默认按 marks 的字数定。 */
  radius?: number;
  ink?: Ink;
}

export interface BalanceProps extends CommonProps {
  name?: string;
  left: string;
  right: string;
  leftName?: string;
  rightName?: string;
  /** -1 左边沉，1 右边沉，0 平。也接受字符串。 */
  tilt: number | string;
}

export interface ConveyorProps extends CommonProps {
  name?: string;
  /** 槽位数。 */
  slots: number;
  /** 从 a 端（左）到 c 端（右）每个槽里的东西，空串是空槽。同一行里的字互不相同，部件按字认出谁移到了哪。 */
  items: string[];
  /** 进口、出口的字，默认 'a'、'c'。 */
  inLabel?: string;
  outLabel?: string;
  /** 槽宽，默认 1.0。 */
  slotWidth?: number;
}

export interface StackCard {
  title: string;
  /** 卡角上的字（断点）。 */
  note?: string;
}

export interface CardStackProps extends CommonProps {
  name?: string;
  /** 从下到上，最上面的是正在运行的。 */
  cards: StackCard[];
  /** 卡宽，默认 3.2。 */
  width?: number;
}

export interface CompareProps extends CommonProps {
  name?: string;
  left: string;
  right: string;
  leftName?: string;
  rightName?: string;
  /** 'match' 一致扣上，'mismatch' 不一致弹开，空串两张卡分开放着。 */
  result?: 'match' | 'mismatch' | '' | string;
}

export interface PartPropsByKind {
  register: RegisterProps;
  bus: BusProps;
  gate: GateProps;
  memory: MemoryProps;
  bits: BitsProps;
  token: TokenProps;
  sheet: SheetProps;
  label: LabelProps;
  chip: ChipProps;
  decoder: DecoderProps;
  grid: GridProps;
  track: TrackProps;
  signal: SignalProps;
  dial: DialProps;
  balance: BalanceProps;
  conveyor: ConveyorProps;
  stack: CardStackProps;
  compare: CompareProps;
}

export type PartKind = keyof PartPropsByKind;

/** 页面自带的部件种类：'<页面编号>:<名字>'，例如 '6-arbiter:baton'。用 definePart 登记（见 define.ts）。 */
export type LocalKind = `${string}:${string}`;

interface PartSpecBase {
  id: string;
  position: Vec2;
  /** 可点选：播放器为它生成 button[data-pick]。 */
  pick?: boolean;
  /** 给读屏和平面模式的说法，默认用 props.name。 */
  title?: string;
  /** 原地翻面时晚多少毫秒开始。一排部件同时变时逐个错开 20–40 毫秒。 */
  delay?: number;
}

export type PartSpec =
  | {
      [K in PartKind]: PartSpecBase & {
        kind: K;
        /** 不随步骤变的属性。绑定给出的属性盖在它上面。 */
        props: PartPropsByKind[K];
      };
    }[PartKind]
  | (PartSpecBase & {
      kind: LocalKind;
      props: CommonProps & Record<string, unknown>;
      /** 平面模式和读屏的一句读数。不写时用「名字，value」。 */
      describe?: (props: Patch) => string;
    });

/**
 * 连线。端点写部件 id，可带出口：'R1.s'（n、s、e、w 四个边）。不写出口时取朝向对方的那一边。
 * 端点是总线时，接在对方正对的位置。via 是中途的拐点。
 */
export interface WireSpec {
  id: string;
  from: string;
  to: string;
  via?: Vec2[];
  ink?: Ink;
}

export interface SceneSpec {
  parts: PartSpec[];
  wires: WireSpec[];
  /** 页面自带部件的模块：() => import('./parts')。播放器在建场景前加载它，模块里用 definePart 登记。 */
  kinds?: () => Promise<unknown>;
}

/** 一次值的移动：哪个值，从哪个部件，沿哪些连线，到哪个部件。同一步里的几个移动一起动。
 * from、to 可以写成存储阵列的一个格子：'mem.3.1'（部件 id.行.列）。 */
export interface Move {
  value: string;
  from: string;
  to: string;
  /** 依次经过的连线 id。相邻两条线的端点不重合时走直线接上（例如沿总线）。 */
  via?: string[];
  ink?: Ink;
  /** 先后次序：0 先走，1 等 0 落下再走，依此类推。同一个数的几个移动一起走。 */
  phase?: number;
  /** 不沿连线时抬高再落下（例如进位跳到左边一列）。 */
  arc?: boolean;
  /**
   * 走的是什么：'card' 值牌（默认）；'pulse' 脉冲（一个窄的尖块，到了让部件打入）；'level' 电位（一段扁平的条，到了让门、部件变状态）。
   * 信号到达时，接收的部件按这一步的属性原地变化，不把 value 写进去；value 写信号名，例如 'LDDR'。
   */
  shape?: 'card' | 'pulse' | 'level';
}

export interface BindContext<S> {
  state: S;
  /** flatten(state)：路径 → 字符串。 */
  flat: Record<string, string>;
  /** 0 是初始状态。 */
  index: number;
  /** 到达这个状态的那一步；初始状态时为 null。 */
  step: Step<S> | null;
  /** 这一步变了的路径。 */
  changed: ReadonlySet<string>;
}

export type Patch = Record<string, unknown>;

/** 状态到部件属性的绑定。 */
export interface Binding<S> {
  /** 部件 id → 要盖上去的属性。 */
  props(context: BindContext<S>): Record<string, Patch>;
  /** 状态路径（或部件 id）对应哪些部件。用来把 step.focus、step.changes 落到部件上。 */
  partsFor(path: string): string[];
}

/** 一步的目标画面。场景只认它。 */
export interface Pose {
  parts: Record<string, Patch>;
  /** 这一步里有值走过的连线。 */
  wires: Record<string, boolean>;
}
