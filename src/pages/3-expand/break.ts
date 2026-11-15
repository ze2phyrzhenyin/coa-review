/**
 * 「弄坏它」：停在讲解例题选中一组之后，故意做两件错事，把后果演出来。
 * 1. 让另一组也选中：两组同时往数据线上送数，撞在一起。
 * 2. 断一根进译码器的地址线（接成 0）：两个地址选中同一个单元，有一半芯片永远选不中。
 * 这里的数是「真实硬件会怎样」的演示，不是题目的答案；地址、组号都从引擎的状态里取。
 */
import type { Trace } from '../../engines/trace';
import { hex } from '../../engines/expand/model';
import type { Params } from '../../engines/expand/model';
import type { Breakage } from '../../player/Player';
import type { ExpandStage, PState } from './scene';
import { groupBits, sub } from './scene';

export type BreakKind = 'fight' | 'cut';

/** 只留查地址的两小步：初始画面是地址送出之前，接线都已经接好。 */
export function breakTrace(trace: Trace<Params, PState>): Trace<Params, PState> {
  const at = trace.steps.findIndex((step) => step.state.stage === 'send');
  if (at < 0) return trace;
  const before = at > 0 ? trace.steps[at - 1]!.state : trace.initial;
  return { ...trace, initial: before, steps: trace.steps.slice(at), table: { columns: trace.table.columns, rows: [] } };
}

export function breakage(kind: BreakKind, state: PState, stage: ExpandStage, other?: number): Breakage | null {
  const p = stage.plan;
  const probe = state.probe;
  if (!probe || state.stage !== 'select' || probe.group === null || p.groups < 2) return null;
  const h = p.n - p.k;
  const g = probe.group;
  const P = p.perGroup;
  const chips = (k: number) => Array.from({ length: P }, (_, j) => stage.chipId(k * P + j));
  const high = /D(\d+)/.exec(state.chips[P - 1]?.data ?? '')?.[1] ?? '0';
  const width = `D${high}–D0`;
  if (kind === 'fight') {
    const k = other !== undefined && other !== g ? other : g === 0 ? 1 : 0;
    const patch: Breakage['patch'] = { dbus: { value: '冲突', drivers: [`第 ${g} 组`, `第 ${k} 组`], tileAt: -3 } };
    for (const id of chips(k)) patch[id] = { selected: true };
    return {
      label: `让第 ${k} 组也选中`,
      patch,
      moves: [
        ...stage.selectMoves(k).map((move) => ({ ...move, phase: 0 })),
        { value: `第 ${g} 组的数`, from: stage.chipId(g * P), to: 'dbus', arc: true, ink: 'data', phase: 1 },
        { value: `第 ${k} 组的数`, from: stage.chipId(k * P), to: 'dbus', arc: true, ink: 'data', phase: 1 },
      ],
      message: `第 ${g} 组和第 ${k} 组同时选中，两组都往 ${sub(width)} 上送数。一边送 1、一边送 0 的那几根线上，电流从一片直接灌进另一片：读出来的数说不准，芯片还会发热损坏。译码器同一时刻只让一个输出有效，就是为了不让两组同时上线。`,
    };
  }
  // 断线：最高的那根进译码器的地址线接成 0。
  const top = p.n - 1;
  const seen = probe.bits.slice(0, h);
  const cut = `0${seen.slice(1)}`;
  const k = parseInt(cut, 2);
  const address = parseInt(probe.bits, 2);
  const twin = probe.bits[0] === '1' ? hex(address - 2 ** top, p.n) : hex(address + 2 ** top, p.n);
  const patch: Breakage['patch'] = { DEC: { input: cut, active: k } };
  for (let j = 0; j < P; j++) {
    patch[stage.chipId(g * P + j)] = { selected: k === g };
    patch[stage.chipId(k * P + j)] = { selected: true };
  }
  const lost = Array.from({ length: p.groups }, (_, i) => i)
    .filter((i) => groupBits(i, h)[0] === '1')
    .map((i) => `第 ${i} 组`)
    .join('、');
  return {
    label: `剪断 A${top}`,
    patch,
    moves: [{ value: cut, from: 'addr', to: 'DEC', via: ['a-in0'], ink: 'addr', phase: 0 }, ...stage.selectMoves(k).map((move) => ({ ...move, phase: 1 }))],
    message:
      `${sub(`A${top}`)} 断了，译码器那一脚一直是 0。` +
      (seen[0] === '1' ? `${probe.address} 的高位 ${seen} 被当成 ${cut}，选中的是第 ${k} 组；` : `${probe.address} 本来就是 ${seen}，照样选中第 ${k} 组；`) +
      `${twin} 也选中第 ${k} 组的同一个单元：两个地址落到同一处，写一个就改了另一个。${lost} 再也选不中，容量只剩一半。`,
  };
}
