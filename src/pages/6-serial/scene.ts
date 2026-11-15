/**
 * 6-serial 的台面。
 * 串行帧：上面一排是字符的编码（高位在左），每一位一张翻片；下面是线路的波形，上一道是 1、下一道是 0，
 * 每个位时间一段，起始位、数据位（从 D0 起）、校验位、停止位依次从左往右长出来，数据位从编码那一排的右端（最低位）一张张跳下去；
 * 再下面是每帧位数、波特率、每位时间、有效数据率的读数。
 * 总线带宽：一个总线周期送 D 字节，时钟道上画出时钟和总线周期，带宽 = D ÷ T。
 * 画面只取决于引擎 Trace 的状态。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import type { BusParams, BusState, FrameParams, FrameState, Params, State } from '../../engines/serial/model';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export const SERIAL_QUESTION = { text: '一个字符在线上占几个位时间，速率和带宽各怎么算', at: ['wave', 'len'] };
export const BUS_QUESTION = { text: '总线带宽里的 D 和 T 各是多少', at: ['D', 'T', 'Dr'] };
export const SERIAL_CONCLUSION =
  '一帧 = 1 位起始位 + 数据位 + 校验位（有就 1 位）+ 停止位，数据从最低位先发。波特率是每秒的位数，等于字符速率乘每帧位数，每位时间是它的倒数；有效数据率只算数据位。并行总线的带宽 D_r = D ÷ T：D 是一个总线周期送的字节数，T 是一个总线周期的时间。';
export const SERIAL_NEEDS = [{ href: '/2-codes', text: '二进制编码' }];

export interface SerialStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  caption: (state: State) => string;
  flipPart: (ask: Ask, index: number) => string | null;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
  wrong: (ask: Ask, value: string, state: State, next: Step<State> | null) => Breakage | null;
  mistakes: Mistake<State>[];
  question: { text: string; at: string[] };
  convention: (step: Step<State>) => string | null;
}

/** 发送次序里第 k 位的名字：起、D0…、校、停。 */
export function slotName(p: FrameParams, k: number): string {
  if (k === 0) return '起';
  if (k <= p.dataBits) return `D${k - 1}`;
  if (p.parity !== '无' && k === p.dataBits + 1) return '校';
  return '停';
}

export function serialStage(trace: Trace<Params, State>, narrow: boolean): SerialStage {
  return trace.params.task === '串行帧' ? frameStage(trace as Trace<Params, State>, trace.params, narrow) : busStage(trace, trace.params, narrow);
}

function frameStage(trace: Trace<Params, State>, p: FrameParams, narrow: boolean): SerialStage {
  const final = (trace.steps.at(-1)?.state ?? trace.initial) as FrameState;
  const total = final.line.length;
  const pitch = narrow ? 0.56 : 0.72;
  const idle = narrow ? 0 : 1;
  const span: [number, number] = [-idle, total + idle];
  const L = (span[1] - span[0]) * pitch;
  const TZ = narrow ? 1.6 : 0.6;
  const trackDepth = 2 * 1.25 + 0.5;
  const laneZ = (lane: number) => TZ - trackDepth / 2 + 0.3 + (lane + 0.5) * 1.25 - 0.05;
  const slotX = (k: number) => -L / 2 + (k + 0.5 - span[0]) * pitch;
  const codePitch = narrow ? 0.6 : 0.64;
  const codeX = (j: number) => (j - (p.dataBits - 1) / 2) * codePitch - (narrow ? 0.6 : 1.2);

  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<State>>[0] = {};
  const codeZ = narrow ? -2.2 : -2.6;
  // 编码：左边是最高位。每一位一张翻片，名牌在上面。
  for (let j = 0; j < p.dataBits; j++) {
    const k = p.dataBits - 1 - j; // 这是 D_k
    parts.push({
      id: `c-${k}`,
      kind: 'bits',
      position: [codeX(j), codeZ],
      props: { bits: final.codeBits[j] ?? ' ', group: 8 },
      ...(k === 0 ? { pick: true, title: '最低位' } : k === p.dataBits - 1 ? { pick: true, title: '最高位' } : { title: `D${k}` }),
    });
    parts.push({ id: `cl-${k}`, kind: 'label', position: [codeX(j), codeZ - 1.15], props: { text: `D_${k}`, size: 0.31, tone: 'muted', weight: 600 } });
    table[`c-${k}`] = { bits: from(['line', 'codeBits'], (c) => {
      const s = c.state as FrameState;
      // 已经发出去的数据位，编码这一排上留一个空槽。
      return s.line.length > k + 1 ? ' ' : (s.codeBits[j] ?? ' ');
    }) };
  }
  if (!narrow) parts.push({ id: 'code-name', kind: 'label', position: [codeX(0) - (narrow ? 1.0 : 1.2), codeZ], props: { text: p.char ? `「${p.char}」` : '编码', size: 0.36, weight: 600 } });
  if (p.parity !== '无') {
    parts.push({ id: 'par', kind: 'bits', position: [codeX(p.dataBits - 1) + (narrow ? 2.05 : 2.0), codeZ], props: { name: `${p.parity}校验`, bits: ' ', group: 8 }, title: '校验位' });
    table.par = { bits: from('parityBit', (c) => {
      const s = c.state as FrameState;
      return s.parityBit === null ? ' ' : String(s.parityBit);
    }) };
  }

  // 线路波形：上一道是 1，下一道是 0。
  parts.push({
    id: 'wave',
    kind: 'track',
    position: [narrow ? 0.35 : 0, TZ],
    props: {
      name: '线路',
      length: L,
      span,
      lanes: ['1', '0'],
      segments: [],
      ticks: [],
    },
    title: '线路波形',
  });
  table.wave = {
    segments: from('line', (c) => {
      const s = c.state as FrameState;
      const idleSegments = idle
        ? [
            { lane: 0, from: -1, to: 0, ink: 'muted' as const },
            ...(s.line.length === total ? [{ lane: 0, from: total, to: total + 1, ink: 'muted' as const }] : []),
          ]
        : [];
      return [...idleSegments, ...s.line.map((bit, k) => ({ lane: bit === 1 ? 0 : 1, from: k, to: k + 1, ink: 'data' as const }))];
    }),
    now: from('line', (c) => ((c.state as FrameState).line.length ? (c.state as FrameState).line.length : undefined)),
  };
  // 波形下面一排：每个位时间是哪一位，发出去才写上。
  for (let k = 0; k < total; k++) {
    parts.push({ id: `n-${k}`, kind: 'label', position: [slotX(k) + (narrow ? 0.35 : 0), TZ + trackDepth / 2 + 0.3], props: { text: '', size: 0.31, weight: 600 } });
    table[`n-${k}`] = { text: from(`line.${k}`, (c) => ((c.state as FrameState).line.length > k ? slotName(p, k) : '')) };
  }
  if (idle) {
    parts.push({ id: 'idle-a', kind: 'label', position: [slotX(-1), TZ + trackDepth / 2 + 0.3], props: { text: '空闲', size: 0.31, tone: 'muted' } });
  }
  // 每个位时间的落点（看不见），数据位从编码那一排跳到这里。
  for (let k = 0; k < total; k++) {
    const bit = final.line[k] ?? 1;
    parts.push({ id: `s-${k}`, kind: 'label', position: [slotX(k) + (narrow ? 0.35 : 0), laneZ(bit === 1 ? 0 : 1)], props: { text: '', size: 0.31 } });
  }

  // 读数。
  const RZ = TZ + trackDepth / 2 + (narrow ? 1.75 : 1.85);
  const w = narrow ? 3.2 : 2.7;
  const slots = narrow
    ? ([[-1.65, RZ], [1.65, RZ], [-1.65, RZ + 1.75], [1.65, RZ + 1.75]] as [number, number][])
    : ([[-4.35, RZ], [-1.45, RZ], [1.45, RZ], [4.35, RZ]] as [number, number][]);
  const rateName = p.charRate !== undefined ? '波特率' : '字符速率';
  const readings: { id: string; name: string; of: (s: FrameState) => string | null }[] = [
    { id: 'len', name: '每帧位数', of: (s) => (s.frameLength === null ? null : `${s.frameLength} 位`) },
    { id: 'rate', name: rateName, of: (s) => (p.charRate !== undefined ? (s.baud === null ? null : `${s.baud} 波特`) : s.charRate === null ? null : `${s.charRate} 字符/秒`) },
    { id: 'td', name: '每位时间 T_d', of: (s) => s.bitTime },
    { id: 'dr', name: '有效数据率', of: (s) => (s.dataRate === null ? null : `${s.dataRate} 位/秒`) },
  ];
  const withRates = p.charRate !== undefined || p.baud !== undefined;
  readings.slice(0, withRates ? 4 : 1).forEach((item, i) => {
    parts.push({ id: item.id, kind: 'register', position: slots[i]!, props: { name: item.name, value: '', width: w } });
    const path = item.id === 'len' ? 'frameLength' : item.id === 'rate' ? (p.charRate !== undefined ? 'baud' : 'charRate') : item.id === 'td' ? 'bitTime' : 'dataRate';
    table[item.id] = { value: from(path, (c) => item.of(c.state as FrameState) ?? '') };
  });

  const scene: SceneSpec = { parts, wires: [] };
  const bind = bindTable<State>(table);

  const moves = (step: Step<State>): Move[] => {
    const s = step.state as FrameState;
    const k = s.line.length - 1;
    if (step.level === 'beat' && k >= 0) {
      const bit = String(s.line[k]);
      if (k >= 1 && k <= p.dataBits) return [{ value: bit, from: `c-${k - 1}`, to: `s-${k}`, arc: true }];
      if (p.parity !== '无' && k === p.dataBits + 1) return [{ value: bit, from: 'par', to: `s-${k}`, arc: true }];
      return [];
    }
    if (step.changes.some((c) => c.at === 'frameLength')) return [{ value: `${s.frameLength} 位`, from: `s-${Math.max(0, total - 1)}`, to: 'len', arc: true }];
    if (step.changes.some((c) => c.at === 'baud' || c.at === 'charRate')) return [{ value: p.charRate !== undefined ? `× ${s.frameLength}` : `÷ ${s.frameLength}`, from: 'len', to: 'rate', arc: true }];
    if (step.changes.some((c) => c.at === 'bitTime')) return [{ value: '1 ÷', from: 'rate', to: 'td', arc: true }];
    if (step.changes.some((c) => c.at === 'dataRate')) return [{ value: `× ${p.dataBits}`, from: 'rate', to: 'dr', arc: true }];
    return [];
  };

  const plain: Record<string, string> = { codeBits: '编码', ones: '1 的个数', parityBit: '校验位', current: '正在发', frameLength: '每帧位数', baud: '波特率', charRate: '字符速率', bitTime: '每位时间', dataRate: '有效数据率' };
  const names = (path: string): string => {
    if (plain[path]) return plain[path]!;
    const m = /^line\.(\d+)$/.exec(path);
    if (m) return `第 ${Number(m[1]) + 1} 个位时间（${slotName(p, Number(m[1]))}）`;
    return path;
  };
  const values = (_path: string, value: string): string => value;
  const caption = (state: State): string => {
    const s = state as FrameState;
    return s.line.length ? `已发 ${s.line.length} 位　正在发 ${s.current}` : `编码 ${s.codeBits}　线路空闲`;
  };

  const flipPart = (ask: Ask): string | null => (ask.kind === 'bits' && p.parity !== '无' ? 'par' : null);
  const askFrame = (ask: Ask): string[] => {
    const code = Array.from({ length: p.dataBits }, (_, k) => `c-${k}`);
    if (ask.kind === 'bits') return [...code, 'par'];
    if (ask.kind === 'choice') return [...code, 'wave'];
    return ['wave', 'len', ...(withRates ? ['rate'] : [])];
  };
  const frame = (step: Step<State>): string[] | null => {
    if (step.level !== 'beat') return null;
    const k = (step.state as FrameState).line.length - 1;
    return ['wave', ...(k >= 1 && k <= p.dataBits ? [`c-${k - 1}`] : [])];
  };

  const wrong = (ask: Ask, value: string, state: State): Breakage | null => {
    const s = state as FrameState;
    if (ask.kind === 'choice' && value === '最高位') {
      const msb = p.dataBits - 1;
      return {
        label: '',
        patch: { wave: { segments: [{ lane: 1, from: 0, to: 1, ink: 'data', text: '起' }, { lane: s.codeBits[0] === '1' ? 0 : 1, from: 1, to: 2, ink: 'accent', text: `D${msb}` }] } },
        moves: [{ value: s.codeBits[0] ?? '0', from: `c-${msb}`, to: 's-1', arc: true }],
        message: `先发 D${msb}，接收方却按低位在前把它当成 D0 收，整个字符的位序就反了。`,
      };
    }
    if (ask.kind === 'bits' && p.parity !== '无') {
      const bit = value.replace(/\s/g, '');
      const ones = (s.codeBits.match(/1/g) ?? []).length + (bit === '1' ? 1 : 0);
      return {
        label: '',
        patch: { par: { bits: bit } },
        moves: [{ value: bit, from: `c-0`, to: 'par', arc: true }],
        message: `按你写的 ${bit}，数据加校验一共 ${ones} 个 1，是${ones % 2 ? '奇' : '偶'}数，不符合${p.parity}校验。`,
      };
    }
    if (ask.kind === 'number') {
      const target = ask.prompt.includes('几位') ? 'len' : 'rate';
      return {
        label: '',
        patch: { [target]: { value: `${value}？` } },
        moves: [{ value, from: target === 'len' ? 'wave' : 'len', to: target, arc: true }],
        message: target === 'len' ? `线上一个字符占的位时间要从起始位数到最后一个停止位，波形上一共 ${s.line.length} 段。` : '速率要和每帧位数一起算：字符速率 × 每帧位数 = 波特率。',
      };
    }
    return null;
  };

  const stepWhere = (test: (step: Step<State>) => boolean) => trace.steps.findIndex(test) + 1;
  const mistakes: Mistake<State>[] = [];
  const atLen = stepWhere((step) => step.changes.some((c) => c.at === 'frameLength'));
  if (atLen > 0) {
    mistakes.push({
      text: '容易把每帧位数数成数据位数，因为只数了编码',
      at: atLen,
      act: () => ({
        label: '',
        patch: { len: { value: `${p.dataBits} 位？` } },
        moves: [{ value: `${p.dataBits}`, from: `c-${p.dataBits - 1}`, to: 'len', arc: true }],
        message: `线上这个字符占了 ${total} 个位时间：起始位、${p.parity === '无' ? '' : '校验位、'}停止位也都要占一位的时间。按 ${p.dataBits} 位去算波特率，会少算 ${total - p.dataBits} 位。`,
      }),
    });
  }
  const atFirst = stepWhere((step) => step.level === 'beat' && (step.state as FrameState).line.length === 2);
  if (atFirst > 0) {
    mistakes.push({
      text: '容易先发最高位，因为编码是从左往右写的',
      at: atFirst,
      act: (state) => {
        const s = state as FrameState;
        const msb = p.dataBits - 1;
        return {
          label: '',
          patch: { wave: { segments: [{ lane: 1, from: 0, to: 1, ink: 'data', text: '起' }, { lane: s.codeBits[0] === '1' ? 0 : 1, from: 1, to: 2, ink: 'accent', text: `D${msb}` }] } },
          moves: [{ value: s.codeBits[0] ?? '0', from: `c-${msb}`, to: 's-1', arc: true }],
          message: '串行传送低位在前（教材 p209）。写的时候高位在左，发的时候从右边的 D0 开始。',
        };
      },
    });
  }
  const atRate = stepWhere((step) => step.changes.some((c) => c.at === 'baud' || c.at === 'charRate'));
  if (atRate > 0) {
    mistakes.push({
      text: '容易把波特率当成每秒传的字符数，因为都叫传送速率',
      at: atRate,
      act: (state) => {
        const s = state as FrameState;
        return {
          label: '',
          patch: { rate: { value: `${p.charRate ?? s.charRate} 波特？` } },
          moves: [{ value: '×1', from: 'len', to: 'rate', arc: true }],
          message: `教材的波特率是每秒传的位数（p211）。一个字符 ${total} 位，波特率是字符速率的 ${total} 倍。`,
        };
      },
    });
  }

  const convention = (step: Step<State>): string | null =>
    step.changes.some((c) => c.at === 'dataRate') ? '教材只讲波特率（p211），没有定义有效数据率。这里按每秒传送的数据位数算，起始位、校验位、停止位不计，单位 位/秒。' : null;
  return { scene, bind, moves, names, values, caption, flipPart, askFrame, frame, wrong, mistakes, question: SERIAL_QUESTION, convention };
}

function busStage(trace: Trace<Params, State>, p: BusParams, narrow: boolean): SerialStage {
  const cycles = 3;
  const clocks = cycles * p.clocksPerCycle;
  const L = narrow ? 6.0 : 9.0;
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<State>>[0] = {};
  const at = (wide: [number, number], small: [number, number]): [number, number] => (narrow ? small : wide);
  parts.push({ id: 'W', kind: 'register', position: at([-4.2, -2.6], [-1.6, -2.6]), props: { name: '数据线', value: `${p.widthBits} 位`, width: 2.6 } });
  parts.push({ id: 'F', kind: 'register', position: at([0, -2.6], [1.6, -2.6]), props: { name: '时钟频率 f', value: `${p.freqMHz} MHz`, width: 2.8 } });
  parts.push({ id: 'C', kind: 'register', position: at([4.2, -2.6], [0, -0.8]), props: { name: '每个总线周期', value: `${p.clocksPerCycle} 个时钟`, width: 2.8 } });
  parts.push({
    id: 'clk',
    kind: 'track',
    position: at([0.3, 0.9], [0.4, 2.0]),
    props: {
      name: '时间',
      length: L,
      span: [0, clocks],
      lanes: ['时钟', '总线周期'],
      segments: [
        ...Array.from({ length: clocks }, (_, k) => ({ lane: 0, from: k, to: k + 0.5, ink: 'ctrl' as const, high: true })),
      ],
      ticks: [],
    },
    title: '时钟和总线周期',
  });
  table.clk = {
    segments: from('cycleNs', (c) => {
      const s = c.state as BusState;
      const clock = Array.from({ length: clocks }, (_, k) => ({ lane: 0, from: k, to: k + 0.5, ink: 'ctrl' as const, high: true }));
      const bus = s.cycleNs === null ? [] : Array.from({ length: cycles }, (_, k) => ({ lane: 1, from: k * p.clocksPerCycle, to: (k + 1) * p.clocksPerCycle - 0.08, ink: 'data' as const, text: s.bytes === null ? '' : `${s.bytes} B` }));
      return [...clock, ...bus];
    }),
  };
  const RZ = narrow ? 5.0 : 4.0;
  const regs: { id: string; name: string; path: string; of: (s: BusState) => string }[] = [
    { id: 'D', name: 'D', path: 'bytes', of: (s) => (s.bytes === null ? '' : `${s.bytes} B`) },
    { id: 'T', name: '总线周期 T', path: 'cycleNs', of: (s) => (s.cycleNs === null ? '' : `${s.cycleNs} ns`) },
    { id: 'Dr', name: '带宽 D_r = D ÷ T', path: 'bandwidth', of: (s) => (s.bandwidth === null ? '' : `${s.bandwidth} MB/s`) },
  ];
  regs.forEach((item, i) => {
    const pos = narrow ? ([[-1.65, RZ], [1.65, RZ], [0, RZ + 1.8]] as [number, number][])[i]! : ([[-4.2, RZ], [0, RZ], [4.2, RZ]] as [number, number][])[i]!;
    parts.push({ id: item.id, kind: 'register', position: pos, props: { name: item.name, value: '', width: item.id === 'Dr' ? 3.6 : 2.8 } });
    table[item.id] = { value: from(item.path, (c) => item.of(c.state as BusState)) };
  });
  const scene: SceneSpec = { parts, wires: [] };
  const bind = bindTable<State>(table);
  const moves = (step: Step<State>): Move[] => {
    const s = step.state as BusState;
    const changed = new Set(step.changes.map((c) => c.at));
    if (changed.has('bytes')) return [{ value: '÷ 8', from: 'W', to: 'D', arc: true }];
    if (changed.has('cycleNs')) return [{ value: `${p.clocksPerCycle} ÷ f`, from: 'F', to: 'T', arc: true }];
    if (changed.has('bandwidth'))
      return [
        { value: `${s.bytes} B`, from: 'D', to: 'Dr', arc: true, phase: 0 },
        { value: `${s.cycleNs} ns`, from: 'T', to: 'Dr', arc: true, phase: 1 },
      ];
    return [];
  };
  const plain: Record<string, string> = { bytes: 'D', cycleNs: '总线周期 T', bandwidth: '带宽 D_r' };
  const names = (path: string) => plain[path] ?? path;
  const values = (_path: string, value: string) => value;
  const caption = (state: State): string => {
    const s = state as BusState;
    return s.bandwidth ? `D_r = ${s.bandwidth} MB/s` : `${p.widthBits} 位，${p.freqMHz} MHz，每个总线周期 ${p.clocksPerCycle} 个时钟`;
  };
  const wrong = (ask: Ask, value: string, state: State): Breakage | null => {
    const s = state as BusState;
    if (ask.kind !== 'number') return null;
    const raw = (p.widthBits * p.freqMHz) / p.clocksPerCycle;
    const noCycle = (p.widthBits / 8) * p.freqMHz;
    const v = Number(value);
    const why =
      Math.abs(v - raw) < 1e-6
        ? `${value} 是没除以 8 的结果：带宽按字节算，${p.widthBits} 位是 ${p.widthBits / 8} 字节。`
        : p.clocksPerCycle > 1 && Math.abs(v - noCycle) < 1e-6
          ? `${value} 是把一个总线周期当成一个时钟周期算的。这里一个总线周期占 ${p.clocksPerCycle} 个时钟，每秒只有 f ÷ ${p.clocksPerCycle} 个总线周期。`
          : `每个总线周期送 ${s.bytes ?? p.widthBits / 8} 字节，总线周期是 ${s.cycleNs ?? ''} ns，带宽是两者相除。`;
    return { label: '', patch: { Dr: { value: `${value}？` } }, moves: [{ value, from: 'D', to: 'Dr', arc: true }], message: why };
  };
  const atBw = trace.steps.findIndex((step) => step.changes.some((c) => c.at === 'bandwidth')) + 1;
  const mistakes: Mistake<State>[] = [];
  if (atBw > 0) {
    mistakes.push({
      text: '容易拿位数直接乘频率，因为线宽写的是位',
      at: atBw,
      act: () => ({
        label: '',
        patch: { Dr: { value: `${(p.widthBits * p.freqMHz) / p.clocksPerCycle}？` } },
        moves: [{ value: `${p.widthBits} 位`, from: 'W', to: 'Dr', arc: true }],
        message: `MB/s 的 B 是字节。${p.widthBits} 位要先除以 8，否则大了 8 倍。`,
      }),
    });
    mistakes.push({
      text: '容易把总线周期当成时钟周期，因为例 6.1 里两者相等',
      at: atBw,
      act: () => ({
        label: '',
        patch: { T: { value: `${Number((1000 / p.freqMHz).toPrecision(4))} ns？` } },
        moves: [{ value: '1 ÷ f', from: 'F', to: 'T', arc: true }],
        message: p.clocksPerCycle === 1 ? '这一题一个总线周期正好一个时钟，碰巧相等。总线周期占几个时钟要看题目，占 2 个时带宽就减半。' : `这里一个总线周期占 ${p.clocksPerCycle} 个时钟，T 是时钟周期的 ${p.clocksPerCycle} 倍，带宽相应除以 ${p.clocksPerCycle}。`,
      }),
    });
  }
  return {
    scene,
    bind,
    moves,
    names,
    values,
    caption,
    flipPart: () => null,
    askFrame: () => ['D', 'T', 'Dr'],
    frame: () => null,
    wrong,
    mistakes,
    question: BUS_QUESTION,
    convention: () => null,
  };
}
