/**
 * 引擎的文字里把 Tk、Ck、Tp、τl 写成了平文。给学生看之前换成带下标的写法（T_k → T 下标 k），由 Rich 排版。
 * 只换写法，不改数。
 */
import type { Trace } from '../../engines/trace';

export function typeset(text: string): string {
  return text
    .replace(/\bTk\b/g, 'T_k')
    .replace(/\bCk\b/g, 'C_k')
    .replace(/\bTp\b/g, 'T_p')
    .replace(/τl\b/g, 'τₗ')
    .replace(/τi\b/g, 'τᵢ');
}

export function polishTrace<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return {
    ...trace,
    conditions: trace.conditions.map((c) => ({ label: typeset(c.label), value: typeset(c.value) })),
    steps: trace.steps.map((step) => ({
      ...step,
      // 两头都是「空」的变化（例如集合从 null 变成数组）不列出来。
      changes: step.changes.filter((change) => !(['', 'null'].includes(change.from) && ['', 'null'].includes(change.to))),
      title: typeset(step.title),
      why: typeset(step.why),
      ...(step.ask ? { ask: { ...step.ask, prompt: typeset(step.ask.prompt), ...(step.ask.hint ? { hint: typeset(step.ask.hint) } : {}) } } : {}),
    })),
    result: Object.fromEntries(Object.entries(trace.result).map(([key, value]) => [typeset(key.replace(/^加速比Ck$/, '加速比 Ck').replace(/^吞吐率Tp$/, '吞吐率 Tp')), typeset(value)])),
    table: { columns: trace.table.columns.map(typeset), rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(typeset) })) },
  };
}
