/**
 * 串行帧与总线带宽引擎（教材 6.1.1、6.2，p204–211）。规格见 specs/6-serial.md。
 *
 * 两类题：串行帧（起始位、数据位低位在前、校验位、停止位，算波特率、字符速率、每位时间、有效数据率）；
 * 总线带宽（Dr = D × f ÷ 每个总线周期的时钟数，M 取 10^6）。
 * 状态路径（line、parityBit、frameLength、bandwidth …）是场景和页面引用的 id，不要改名。
 */
import { TraceBuilder, type Condition, type SolutionTable, type StepInput, type Trace } from '../trace';

export const ENGINE = 'serial';

export type Parity = '无' | '奇' | '偶';
export type Task = '串行帧' | '总线带宽';

export interface FrameParams {
  task: '串行帧';
  /** 字符编码。 */
  code: number;
  dataBits: 5 | 6 | 7 | 8;
  parity: Parity;
  stopBits: 1 | 2;
  /** 波特率（位/秒），与 charRate 最多给一个。 */
  baud?: number;
  /** 字符速率（字符/秒）。 */
  charRate?: number;
  /** 只用于显示的字符。 */
  char?: string;
}

export interface BusParams {
  task: '总线带宽';
  /** 一个总线周期并行传送的位数。 */
  widthBits: number;
  /** 总线时钟频率，MHz。 */
  freqMHz: number;
  /** 一个总线周期占几个时钟周期。 */
  clocksPerCycle: number;
}

export type Params = FrameParams | BusParams;

export interface FrameState {
  /** 编码，高位在左。 */
  codeBits: string;
  /** 数据位里 1 的个数；还没数时为 null。 */
  ones: number | null;
  parityBit: 0 | 1 | null;
  /** 已发到线上的电平，按时间先后。 */
  line: (0 | 1)[];
  /** 正在发的位的名称。 */
  current: string;
  frameLength: number | null;
  baud: string | null;
  charRate: string | null;
  bitTime: string | null;
  dataRate: string | null;
}

export interface BusState {
  bytes: number | null;
  cycleNs: string | null;
  bandwidth: string | null;
}

export type State = FrameState | BusState;

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isPos = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

export function validateParams(p: Params): string[] {
  const problems: string[] = [];
  if (!p || (p.task !== '串行帧' && p.task !== '总线带宽')) return ['task 必须是「串行帧」或「总线带宽」'];
  if (p.task === '串行帧') {
    if (![5, 6, 7, 8].includes(p.dataBits)) problems.push('数据位数必须是 5–8');
    else if (!isInt(p.code) || p.code < 0 || p.code >= 2 ** p.dataBits) problems.push(`编码必须是 0 到 ${2 ** p.dataBits - 1} 的整数`);
    if (!['无', '奇', '偶'].includes(p.parity)) problems.push('校验必须是 无、奇、偶 之一');
    if (p.stopBits !== 1 && p.stopBits !== 2) problems.push('停止位必须是 1 或 2 位');
    if (p.baud !== undefined && p.charRate !== undefined) problems.push('波特率和字符速率只能给一个，另一个由引擎算');
    if (p.baud !== undefined && (!isPos(p.baud) || p.baud > 1e9)) problems.push('波特率必须是正数');
    if (p.charRate !== undefined && (!isPos(p.charRate) || p.charRate > 1e9)) problems.push('字符速率必须是正数');
  } else {
    if (!isInt(p.widthBits) || p.widthBits < 8 || p.widthBits > 256 || p.widthBits % 8 !== 0) problems.push('位宽必须是 8–256 之间 8 的倍数');
    if (!isPos(p.freqMHz) || p.freqMHz > 10000) problems.push('时钟频率必须是正数，不超过 10000 MHz');
    if (!isInt(p.clocksPerCycle) || p.clocksPerCycle < 1 || p.clocksPerCycle > 16) problems.push('每个总线周期的时钟数必须是 1–16 的整数');
  }
  return problems;
}

function check(p: Params): void {
  const problems = validateParams(p);
  if (problems.length) throw new Error(problems.join('；'));
}

function parityCount(p: FrameParams): number {
  return p.parity === '无' ? 0 : 1;
}

function ones(code: number): number {
  let n = 0;
  for (let x = code; x > 0; x >>= 1) n += x & 1;
  return n;
}

function parityOf(p: FrameParams): 0 | 1 | null {
  if (p.parity === '无') return null;
  const odd = ones(p.code) % 2 === 1;
  // 奇校验：总个数要奇；偶校验：总个数要偶。
  if (p.parity === '奇') return odd ? 0 : 1;
  return odd ? 1 : 0;
}

/** 一帧按发送次序的位：起始 0，D0 起的数据位，校验位，停止位 1。 */
export function frameBits(p: FrameParams): (0 | 1)[] {
  check(p);
  const bits: (0 | 1)[] = [0];
  for (let i = 0; i < p.dataBits; i++) bits.push(((p.code >> i) & 1) as 0 | 1);
  const parity = parityOf(p);
  if (parity !== null) bits.push(parity);
  for (let i = 0; i < p.stopBits; i++) bits.push(1);
  return bits;
}

export function rates(p: FrameParams): {
  frameLength: number;
  baud: number | null;
  charRate: number | null;
  bitTime: number | null;
  dataRate: number | null;
} {
  check(p);
  const frameLength = 1 + p.dataBits + parityCount(p) + p.stopBits;
  let baud: number | null = null;
  let charRate: number | null = null;
  if (p.charRate !== undefined) {
    charRate = p.charRate;
    baud = p.charRate * frameLength;
  } else if (p.baud !== undefined) {
    baud = p.baud;
    charRate = p.baud / frameLength;
  }
  return {
    frameLength,
    baud,
    charRate,
    bitTime: baud === null ? null : 1 / baud,
    dataRate: charRate === null ? null : charRate * p.dataBits,
  };
}

/** 总线带宽，MB/s，M 取 10^6。 */
export function bandwidth(p: BusParams): number {
  check(p);
  return ((p.widthBits / 8) * p.freqMHz) / p.clocksPerCycle;
}

/** 整数照写；否则 4 位有效数字，带「≈」。 */
export function formatNumber(x: number): string {
  if (Math.abs(x - Math.round(x)) < 1e-9 * Math.max(1, Math.abs(x))) return String(Math.round(x));
  const text = Number(x.toPrecision(4)).toString();
  return `≈ ${text}`;
}

/** 每位时间一律用 ms，跟例 6.2 的写法。 */
export function formatSeconds(s: number): string {
  return `${formatNumber(s * 1000)} ms`;
}

function bitName(p: FrameParams, index: number): string {
  if (index === 0) return '起始位';
  if (index <= p.dataBits) return `D${index - 1}`;
  if (p.parity !== '无' && index === p.dataBits + 1) return '校验位';
  return '停止位';
}

function bitNote(p: FrameParams, index: number): string {
  const name = bitName(p, index);
  if (name === 'D0') return 'D0（最低位）';
  if (name === `D${p.dataBits - 1}`) return `${name}（最高位）`;
  return name;
}

function runFrame(p: FrameParams): Trace<Params, State> {
  const bits = frameBits(p);
  const r = rates(p);
  const codeBits = p.code.toString(2).padStart(p.dataBits, '0');
  const parity = parityOf(p);
  const shown = p.char ? `「${p.char}」` : '';
  const conditions: Condition[] = [
    { label: '字符编码', value: `${shown}${codeBits}（${p.dataBits} 位）` },
    { label: '帧格式', value: `1 位起始位，${p.dataBits} 位数据，${p.parity === '无' ? '无校验' : `${p.parity}校验`}，${p.stopBits} 位停止位` },
    { label: '电平', value: '线路空闲为 1，起始位为 0，停止位为 1；数据先发最低位（教材 p209、p211）' },
  ];
  if (p.charRate !== undefined) conditions.push({ label: '字符速率', value: `${p.charRate} 字符/秒` });
  if (p.baud !== undefined) conditions.push({ label: '波特率', value: `${p.baud} 波特` });

  const initial: FrameState = {
    codeBits,
    ones: null,
    parityBit: null,
    line: [],
    current: '空闲',
    frameLength: null,
    baud: null,
    charRate: null,
    bitTime: null,
    dataRate: null,
  };
  const b = new TraceBuilder<Params, State>(ENGINE, p, initial, conditions);
  const rows: SolutionTable['rows'] = [];
  let count = 0;
  const step = (input: StepInput<State>): void => {
    b.step(input);
    count += 1;
  };
  const at = () => `s${count}`;

  step({
    title: `写出编码 ${codeBits}`,
    why: `编码 ${p.code} 写成 ${p.dataBits} 位二进制，高位在左。发送时要倒过来，从右边的最低位开始。`,
    ref: '教材 p209',
    focus: ['codeBits'],
    update: () => {},
  });
  rows.push({ cells: ['字符编码', `${p.code} 写成 ${p.dataBits} 位二进制`, codeBits], step: at() });

  const n1 = ones(p.code);
  if (parity !== null) {
    step({
      title: `数据里有 ${n1} 个 1，校验位取 ${parity}`,
      why:
        p.parity === '奇'
          ? `奇校验要求数据位加校验位里 1 的总数为奇数。${n1} 个已经是${n1 % 2 ? '奇数，补 0' : '偶数，补 1'}。`
          : `偶校验要求数据位加校验位里 1 的总数为偶数。${n1} 个已经是${n1 % 2 ? '奇数，补 1' : '偶数，补 0'}。`,
      ref: '教材 p229 习题 3',
      ask: { prompt: `${p.parity}校验时校验位是几？`, kind: 'bits', answer: String(parity), hint: '先数编码里 1 的个数，再看总数要奇还是要偶。' },
      update: (s) => {
        const d = s as FrameState;
        d.ones = n1;
        d.parityBit = parity;
      },
    });
    rows.push({ cells: ['校验位', `${p.parity}校验，数据里 ${n1} 个 1`, String(parity)], step: at() });
  }

  bits.forEach((bit, index) => {
    const name = bitName(p, index);
    let why: string;
    if (index === 0) why = '线路原来是空闲的 1，先拉成 0 一个位时间，接收方由这个下降沿知道一个字符开始了。';
    else if (index <= p.dataBits) {
      const k = index - 1;
      why =
        k === 0
          ? '串行传送先发最低位，所以紧跟起始位的是编码最右边那一位。'
          : `接着按权从低到高发，这是编码从右数第 ${k + 1} 位。`;
    } else if (name === '校验位') why = '数据位发完后发校验位，接收方据此检查有没有错一位。';
    else why = '最后发停止位 1，线路回到空闲电平，等下一个起始位。';
    step({
      level: 'beat',
      title: `第 ${index + 1} 个位时间：${bitNote(p, index)} = ${bit}`,
      why,
      ref: index === 0 || name === '停止位' ? '教材 p211 图 6.9' : '教材 p209',
      focus: [`line.${index}`, 'current'],
      ...(index === 1
        ? { ask: { prompt: '起始位之后先发编码的哪一位？', kind: 'choice' as const, options: ['最低位', '最高位'], answer: '最低位', hint: '看串行传送的发送次序。' } }
        : {}),
      update: (s) => {
        const d = s as FrameState;
        d.line.push(bit);
        d.current = name;
      },
    });
  });
  const frame = bits.join('');
  const grouped = [bits.slice(0, 1), bits.slice(1, 1 + p.dataBits), ...(parity !== null ? [[parity]] : []), bits.slice(1 + p.dataBits + (parity !== null ? 1 : 0))]
    .map((g) => g.join(''))
    .join(' ');
  rows.push({ cells: ['发送次序', '起始 D0…D' + (p.dataBits - 1) + (parity !== null ? ' 校验' : '') + ' 停止', grouped], step: at() });

  const lengthFormula = `1 + ${p.dataBits}${parity !== null ? ' + 1' : ''} + ${p.stopBits}`;
  step({
    title: `每帧 ${r.frameLength} 位`,
    why: `一帧 = 起始位 + 数据位${parity !== null ? ' + 校验位' : ''} + 停止位 = ${lengthFormula}。`,
    ref: '教材 p211 例 6.2',
    ask: { prompt: '一帧一共几位？', kind: 'number', answer: String(r.frameLength), hint: '起始位、校验位、停止位都要算进去。' },
    update: (s) => {
      const d = s as FrameState;
      d.current = '空闲';
      d.frameLength = r.frameLength;
    },
  });
  rows.push({ cells: ['每帧位数', lengthFormula, String(r.frameLength)], step: at() });

  const result: Record<string, string> = { 帧: frame, 每帧位数: String(r.frameLength) };
  if (r.baud !== null && r.charRate !== null && r.bitTime !== null && r.dataRate !== null) {
    const baudText = formatNumber(r.baud);
    const charText = formatNumber(r.charRate);
    const timeText = formatSeconds(r.bitTime);
    const dataText = formatNumber(r.dataRate);
    if (p.charRate !== undefined) {
      step({
        title: `波特率 ${baudText} 波特`,
        why: `每秒传 ${p.charRate} 个字符，每个字符 ${r.frameLength} 位，每秒传的位数就是两者相乘。`,
        ref: '教材 p211 例 6.2',
        ask: { prompt: '波特率是多少（位/秒）？', kind: 'number', answer: String(Number(r.baud.toPrecision(10))), hint: '字符速率乘每帧位数。' },
        update: (s) => {
          (s as FrameState).baud = baudText;
          (s as FrameState).charRate = String(p.charRate);
        },
      });
      rows.push({ cells: ['波特率', `${p.charRate} × ${r.frameLength}`, `${baudText} 波特`], step: at() });
    } else {
      step({
        title: `字符速率 ${charText} 字符/秒`,
        why: `每秒传 ${p.baud} 位，每 ${r.frameLength} 位才是一个字符，所以相除。`,
        ref: '教材 p211 例 6.2',
        ask: { prompt: '每秒能传几个字符？', kind: 'number', answer: String(Number(r.charRate.toPrecision(4))), hint: '波特率除以每帧位数，不是除以数据位数。' },
        update: (s) => {
          (s as FrameState).baud = String(p.baud);
          (s as FrameState).charRate = charText;
        },
      });
      rows.push({ cells: ['字符速率', `${p.baud} ÷ ${r.frameLength}`, `${charText} 字符/秒`], step: at() });
    }
    step({
      title: `每位时间 ${timeText}`,
      why: '一秒里排了「波特率」那么多个位，每一位占的时间是波特率的倒数。',
      ref: '教材 p211 例 6.2',
      update: (s) => {
        (s as FrameState).bitTime = timeText;
      },
    });
    rows.push({ cells: ['每位时间', `1 ÷ ${formatNumber(r.baud).replace('≈ ', '')} s`, timeText], step: at() });
    step({
      title: `有效数据率 ${dataText} 位/秒`,
      why: `每个字符里真正是数据的只有 ${p.dataBits} 位，起始、校验、停止位不算，所以用字符速率乘数据位数。`,
      update: (s) => {
        (s as FrameState).dataRate = dataText;
      },
    });
    rows.push({ cells: ['有效数据率', `${charText.replace('≈ ', '')} × ${p.dataBits}`, `${dataText} 位/秒`], step: at() });
    result['波特率'] = `${baudText} 波特`;
    result['字符速率'] = `${charText} 字符/秒`;
    result['每位时间'] = timeText;
    result['有效数据率'] = `${dataText} 位/秒`;
  }
  return b.finish(result, { columns: ['项目', '算式', '结果'], rows });
}

function runBus(p: BusParams): Trace<Params, State> {
  const bytes = p.widthBits / 8;
  const value = bandwidth(p);
  const cycleNs = (1000 / p.freqMHz) * p.clocksPerCycle;
  const conditions: Condition[] = [
    { label: '每个总线周期传送', value: `${p.widthBits} 位` },
    { label: '总线时钟频率', value: `${p.freqMHz} MHz` },
    { label: '一个总线周期', value: `${p.clocksPerCycle} 个时钟周期` },
    { label: '单位', value: 'MB/s 里的 M 取 10^6（教材 p205）' },
  ];
  const initial: BusState = { bytes: null, cycleNs: null, bandwidth: null };
  const b = new TraceBuilder<Params, State>(ENGINE, p, initial, conditions);
  const rows: SolutionTable['rows'] = [];
  let count = 0;
  const step = (input: StepInput<State>): void => {
    b.step(input);
    count += 1;
  };
  const at = () => `s${count}`;
  const bwText = formatNumber(value);
  const cycleText = formatNumber(cycleNs);

  step({
    title: `${p.widthBits} 位 = ${bytes} 字节`,
    why: '带宽按字节算，位数先除以 8。',
    ref: '教材 p205 例 6.1',
    update: (s) => {
      (s as BusState).bytes = bytes;
    },
  });
  rows.push({ cells: ['D', `${p.widthBits} 位 ÷ 8`, `${bytes} B`], step: at() });
  step({
    title: `总线周期 ${cycleText} ns`,
    why:
      p.clocksPerCycle === 1
        ? `一个总线周期就是一个时钟周期，1 ÷ ${p.freqMHz} MHz。`
        : `一个总线周期占 ${p.clocksPerCycle} 个时钟周期，每个 1 ÷ ${p.freqMHz} MHz。`,
    ref: '教材 p205 例 6.1',
    update: (s) => {
      (s as BusState).cycleNs = cycleText;
    },
  });
  rows.push({ cells: ['T', p.clocksPerCycle === 1 ? `1 ÷ ${p.freqMHz} MHz` : `${p.clocksPerCycle} × (1 ÷ ${p.freqMHz} MHz)`, `${cycleText} ns`], step: at() });
  step({
    title: `带宽 ${bwText} MB/s`,
    why: '每个总线周期送 D 字节，每秒有 1/T 个总线周期，两者相乘。',
    ref: '教材 p205 例 6.1',
    ask: { prompt: '总线带宽是多少 MB/s？', kind: 'number', answer: String(Number(value.toPrecision(4))), hint: '先化成字节，再看一个总线周期占几个时钟。' },
    update: (s) => {
      (s as BusState).bandwidth = bwText;
    },
  });
  rows.push({
    cells: ['Dr = D ÷ T', p.clocksPerCycle === 1 ? `${bytes} B × ${p.freqMHz} × 10^6/s` : `${bytes} B × ${p.freqMHz} × 10^6/s ÷ ${p.clocksPerCycle}`, `${bwText} MB/s`],
    step: at(),
  });
  return b.finish({ 带宽: `${bwText} MB/s` }, { columns: ['项目', '算式', '结果'], rows });
}

export function run(p: Params): Trace<Params, State> {
  check(p);
  return p.task === '串行帧' ? runFrame(p) : runBus(p);
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

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** 按种子出一道题。 */
export function generate(seed: number, task?: Task): Params {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const kind = task ?? (r() < 0.6 ? '串行帧' : '总线带宽');
  if (kind === '总线带宽') {
    return {
      task: '总线带宽',
      widthBits: pick([8, 16, 32, 64, 128]),
      freqMHz: pick([25, 33, 50, 66, 100, 133, 200]),
      clocksPerCycle: pick([1, 1, 2, 4]),
    };
  }
  const char = pick(CHARS.split(''));
  const dataBits = pick([7, 8] as const);
  const p: FrameParams = {
    task: '串行帧',
    code: char.charCodeAt(0),
    char,
    dataBits,
    parity: pick(['无', '奇', '偶'] as const),
    stopBits: pick([1, 1, 2] as const),
  };
  if (r() < 0.5) p.charRate = pick([60, 120, 240, 480, 960]);
  else p.baud = pick([1200, 2400, 4800, 9600]);
  return p;
}
