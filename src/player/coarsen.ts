/**
 * 换步的粒度：把 Trace 里相邻的小步并成一步（一个节拍、一个 CPU 周期、一条指令）。
 * 只是换一种分组，不重新计算：每一组的状态取组里最后一步，变化是前后两组状态之差。
 */
import { diffStates } from '../engines/trace';
import type { Step, StepLevel, Trace } from '../engines/trace';
import type { Move } from '../scene';

export type Grain = 'explain' | 'beat' | 'cycle' | 'instruction';

export const grainNames: Record<Grain, string> = {
  explain: '小步',
  beat: '节拍',
  cycle: 'CPU 周期',
  instruction: '指令',
};

const rank: Record<StepLevel, number> = { explain: 0, beat: 1, access: 1, cycle: 2, instruction: 3 };

export interface Coarse<P, S> {
  trace: Trace<P, S>;
  /** 每一组包含的原始步。 */
  members: Map<string, Step<S>[]>;
  /** 原始的第 i 步（0 是初始状态）在这一粒度下是第几步。 */
  toCoarse(fine: number): number;
  /** 这一粒度下的第 i 步，对应原始的第几步（组里最后一步）。 */
  toFine(coarse: number): number;
}

export function coarsen<P, S>(trace: Trace<P, S>, grain: Grain): Coarse<P, S> {
  const groups: Step<S>[][] = [];
  for (const step of trace.steps) {
    const opens = grain === 'explain' || rank[step.level] >= rank[grain] || groups.length === 0;
    if (opens) groups.push([step]);
    else groups[groups.length - 1]!.push(step);
  }
  const members = new Map<string, Step<S>[]>();
  const groupOf = new Map<string, string>();
  const ends: number[] = [0];
  let previous: S = trace.initial;
  let fine = 0;
  const steps = groups.map((group, g) => {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const id = grain === 'explain' ? first.id : `g${g + 1}`;
    fine += group.length;
    ends.push(fine);
    members.set(id, group);
    for (const member of group) groupOf.set(member.id, id);
    const rest = group.slice(1).map((member) => member.title);
    const step: Step<S> = {
      id,
      level: grain === 'explain' ? first.level : rank[first.level] >= rank[grain] ? first.level : grain,
      title: first.title,
      why: rest.length ? `${first.why} 接着：${rest.join('；')}。` : first.why,
      state: last.state,
      changes: grain === 'explain' ? first.changes : diffStates(previous, last.state),
      // 并起来的一步停在组里最后一个小步上：焦点取它的，镜头看住这一段的落点。
      focus: last.focus,
    };
    const ref = first.ref;
    if (ref) step.ref = ref;
    const ask = group.find((member) => member.ask)?.ask;
    if (ask) step.ask = ask;
    previous = last.state;
    return step;
  });
  const coarse: Trace<P, S> = {
    ...trace,
    steps,
    table: {
      columns: trace.table.columns,
      rows: trace.table.rows.map((row) => {
        const mapped = row.step ? groupOf.get(row.step) : undefined;
        return mapped ? { cells: row.cells, step: mapped } : { cells: row.cells };
      }),
    },
  };
  return {
    trace: coarse,
    members,
    toCoarse(index) {
      for (let i = 0; i < ends.length; i++) if (ends[i]! >= index) return i;
      return ends.length - 1;
    },
    toFine(index) {
      return ends[Math.max(0, Math.min(ends.length - 1, index))]!;
    },
  };
}

/** 并起来的一步里，各小步的移动依次走：后一小步的移动排在前一小步之后。 */
export function coarseMoves<S>(members: Map<string, Step<S>[]>, moves: (step: Step<S>) => Move[]): (step: Step<S>) => Move[] {
  return (step) => {
    const group = members.get(step.id) ?? [step];
    const out: Move[] = [];
    let offset = 0;
    for (const member of group) {
      const own = moves(member);
      if (own.length === 0) continue;
      const top = Math.max(...own.map((move) => move.phase ?? 0));
      for (const move of own) out.push({ ...move, phase: offset + (move.phase ?? 0) });
      offset += top + 1;
    }
    return out;
  };
}
