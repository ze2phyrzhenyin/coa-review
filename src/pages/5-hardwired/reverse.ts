/**
 * 试一试的「检查一个式子」：把学生写的式子一项一项摆到格子表上，亮出它为 1 的节拍，
 * 最后和流程图对照，标出漏掉和多出的节拍。数据都来自引擎 runReverse 的 Trace。
 */
import type { Op } from '../../engines/cpu/model';
import type { ReverseParams, ReverseState } from '../../engines/hardwired/model';
import type { Step, Trace } from '../../engines/trace';
import { bindTable } from '../../scene';
import type { BindContext, Move, PartSpec, SceneSpec } from '../../scene';
import { cellOf, cellRef, flowCells, gridDepth, gridParts, gridPatch, gridView } from './scene';

type Ctx = BindContext<ReverseState>;
const opsOf = (p: ReverseParams): Op[] => p.instructions ?? ['MOV', 'LAD', 'ADD', 'STO', 'JMP'];

export function revScene(trace: Trace<ReverseParams, ReverseState>, narrow: boolean): SceneSpec {
  const p = trace.params;
  const ops = opsOf(p);
  const cells = flowCells(ops, p.names ?? 'book');
  const terms = trace.initial.terms;
  const view = gridView(ops, narrow);
  const z = gridDepth(view) - 2.6;
  // 手机上项牌摆在格子表上方，一项一行，镜头先看它，再跟着落点走。
  const parts: PartSpec[] = [
    ...gridParts(view, cells, narrow ? [0, 0] : [-4.4, 0]),
    ...terms.map((term, i): PartSpec => ({ id: `TERM_${i}`, kind: 'register', position: narrow ? [0, -12.4 - (terms.length - 1 - i) * 1.6] : [7.3, -4.4 + i * 1.65], props: { name: `第 ${i + 1} 项`, value: term, width: narrow ? 6.6 : 4.2, ink: 'ctrl' } })),
    ...(p.signal ? [{ id: 'VERDICT', kind: 'register' as const, position: (narrow ? [0, z] : [7.3, -3.6 + terms.length * 1.65]) as [number, number], props: { name: `对照 ${p.signal}`, value: '', width: narrow ? 6.6 : 4.8 } }] : []),
  ];
  return { parts, wires: [] };
}

function litCells(state: ReverseState, ops: readonly Op[], base: string[][]): { cells: string[][]; on: string[] } {
  const cells = base.map((row) => [...row]);
  const on = [...new Set(state.matches.flat())].map((x) => cellOf(x, ops));
  for (const key of on) {
    const [r, c] = key.split('.').map(Number);
    if (cells[r!]![c!] === '') cells[r!]![c!] = '保持';
  }
  for (const x of state.extra ?? []) {
    const [r, c] = cellOf(x, ops).split('.').map(Number);
    if (cells[r!]![c!] === '保持') cells[r!]![c!] = '多发';
  }
  for (const x of state.missing ?? []) {
    const [r, c] = cellOf(x, ops).split('.').map(Number);
    cells[r!]![c!] = `漏：${cells[r!]![c!] || '保持'}`;
  }
  return { cells, on };
}

export function revBind(trace: Trace<ReverseParams, ReverseState>, narrow: boolean) {
  const p = trace.params;
  const ops = opsOf(p);
  const view = gridView(ops, narrow);
  const base = flowCells(ops, p.names ?? 'book');
  const changedOf = (c: Ctx): string[] => {
    if ([...c.changed].some((x) => /^(missing|extra)(\.|$)/.test(x))) {
      return [...(c.state.missing ?? []), ...(c.state.extra ?? [])].map((x) => cellOf(x, ops));
    }
    const i = c.state.matches.findIndex((_, k) => [...c.changed].some((x) => x.startsWith(`matches.${k}.`)));
    return i >= 0 ? c.state.matches[i]!.map((x) => cellOf(x, ops)) : [];
  };
  const grid = (c: Ctx) => {
    const { cells, on } = litCells(c.state, ops, base);
    return gridPatch(view, cells, on, changedOf(c), -1);
  };
  const table: Record<string, Record<string, unknown>> = {};
  for (const id of view.ids) {
    table[id] = {
      cells: { at: 'matches', as: (c: Ctx) => grid(c)[id]!.cells },
      tones: (c: Ctx) => grid(c)[id]!.tones,
      changedCells: (c: Ctx) => grid(c)[id]!.changedCells,
    };
  }
  Object.assign(table, {
    VERDICT: {
      value: {
        at: ['missing', 'extra'],
        as: (c: Ctx) => (c.state.missing === null ? '' : c.state.missing.length || c.state.extra!.length ? `漏 ${c.state.missing.length} 拍，多 ${c.state.extra!.length} 拍` : '一致'),
      },
    },
  });
  trace.initial.terms.forEach((_, i) => {
    table[`TERM_${i}`] = { focus: (c: Ctx) => [...c.changed].some((x) => x.startsWith(`matches.${i}.`)) };
  });
  return bindTable<ReverseState>(table as never);
}

export function revMoves(trace: Trace<ReverseParams, ReverseState>, narrow: boolean) {
  const ops = opsOf(trace.params);
  const view = gridView(ops, narrow);
  return (step: Step<ReverseState>): Move[] => {
    const i = step.state.matches.findIndex((_, k) => step.changes.some((x) => x.at.startsWith(`matches.${k}.`)));
    if (i < 0) return [];
    const first = step.state.matches[i]![0];
    return first ? [{ value: step.state.terms[i]!, from: `TERM_${i}`, to: cellRef(view, cellOf(first, ops)), arc: true, ink: 'ctrl' }] : [];
  };
}

export function revNames(path: string): string {
  const m = /^matches\.(\d+)\.(\d+)$/.exec(path);
  if (m) return `第 ${Number(m[1]) + 1} 项为 1 的节拍`;
  if (/^missing/.test(path)) return '漏掉的节拍';
  if (/^extra/.test(path)) return '多出的节拍';
  return path;
}
