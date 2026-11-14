/**
 * 文字里的下标和上标：S_f1、C_0、2^6、2^-1、2^(n+2)、x_{i+1}。画布和页面都用这一份解析，
 * 学生看到的是降低、升高的小字，不是下划线和尖号。
 */
export type Run = { text: string; kind: 'base' | 'sub' | 'sup' };

const MARK = /([A-Za-z0-9)\]])([_^])(\{[^}]*\}|\([^)]*\)|[-−]?[A-Za-z0-9]+)/g;

export function parseRich(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    const at = match.index + match[1]!.length;
    if (at > last) runs.push({ text: text.slice(last, at), kind: 'base' });
    let body = match[3]!;
    if (body.startsWith('{') || body.startsWith('(')) body = body.slice(1, -1);
    runs.push({ text: body.replace(/^-/, '−'), kind: match[2] === '_' ? 'sub' : 'sup' });
    last = at + 1 + match[3]!.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), kind: 'base' });
  return runs.length ? runs : [{ text, kind: 'base' }];
}

/** 有没有要排成上下标的记号。 */
export const hasMarks = (text: string): boolean => new RegExp(MARK.source).test(text);

/** 读屏和平面文字：S_f1 读作「S f1」，2^6 读作「2 的 6 次方」。 */
export function plainRich(text: string): string {
  return parseRich(text)
    .map((run) => (run.kind === 'sup' ? ` 的 ${run.text} 次方` : run.kind === 'sub' ? run.text : run.text))
    .join('');
}
