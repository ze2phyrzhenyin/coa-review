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
}

export interface BitsProps extends CommonProps {
  name?: string;
  /** 位串，只含 0 和 1，左边是高位。 */
  bits: string;
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

export interface PartPropsByKind {
  register: RegisterProps;
  bus: BusProps;
  gate: GateProps;
  memory: MemoryProps;
  bits: BitsProps;
  token: TokenProps;
  sheet: SheetProps;
  label: LabelProps;
}

export type PartKind = keyof PartPropsByKind;

export type PartSpec = {
  [K in PartKind]: {
    id: string;
    kind: K;
    position: Vec2;
    /** 不随步骤变的属性。绑定给出的属性盖在它上面。 */
    props: PartPropsByKind[K];
    /** 可点选：播放器为它生成 button[data-pick]。 */
    pick?: boolean;
    /** 给读屏和平面模式的说法，默认用 props.name。 */
    title?: string;
  };
}[PartKind];

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
}

/** 一次值的移动：哪个值，从哪个部件，沿哪些连线，到哪个部件。同一步里的几个移动一起动。 */
export interface Move {
  value: string;
  from: string;
  to: string;
  /** 依次经过的连线 id。相邻两条线的端点不重合时走直线接上（例如沿总线）。 */
  via?: string[];
  ink?: Ink;
  /** 先后次序：0 先走，1 等 0 落下再走，依此类推。同一个数的几个移动一起走。 */
  phase?: number;
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
