/** 页面上的文字：把 S_f1、2^6 这类记号排成 <sub>、<sup>。 */
import { parseRich } from '../scene/rich';

export function Rich({ text }: { text: string }) {
  const runs = parseRich(text);
  if (runs.length === 1 && runs[0]!.kind === 'base') return <>{text}</>;
  return (
    <>
      {runs.map((run, i) => (run.kind === 'sub' ? <sub key={i}>{run.text}</sub> : run.kind === 'sup' ? <sup key={i}>{run.text}</sup> : run.text))}
    </>
  );
}
