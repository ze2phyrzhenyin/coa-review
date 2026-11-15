/**
 * 「弄坏它」：用讲解的变式（多一片 4K 的 RAM），查一个落在 RAM 区的地址，选中一组之后故意接错一处：
 * 1. 把另一组 RAM 也接到同一个 Y：两组一起选中，往数据线上送数撞在一起。
 * 2. 小芯片去掉局部译码，直接接 Y：一段 8K 里同一片出现两次，两个地址落到同一个单元。
 * 这些是「真实硬件会怎样」的演示，不是题目的答案；组名、地址都取自引擎的 design()。
 */
import { hex } from '../../engines/decode/model';
import type { Trace } from '../../engines/trace';
import type { Params } from '../../engines/decode/model';
import type { Breakage } from '../../player/Player';
import { sub } from '../3-expand/scene';
import type { DecodeStage, PState } from './scene';

export type BreakKind = 'fight' | 'alias';

/** 只留查地址的两小步：初始画面是地址送出之前，接线都已经接好。 */
export function breakTrace(trace: Trace<Params, PState>): Trace<Params, PState> {
  const at = trace.steps.findIndex((step) => step.state.stage === 'send');
  if (at < 0) return trace;
  const before = at > 0 ? trace.steps[at - 1]!.state : trace.initial;
  return { ...trace, initial: before, steps: trace.steps.slice(at), table: { columns: trace.table.columns, rows: [] } };
}

export function breakage(kind: BreakKind, state: PState, stage: DecodeStage, other?: number): Breakage | null {
  const d = stage.design;
  const n = d.n;
  const probe = state.probe;
  if (!probe || state.stage !== 'select') return null;
  const r = stage.groupOf(probe.chip);
  if (kind === 'fight') {
    if (r < 0) return null;
    const k = other !== undefined && other !== r && d.groups[other] ? other : d.groups.findIndex((g, i) => i !== r && g.kind === 'RAM');
    if (k < 0) return null;
    const a = d.groups[r]!;
    const b = d.groups[k]!;
    const high = /D(\d+)/.exec(a.data[a.data.length - 1] ?? '')?.[1] ?? '0';
    const patch: Breakage['patch'] = { dbus: { value: '冲突', drivers: `${a.name}、${b.name}`, tileAt: -3 } };
    for (const id of stage.chipIds(k)) patch[id] = { selected: true };
    return {
      label: `把 ${b.name} 也接到 ${probe.output}`,
      patch,
      moves: [
        { value: `${a.name} 的数`, from: stage.chipIds(r)[0]!, to: 'dbus', arc: true, ink: 'data', phase: 0 },
        { value: `${b.name} 的数`, from: stage.chipIds(k)[0]!, to: 'dbus', arc: true, ink: 'data', phase: 0 },
      ],
      message: `${sub(probe.output)} 同时接了 ${a.name} 和 ${b.name}，访问 ${probe.address} 时两组一起选中，都往 ${sub(`D${high}–D0`)} 上送数。一边送 1、一边送 0 的线上电流从一片灌进另一片，读出的数说不准，芯片还会发热。一个 Y 只能接一组。`,
    };
  }
  // 小芯片去掉局部译码。
  const s = d.groups.findIndex((g) => g.words < d.groupWords);
  if (s < 0) return null;
  const g = d.groups[s]!;
  const y = Number(/Y(\d+)/.exec(g.select)?.[1] ?? 0);
  const o = d.outputs[y]!;
  const first = parseInt(o.from, 16);
  const other2 = g.start === first ? g.start + g.words : first;
  const patch: Breakage['patch'] = { map: { active: y } };
  for (const id of stage.chipIds(s)) patch[id] = { selected: true };
  for (const id of [`not${s}`, `st${s}`]) patch[id] = { hidden: true };
  patch[`g${s}`] = { text: '直接接', changed: true };
  return {
    label: `去掉 ${g.name} 的非门和与非门`,
    patch,
    moves: [
      { value: hex(g.start, n), from: 'addr', to: stage.chipIds(s)[0]!, arc: true, ink: 'addr', phase: 0 },
      { value: hex(other2, n), from: 'addr', to: stage.chipIds(s)[0]!, arc: true, ink: 'addr', phase: 1 },
    ],
    message: `${g.name} 只有 ${g.chip.split('×')[0]}，${sub(o.y)} 管 ${o.from}–${o.to} 一整段。直接接上，${hex(g.start, n)} 和 ${hex(other2, n)} 都落进 ${g.name} 的第 0 个单元：写一个就改了另一个，这一段里同一片出现两次。局部译码用组内的高位把另一半挡在外面。`,
  };
}
