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
      // 流水线的一步是一个时钟周期，不是含 T1–T4 的 CPU 周期。播放器的粒度标签里最接近的是「一个节拍」（教材里节拍就是时钟周期）。
      level: step.level === 'cycle' ? ('beat' as const) : step.level,
      title: typeset(step.title),
      why: typeset(step.why).replace('按序流水线里读总在前一条写之前、写也按顺序，WAR 和 WAW 不会出错', '按序流水线里每条都在 ID 段读、在 WB 段写：前一条的读（ID）总比后一条的写（WB）早，两条的写回也按先后进行，所以 WAR 和 WAW 不会出错'),
      ...(step.ask ? { ask: { ...step.ask, prompt: typeset(step.ask.prompt), ...(step.ask.hint ? { hint: typeset(step.ask.hint) } : {}) } } : {}),
    })),
    result: Object.fromEntries(Object.entries(trace.result).map(([key, value]) => [typeset(key.replace(/^加速比Ck$/, '加速比 Ck').replace(/^吞吐率Tp$/, '吞吐率 Tp')), typeset(value)])),
    table: { columns: trace.table.columns.map(typeset), rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(typeset) })) },
  };
}
