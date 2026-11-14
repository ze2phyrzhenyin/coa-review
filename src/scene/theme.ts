/**
 * 场景的颜色、字体、尺寸、时长。全站只在这里定义一次，浅色和深色各一套。
 * 规则见 docs/INTERACTION.md「场景」「动效标准」。这个文件不依赖 three.js，页面外壳也可以读。
 */

/** 三种墨色：数据、地址、控制。另有一种强调色表示「变了」。 */
export type Ink = 'data' | 'addr' | 'ctrl';
export type Tone = Ink | 'text' | 'muted' | 'accent';
export type Scheme = 'light' | 'dark';

export interface Palette {
  /** 台面（纸）。 */
  paper: string;
  /** 部件本体。 */
  block: string;
  /** 底座、导轨这类次一级的实体。 */
  plinth: string;
  /** 值牌。 */
  tile: string;
  /** 值牌上的字。 */
  tileText: string;
  /** 名牌。 */
  chip: string;
  chipText: string;
  /** 台面上的字。 */
  text: string;
  muted: string;
  /** 中性的线：没接通的门、表格线。 */
  line: string;
  data: string;
  addr: string;
  ctrl: string;
  /** 变化。 */
  accent: string;
  /** 值牌上表示变化的字（值牌在两种模式下都是浅色）。 */
  accentOnTile: string;
  /** 阴影的浓度，0–1。 */
  shadow: number;
}

export const palettes: Record<Scheme, Palette> = {
  light: {
    paper: '#f6f3ec',
    block: '#e2ddd1',
    plinth: '#cfc9bb',
    tile: '#fffdf8',
    tileText: '#22211f',
    chip: '#34322e',
    chipText: '#fbfaf7',
    text: '#22211f',
    muted: '#6f6a60',
    line: '#a8a294',
    data: '#2c63a8',
    addr: '#1e7d6b',
    ctrl: '#7a5195',
    accent: '#d4472a',
    accentOnTile: '#c53d21',
    shadow: 0.2,
  },
  dark: {
    paper: '#1f1e1b',
    block: '#45433d',
    plinth: '#35332f',
    tile: '#ece8de',
    tileText: '#1d1c1a',
    chip: '#77726a',
    chipText: '#fbfaf7',
    text: '#ece9e2',
    muted: '#a8a397',
    line: '#6b675e',
    data: '#78a9e6',
    addr: '#5fbfa8',
    ctrl: '#b998d4',
    accent: '#f0795c',
    accentOnTile: '#c53d21',
    shadow: 0.42,
  },
};

export const inkNames: Record<Ink, string> = { data: '数据', addr: '地址', ctrl: '控制' };
export const accentName = '变化';

/** 系统字体，不下载。位串用等宽，中文落到黑体。 */
const sans = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',system-ui,sans-serif";
export const fonts = {
  sans,
  mono: `ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',${sans}`,
};

/** 时长（毫秒）。对应动效标准第 3、5 条。 */
export const timing = {
  /** 起因：门打开、信号变。 */
  cause: 220,
  /** 值牌原地翻面。 */
  flip: 260,
  /** 旧值被顶出。 */
  push: 300,
  /** 每走一个单位长度。 */
  travelPerUnit: 105,
  travelMin: 280,
  travelMax: 900,
  camera: 760,
  /** 多位一起动时逐位错开。 */
  stagger: 30,
  shake: 380,
  fade: 200,
};

/** 尺寸（世界单位）。一个寄存器宽 2.4。 */
export const sizes = {
  /** 值牌上的字高。 */
  value: 0.36,
  /** 名牌上的字高。 */
  name: 0.31,
  /** 台面上的小字。 */
  note: 0.26,
  tileHeight: 0.66,
  chipHeight: 0.44,
  /** 牌的厚度。 */
  cardDepth: 0.05,
  /** 牌的圆角。 */
  radius: 0.07,
  /** 值在线上方走的高度。 */
  hover: 0.62,
};

export function currentScheme(): Scheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function toneColor(palette: Palette, tone: Tone): string {
  return palette[tone];
}

/** 两个 #rrggbb 之间取中间色，t=0 得 a。用来做「没接通」的淡墨色。 */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}
