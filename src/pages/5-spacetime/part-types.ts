/**
 * 流水线三页自带部件的属性。这个文件不引用 three.js，scene.ts 和页面可以直接引用。部件本身在 parts.ts。
 */
import type { CommonProps } from '../../scene';

export type LinkKind = 'RAW' | 'WAR' | 'WAW';
/** 线和小牌的颜色：普通墨色、强调（这一步的主角）、错、淡（已经看过的）。 */
export type LinkTone = '' | 'hot' | 'bad' | 'faint';

/** 装配线。items 是每个工位里的东西：'' 空，'I3' 一个指令盒子，'~5' 一个空泡（~ 后面是它的编号，用来认出它挪到了哪）。 */
export interface LineProps extends CommonProps {
  name?: string;
  stations: string[];
  /** 工位名旁边的小字（取指、译码…），窄屏不写。 */
  notes?: string[];
  items: string[];
  /** 每个工位的盒子上方的小牌（读 R1、等 R1、R1 旧值）。 */
  tags?: string[];
  tones?: LinkTone[];
  /** 盒子的牌换强调色、错色的工位。 */
  hot?: number[];
  bad?: number[];
  /** 还没进流水线的指令，按先后。第一条放在进口的托盘上。 */
  queue?: string[];
  /** 已经做完的条数。 */
  done?: number;
  /** 定向：结果从一个工位抛到另一个工位。 */
  pass?: { from: number; to: number; text: string } | null;
  /** 撞车的工位（拿着错的值往前走），-1 没有。 */
  crash?: number;
  stationWidth?: number;
  padWidth?: number;
  /** 窄屏：进出口的字短一点（不写「条」）。 */
  compact?: boolean;
}

export interface ChartLink {
  /** '行.列'。 */
  from: string;
  to: string;
  style?: LinkKind;
  tone?: LinkTone;
  /** 弯的程度，0 是直线。 */
  bend?: number;
}

/** 时空图。 */
export interface ChartProps extends CommonProps {
  name?: string;
  /** 左上角的字，例如「段＼周期」。 */
  corner?: string;
  columns: string[];
  rows: string[];
  /** 行名可能换成的写法（量宽度用）。 */
  rowChoices?: string[];
  cells: string[][];
  current?: number;
  changedCells?: string[];
  /** 实心强调色的格子。 */
  hotCells?: string[];
  /** 错色框出的格子。 */
  badCells?: string[];
  /** 空泡（停顿）的格子。 */
  bubbles?: string[];
  /** 墨色框出的格子（答题纸上正在填的那一格）。 */
  picked?: string;
  /** 翻牌晚多少毫秒开始（等装配线先动）。 */
  lag?: number;
  /** 手机上镜头只看当前列附近的几列；0 看整张。 */
  window?: number;
  links?: ChartLink[];
  cellWidth?: number;
}

export interface DepsRow {
  label: string;
  text: string;
  reads: string[];
  writes: string[];
  /** 读写集合已经写出来了。 */
  shown: boolean;
}

export interface DepsLink {
  i: number;
  j: number;
  kind: LinkKind;
  reg: string;
  on: boolean;
  tone?: LinkTone;
}

/** 相关连线：几条指令，读、写的寄存器是小牌，写和读之间拉线。links 是全部可能的线（建好后不变），按步打开。 */
export interface DepsProps extends CommonProps {
  name?: string;
  rows: DepsRow[];
  links: DepsLink[];
  /** 垫底色的行（0 起）。 */
  current?: number[];
  hotReads?: string[][];
  hotWrites?: string[][];
  badReads?: string[][];
  legend?: boolean;
  /** 窄屏：牌和走道窄一点。 */
  compact?: boolean;
}
