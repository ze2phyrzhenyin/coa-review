/**
 * 把引擎文字里的记号换成排版用的写法：[x]补 的码名排成下标（[x]_{补}），Ex、My 排成 E_x、M_y。
 * 只改写法，不改内容；标题、为什么、题面、条件、解题表都过一遍。
 */
import type { Trace } from '../../engines/trace';

export function sub(text: string): string {
  return text.replace(/\[([^\]\[]{1,12})\](变补|原|反|补|移|浮)/g, '[$1]_{$2}').replace(/(?<![A-Za-z])([EM])([xy])(?![A-Za-z])/g, '$1_$2');
}

export function subTrace<P, S>(trace: Trace<P, S>, more: (text: string) => string = (t) => t): Trace<P, S> {
  const f = (text: string) => more(sub(text));
  return {
    ...trace,
    conditions: trace.conditions.map((c) => ({ label: f(c.label), value: f(c.value) })),
    steps: trace.steps.map((step) => ({
      ...step,
      title: f(step.title),
      why: f(step.why),
      ...(step.ask ? { ask: { ...step.ask, prompt: f(step.ask.prompt), ...(step.ask.hint ? { hint: f(step.ask.hint) } : {}) } } : {}),
    })),
    table: { columns: trace.table.columns.map(f), rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(f) })) },
  };
}
