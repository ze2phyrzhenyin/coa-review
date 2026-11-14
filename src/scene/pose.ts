/**
 * Trace 的一步 → 目标画面（Pose）。纯函数，不引用 three.js：三维场景和平面模式用同一份。
 */
import { flatten } from '../engines/trace';
import type { Step, Trace } from '../engines/trace';
import type { BindContext, Binding, Move, Patch, Pose, SceneSpec } from './types';

type Source<S> = string | { at: string | string[]; as: (context: BindContext<S>) => unknown } | ((context: BindContext<S>) => unknown);

/** 属性取自多个路径或要换算时用：from(['bus.driver'], (c) => …)。写明路径，焦点和变化才能落到部件上。 */
export function from<S>(at: string | string[], as: (context: BindContext<S>) => unknown): Source<S> {
  return { at, as };
}

/**
 * 最常用的绑定：每个部件的每个属性写一个状态路径（取出来是字符串），或一个函数。
 * 例：bindTable({ R1: { value: 'reg.R1' }, G1: { open: 'ctl.R1o' } })
 */
export function bindTable<S>(table: Record<string, Record<string, Source<S>>>): Binding<S> {
  const owners = new Map<string, Set<string>>();
  const own = (path: string, part: string) => {
    if (!owners.has(path)) owners.set(path, new Set());
    owners.get(path)!.add(part);
  };
  for (const [part, props] of Object.entries(table)) {
    for (const source of Object.values(props)) {
      if (typeof source === 'string') own(source, part);
      else if (typeof source === 'object') for (const path of [source.at].flat()) own(path, part);
    }
  }
  return {
    props(context) {
      const out: Record<string, Patch> = {};
      for (const [part, props] of Object.entries(table)) {
        const patch: Patch = {};
        for (const [name, source] of Object.entries(props)) {
          if (typeof source === 'string') patch[name] = context.flat[source] ?? '';
          else if (typeof source === 'function') patch[name] = source(context);
          else patch[name] = source.as(context);
        }
        out[part] = patch;
      }
      return out;
    },
    partsFor(path) {
      if (path in table) return [path];
      const found = new Set<string>();
      for (const [owned, parts] of owners) {
        if (owned === path || path.startsWith(`${owned}.`) || owned.startsWith(`${path}.`)) for (const part of parts) found.add(part);
      }
      return [...found];
    },
  };
}

export interface PoseInput<P, S> {
  trace: Trace<P, S>;
  scene: SceneSpec;
  bind: Binding<S>;
  moves?: ((step: Step<S>) => Move[]) | undefined;
}

function stepAt<P, S>(trace: Trace<P, S>, index: number): Step<S> | null {
  return index > 0 ? (trace.steps[index - 1] ?? null) : null;
}

/** 第 index 步（0 是初始状态）的目标画面。 */
export function poseAt<P, S>(input: PoseInput<P, S>, index: number): Pose {
  const { trace, scene, bind } = input;
  const step = stepAt(trace, index);
  const state = step ? step.state : trace.initial;
  const changed = new Set(step ? step.changes.map((change) => change.at) : []);
  const patches = bind.props({ state, flat: flatten(state), index, step, changed });
  const known = new Set(scene.parts.map((part) => part.id));
  const focus = new Set<string>();
  const changedParts = new Set<string>();
  if (step) {
    for (const path of step.focus) for (const id of known.has(path) ? [path] : bind.partsFor(path)) focus.add(id);
    for (const path of changed) for (const id of bind.partsFor(path)) changedParts.add(id);
  }
  const parts: Record<string, Patch> = {};
  for (const part of scene.parts) {
    const props: Patch = { ...part.props, ...(patches[part.id] ?? {}) };
    if (part.kind === 'sheet' && !('shown' in (patches[part.id] ?? {}))) Object.assign(props, sheetProps(trace, index));
    if (focus.has(part.id)) props.focus = true;
    if (changedParts.has(part.id)) props.changed = true;
    parts[part.id] = props;
  }
  const wires: Record<string, boolean> = {};
  const active = new Set(step && input.moves ? input.moves(step).flatMap((move) => move.via ?? []) : []);
  for (const wire of scene.wires) wires[wire.id] = active.has(wire.id);
  return { parts, wires };
}

/** 解题表里到第 index 步为止该出现的行数，以及当前步对应的行。没有指回步骤的行跟着它前面的行出现。 */
export function revealedRows<P, S>(trace: Trace<P, S>, index: number): { shown: number; current: number } {
  const order = new Map(trace.steps.map((step, i) => [step.id, i + 1]));
  let shown = 0;
  let current = -1;
  for (const [i, row] of trace.table.rows.entries()) {
    const at = row.step ? (order.get(row.step) ?? 0) : null;
    if (at !== null && at > index) break;
    shown = i + 1;
    if (at !== null && at === index) current = i;
  }
  return { shown, current };
}

function sheetProps<P, S>(trace: Trace<P, S>, index: number): Patch {
  return { columns: trace.table.columns, rows: trace.table.rows.map((row) => row.cells), ...revealedRows(trace, index) };
}

/** 这一步镜头该看住的部件：焦点、移动的两端。没有时返回空，表示看全景。 */
export function frameAt<P, S>(input: PoseInput<P, S>, index: number): string[] {
  const step = stepAt(input.trace, index);
  if (!step) return [];
  const known = new Set(input.scene.parts.map((part) => part.id));
  const ids = new Set<string>();
  for (const path of step.focus) for (const id of known.has(path) ? [path] : input.bind.partsFor(path)) ids.add(id);
  // 移动的两头也要看住；分了先后的，只看最后一批（值最后落在哪）。
  const moves = input.moves?.(step) ?? [];
  const last = Math.max(0, ...moves.map((move) => move.phase ?? 0));
  for (const move of moves) {
    if ((move.phase ?? 0) !== last) continue;
    ids.add(move.from);
    ids.add(move.to);
  }
  return [...ids].filter((id) => known.has(id));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

/** 目标画面的摘要（FNV-1a）。写在 [data-stage] 的 data-scene-hash 上。 */
export function hashPose(pose: Pose): string {
  const text = stable(pose);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
