/**
 * 台面：芯片插在板上。左后方是 CPU 的地址，一束地址线在这里分开：高位往下进译码器，低位沿片内地址线送到每一片。
 * 芯片按组排成横排（一组一排），组内各片并排；译码器在左边，每个输出 Y_i 伸出一根片选线，接到第 i 排每一片的 CS。
 * 被选中的一组从板上抬起。最前面是数据线，演总线冲突时用。
 * 部件位置只取决于引擎 plan() 给出的组数和每组片数，不随步骤变。所有数都取自 Trace 的状态或 plan()。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { plan } from '../../engines/expand/model';
import type { Params, Plan, State } from '../../engines/expand/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec, Vec2, WireSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

/** 页面在引擎的状态上加一个标记：查地址拆成「送地址」「选中」两小步。 */
export type PState = State & { stage?: 'send' | 'select' };

/** A13、Y2、D7 写成 A_13、Y_2、D_7，场景和 Rich 排成下标。十六进制数（9A3CH、A51CH）不动。 */
export const sub = (text: string): string => text.replace(/\b([ADY])(\d{1,2})(?![0-9A-FHK])/g, '$1_$2').replace(/\bG(1|2A|2B)\b/g, 'G_$1');

const D = 1.4;
const LANE_C = 1.55;
const LANE_A = 1.25;
const OUT_ROW = 0.62;

export interface ExpandStage {
  scene: SceneSpec;
  bind: Binding<PState>;
  moves: (step: Step<PState>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  frame: (step: Step<PState>) => string[] | null;
  askFrame: (ask: Ask, index: number) => string[];
  wrong: (ask: Ask, value: string, state: PState, next: Step<PState> | null) => Breakage | null;
  question: { text: string; at: string[] };
  conclusion: string;
  plan: Plan;
  /** 第 c 片（按组从 0 数）的部件 id。 */
  chipId: (c: number) => string;
  /** Y_g 有效：电位沿片选线跑到第 g 组每一片。 */
  selectMoves: (g: number) => Move[];
}

/** 选项文字 → 场景里那根线头的部件 id。 */
const optionId = (i: number) => `opt${i}`;
/** 第 c 片的片选线。 */
export const csWire = (c: number) => `cs-${c}`;

export function expandStage(params: Params, narrow = false): ExpandStage {
  const p = plan(params);
  // 手机上芯片窄一点、排得紧一点：选中的一组两片能一起装进画面。
  const W = narrow ? 2.0 : 2.8;
  const PITCH_X = narrow ? 2.9 : 4.3;
  // 手机上组名和地址范围写在这一排的后面（右边放不下），排距加大。
  const PITCH_Z = narrow ? 4.5 : 3.4;
  const G = p.groups;
  const P = p.perGroup;
  const h = p.n - p.k;
  const many = G > 1;
  const chipId = (c: number) => `U${c}`;
  const chipsOf = (g: number) => Array.from({ length: P }, (_, j) => chipId(g * P + j));

  // ---------- 位置 ----------
  const zRow = (g: number) => g * PITCH_Z;
  const zMid = ((G - 1) * PITCH_Z) / 2;
  const xD = 0;
  const zOut = (g: number) => zMid - (G * OUT_ROW) / 2 + OUT_ROW * (g + 0.5);
  const laneC = (g: number) => zRow(g) + D / 2 + LANE_C - 0.65;
  const laneA = (g: number) => zRow(g) - D / 2 - LANE_A + 0.35;
  // 片选线从译码器出来先横走再竖走：同一方向的线里，走得远的先拐弯，线不交叉。
  const fanBase = xD + 2.75;
  const xFan = new Map<number, number>();
  {
    const up: number[] = [];
    const down: number[] = [];
    for (let g = 0; g < G; g++) (laneC(g) < zOut(g) ? up : down).push(g);
    for (const set of [up, down]) {
      set.sort((a, b) => Math.abs(laneC(b) - zOut(b)) - Math.abs(laneC(a) - zOut(a)));
      set.forEach((g, rank) => xFan.set(g, fanBase + rank * 0.32));
    }
  }
  const fanRight = Math.max(fanBase, ...xFan.values());
  const xChip0 = fanRight + 0.7 + W / 2;
  const xChip = (j: number) => xChip0 + j * PITCH_X;
  const xLast = xChip(P - 1);
  const xLabel = xLast + W / 2 + 2.0;
  const xTrunk = xLast + W / 2 + (many && !narrow ? 4.1 : 1.0);
  const zBus = zRow(0) - D / 2 - (narrow ? 2.7 : 2.1);
  const zData = zRow(G - 1) + D / 2 + 2.3;
  const xAddr = xD - 1.0;
  // 译码器左边的输入脚：和 decoder 部件里的排法相同（均匀分布在一段长度里）。
  const inSpan = Math.min(Math.max(1.8, G * OUT_ROW + 0.3) - 0.4, h * 0.9);
  const ins = Array.from({ length: h }, (_, i) => zMid - inSpan / 2 + (inSpan / h) * (i + 0.5));

  // ---------- 部件 ----------
  // 输入脚不写地址线号：「进译码器的是哪几位」要学生自己定。高位在上。
  const decoderInputs = Array.from({ length: h }, (_, i) => (h === 1 ? '入' : i === 0 ? '高' : i === h - 1 ? '低' : '中'));
  const parts: PartSpec[] = [
    { id: 'addr', kind: 'register', position: [xAddr, zBus], props: { name: `地址 ${sub(`A${p.n - 1}–A0`)}`, value: '', ink: 'addr', width: 2.4 }, title: '地址' },
    {
      id: 'abus',
      kind: 'bus',
      position: [(xD + 0.9 + xTrunk + 0.3) / 2, zBus],
      props: { name: '片内地址', length: xTrunk + 0.3 - (xD + 0.9), value: '', ink: 'addr', idleText: '', showDriver: false },
    },
    {
      id: 'dbus',
      kind: 'bus',
      position: [(xChip0 - W / 2 - 0.4 + xTrunk) / 2, zData],
      props: { name: `数据线 ${sub(`D${params.target.bits - 1}–D0`)}`, length: xTrunk - (xChip0 - W / 2 - 0.4), value: '', ink: 'data', idleText: '' },
    },
  ];
  if (many) {
    parts.push({
      id: 'DEC',
      kind: 'decoder',
      position: [xD, zMid],
      props: { name: p.decoder.replace(' ', ''), inputs: decoderInputs, input: '', enableName: '', low: true },
      title: '译码器',
    });
  } else {
    parts.push({ id: 'DEC', kind: 'label', position: [xD + 0.9, zMid], props: { text: '片选（共用）', plate: true, size: 0.31 }, title: '片选' });
  }
  for (let g = 0; g < G; g++) {
    for (let j = 0; j < P; j++) {
      const c = g * P + j;
      parts.push({
        id: chipId(c),
        kind: 'chip',
        position: [xChip(j), zRow(g)],
        props: {
          name: `${typeof params.chip.words === 'string' ? params.chip.words : p.chipWords}×${params.chip.bits}`,
          label: '',
          width: W,
          depth: D,
          pins: [
            { id: 'addr', name: 'A', side: 'n', lines: narrow ? 8 : 3, ink: 'addr' },
            { id: 'cs', name: 'CS', side: 's', lines: 1, ink: 'ctrl' },
          ],
        },
        pick: true,
        title: many ? `第 ${g} 组第 ${j} 片` : `第 ${j} 片`,
        delay: c * 30,
      });
    }
    if (many) parts.push({ id: `gl${g}`, kind: 'label', position: narrow ? [xChip0 + ((P - 1) * PITCH_X) / 2, zRow(g) - D / 2 - 1.55] : [xLabel, zRow(g)], props: { text: '', plate: true, size: 0.31, mono: true }, title: `第 ${g} 组` });
  }
  // 接好以后，译码器后面一张牌写着进来的是哪几根。
  if (many) parts.push({ id: 'inl', kind: 'label', position: [xD - 0.2, zMid - Math.max(1.8, G * OUT_ROW + 0.3) / 2 - 0.75], props: { text: `${sub(p.decoderLines)} 进译码器`, plate: true, size: 0.31, mono: true }, title: '进译码器的地址线' });
  // 预测「进译码器的是哪几位」时，三根线头摆在译码器前面，点哪根就把哪根插进译码器。
  const options = many ? optionTexts(p) : [];
  options.forEach((option, i) => {
    parts.push({ id: optionId(i), kind: 'label', position: [xD - 0.4, zMid + Math.max(1.8, G * OUT_ROW + 0.3) / 2 + 1.1 + i * 0.95], props: { text: sub(option), plate: true, size: 0.31, mono: true }, pick: true, title: option });
  });

  const wires: WireSpec[] = [{ id: 'a-bus', from: 'addr.e', to: 'abus', ink: 'addr' }];
  for (let i = 0; i < h; i++) {
    const x = xD - 2.75 - i * 0.3;
    wires.push({ id: `a-in${i}`, from: 'addr.w', to: `DEC.in${i}`, ink: 'addr', via: [[x, zBus], [x, ins[i] ?? zMid]] });
  }
  // 片选线：Y_g 到第 g 组每一片的 CS（控制线，虚线）。只有一组时从「片选」牌接出，各片共用。
  for (let g = 0; g < G; g++) {
    for (let j = 0; j < P; j++) {
      const c = g * P + j;
      const x = many ? (xFan.get(g) ?? fanBase) : fanBase;
      const via: Vec2[] = [
        [x, many ? zOut(g) : zMid],
        [x, laneC(g)],
        [xChip(j), laneC(g)],
      ];
      wires.push({ id: csWire(c), from: many ? `DEC.y${g}` : 'DEC.e', to: `${chipId(c)}.cs`, ink: 'ctrl', via });
    }
  }
  for (let g = 0; g < G; g++) {
    for (let j = 0; j < P; j++) {
      const c = g * P + j;
      wires.push(
        g === 0
          ? { id: `b-${c}`, from: 'abus', to: `${chipId(c)}.addr`, ink: 'addr' }
          : { id: `b-${c}`, from: 'abus', to: `${chipId(c)}.addr`, ink: 'addr', via: [[xTrunk, zBus], [xTrunk, laneA(g)], [xChip(j), laneA(g)]] },
      );
    }
  }

  // ---------- 绑定 ----------
  type Src = Parameters<typeof bindTable<PState>>[0][string][string];
  const table: Record<string, Record<string, Src>> = {};
  const probeOf = (c: BindContext<PState>) => c.state.probe;
  const selectedGroup = (c: BindContext<PState>): number | null => {
    const probe = probeOf(c);
    if (probe && c.state.stage !== 'send') return probe.group ?? (many ? null : 0);
    // 每组地址范围那一步：译码器的输入取这一组的编号，Y_g 有效，这一组抬起来演一遍。
    const range = c.step?.changes.find((change) => /^ranges\.\d+\.from$/.test(change.at));
    return range ? Number(range.at.split('.')[1]) : null;
  };
  table['addr'] = { value: from(['probe.address'], (c) => probeOf(c)?.address ?? '') };
  table['abus'] = {
    value: from(['chipLines', 'probe.inner'], (c) => {
      const probe = probeOf(c);
      if (probe) return probe.inner;
      return c.state.chipLines ? sub(c.state.chipLines) : '';
    }),
    drivers: (c: BindContext<PState>) => (c.state.chipLines ? 'CPU' : ''),
  };
  table['dbus'] = { value: () => '' };
  if (many) {
    table['DEC'] = {
      input: from(['decoderLines', 'probe.bits'], (c) => {
        const probe = probeOf(c);
        if (probe) return probe.bits.slice(0, h);
        const g = selectedGroup(c);
        return g === null ? '' : c.state.ranges[g] ? groupBits(g, h) : '';
      }),
      // 没有选中时不给 active：输出脚上不写电平。
      active: from(['probe.group'], (c) => selectedGroup(c) ?? undefined),
    };
  }
  for (let g = 0; g < G; g++) {
    if (many) {
      table[`gl${g}`] = {
        text: from([`ranges.${g}`, 'groups'], (c) => {
          const r = c.state.ranges[g];
          if (r) return `第 ${g} 组  ${r.from}–${r.to}`;
          return c.state.groups !== null ? `第 ${g} 组` : '';
        }),
        hidden: (c: BindContext<PState>) => c.state.groups === null,
      };
    }
    for (let j = 0; j < P; j++) {
      const c = g * P + j;
      table[chipId(c)] = {
        label: from([`chips.${c}.data`], (x) => sub(x.state.chips[c]?.data ?? '')),
        // 引脚、抬起不登记状态路径：送地址那一步每一片都收到片内地址，不能八片一起标成「变了」。
        pins: (x: BindContext<PState>) => {
          const chip = x.state.chips[c];
          const probe = probeOf(x);
          // 手机上两片并排时地址脚旁放不下读数（会压住右边一片的名牌），读数看片内地址线上的那张牌。
          const addrValue = narrow && P > 1 ? '' : probe ? probe.inner : x.state.chipLines && !narrow ? sub(x.state.chipLines) : '';
          const sel = selectedGroup(x);
          const csValue = probe && x.state.stage !== 'send' ? (sel === g ? '0' : '1') : chip?.select ? sub(chip.select).replace('片选（共用）', '共用') : '';
          return [
            { id: 'addr', name: 'A', side: 'n', lines: narrow ? 8 : 3, ink: 'addr', value: addrValue },
            { id: 'cs', name: 'CS', side: 's', lines: 1, ink: 'ctrl', value: csValue },
          ];
        },
        selected: (x: BindContext<PState>) => selectedGroup(x) === g,
        changed: (x: BindContext<PState>) => selectedGroup(x) === g && x.state.stage !== 'send' && !!x.step && x.step.changes.some((change) => change.at === 'probe.group' || /^ranges\.\d+\.from$/.test(change.at)),
      };
    }
  }
  if (many) table['inl'] = { hidden: (c: BindContext<PState>) => c.state.decoderLines === '' };
  options.forEach((_, i) => {
    table[optionId(i)] = { hidden: (c: BindContext<PState>) => !(c.state.groups !== null && c.state.decoderLines === '' && c.index > 0) };
  });
  const bind = bindTable<PState>(table);

  // ---------- 移动 ----------
  const selectMoves = (g: number): Move[] =>
    Array.from({ length: P }, (_, j) => ({ value: many ? `Y_${g}` : 'CS', from: 'DEC', to: chipId(g * P + j), via: [csWire(g * P + j)], ink: 'ctrl' as const, shape: 'level' as const }));
  const moves = (step: Step<PState>): Move[] => {
    const at = new Set(step.changes.map((change) => change.at));
    if (at.has('decoderLines') || (at.has('chipLines') && !many)) {
      const out: Move[] = [{ value: sub(p.chipLines), from: 'addr', to: 'abus', via: ['a-bus'], ink: 'addr' }];
      if (many) out.unshift({ value: sub(p.decoderLines), from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr' });
      return out;
    }
    // 选中一组：Y_g 的电位沿片选线跑到这一组的每一片，片子随后抬起。
    const range = step.changes.find((change) => /^ranges\.\d+\.from$/.test(change.at));
    const picked = range ? Number(range.at.split('.')[1]) : step.state.stage === 'select' && step.state.probe ? (step.state.probe.group ?? 0) : null;
    if (picked !== null) return selectMoves(picked);
    if (step.state.stage === 'send' && step.state.probe) {
      const probe = step.state.probe;
      const out: Move[] = [{ value: probe.inner, from: 'addr', to: 'abus', via: ['a-bus'], ink: 'addr' }];
      if (many) out.unshift({ value: probe.bits.slice(0, h), from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr' });
      return out;
    }
    return [];
  };

  // ---------- 文字 ----------
  const names = (path: string): string => {
    const parts = path.split('.');
    const fixed: Record<string, string> = { d: '芯片数 d', perGroup: '每组片数', groups: '组数', chipLines: '片内地址线', decoderLines: '进译码器的地址线', decoder: '译码器' };
    if (parts[0] && fixed[parts[0]]) return fixed[parts[0]]!;
    if (parts[0] === 'chips') {
      const chip = Number(parts[1]);
      const g = Math.floor(chip / P);
      const j = chip % P;
      const field: Record<string, string> = { data: '数据线', select: '片选', group: '组号', index: '组内序号' };
      return `${many ? `第 ${g} 组第 ${j} 片` : `第 ${j} 片`}${field[parts[2] ?? ''] ?? ''}`;
    }
    if (parts[0] === 'ranges') {
      const field: Record<string, string> = { from: '首地址', to: '尾地址', select: '片选', group: '组号' };
      return `第 ${parts[1]} 组${field[parts[2] ?? ''] ?? ''}`;
    }
    if (parts[0] === 'probe') {
      const field: Record<string, string> = { address: '要查的地址', bits: '地址的二进制', group: '选中的组', inner: '片内地址' };
      return field[parts[1] ?? ''] ?? '查地址';
    }
    return path;
  };
  const values = (_path: string, value: string): string => sub(value);

  const frame = (step: Step<PState>): string[] | null => {
    const range = step.changes.find((change) => /^ranges\.\d+\.from$/.test(change.at));
    if (range) {
      const g = Number(range.at.split('.')[1]);
      return narrow ? [`gl${g}`, ...chipsOf(g)] : ['DEC', `gl${g}`, ...chipsOf(g)];
    }
    if (step.state.stage === 'send') return narrow ? [many ? 'DEC' : 'addr'] : ['addr', 'DEC', chipId(0)];
    if (narrow && step.changes.some((change) => change.at === 'chipLines')) return many ? ['DEC', 'inl'] : chipsOf(0);
    if (step.state.probe && step.state.probe.group !== null) return narrow ? chipsOf(step.state.probe.group) : ['DEC', ...chipsOf(step.state.probe.group)];
    if (step.changes.some((change) => change.at === 'perGroup')) return chipsOf(0);
    return null;
  };
  const askFrame = (ask: Ask): string[] => (ask.kind === 'choice' ? ['DEC', ...options.map((_, i) => optionId(i))] : narrow ? ['DEC'] : ['addr', 'DEC']);

  // 答错时演学生的选择。
  const wrong = (ask: Ask, value: string, state: PState): Breakage | null => {
    if (ask.kind === 'choice') {
      const i = options.indexOf(value);
      if (i < 0) return null;
      const width = lineCount(value);
      return {
        label: '',
        patch: { DEC: { input: '' } },
        moves: [{ value: sub(value), from: optionId(i), to: 'DEC', arc: true, ink: 'addr' }],
        message:
          value === p.chipLines
            ? `把片内地址 ${sub(value)} 送进译码器，芯片的地址脚就空着了，一片里的 ${sizeName(params.chip.words)} 个字分不开。片选只用片内地址用剩下的高位。`
            : `${width} 根线全进译码器，要 ${width}:2^${width} 的译码器，每个输出只管一个字；芯片的片内地址 ${sub(p.chipLines)} 又没人接。`,
      };
    }
    // 选中第几组：让学生说的那一组抬起来，看它管哪段地址。
    const guess = Number(value);
    const probe = state.probe;
    if (!probe || !Number.isInteger(guess) || guess < 0 || guess >= G || guess === probe.group) {
      return probe
        ? { label: '', patch: {}, moves: [{ value: probe.bits.slice(0, h), from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr' }], message: `一共 ${G} 组，编号 0 到 ${G - 1}。看 ${probe.address} 的高 ${h} 位。` }
        : null;
    }
    const patch: Record<string, Record<string, unknown>> = { DEC: { input: groupBits(guess, h), active: guess } };
    for (const id of chipsOf(guess)) patch[id] = { selected: true };
    return {
      label: '',
      patch,
      moves: selectMoves(guess),
      message: `要让第 ${guess} 组抬起来，译码器的输入得是 ${groupBits(guess, h)}；${probe.address} 的高 ${h} 位是 ${probe.bits.slice(0, h)}。`,
    };
  };

  const question = { text: `${p.d} 片芯片，片选要几位地址`, at: narrow ? (many && G > 4 ? ['DEC'] : chipsOf(0)) : many ? ['DEC', ...chipsOf(0)] : [chipId(0)] };
  const conclusion = many
    ? `片选按组算，不按片算：一组里的${P > 1 ? '几片共用一个片选，同时工作才凑出一个完整的字' : '只有一片，它自己一个片选'}。${G} 组 = 2^${h}，所以 ${p.d} 片只要 ${h} 位高位地址进译码器，低 ${p.k} 位接每一片。`
    : `只有一组，${p.d} 片同时工作，片选共用，不要译码器。`;

  return { scene: { parts, wires }, bind, moves, names, values, frame, askFrame, wrong, question, conclusion, plan: p, chipId, selectMoves };
}

/** 组号写成 h 位二进制：译码器的输入。 */
export function groupBits(g: number, h: number): string {
  return g.toString(2).padStart(h, '0');
}

/** A15–A14 有几根线。 */
export function lineCount(lines: string): number {
  const m = /A(\d+)–A(\d+)/.exec(lines);
  if (m) return Number(m[1]) - Number(m[2]) + 1;
  return /A\d+/.test(lines) ? 1 : 0;
}

const sizeName = (words: number | string): string => (typeof words === 'string' ? words.toUpperCase() : String(words));

/** 引擎「进译码器的是哪几位」的选项，场景里每个选项一根线头。 */
function optionTexts(p: Plan): string[] {
  return [p.decoderLines, p.chipLines, `A${p.n - 1}–A0`].filter((x, i, all) => x && all.indexOf(x) === i);
}

/**
 * 页面对 Trace 的加工：A13、Y2 排成下标；查地址那一步拆成「送地址」和「选中」两小步（同一时刻发生的事，拆开是为了讲清楚）。
 * 新加的一步只用引擎在查地址那一步给出的数。
 */
export function polish(trace: Trace<Params, State>): Trace<Params, PState> {
  const steps: Step<PState>[] = [];
  const h = (() => {
    const p = plan(trace.params);
    return p.n - p.k;
  })();
  const k = plan(trace.params).k;
  for (const step of trace.steps) {
    const base: Step<PState> = { ...step, title: sub(step.title), why: sub(step.why) };
    const probe = step.state.probe;
    if (probe && step.changes.some((change) => change.at === 'probe')) {
      const sendState: PState = { ...step.state, stage: 'send' };
      steps.push({
        id: `${step.id}a`,
        level: 'explain',
        title: `地址 ${probe.address} 送上地址线`,
        why: `${probe.address} = ${probe.bits}。${h > 0 ? `高 ${h} 位 ${probe.bits.slice(0, h)} 送到译码器，` : ''}低 ${k} 位送到每一片的地址脚，片内地址 ${probe.inner}。每一片都收到同一个片内地址，${h > 0 ? '还没说哪一组工作' : '一起工作'}。`,
        ...(step.ref ? { ref: step.ref } : {}),
        state: sendState,
        changes: step.changes.filter((change) => change.at !== 'probe.group'),
        focus: ['probe'],
      });
      steps.push({ ...base, state: { ...step.state, stage: 'select' }, changes: step.changes.filter((change) => change.at === 'probe.group') });
    } else steps.push({ ...base, state: { ...step.state } });
  }
  return {
    ...trace,
    initial: { ...trace.initial },
    steps,
    conditions: trace.conditions.map((item) => ({ ...item, value: sub(item.value) })),
    table: { ...trace.table, rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(sub) })) },
  } as Trace<Params, PState>;
}

/** 常见错误，每条在场景里演一遍。数都取自 plan() 和 Trace。 */
export function expandMistakes(trace: Trace<Params, PState>, stage: ExpandStage): Mistake<PState>[] {
  const p = stage.plan;
  const out: Mistake<PState>[] = [];
  const h = p.n - p.k;
  const lines = trace.steps.findIndex((step) => step.changes.some((change) => change.at === 'decoderLines'));
  const last = trace.steps[trace.steps.length - 1]?.state;
  const slice = sub(last?.chips[0]?.data ?? '');
  if (p.groups > 1 && p.perGroup > 1 && lines >= 0) {
    const wrongBits = Math.round(Math.log2(p.d));
    out.push({
      text: `容易按 ${p.d} 片算成 ${wrongBits} 位片选，因为把每一片都当成要单独选`,
      at: lines + 1,
      act: () => ({
        label: '',
        // 只有第 0 片抬起、送数；数据线上只到了它那几位，不是冲突。
        patch: { [stage.chipId(0)]: { selected: true }, dbus: { value: `只到 ${slice}`, drivers: ['第 0 片'] } },
        moves: [
          { ...stage.selectMoves(0)[0]!, phase: 0 },
          { value: slice, from: stage.chipId(0), to: 'dbus', arc: true, ink: 'data', phase: 1 },
        ],
        message: `单独选一片，这一组只有第 0 片工作：它只送 ${slice}，数据线上只到了这几位，其余的位没有芯片送数，读出来缺了几位。组内 ${p.perGroup} 片必须一起选中，所以片选按组数 ${p.groups} 算，${h} 位就够。`,
      }),
    });
  }
  if (p.groups > 1 && lines >= 0) {
    out.push({
      text: '容易把低位地址接译码器、高位接芯片，因为觉得哪几根都一样',
      at: lines + 1,
      act: () => ({
        label: '',
        patch: { DEC: { input: '' } },
        moves: [{ value: sub(`A${h - 1}–A0`), from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr' }],
        message: `低 ${h} 位每加 1 就换一组：连续的几个地址散到 ${p.groups} 组里，一组芯片不再是一整段地址，地址范围也写不成「首地址–尾地址」。教材的接法是低位接片内地址，高位进译码器（p77）。`,
      }),
    });
  }
  out.push({
    text: '容易把芯片数算成 目标字数 ÷ 芯片字数，因为忘了位数也要除',
    at: 1,
    act: () => ({
      label: '',
      // 只摆出 组数 那么多片：每组只剩一片，其余的位没有芯片。
      patch: Object.fromEntries(Array.from({ length: p.d }, (_, c) => [stage.chipId(c), { hidden: c % p.perGroup !== 0 }])),
      moves: [{ value: `${p.groups} 片`, from: 'addr', to: stage.chipId(0), arc: true, ink: 'addr' }],
      message: `d 要按「字数 × 位数」整体除：(${sub(trace.conditions[0]?.value ?? '')}) / (${sub(trace.conditions[1]?.value ?? '')})。只除字数，得到的是组数 ${p.groups}，还要乘每组片数 ${p.perGroup}。`,
    }),
  });
  return out.slice(0, 3);
}
