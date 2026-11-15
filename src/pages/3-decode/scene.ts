/**
 * 台面：芯片插在板上。左边一张「地址空间」表，一行是译码器的一个输出 Y_i 管的那一段地址；
 * 左后方是 CPU 的地址，一束地址线分开：紧挨着组内地址的几位进 74138（或 74139），低位沿片内地址线送到每一片。
 * 右边每组芯片一排；Y_i 伸出片选线接到它那一组的 CS，占好几个 Y 的大块经与门，比一组小的芯片经非门、与非门再分一次。
 * 被选中的一组从板上抬起。部件位置只取决于引擎 design() 给出的分组和接法，不随步骤变。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { design, hex } from '../../engines/decode/model';
import type { ChipGroup, Design, Params, State } from '../../engines/decode/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec, Vec2, WireSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';
import { sub } from '../3-expand/scene';

export type PState = State & { stage?: 'send' | 'select' };

const D = 1.4;
const OUT_ROW = 0.62;

type Conn =
  | { kind: 'direct'; ys: number[] }
  | { kind: 'and'; ys: number[] }
  | { kind: 'nand'; ys: number[]; lines: string }
  | { kind: 'none'; ys: number[] };

/** 一组芯片的片选怎么接：读引擎 design() 写好的 select（如 Y3、Y0、Y1 进与门、Y7 经非门，与 A12 进与非门）。 */
function connOf(group: ChipGroup): Conn {
  const ys = [...group.select.matchAll(/Y(\d+)/g)].map((m) => Number(m[1]));
  if (group.select.includes('与非门')) return { kind: 'nand', ys, lines: /与 (.+) 进与非门/.exec(group.select)?.[1] ?? '' };
  if (group.select.includes('与门')) return { kind: 'and', ys };
  if (ys.length === 1) return { kind: 'direct', ys };
  return { kind: 'none', ys };
}

export interface DecodeStage {
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
  design: Design;
  /** Y_i 有效：电位沿片选线（经门）跑到它那一组的每一片。 */
  yMoves: (i: number, value?: string) => Move[];
  chipIds: (r: number) => string[];
  groupOf: (name: string) => number;
}

export function decodeStage(params: Params, narrow = false): DecodeStage {
  const d = design(params);
  const n = d.n;
  const count = d.decoder === '74138' ? 3 : 2;
  const outs = 2 ** count;
  const groups = d.groups;
  const R = groups.length;
  const conns = groups.map(connOf);
  const W = narrow ? 2.0 : 2.8;
  const PITCH_X = narrow ? 2.9 : 3.9;
  // 手机上组名写在这一排的后面（右边放不下），排距加大。
  const PITCH_Z = narrow ? 4.5 : 3.4;
  // 一列的版式（台面约 45 个单位深）镜头会找偏，停用；手机上沿用左右排开的台面，只是芯片窄一些、每步只框一小组。
  const col = false as boolean;
  const chipId = (r: number, j: number) => `U${r}_${j}`;
  const chipIds = (r: number) => Array.from({ length: groups[r]!.perGroup }, (_, j) => chipId(r, j));
  const groupOf = (name: string) => groups.findIndex((g) => g.name === name);
  const viewIndex = (g: ChipGroup) => d.regions.findIndex((r) => r.index === g.region);

  // ---------- 位置 ----------
  // 桌面：地址空间表、译码器、芯片从左到右。手机：从后到前排成一列（表、作答名牌、地址、译码器、各组芯片），
  // 片选线从译码器右边绕下来、从右边进各排，地址线走左边；镜头只上下移，整片芯片都在画面里。
  const zRow = (r: number) => r * PITCH_Z;
  const depthD = Math.max(1.8, outs * OUT_ROW + 0.3);
  const enCount = d.enables.length;
  const zBus = zRow(0) - D / 2 - (narrow ? 2.7 : 2.1);
  const zMid = col ? zBus - 5.6 - depthD / 2 : ((R - 1) * PITCH_Z) / 2;
  const zAddr = col ? zMid - depthD / 2 - 1.7 : zBus;
  const xD = 0;
  const zOut = (i: number) => zMid - (outs * OUT_ROW) / 2 + OUT_ROW * (i + 0.5);
  const lane = (r: number) => zRow(r) + D / 2 + 0.9;
  const laneA = (r: number) => zRow(r) - D / 2 - 0.9;
  const rowOfY = new Map<number, number>();
  conns.forEach((c, r) => c.ys.forEach((i) => rowOfY.set(i, r)));
  const fanBase = xD + (col ? 5.3 : 2.75);
  const xFan = new Map<number, number>();
  {
    const up: number[] = [];
    const down: number[] = [];
    for (const [i, r] of rowOfY) (lane(r) < zOut(i) ? up : down).push(i);
    for (const set of [up, down]) {
      set.sort((a, b) => Math.abs(lane(rowOfY.get(b)!) - zOut(b)) - Math.abs(lane(rowOfY.get(a)!) - zOut(a)));
      // 手机上线从右边进各排：走得远的在外圈。
      set.forEach((i, rank) => xFan.set(i, fanBase + (col ? set.length - 1 - rank : rank) * 0.3));
    }
  }
  const fanRight = Math.max(fanBase, ...xFan.values());
  const hasNand = conns.some((c) => c.kind === 'nand');
  const hasAnd = conns.some((c) => c.kind === 'and');
  const xG1 = col ? 4.45 : fanRight + 1.0;
  const xG2 = col ? 2.95 : xG1 + 1.7;
  const xAnd = col ? 2.95 : xG1;
  const gatesRight = hasNand ? xG2 + 0.8 : hasAnd ? xG1 + 0.7 : fanRight;
  const xChip0 = col ? -1.9 : gatesRight + 0.7 + W / 2;
  const xChip = (j: number) => xChip0 + j * PITCH_X;
  const maxPer = Math.max(...groups.map((g) => g.perGroup));
  const xLast = xChip(maxPer - 1);
  const xTrunk = col ? -4.3 : xLast + W / 2 + 2.3;
  const zData = zRow(R - 1) + D / 2 + 2.4;
  const inSpan = Math.min(depthD - 0.4, count * 0.9);
  const zIn = (t: number) => zMid - inSpan / 2 + (inSpan / count) * (t + 0.5);
  const zUnder = zMid + depthD / 2 + 1.4;
  // 手机上作答用的名牌摆在地址空间表前面，三个一排；桌面上直接点各组右边的名牌。
  // 手机一屏只装得下约 6 个单位宽：作答的名牌三个一排摆在表的前面，上面一张牌写着这道题问的那一段。
  const mapHalf = outs * 0.36 + 0.5;
  const tagRows = Math.ceil((R + 1) / 3);
  const xMap = col ? -0.4 : xD - 6.1;
  // 作答的一小组和表、地址隔开一屏的距离：镜头看它时不会为了不切开旁边的大部件而挪走。
  const zMap = col ? zAddr - 3.2 - tagRows * 1.1 - 1.1 - 3.0 - mapHalf : zMid;
  const zAsk = zMap + mapHalf + (col ? 3.0 : 1.0);
  const tagAt = (t: number): Vec2 => [xMap + (t % 3 - 1) * 1.6, zAsk + 1.1 + Math.floor(t / 3) * 1.1];
  const lastSpot: Vec2 = narrow ? tagAt(groups.length) : [xD - 0.3, zUnder + (enCount + 2) * 0.6 + 0.9];
  const side = col ? { into: 'e', out: 'w' } : { into: 'w', out: 'e' };

  // ---------- 部件 ----------
  const lowGroup = `A${d.k - 1}–A0`;
  const parts: PartSpec[] = [
    { id: 'addr', kind: 'register', position: [col ? xD - 0.2 : xD - 1.0, zAddr], props: { name: `地址 ${sub(`A${n - 1}–A0`)}`, value: '', ink: 'addr', width: 2.4 }, title: '地址' },
    {
      id: 'abus',
      kind: 'bus',
      position: col ? [(xTrunk - 0.3 + xLast + W / 2) / 2, zBus] : [(xD + 0.9 + xTrunk + 0.3) / 2, zBus],
      props: { name: '组内地址', length: col ? xLast + W / 2 - (xTrunk - 0.3) : xTrunk + 0.3 - (xD + 0.9), value: '', ink: 'addr', idleText: '', showDriver: false },
    },
    {
      id: 'dbus',
      kind: 'bus',
      position: [(xChip0 - W / 2 - 0.4 + xLast + W / 2) / 2, zData],
      props: { name: `数据线 ${sub(`D${params.dataBits - 1}–D0`)}`, length: xLast + W / 2 - (xChip0 - W / 2 - 0.4), value: '', ink: 'data', idleText: '' },
    },
    {
      id: 'DEC',
      kind: 'decoder',
      position: [xD, zMid],
      props: { name: d.decoder, inputs: count === 3 ? ['C', 'B', 'A'] : ['B', 'A'], input: '', enableName: count === 3 ? 'G_2A' : 'G', low: true },
      title: '译码器',
    },
    {
      id: 'map',
      kind: 'memory',
      position: [xMap, zMap],
      title: '地址空间',
      props: {
        name: '地址空间',
        columns: [
          { title: '地址范围', width: 2.5, ink: 'addr' },
          { title: '放什么', width: 1.5 },
        ],
        rows: d.outputs.map(() => ['', '']),
        labels: d.outputs.map((o) => sub(o.y)),
      },
    },
    ...Array.from({ length: enCount }, (_, t): PartSpec => ({ id: `en${t}`, kind: 'label', position: [xD - 0.3, zUnder + t * 0.6], props: { text: '', size: 0.31, tone: 'muted' }, title: '使能端' })),
    ...[0, 1].map((t): PartSpec => ({ id: `ctl${t}`, kind: 'label', position: [xD - 0.3, zUnder + (enCount + t) * 0.6 + 0.3], props: { text: '', size: 0.31, tone: 'muted' }, title: '控制线' })),
    { id: 'none', kind: 'label', position: lastSpot, props: { text: '空着不接', plate: true, size: 0.31 }, pick: true, title: '空' },
    { id: 'nochip', kind: 'label', position: lastSpot, props: { text: '没有芯片', plate: true, size: 0.31 }, pick: true, title: '没有芯片' },
  ];
  groups.forEach((g, r) => {
    for (let j = 0; j < g.perGroup; j++) {
      parts.push({
        id: chipId(r, j),
        kind: 'chip',
        position: [xChip(j), zRow(r)],
        props: {
          // 手机上组名写在芯片的名牌上（右边放不下单独的名牌）。
          name: narrow ? g.name : g.chip.replace(' 位', ''),
          label: '',
          width: W,
          depth: D,
          pins: [
            { id: 'addr', name: 'A', side: 'n', lines: narrow ? 8 : 3, ink: 'addr' },
            { id: 'cs', name: 'CS', side: 's', lines: 1, ink: 'ctrl' },
          ],
        },
        title: `${g.name} 第 ${j} 片`,
        delay: j * 30,
      });
    }
    if (!narrow) parts.push({ id: `gl${r}`, kind: 'label', position: [xChip(g.perGroup - 1) + W / 2 + 1.3, zRow(r)], props: { text: g.name, plate: true, size: 0.31, mono: true }, pick: true, title: g.name });
    if (narrow) parts.push({ id: `cap${r}`, kind: 'label', position: [xChip0 + ((g.perGroup - 1) * PITCH_X) / 2, zRow(r) - D / 2 - 1.55], props: { text: `${g.name}：${g.chip}`, plate: true, size: 0.31 }, title: `${g.name} 的规格` });
    if (narrow && r === 0) parts.push({ id: 'ql', kind: 'label', position: [xMap, zAsk], props: { text: `${sub(d.outputs[0]!.y)}：${d.outputs[0]!.from}–${d.outputs[0]!.to}`, plate: true, size: 0.31, mono: true }, title: '这道题问的地址' });
    if (narrow) parts.push({ id: `pk${r}`, kind: 'label', position: tagAt(r), props: { text: g.name, plate: true, size: 0.31, mono: true }, pick: true, title: g.name });
    const c = conns[r]!;
    if (c.kind === 'and') parts.push({ id: `g${r}`, kind: 'label', position: [xAnd, lane(r)], props: { text: '与门', plate: true, size: 0.31 }, title: `${g.name} 的与门` });
    if (c.kind === 'nand') {
      parts.push(
        { id: `not${r}`, kind: 'label', position: [xG1, lane(r)], props: { text: '非门', plate: true, size: 0.31 }, title: `${g.name} 的非门` },
        { id: `g${r}`, kind: 'label', position: [xG2, lane(r)], props: { text: '与非门', plate: true, size: 0.31 }, title: `${g.name} 的与非门` },
        { id: `st${r}`, kind: 'label', position: [xG2, lane(r) + 1.0], props: { text: sub(c.lines), plate: true, size: 0.31, mono: true }, title: '组内高位地址' },
      );
    }
  });

  // ---------- 连线 ----------
  const wires: WireSpec[] = [col ? { id: 'a-bus', from: 'addr.w', to: 'abus', ink: 'addr', via: [[xTrunk + 0.3, zAddr], [xTrunk + 0.3, zBus]] } : { id: 'a-bus', from: 'addr.e', to: 'abus', ink: 'addr' }];
  for (let t = 0; t < count; t++) {
    const x = xD - 2.75 - t * 0.3;
    wires.push({ id: `a-in${t}`, from: 'addr.w', to: `DEC.in${t}`, ink: 'addr', via: [[x, zAddr], [x, zIn(t)]] });
  }
  const fanVia = (i: number, r: number): Vec2[] => {
    const x = xFan.get(i) ?? fanBase;
    return [
      [x, zOut(i)],
      [x, lane(r)],
    ];
  };
  groups.forEach((g, r) => {
    const c = conns[r]!;
    const head = c.kind === 'and' || c.kind === 'nand' ? `g${r}` : null;
    if (c.kind === 'direct') {
      for (let j = 0; j < g.perGroup; j++) wires.push({ id: `cs-${r}-${j}`, from: `DEC.y${c.ys[0]}`, to: `${chipId(r, j)}.cs`, ink: 'ctrl', via: [...fanVia(c.ys[0]!, r), [xChip(j), lane(r)]] });
    } else if (head) {
      const first = c.kind === 'nand' ? `not${r}` : head;
      for (const i of c.ys) wires.push({ id: `in-${r}-${i}`, from: `DEC.y${i}`, to: `${first}.${side.into}`, ink: 'ctrl', via: fanVia(i, r) });
      if (c.kind === 'nand') {
        wires.push({ id: `nn-${r}`, from: `not${r}.${side.out}`, to: `${head}.${side.into}`, ink: 'ctrl' });
        wires.push({ id: `st-${r}`, from: `st${r}.n`, to: `${head}.s`, ink: 'addr' });
      }
      for (let j = 0; j < g.perGroup; j++) wires.push({ id: `cs-${r}-${j}`, from: `${head}.${side.out}`, to: `${chipId(r, j)}.cs`, ink: 'ctrl', via: [[xChip(j), lane(r)]] });
    }
    for (let j = 0; j < g.perGroup; j++) {
      wires.push(
        r === 0 && !col
          ? { id: `b-${r}-${j}`, from: 'abus', to: `${chipId(r, j)}.addr`, ink: 'addr' }
          : { id: `b-${r}-${j}`, from: 'abus', to: `${chipId(r, j)}.addr`, ink: 'addr', via: [[xTrunk, zBus], [xTrunk, laneA(r)], [xChip(j), laneA(r)]] },
      );
    }
  });

  // ---------- 状态 → 画面 ----------
  const yIndex = (y: string | undefined): number | null => (y && /^Y\d+$/.test(y) ? Number(y.slice(1)) : null);
  /** 这一步亮的是哪个 Y：译出某个 Y 的那一步，或查地址选中的那一步。 */
  const activeY = (c: BindContext<PState>): number | null => {
    const probe = c.state.probe;
    if (probe && c.state.stage !== 'send') return yIndex(probe.output);
    const out = c.step?.changes.find((change) => /^outputs\.\d+\.y$/.test(change.at));
    return out ? Number(out.at.split('.')[1]) : null;
  };
  const sliceText = (i: number, c: BindContext<PState>): string => {
    const done = c.state.outputs[i];
    if (done) return done.target;
    if (c.state.regions.length === 0) return '';
    const o = d.outputs[i]!;
    const a = parseInt(o.from, 16);
    const b = parseInt(o.to, 16);
    const hit = d.regions.filter((r) => r.start <= b && r.end >= a);
    if (hit.length === 0) return '空';
    return hit.map((r) => (r.start <= a && r.end >= b ? r.kind : `${r.kind} ${c.state.regions[d.regions.indexOf(r)]?.size ?? ''}`)).join('、');
  };
  type Src = Parameters<typeof bindTable<PState>>[0][string][string];
  const table: Record<string, Record<string, Src>> = {};
  table['addr'] = { value: from(['probe.address'], (c) => c.state.probe?.address ?? '') };
  table['abus'] = {
    value: from(['groupLines', 'probe.inner'], (c) => {
      const probe = c.state.probe;
      if (probe) return probe.bits ? hex(parseInt(probe.bits.slice(n - d.k), 2), d.k) : '';
      return c.state.groupLines ? sub(c.state.groupLines) : '';
    }),
  };
  table['dbus'] = { value: () => '' };
  table['DEC'] = {
    input: from(['decoder.type', 'probe.bits'], (c) => {
      const probe = c.state.probe;
      if (probe) return probe.bits.slice(n - d.k - count, n - d.k);
      const y = activeY(c);
      return y === null ? '' : y.toString(2).padStart(count, '0');
    }),
    active: from(['outputs', 'probe.output'], (c) => activeY(c) ?? undefined),
  };
  table['map'] = {
    rows: from(['regions', 'outputs'], (c) => d.outputs.map((o, i) => [c.state.regions.length > 0 || c.state.outputs[i] ? `${o.from}–${o.to}` : '', sliceText(i, c)])),
    active: (c: BindContext<PState>) => activeY(c) ?? -1,
    changedCells: (c: BindContext<PState>) => {
      const y = c.step?.changes.find((change) => /^outputs\.\d+\.target$/.test(change.at));
      return y ? [`${y.at.split('.')[1]}.1`] : [];
    },
  };
  for (let t = 0; t < enCount; t++) table[`en${t}`] = { text: from([`decoder.enables.${t}`], (c) => sub(c.state.decoder.enables[t] ?? '')) };
  for (const t of [0, 1]) table[`ctl${t}`] = { text: from([`control.${t}`], (c) => sub(c.state.control[t] ?? '')) };
  const yPhase = (c: BindContext<PState>) => c.state.decoder.type !== '' && c.state.outputs.length < outs;
  const pPhase = (c: BindContext<PState>) => c.state.control.length > 0 && c.state.stage !== 'select';
  table['none'] = { hidden: (c: BindContext<PState>) => !yPhase(c) };
  table['nochip'] = { hidden: (c: BindContext<PState>) => !pPhase(c) };
  if (narrow) {
    const asked = (c: BindContext<PState>): string => {
      if (yPhase(c)) {
        const o = d.outputs[c.state.outputs.length];
        return o ? `${sub(o.y)}：${o.from}–${o.to}` : '';
      }
      return pPhase(c) && c.state.probe ? `${c.state.probe.address}：高位 ${c.state.probe.bits.slice(0, n - d.k)}` : '';
    };
    table['ql'] = { text: asked, hidden: (c: BindContext<PState>) => asked(c) === '' };
  }
  if (narrow) groups.forEach((_, r) => (table[`pk${r}`] = { hidden: (c: BindContext<PState>) => !(yPhase(c) || pPhase(c)) }));
  const selectedRow = (c: BindContext<PState>): number | null => {
    const probe = c.state.probe;
    if (probe) return c.state.stage === 'send' ? null : groupOf(probe.chip);
    const y = activeY(c);
    if (y === null) return null;
    return rowOfY.get(y) ?? null;
  };
  groups.forEach((g, r) => {
    const vi = viewIndex(g);
    const shown = (c: BindContext<PState>) => (c.state.regions[vi]?.chips ?? '') !== '';
    table[`gl${r}`] = {
      // 字不随步骤变（点选按钮的大小按字宽算），只在这一区选好片之后显出来。
      hidden: (c: BindContext<PState>) => !shown(c),
    };
    if (narrow) table[`cap${r}`] = { hidden: (c: BindContext<PState>) => !shown(c) };
    for (let j = 0; j < g.perGroup; j++) {
      table[chipId(r, j)] = {
        label: from([`regions.${vi}.chips`], (c) => (shown(c) ? sub(g.data[j] ?? '') : '')),
        pins: (c: BindContext<PState>) => {
          const probe = c.state.probe;
          const own = Math.log2(g.words);
          const addrValue = narrow && j < g.perGroup - 1 ? '' : probe && probe.chip === g.name ? probe.inner : c.state.groupLines ? sub(own < d.k ? `A${own - 1}–A0` : c.state.groupLines) : '';
          const sel = selectedRow(c);
          const csValue = sel === null ? '' : sel === r ? '0' : '1';
          return [
            { id: 'addr', name: 'A', side: 'n', lines: narrow ? 8 : 3, ink: 'addr', value: addrValue },
            { id: 'cs', name: 'CS', side: 's', lines: 1, ink: 'ctrl', value: c.state.outputs.length > 0 || c.state.probe ? csValue : '' },
          ];
        },
        selected: (c: BindContext<PState>) => selectedRow(c) === r,
        changed: (c: BindContext<PState>) => selectedRow(c) === r && !!c.step && c.step.changes.some((change) => /^outputs\.\d+\.y$/.test(change.at) || change.at === 'probe.output'),
      };
    }
  });
  const bind = bindTable<PState>(table);

  // ---------- 移动 ----------
  const yMoves = (i: number, value?: string): Move[] => {
    const r = rowOfY.get(i);
    if (r === undefined) return [];
    const c = conns[r]!;
    const level = (from: string, to: string, via: string, phase: number): Move => ({ value: value ?? sub(`Y${i}`), from, to, via: [via], ink: 'ctrl', shape: 'level', phase });
    const chips = chipIds(r);
    if (c.kind === 'direct') return chips.map((id, j) => level('DEC', id, `cs-${r}-${j}`, 0));
    if (c.kind === 'and') return [level('DEC', `g${r}`, `in-${r}-${i}`, 0), ...chips.map((id, j) => level(`g${r}`, id, `cs-${r}-${j}`, 1))];
    if (c.kind === 'nand')
      return [
        level('DEC', `not${r}`, `in-${r}-${i}`, 0),
        level(`not${r}`, `g${r}`, `nn-${r}`, 1),
        { value: sub(c.lines.split('、')[0] ?? ''), from: `st${r}`, to: `g${r}`, via: [`st-${r}`], ink: 'addr', phase: 1 },
        ...chips.map((id, j) => level(`g${r}`, id, `cs-${r}-${j}`, 2)),
      ];
    return [];
  };
  const inLines = `A${d.k + count - 1}–A${d.k}`;
  const moves = (step: Step<PState>): Move[] => {
    const at = new Set(step.changes.map((change) => change.at));
    if (at.has('groupLines')) return [{ value: sub(lowGroup), from: 'addr', to: 'abus', via: ['a-bus'], ink: 'addr' }];
    if (at.has('decoder.type')) return [{ value: sub(inLines), from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr' }];
    const out = step.changes.find((change) => /^outputs\.\d+\.y$/.test(change.at));
    if (out) return yMoves(Number(out.at.split('.')[1]));
    const probe = step.state.probe;
    if (probe && step.state.stage === 'send') {
      return [
        { value: probe.bits.slice(n - d.k - count, n - d.k), from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr' },
        { value: hex(parseInt(probe.bits.slice(n - d.k), 2), d.k), from: 'addr', to: 'abus', via: ['a-bus'], ink: 'addr' },
      ];
    }
    if (probe && step.state.stage === 'select') {
      const y = yIndex(probe.output);
      return y === null ? [] : yMoves(y);
    }
    return [];
  };

  // ---------- 文字 ----------
  const names = (path: string): string => {
    const p = path.split('.');
    if (p[0] === 'regions') {
      const view = d.regions[Number(p[1])];
      const field: Record<string, string> = { kind: '种类', from: '首地址', to: '尾地址', size: '大小', chips: '芯片' };
      return `${view ? `${view.kind} 区` : '区域'}${field[p[2] ?? ''] ?? ''}`;
    }
    if (p[0] === 'groupWords') return '每组地址数';
    if (p[0] === 'groupLines') return '组内地址线';
    if (p[0] === 'decoder') return p[1] === 'type' ? '译码器' : p[1] === 'inputs' ? `输入 ${Number(p[2]) + 1}` : `使能端 ${Number(p[2]) + 1}`;
    if (p[0] === 'outputs') {
      const field: Record<string, string> = { y: '输出', from: '首地址', to: '尾地址', target: '接到', gate: '门电路' };
      return `${sub(`Y${p[1]}`)} ${field[p[2] ?? ''] ?? ''}`;
    }
    if (p[0] === 'control') return '控制线';
    if (p[0] === 'probe') {
      const field: Record<string, string> = { address: '要查的地址', bits: '地址的二进制', output: '有效的输出', chip: '选中的组', inner: '片内地址' };
      return field[p[1] ?? ''] ?? '查地址';
    }
    return path;
  };
  const values = (_path: string, value: string): string => sub(value);

  const tags = narrow ? groups.map((_, r) => `pk${r}`) : [];
  // 桌面上整张台面装得下，一直看全景；手机上镜头跟着这一步走，只框装得下的一小组部件。
  const frame = (step: Step<PState>): string[] | null => {
    if (!narrow) return null;
    const row = (r: number) => [`cap${r}`, ...chipIds(r)];
    // 出题前的那一小步、送地址那一步：看作答的名牌。
    if (step.id.endsWith('q')) return ['ql', ...tags, step.state.control.length > 0 ? 'nochip' : 'none'];
    if (step.state.probe && step.state.stage === 'send') return ['DEC'];
    const out = step.changes.find((change) => /^outputs\.\d+\.y$/.test(change.at));
    if (out) {
      const r = rowOfY.get(Number(out.at.split('.')[1]));
      return r === undefined ? ['map'] : row(r);
    }
    const probe = step.state.probe;
    if (probe) {
      const r = groupOf(probe.chip);
      return r < 0 ? ['map'] : row(r);
    }
    if (step.changes.some((change) => /^regions\.\d+\.from$/.test(change.at))) return ['map'];
    const region = step.changes.find((change) => /^regions\.\d+\.chips$/.test(change.at));
    if (region) {
      const vi = Number(region.at.split('.')[1]);
      // 镜头的字号不变，一屏装得下两排多：框这一区中间那一排，上下两排跟着露出来。
      const rows = groups.flatMap((g, r) => (viewIndex(g) === vi ? [r] : []));
      const mid = rows[Math.floor((rows.length - 1) / 2)];
      return mid === undefined ? null : row(mid);
    }
    if (step.changes.some((change) => change.at === 'groupLines')) return row(Math.max(0, groups.findIndex((g) => g.kind === 'RAM')));
    if (step.changes.some((change) => change.at.startsWith('decoder.'))) return ['DEC', ...Array.from({ length: enCount }, (_, t) => `en${t}`)];
    if (step.changes.some((change) => change.at.startsWith('control'))) return ['ctl0', 'ctl1'];
    return null;
  };
  // 出题时不另给镜头：手机上出题前那一步已经看着名牌（台面很深时播放器按题目找镜头会找偏，见 progress）。
  const askFrame = (): string[] => [];

  const wrong = (ask: Ask, value: string, state: PState, next: Step<PState> | null): Breakage | null => {
    const y = /^Y_?(\d+)/.exec(ask.prompt);
    if (y) {
      const i = Number(y[1]);
      const o = next?.state.outputs[i];
      if (!o) return null;
      if (value === '空') {
        return {
          label: '',
          patch: { map: { active: i } },
          moves: [{ value: sub(o.y), from: 'DEC', to: 'none', arc: true, ink: 'ctrl' }],
          message: `${sub(o.y)} 管 ${o.from}–${o.to}，这段地址里放着 ${o.target}。空着不接，CPU 访问这段地址时没有芯片应答。`,
        };
      }
      const r = groupOf(value);
      if (r < 0) return null;
      const patch: Breakage['patch'] = { map: { active: i } };
      for (const id of chipIds(r)) patch[id] = { selected: true };
      const g = groups[r]!;
      return {
        label: '',
        patch,
        moves: [{ value: sub(o.y), from: 'DEC', to: chipIds(r)[0]!, arc: true, ink: 'ctrl' }],
        message: `接到 ${value}，${o.from}–${o.to} 就落进 ${value}；可 ${value} 在地址空间里占的是 ${hex(g.start, n)}–${hex(g.start + g.words - 1, n)}。${o.target === '空' ? '这段地址本来不放芯片。' : `这段地址该归 ${o.target}。`}`,
      };
    }
    // 查地址：让学生说的那一组抬起来。
    const probe = state.probe ?? next?.state.probe;
    if (!probe) return null;
    const r = groupOf(value);
    if (r < 0) return { label: '', patch: {}, moves: [{ value: probe.address, from: 'addr', to: 'map', arc: true, ink: 'addr' }], message: `${probe.address} 的高位让某个 Y 有效，先在左边的表里找它落在哪一段。` };
    const patch: Breakage['patch'] = {};
    for (const id of chipIds(r)) patch[id] = { selected: true };
    const g = groups[r]!;
    return { label: '', patch, moves: [{ value: probe.address, from: 'addr', to: chipIds(r)[0]!, arc: true, ink: 'addr' }], message: `${value} 管 ${hex(g.start, n)}–${hex(g.start + g.words - 1, n)}，${probe.address} 不在里面。` };
  };

  const question = { text: `译码器的输入接哪几根地址线，每个输出接到哪一组`, at: narrow ? ['DEC'] : ['DEC', 'map'] };
  const conclusion = `一段 ${sub(`2^${d.k}`)} 个地址配一个 Y：低 ${d.k} 位接芯片，紧挨着的 ${count} 位 ${sub(inLines)} 进 ${d.decoder}。大块占几段就用与门，不足一段的再用组内高位分一次，没有芯片的段空着。`;

  return { scene: { parts, wires }, bind, moves, names, values, frame, askFrame, wrong, question, conclusion, design: d, yMoves, chipIds, groupOf };
}

/** 文字排成下标；查地址那一步拆成「送地址」「选中」两小步，新的一步只用引擎在那一步给的数。 */
export function polish(trace: Trace<Params, State>): Trace<Params, PState> {
  const d = design(trace.params);
  const count = d.decoder === '74138' ? 3 : 2;
  const steps: Step<PState>[] = [];
  // 「Y_i 接到哪里」只留有辨别力的几问：占几段的大块的第一段、第一个空段、不足一段的小芯片；不够两问时补第一个直接接的。其余照常演。
  const keep = new Set<number>();
  const firstOf = (test: (i: number) => boolean) => d.outputs.findIndex((_, i) => test(i));
  const add = (i: number) => i >= 0 && keep.add(i);
  add(firstOf((i) => d.outputs[i]!.gate.includes('与门')));
  add(firstOf((i) => d.outputs[i]!.target === '空'));
  add(firstOf((i) => d.outputs[i]!.gate.includes('与非门')));
  if (keep.size < 2) add(firstOf((i) => d.outputs[i]!.gate === '' && d.outputs[i]!.target !== '空'));
  for (const raw of trace.steps) {
    const y = raw.ask ? /^Y(\d+)/.exec(raw.ask.prompt) : null;
    const { ask, ...rest } = raw;
    const kept = ask && (!y || keep.has(Number(y[1]))) ? { ask: { ...ask, prompt: sub(ask.prompt), ...(ask.hint ? { hint: sub(ask.hint) } : {}) } } : {};
    const step = { ...rest, ...kept } as typeof raw;
    const base: Step<PState> = { ...step, title: sub(step.title), why: sub(step.why), state: { ...step.state } };
    if (y && step.ask) {
      // 出题前的一小步：只说轮到哪一段，画面不变。
      const o = d.outputs[Number(y[1])]!;
      const before = steps[steps.length - 1];
      if (before) {
        steps.push({
          id: `${step.id}q`,
          level: 'explain',
          title: `轮到 ${sub(o.y)}：${o.from}–${o.to}`,
          why: '这一段地址里放着哪一组芯片，这个输出就接到那一组的片选；这一段没有芯片就空着。',
          state: before.state,
          changes: [],
          focus: [],
        });
      }
    }
    const probe = step.state.probe;
    if (probe && step.changes.some((change) => change.at === 'probe')) {
      const bits = probe.bits;
      const into = bits.slice(d.n - d.k - count, d.n - d.k);
      steps.push({
        id: `${step.id}a`,
        level: 'explain',
        title: `地址 ${probe.address} 送上地址线`,
        why: `${probe.address} = ${bits}。${sub(`A${d.k + count - 1}–A${d.k}`)} 这 ${count} 位是 ${into}，送进译码器；低 ${d.k} 位送到各片的地址脚。`,
        ...(step.ref ? { ref: step.ref } : {}),
        state: { ...step.state, stage: 'send' },
        changes: step.changes.filter((change) => !['probe.output', 'probe.chip', 'probe.inner'].includes(change.at)),
        focus: ['probe'],
      });
      // 出题前的一小步：手机上镜头从译码器转到作答的名牌。
      steps.push({
        id: `${step.id}q`,
        level: 'explain',
        title: `${probe.address} 落在哪一段`,
        why: `看 ${sub(`A${d.k + count - 1}–A${d.k}`)} 让哪个输出有效，再看这个输出接到哪一组；不足一段的小芯片还要看组内高位。`,
        state: { ...step.state, stage: 'send' },
        changes: [],
        focus: [],
      });
      steps.push({ ...base, state: { ...step.state, stage: 'select' }, changes: step.changes.filter((change) => ['probe.output', 'probe.chip', 'probe.inner'].includes(change.at)) });
    } else steps.push(base);
  }
  return {
    ...trace,
    initial: { ...trace.initial },
    steps,
    conditions: trace.conditions.map((item) => ({ ...item, value: sub(item.value) })),
    table: { ...trace.table, rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(sub) })) },
  } as Trace<Params, PState>;
}

/** 常见错误，每条在场景里演一遍。 */
export function decodeMistakes(trace: Trace<Params, PState>, stage: DecodeStage): Mistake<PState>[] {
  const d = stage.design;
  const n = d.n;
  const out: Mistake<PState>[] = [];
  const stepOfY = (i: number) => trace.steps.findIndex((step) => step.changes.some((change) => change.at === `outputs.${i}.y`));
  // 小芯片直接接 Y：同一片在这一段里出现两次。
  const small = d.groups.findIndex((g) => g.words < d.groupWords);
  if (small >= 0) {
    const g = d.groups[small]!;
    const y = Number(/Y(\d+)/.exec(g.select)?.[1] ?? 0);
    const o = d.outputs[y]!;
    const at = stepOfY(y);
    const twin = parseInt(o.from, 16) === g.start ? g.start + g.words : g.start - g.words;
    out.push({
      text: `容易把 ${g.name} 直接接 ${sub(`Y${y}`)}，因为它也落在这一段`,
      at: at + 1,
      act: () => {
        const patch: Breakage['patch'] = { map: { active: y } };
        for (const id of stage.chipIds(small)) patch[id] = { selected: true };
        return {
          label: '',
          patch,
          moves: [{ value: sub(`Y${y}`), from: 'DEC', to: stage.chipIds(small)[0]!, arc: true, ink: 'ctrl' }],
          message: `${sub(`Y${y}`)} 管 ${o.from}–${o.to}，${g.name} 只有 ${g.chip.split('×')[0]}。直接接上，${hex(twin, n)} 起的那一半也选中它：同一片在这一段里出现两次，写 ${hex(twin, n)} 就改了 ${hex(g.start, n)}。所以还要用组内的高位再分一次。`,
        };
      },
    });
  }
  // 占两个 Y 的大块只接了一个。
  const wide = d.groups.findIndex((g) => g.words > d.groupWords);
  if (wide >= 0) {
    const g = d.groups[wide]!;
    const ys = [...g.select.matchAll(/Y(\d+)/g)].map((m) => Number(m[1]));
    const lost = ys[ys.length - 1]!;
    const o = d.outputs[lost]!;
    out.push({
      text: `容易只把 ${sub(`Y${ys[0]}`)} 接到 ${g.name}，因为它是一整块`,
      at: stepOfY(lost) + 1,
      act: () => ({
        label: '',
        patch: { map: { active: lost, rows: d.outputs.map((x, i) => [`${x.from}–${x.to}`, i === lost ? '没人接' : x.target]) } },
        moves: [{ value: sub(`Y${lost}`), from: 'DEC', to: 'map', arc: true, ink: 'ctrl' }],
        message: `${g.name} 有 ${g.chip.split('×')[0]}，占 ${ys.map((i) => sub(`Y${i}`)).join("、")} 共 ${ys.length} 段。只接 ${sub(`Y${ys[0]}`)}，访问 ${o.from}–${o.to} 时 ${sub(`Y${lost}`)} 有效，可它没接到 ${g.name}，这一段读不出来。这几个输出低电平有效，要经与门合成一个片选。`,
      }),
    });
  }
  // 漏接 MREQ。
  const ctl = trace.steps.findIndex((step) => step.changes.some((change) => change.at.startsWith('control')));
  const enId = d.decoder === '74138' ? 'en1' : 'en0';
  if (ctl >= 0) {
    out.push({
      text: '容易漏接 MREQ，因为只盯着地址线',
      at: ctl + 1,
      act: () => ({
        label: '',
        patch: { [enId]: { text: `${sub(d.decoder === '74138' ? 'G2A' : 'G')} ← 接地`, changed: true } },
        moves: [{ value: '接地', from: enId, to: 'DEC', arc: true, ink: 'ctrl' }],
        message: `使能端一直有效，CPU 不访存的时候（地址线上是别的东西），译码器照样译出一个 Y，某组芯片被选中，可能往数据线上送数，和正在用数据线的部件撞上。MREQ 接使能端，只在访存时才选芯片。`,
      }),
    });
  }
  return out.slice(0, 3);
}
