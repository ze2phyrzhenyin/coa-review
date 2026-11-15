/**
 * 码名排成下标：[x]补、[|y|]原 写成 [x]_{补}，Rich 和场景里的字都把它排成小一号的下标。
 * 引擎的文字、页面自己的文字、场景里的牌都过这一道；位串和答案不动。重复调用结果不变。
 */
import type { Trace } from '../../engines/trace';
import type { Binding, Patch, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export const sub = (text: string): string => text.replace(/\](变补|补|原)/g, ']_{$1}');

export function subTrace<P, S>(trace: Trace<P, S>): Trace<P, S> {
  return {
    ...trace,
    conditions: trace.conditions.map((c) => ({ label: sub(c.label), value: sub(c.value) })),
    table: { columns: trace.table.columns.map(sub), rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(sub) })) },
    steps: trace.steps.map((step) => ({
      ...step,
      title: sub(step.title),
      why: sub(step.why),
      ...(step.ask ? { ask: { ...step.ask, prompt: sub(step.ask.prompt), ...(step.ask.hint ? { hint: sub(step.ask.hint) } : {}) } } : {}),
    })),
  };
}

const TEXT_KEYS = ['text', 'name', 'leftName', 'rightName'];
const subPatch = (patch: Patch): Patch => {
  const out: Patch = { ...patch };
  for (const key of TEXT_KEYS) if (typeof out[key] === 'string') out[key] = sub(out[key] as string);
  return out;
};
const subBreak = (b: Breakage | null): Breakage | null =>
  b ? { ...b, message: sub(b.message), patch: Object.fromEntries(Object.entries(b.patch).map(([id, patch]) => [id, subPatch(patch)])) } : null;

interface Made<S> {
  scene: SceneSpec;
  bind: Binding<S>;
  names: (path: string) => string;
  wrong?: (...args: never[]) => Breakage | null;
  mistakes?: Mistake<S>[];
  convention?: (...args: never[]) => string | null;
}

/** 场景里所有给学生看的字都过一遍 sub。 */
export function subScene<S, M extends Made<S>>(made: M): M {
  const out: Made<S> = { ...made };
  out.scene = { ...made.scene, parts: made.scene.parts.map((part) => ({ ...part, props: subPatch(part.props as Patch), ...(part.title ? { title: sub(part.title) } : {}) })) as SceneSpec['parts'] };
  out.bind = {
    props: (context) => Object.fromEntries(Object.entries(made.bind.props(context)).map(([id, patch]) => [id, subPatch(patch)])),
    partsFor: made.bind.partsFor,
  };
  out.names = (path) => sub(made.names(path));
  if (made.wrong) {
    const wrong = made.wrong as (...args: unknown[]) => Breakage | null;
    out.wrong = ((...args: unknown[]) => subBreak(wrong(...args))) as never;
  }
  if (made.mistakes) out.mistakes = made.mistakes.map((m) => ({ ...m, text: sub(m.text), act: (state: S) => subBreak(m.act(state)) }));
  if (made.convention) {
    const convention = made.convention as (...args: unknown[]) => string | null;
    out.convention = ((...args: unknown[]) => {
      const text = convention(...args);
      return text ? sub(text) : text;
    }) as never;
  }
  return out as M;
}
