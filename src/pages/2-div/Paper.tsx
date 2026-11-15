/** 练习：台面上一张答题纸，按例 2.25 的版式一轮一行地写加减交替。点台面上的格子、牌，或在填写栏里填，两边等价。 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { Rich } from '../../player/Rich';
import type { Patch, PartSpec, Pose, SceneSpec } from '../../scene';
import { SheetStage } from '../2-mul/SheetStage';
import { sub } from '../2-mul/code';
import { textWidth } from './scene';
import { blankEntry, grade, makeProblem } from './practice';
import type { Entry, Problem } from './practice';

export function Paper() {
  const [seedText, setSeed] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(99999, Math.trunc(Number(raw)) || 1))));
  const seed = Math.max(1, Math.trunc(Number(seedText)) || 1);
  return <Sheet key={seed} problem={makeProblem(seed)} onNext={() => setSeed(String(seed + 1))} />;
}

const ROW = 0.95;
const OPS = ['减 y', '加 y'] as const;

function charAt(raw: string, width: number, k: number): string {
  const text = raw.replace(/[_.]/g, '');
  const shift = width - text.length;
  const c = text.charAt(k - shift);
  return c === '0' || c === '1' ? c : ' ';
}

function sheetScene(problem: Problem, wide: boolean): { scene: SceneSpec; frame: string[] } {
  const n = problem.params.n;
  const W = n + 1;
  const P = wide ? 0.74 : 0.7;
  const DOT = 0.24;
  const span = (W - 1) * P + DOT;
  const cx = (c: number) => c * P + (c >= 1 ? DOT : 0) - span / 2;
  const opX = cx(0) - P / 2 - 0.75;
  const labelRight = opX - 0.75;
  const qX = cx(n) + P / 2 + 0.75;
  const parts: PartSpec[] = [];
  const cell = (id: string, x: number, z: number, title: string, pick = false) =>
    parts.push({ id, kind: '2-mul:cell', position: [x, z], props: { bits: ' ', variant: 'bit' }, title, pick, describe: (p: Patch) => `${title}：${String(p.bits ?? '').trim() || '空'}` } as PartSpec);
  const label = (id: string, text: string, z: number, pick = false) =>
    parts.push({ id, kind: 'label', position: [labelRight - textWidth(text, 0.34) / 2, z], props: { text: sub(text), size: 0.34, weight: 600 }, pick, title: text });
  parts.push({ id: 'h-s', kind: 'label', position: [cx(0), -0.85], props: { text: '符号', size: 0.31, tone: 'muted' } });
  for (let c = 1; c <= n; c++) parts.push({ id: `h-${c}`, kind: 'label', position: [cx(c), -0.85], props: { text: `2^-${c}`, size: 0.31, tone: 'muted' } });
  parts.push({ id: 'h-q', kind: 'label', position: [qX, -0.85], props: { text: '上商', size: 0.31, tone: 'muted' } });
  parts.push({ id: 'h-op', kind: 'label', position: [opX, -0.85], props: { text: '做', size: 0.31, tone: 'muted' } });
  let z = 0;
  const row = (prefix: string, title: string, pick: boolean) => {
    for (let c = 0; c < W; c++) cell(`${prefix}-${c}`, cx(c), z, `${title}的${c === 0 ? '符号位' : `2^-${c} 位`}`, pick);
    parts.push({ id: `${prefix}-dot`, kind: 'label', position: [(cx(0) + cx(1)) / 2, z + 0.16], props: { text: '.', size: 0.5, weight: 700 } });
  };
  label('gl-x', '被除数 |x|', z);
  row('gx', '|x|', false);
  z += ROW;
  label('gl-y', '[|y|]原', z);
  row('gy', '[|y|]原', false);
  z += ROW + 0.25;
  problem.lines.forEach((line, i) => {
    label(`ll-${i}`, line.label, z, true);
    if (line.kind === 'corr') {
      parts.push({ id: `corr-${i}`, kind: 'label', position: [cx(0) + 0.6, z], props: { text: '？', plate: true, size: 0.34 }, pick: true, title: '要不要纠余' });
    } else {
      row(`c${i}`, line.label, true);
    }
    if (line.kind === 'sum') {
      parts.push({ id: `op-${i}`, kind: 'label', position: [opX, z], props: { text: '？', plate: true, size: 0.34 }, pick: true, title: `${line.label} 做什么` });
      cell(`q-${i}`, qX, z, `${line.label} 上商`, true);
    }
    if (line.kind === 'quot') z += 0.15;
    z += ROW;
  });
  if (wide) parts.push({ id: 'desk', kind: 'memory', position: [qX + 4.2, z / 2 - 0.6], props: { name: '', columns: [{ title: '', width: 6.0 }], rows: [[''], [''], [''], ['']], hidden: true } });
  const frame = parts.filter((part) => part.id !== 'desk').map((part) => part.id);
  return { scene: { parts, wires: [], kinds: () => import('../2-mul/parts') }, frame };
}

function Sheet({ problem, onNext }: { problem: Problem; onNext: () => void }) {
  const { params, lines, state, result } = problem;
  const n = params.n;
  const W = n + 1;
  const [wide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 600px)').matches);
  const made = useMemo(() => sheetScene(problem, wide), [problem, wide]);
  const [entry, setEntry] = useState<Entry>(blankEntry);
  const [row, setRow] = useState(0);
  const [misses, setMisses] = useState<ReturnType<typeof grade> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const line = lines[row]!;
  const first = misses?.[0];

  const pose = useMemo<Pose>(() => {
    const parts: Record<string, Patch> = {};
    for (const part of made.scene.parts) parts[part.id] = { ...part.props };
    const given = (prefix: string, text: string) => {
      const b = text.replace('.', '');
      for (let c = 0; c < W; c++) parts[`${prefix}-${c}`] = { ...parts[`${prefix}-${c}`], bits: b.charAt(c) };
    };
    given('gx', state.absX);
    given('gy', state.absY);
    lines.forEach((item, i) => {
      const bad = (at: Patch['at']) => !!first && first.line === i && (first.at === at || first.at === -1);
      if (item.kind === 'corr') {
        parts[`corr-${i}`] = { ...parts[`corr-${i}`], text: entry.corr || '？', focus: i === row, changed: bad('corr') };
        return;
      }
      for (let c = 0; c < W; c++) parts[`c${i}-${c}`] = { ...parts[`c${i}-${c}`], bits: charAt(entry.bits[item.key] ?? '', W, c), focus: i === row, changed: bad(c) };
      if (item.kind === 'sum') {
        parts[`op-${i}`] = { ...parts[`op-${i}`], text: entry.ops[item.key] || '？', focus: i === row, changed: bad('op') };
        parts[`q-${i}`] = { ...parts[`q-${i}`], bits: entry.qs[item.key] || ' ', focus: i === row, changed: bad('q') };
      }
    });
    return { parts, wires: {} };
  }, [made, entry, row, first, lines, state, W]);

  const update = (next: Entry) => {
    setEntry(next);
    setMisses(null);
  };
  const setBits = (key: string, value: string) => update({ ...entry, bits: { ...entry.bits, [key]: value } });
  const setOp = (key: string, value: string) => update({ ...entry, ops: { ...entry.ops, [key]: value } });
  const setQ = (key: string, value: string) => update({ ...entry, qs: { ...entry.qs, [key]: value } });
  const pick = (id: string) => {
    let m = /^(?:ll|op|q|corr)-(\d+)$/.exec(id);
    if (m) {
      const i = Number(m[1]);
      setRow(i);
      const item = lines[i]!;
      if (id.startsWith('op-')) setOp(item.key, entry.ops[item.key] === '减 y' ? '加 y' : '减 y');
      if (id.startsWith('q-')) setQ(item.key, entry.qs[item.key] === '1' ? '0' : '1');
      if (id.startsWith('corr-')) update({ ...entry, corr: entry.corr === '要' ? '不要' : '要' });
      return;
    }
    m = /^c(\d+)-(\d+)$/.exec(id);
    if (!m) return;
    const i = Number(m[1]);
    const k = Number(m[2]);
    const item = lines[i]!;
    setRow(i);
    const cells = Array.from({ length: W }, (_, c) => charAt(entry.bits[item.key] ?? '', W, c));
    cells[k] = cells[k] === '0' ? '1' : '0';
    setBits(item.key, cells.join(''));
  };
  const check = () => {
    const found = grade(problem, entry);
    setMisses(found);
    if (found[0]) setRow(found[0].line);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < lines.length - 1) setRow(row + 1);
    else check();
  };
  const reveal = () => {
    const all: Entry = blankEntry();
    for (const item of lines) {
      if (item.kind === 'corr') all.corr = item.corr ?? '';
      else all.bits[item.key] = item.answer;
      if (item.op) all.ops[item.key] = item.op;
      if (item.q) all.qs[item.key] = item.q;
    }
    setEntry(all);
    setRevealed(true);
    setMisses(grade(problem, all));
  };
  const text = (input: { as: string; text?: string; bits?: string }) => (input.as === '真值' ? (input.text ?? '') : (input.bits ?? '')).replace(/^-/, '−');

  return (
    <div class="md-quiz">
      <p class="md-task">
        n = {n}，定点小数。x = {text(params.x)}，y = {text(params.y)}。用原码加减交替法求 x ÷ y：写出 [−|y|]<sub>补</sub>，每一轮选做减 y 还是加 y、写出和、上商，中间写左移的结果；最后决定要不要纠余，写出 [q]<sub>原</sub>。题号 {problem.seed}。
      </p>
      <SheetStage
        scene={made.scene}
        pose={pose}
        frame={made.frame}
        wide={wide}
        onPick={pick}
        panel={(style, ref) => (
          <form ref={ref} class={`md-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
            <span class="md-fill-head">
              第 {row + 1} 行 <Rich text={sub(line.label)} />
            </span>
            {line.kind === 'sum' ? (
              <div class="seg" role="group" aria-label="这一轮做">
                {OPS.map((op) => (
                  <button key={op} type="button" aria-pressed={entry.ops[line.key] === op} onClick={() => setOp(line.key, op)}>
                    {op}
                  </button>
                ))}
              </div>
            ) : null}
            {line.kind === 'corr' ? (
              <div class="seg" role="group" aria-label="要不要纠余">
                {['要', '不要'].map((item) => (
                  <button key={item} type="button" aria-pressed={entry.corr === item} onClick={() => update({ ...entry, corr: item })}>
                    {item === '要' ? '要，再加 y' : '不要'}
                  </button>
                ))}
              </div>
            ) : (
              <input
                class="input is-mono"
                aria-label={`${line.label}，${W} 位`}
                inputMode="numeric"
                autoComplete="off"
                spellcheck={false}
                placeholder={`·.${'·'.repeat(n)}`}
                value={entry.bits[line.key] ?? ''}
                aria-invalid={first?.line === row}
                onInput={(event) => setBits(line.key, event.currentTarget.value)}
              />
            )}
            {line.kind === 'sum' ? (
              <div class="md-choice" role="group" aria-label="上商">
                <span class="field-label">上商</span>
                <div class="seg is-mono">
                  {['0', '1'].map((q) => (
                    <button key={q} type="button" aria-pressed={entry.qs[line.key] === q} onClick={() => setQ(line.key, q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {first && first.line === row ? (
              <p class="field-error" role="status">
                <Rich text={first.message} />
              </p>
            ) : null}
            {revealed ? (
              <p class="md-key">
                答案 {line.kind === 'corr' ? line.corr : `${line.op ? `${line.op}，` : ''}${line.answer.charAt(0)}.${line.answer.slice(1)}${line.q ? `，上商 ${line.q}` : ''}`}
              </p>
            ) : null}
            <div class="md-fill-foot">
              <button type="button" class="btn" disabled={row === 0} onClick={() => setRow(row - 1)}>
                上一行
              </button>
              <button type="button" class="btn" disabled={row === lines.length - 1} onClick={() => setRow(row + 1)}>
                下一行
              </button>
              <button type="submit" class="btn is-primary">
                {row < lines.length - 1 ? '填好了' : '交卷'}
              </button>
              {row < lines.length - 1 && (
                <button type="button" class="btn" onClick={check}>
                  交卷
                </button>
              )}
              <button type="button" class="btn is-quiet" onClick={reveal}>
                看答案
              </button>
            </div>
          </form>
        )}
      />
      {misses && !first ? (
        <p class="md-verdict is-ok-text" role="status">
          {revealed ? '答案已填上。' : '对。'}[q]<sub>原</sub> = {result['[q]原']}，余数 {result['余数']}。
          <button type="button" class="btn" onClick={onNext}>
            换一题
          </button>
        </p>
      ) : misses && first ? (
        <p class="md-verdict is-bad-text" role="status">
          不对。第 {first.line + 1} 行（<Rich text={sub(lines[first.line]!.label)} />）起有错，台面上标出了这一处。{misses.length > 1 ? `共 ${misses.length} 行有错。` : ''}
        </p>
      ) : (
        <p class="md-hint">点台面上的格子翻成 0 或 1，点「？」牌选做什么、要不要纠余；也可以在填写栏里填。</p>
      )}
    </div>
  );
}
