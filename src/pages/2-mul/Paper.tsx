/** 练习：台面上一张答题纸，按例 2.23、2.24 的竖式一行行填位积矩阵。点格子翻位，或在填写栏里打字。 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { Rich } from '../../player/Rich';
import type { Patch, PartSpec, Pose, SceneSpec } from '../../scene';
import { sub } from './code';
import { geometry, textWidth } from './scene';
import { SheetStage } from './SheetStage';
import { followed, grade, makeProblem } from './practice';
import type { Problem } from './practice';

export function Paper() {
  const [seedText, setSeed] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(99999, Math.trunc(Number(raw)) || 1))));
  const seed = Math.max(1, Math.trunc(Number(seedText)) || 1);
  return <Sheet key={seed} problem={makeProblem(seed)} onNext={() => setSeed(String(seed + 1))} />;
}

const ROW = 0.95;

/** 学生写的一行按右对齐摆进格子：第 k 格（左起）是哪个字符，没写的是空槽。 */
function charAt(raw: string, width: number, k: number): string {
  const text = raw.replace(/[_.]/g, '');
  const shift = width - text.length;
  const c = text.charAt(k - shift);
  return c === '0' || c === '1' ? c : ' ';
}

function sheetScene(problem: Problem, wide: boolean): { scene: SceneSpec; frame: string[] } {
  const { n, mode } = problem.params;
  const signed = mode !== '无符号';
  const W = 2 * n;
  const { colX, signX, labelRight } = geometry(n, signed, !wide);
  const parts: PartSpec[] = [];
  const cell = (id: string, x: number, z: number, title: string, pick = false) =>
    parts.push({ id, kind: '2-mul:cell', position: [x, z], props: { bits: ' ', variant: 'bit' }, title, pick, describe: (p: Patch) => `${title}：${String(p.bits ?? '').trim() || '空'}` } as PartSpec);
  const label = (id: string, text: string, z: number, pick = false) =>
    parts.push({ id, kind: 'label', position: [labelRight - textWidth(text, 0.34) / 2, z], props: { text: sub(text), size: 0.34, weight: 600 }, pick, title: text });
  for (let w = 0; w < W; w++) parts.push({ id: `head-${w}`, kind: 'label', position: [colX(w), -0.85], props: { text: `2^${w}`, size: 0.34, tone: 'muted' } });
  if (signed) parts.push({ id: 'head-s', kind: 'label', position: [signX, -0.85], props: { text: '符号', size: 0.34, tone: 'muted' } });
  let z = 0;
  problem.given.forEach((row, r) => {
    label(`gl-${r}`, row.label, z);
    cell(`g-${r}-s`, signX, z, `${row.label} 的符号位`);
    for (let k = 0; k < n; k++) cell(`g-${r}-${k}`, colX(n - 1 - k), z, `${row.label} 的 2^${n - 1 - k} 位`);
    z += ROW;
  });
  if (signed) z += 0.25;
  problem.lines.forEach((line, i) => {
    if (line.kind === 'sum') z += 0.25;
    label(`ll-${i}`, line.label, z, true);
    for (let k = 0; k < line.width; k++) {
      const weight = line.low + line.width - 1 - k;
      cell(`c-${i}-${k}`, line.low < 0 ? signX : colX(weight), z, line.low < 0 ? `${line.label}` : `${line.label} 的 2^${weight} 位`, true);
    }
    z += ROW;
  });
  if (wide) parts.push({ id: 'desk', kind: 'memory', position: [colX(0) + 4.6, z / 2 - 0.6], props: { name: '', columns: [{ title: '', width: 6.0 }], rows: [[''], [''], [''], ['']], hidden: true } });
  const frame = parts.filter((part) => part.id !== 'desk').map((part) => part.id);
  return { scene: { parts, wires: [], kinds: () => import('./parts') }, frame };
}

function Sheet({ problem, onNext }: { problem: Problem; onNext: () => void }) {
  const { params, lines, result, given } = problem;
  const { n, mode } = params;
  const signed = mode !== '无符号';
  const [wide] = useState(() => typeof matchMedia === 'function' && matchMedia('(min-width: 600px)').matches);
  const made = useMemo(() => sheetScene(problem, wide), [problem, wide]);
  const [written, setWritten] = useState<Record<string, string>>({});
  const [row, setRow] = useState(0);
  const [misses, setMisses] = useState<ReturnType<typeof grade> | null>(null);
  const [revealed, setRevealed] = useState(false);
  const line = lines[row]!;

  const pose = useMemo<Pose>(() => {
    const parts: Record<string, Patch> = {};
    for (const part of made.scene.parts) parts[part.id] = { ...part.props };
    given.forEach((g, r) => {
      parts[`g-${r}-s`] = { ...parts[`g-${r}-s`], bits: g.sign };
      for (let k = 0; k < n; k++) parts[`g-${r}-${k}`] = { ...parts[`g-${r}-${k}`], bits: g.bits.charAt(k) };
    });
    const first = misses?.[0];
    lines.forEach((item, i) => {
      for (let k = 0; k < item.width; k++) {
        const id = `c-${i}-${k}`;
        parts[id] = { ...parts[id], bits: charAt(written[item.key] ?? '', item.width, k), focus: i === row, changed: !!first && first.line === i && (first.at === k || first.at < 0) };
      }
    });
    return { parts, wires: {} };
  }, [made, written, row, misses, lines, given, n]);

  const set = (key: string, value: string) => {
    setWritten((before) => ({ ...before, [key]: value }));
    setMisses(null);
  };
  const pick = (id: string, _bit?: number) => {
    const m = /^(?:c|ll)-(\d+)(?:-(\d+))?$/.exec(id);
    if (!m) return;
    const i = Number(m[1]);
    setRow(i);
    if (m[2] === undefined) return;
    const k = Number(m[2]);
    const item = lines[i]!;
    const cells = Array.from({ length: item.width }, (_, c) => charAt(written[item.key] ?? '', item.width, c));
    cells[k] = cells[k] === '0' ? '1' : '0';
    set(item.key, cells.join(''));
  };
  const check = () => {
    const found = grade(problem, written);
    setMisses(found);
    if (found[0]) setRow(found[0].line);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (row < lines.length - 1) setRow(row + 1);
    else check();
  };
  const reveal = () => {
    const all = Object.fromEntries(lines.map((item) => [item.key, item.answer]));
    setWritten(all);
    setRevealed(true);
    setMisses(grade(problem, all));
  };

  const first = misses?.[0];
  const productLabel = mode === '原码' ? '[x×y]原' : mode === '补码' ? '[x·y]补' : 'P';
  const weights = line.low < 0 ? '1 位' : `${line.width} 位，2^${line.low + line.width - 1} 到 2^${line.low}`;
  const note = misses && !first && lines.some((item) => followed(problem, written, item.key));

  return (
    <div class="md-quiz">
      <p class="md-task">
        {signed ? (
          <>
            {mode}阵列乘法，n = {n}。<Rich text={sub(given.map((g, i) => `${i ? '，' : ''}${g.label} = ${g.sign}${g.bits}`).join(''))} />
            。按带求补器的阵列乘法器逐行写出：积的符号位、两个算前求补器的输出、{n} 行位积、阵列的和、算后求补器的输出。
          </>
        ) : (
          <>
            n = {n}，A = {params.x.as === '真值' ? params.x.text : ''}，B = {params.y.as === '真值' ? params.y.text : ''}。逐行写出 {n} 行位积和积 P。
          </>
        )}{' '}
        题号 {problem.seed}。
      </p>
      <SheetStage
        scene={made.scene}
        pose={pose}
        frame={made.frame}
        wide={wide}
        onPick={pick}
        panel={(style, ref) => (
          <form ref={ref} class={`md-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
            <label class="md-fill-head" for="md-fill-input">
              第 {row + 1} 行 <Rich text={sub(line.label)} />（<Rich text={weights} />）
            </label>
            <input
              id="md-fill-input"
              class="input is-mono"
              inputMode="numeric"
              autoComplete="off"
              spellcheck={false}
              placeholder={'·'.repeat(line.width)}
              value={written[line.key] ?? ''}
              aria-invalid={first?.line === row}
              onInput={(event) => set(line.key, event.currentTarget.value)}
            />
            {first && first.line === row ? (
              <p class="field-error" role="status">
                <Rich text={first.message} />
              </p>
            ) : null}
            {revealed ? <p class="md-key">答案 {line.answer}</p> : null}
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
          {revealed ? '答案已填上。' : '对。'}
          <Rich text={sub(productLabel)} /> = {result['乘积']}，十进制 {result['十进制']}。{note ? '有几行是按你前面写的数算对的。' : ''}
          <button type="button" class="btn" onClick={onNext}>
            换一题
          </button>
        </p>
      ) : misses && first ? (
        <p class="md-verdict is-bad-text" role="status">
          不对。第 {first.line + 1} 行（<Rich text={sub(lines[first.line]!.label)} />）起有错，台面上标出了这一格。{misses.length > 1 ? `共 ${misses.length} 行有错。` : ''}
        </p>
      ) : (
        <p class="md-hint">点台面上的格子翻成 0 或 1，或者在填写栏里打字。</p>
      )}
    </div>
  );
}
