/** 练习：台面上的一张答题纸，按考试的竖式写变形补码，判断溢出。不带动画。 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { formatValue } from '../../lib/bits';
import type { OverflowKind } from '../../lib/bits';
import { Rich } from '../../player/Rich';
import { checkRow, checkValue, columnName, compact, followThrough, makeProblem, show } from './practice';
import { modifiedOverflow } from '../../lib/bits';
import type { RowCheck, RowKind } from './practice';

const KINDS: OverflowKind[] = ['无溢出', '正溢', '负溢'];
const minus = (text: string) => text.replace(/^-/, '−');

interface Line {
  key: 'x' | 'y' | 'negY' | 'sum';
  label: string;
  expected: string;
  kind: RowKind;
}

export function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const problem = useMemo(() => makeProblem(seed), [seed]);
  const { params, solution } = problem;
  const { n, notation, op } = solution;
  const subtract = op === '减';
  const sumLabel = subtract ? '[x−y]变补' : '[x+y]变补';
  const lines: Line[] = [
    { key: 'x', label: '[x]变补', expected: solution.xBits, kind: 'operand' },
    { key: 'y', label: '[y]变补', expected: solution.yBits, kind: 'operand' },
    ...(subtract && solution.negYBits ? [{ key: 'negY' as const, label: '[−y]变补', expected: solution.negYBits, kind: 'negate' as const }] : []),
    { key: 'sum', label: sumLabel, expected: solution.sumBits, kind: 'sum' },
  ];
  const [values, setValues] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<OverflowKind | ''>('');
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const results = useMemo(() => {
    if (!checked) return null;
    const rows: Record<string, RowCheck> = {};
    // 后面的行按学生自己前面写的数来判：前一行错了，这一行做法对仍算对。
    const follow = followThrough(problem, values);
    for (const line of lines) {
      const expected = line.key === 'sum' ? follow.sum : line.key === 'negY' ? (follow.negY ?? line.expected) : line.expected;
      const check = checkRow(expected, values[line.key] ?? '', n, notation, line.kind);
      if (check.ok && expected !== line.expected) check.message = '按你前面写的数，这一行算对了。前面的错改过来，这一行也要跟着改。';
      rows[line.key] = check;
    }
    // 判定按学生自己写的结果来判：两个符号位 00、11 无溢出，01 正溢，10 负溢。
    const sumWritten = compact(values.sum ?? '');
    const basis = sumWritten.length === solution.width && /^[01]+$/.test(sumWritten) ? sumWritten : solution.sumBits;
    const verdictOk = verdict === modifiedOverflow(basis);
    return { rows, verdictOk, value: checkValue(solution, values.value ?? '') };
    // lines 只由 problem 决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked, values, verdict, problem]);

  const set = (key: string, value: string) => {
    setValues((before) => ({ ...before, [key]: value }));
    setChecked(false);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
  };
  const allRight = results && Object.values(results.rows).every((row) => row.ok) && results.verdictOk && results.value.ok;
  const placeholder = show('0'.repeat(n + 2), notation).replace(/0/g, '·');

  return (
    <form class="ovf-paper" onSubmit={submit} aria-label="答题纸">
      <p class="ovf-task">
        n = {n}，定点{notation}。x = {minus(params.x.as === '真值' ? params.x.text : '')}，y = {minus(params.y.as === '真值' ? params.y.text : '')}。用变形补码求 x {subtract ? '−' : '+'} y，判断是否溢出；没有溢出时写出真值。
      </p>
      {lines.map((line) => {
        const result = results?.rows[line.key];
        const written = compact(values[line.key] ?? '');
        return (
          <div key={line.key} class={`ovf-line${line.kind === 'sum' ? ' is-sum' : ''}`}>
            <label class="ovf-line-label" for={`ovf-${line.key}`}>
              {line.label}
            </label>
            <input
              id={`ovf-${line.key}`}
              class={`ovf-input ovf-bits${result ? (result.ok ? ' is-ok' : ' is-bad') : ''}`}
              inputMode="numeric"
              autoComplete="off"
              spellcheck={false}
              placeholder={placeholder}
              value={values[line.key] ?? ''}
              onInput={(e) => set(line.key, e.currentTarget.value)}
            />
            {result && !result.ok && result.wrongAt >= 0 && (
              <div class="ovf-cells" aria-hidden="true">
                {[...written].map((bit, i) => (
                  <span key={i} class={i === result.wrongAt ? 'is-bad' : ''}>
                    {bit}
                  </span>
                ))}
              </div>
            )}
            {result && (
              <p class={`ovf-note${result.ok ? ' is-ok' : ' is-bad'}`} role="status">
                <Rich text={result.message} />
              </p>
            )}
            {revealed && <p class="ovf-key">答案 {show(line.expected, notation)}</p>}
          </div>
        );
      })}
      <fieldset class="ovf-line ovf-verdict">
        <legend class="ovf-line-label">判定</legend>
        <div class="ovf-seg">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              class={`ovf-choice${verdict === kind ? ' is-on' : ''}`}
              aria-pressed={verdict === kind}
              onClick={() => {
                setVerdict(kind);
                setChecked(false);
              }}
            >
              {kind}
            </button>
          ))}
        </div>
        {results && (
          <p class={`ovf-note${results.verdictOk ? ' is-ok' : ' is-bad'}`} role="status">
            <Rich text={results.verdictOk ? '对' : verdict === '' ? '没选' : `不对。看结果的两个符号位（${columnName(0, n, notation)}、${columnName(1, n, notation)}）：相同无溢出，01 正溢，10 负溢。`} />
          </p>
        )}
        {revealed && <p class="ovf-key">答案 {solution.verdict}</p>}
      </fieldset>
      <div class="ovf-line">
        <label class="ovf-line-label" for="ovf-value">
          x {subtract ? '−' : '+'} y 的真值（溢出时不填）
        </label>
        <input id="ovf-value" class="ovf-input ovf-bits" autoComplete="off" spellcheck={false} value={values.value ?? ''} onInput={(e) => set('value', e.currentTarget.value)} />
        {results && (
          <p class={`ovf-note${results.value.ok ? ' is-ok' : ' is-bad'}`} role="status">
            {results.value.message}
          </p>
        )}
        {revealed && <p class="ovf-key">答案 {solution.verdict === '无溢出' ? formatValue(solution.exactUnits, n, notation) : '溢出，不填'}</p>}
      </div>
      <div class="ovf-actions">
        <button type="submit" class="ovf-btn is-primary">
          交卷
        </button>
        <button type="button" class="ovf-btn" onClick={() => setRevealed(true)} disabled={revealed}>
          看答案
        </button>
        <button type="button" class="ovf-btn" onClick={onNext}>
          换一题
        </button>
      </div>
      {allRight && <p class="ovf-done">全对。</p>}
    </form>
  );
}
