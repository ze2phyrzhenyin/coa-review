/**
 * 练习：台面上一张答题纸，按解题表的版式一行一个虚地址：逻辑页号、页内地址、（快表）、有效位、物理页号、物理地址。
 * 没有动画；判分只看引擎的解题表。
 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { run } from '../../engines/vm/model';
import type { Params } from '../../engines/vm/model';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { useNarrow } from '../../app/media';
import { PaperStage, useDraft, useSeed } from '../3-vm-replace/kit';
import { DASH, answerRows, grade, inputOf, quizParams } from './setup';
import type { Row } from './setup';

export function Paper() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<Params>(() => quizParams(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const columns = trace.table.columns;
  const count = trace.table.rows.length;
  const narrow = useNarrow();
  // 这一页的填写栏高，压在台面上会挡住答题纸：一律排在舞台下面。
  const wide = false;
  const blankRows = (): Row[] => trace.table.rows.map((row) => [row.cells[0] ?? '', ...columns.slice(1).map(() => '')]);
  const ok = (value: unknown): value is Row[] => Array.isArray(value) && value.length === count && value.every((row) => Array.isArray(row) && row.length === columns.length);
  const [rows, setRows] = useDraft(`coa:3-vm-addr:quiz:${seed}`, blankRows, ok);
  const [line, setLine] = useState(0);
  const [result, setResult] = useState<number[][] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const first = result ? result.findIndex((bad) => bad.length > 0) : -1;

  const [, setTab] = useParam('t', '');
  const [, setStep] = useParam('s', '0');
  const setters = {
    size: useParam('size', '2048')[1],
    pages: useParam('pages', '16')[1],
    frames: useParam('frames', '8')[1],
    table: useParam('table', '0:3 1:6 2:- 3:1 5:2')[1],
    tlb: useParam('tlb', '')[1],
    addr: useParam('addr', '1A2FH 0C05H 2B70H')[1],
    radix: useParam('radix', 'hex')[1],
  };

  // 窄屏上「逻辑页号」「物理页号」缩成「逻辑页」「物理页」，格子里的字不变。
  const short = (title: string) => (narrow ? title.replace(/页号$/, '页') : title);
  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0],
          title: '答题纸',
          props: {
            name: '答题纸',
            columns: columns.slice(1).map((title) => ({ title: short(title), width: title === '物理地址' || title === '页内地址' ? (narrow ? 1.35 : 1.6) : narrow ? 1.0 : 1.2 })),
            rows: trace.table.rows.map(() => columns.slice(1).map(() => '')),
            labels: trace.table.rows.map((row) => row.cells[0] ?? ''),
          },
        },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 2.6 + count * 0.6] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    // columns、行数只由题目决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trace, wide, narrow],
  );

  const pose = useMemo<Pose>(() => {
    const wrongCells = first >= 0 ? (result?.[first] ?? []).map((c) => `${first}.${c - 1}`) : [];
    return {
      parts: {
        paper: { ...scene.parts[0]!.props, rows: rows.map((row) => row.slice(1).map((t) => t.trim().toUpperCase())), active: line, changedCells: wrongCells },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    };
  }, [scene, rows, line, result, first]);

  const row = rows[line] ?? [];
  const edit = (c: number, value: string) => {
    setRows(rows.map((r, i) => (i === line ? r.map((t, k) => (k === c ? value : t)) : r)));
    setResult(null);
  };
  const check = () => {
    const graded = grade(params, rows);
    setResult(graded);
    const f = graded.findIndex((bad) => bad.length > 0);
    if (f >= 0) setLine(f);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (line < count - 1) setLine(line + 1);
    else check();
  };
  const reveal = () => {
    const filled = answerRows(params);
    setRows(filled);
    setRevealed(true);
    setResult(grade(params, filled));
  };
  const demo = (r: number) => {
    const input = inputOf(params);
    for (const [key, value] of Object.entries(input)) setters[key as keyof typeof setters](value);
    const at = trace.steps.findIndex((step) => step.state.current.n === r + 1);
    setStep(String(Math.max(0, at + 1)));
    setTab('try');
  };

  const fault = (c: number) => columns[c] === '物理页号' || columns[c] === '物理地址';
  const wrongHere = result?.[line] ?? [];
  const panel = (style: Parameters<Parameters<typeof PaperStage>[0]['panel']>[0], ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`t4-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <p class="t4-fill-head">
        第 {line + 1} 行，虚地址 {row[0]}
      </p>
      <div class="t4-fill-grid">
        {columns.map((title, c) => {
          if (c === 0) return null;
          if (title === '快表') {
            return (
              <div key={c} class={`t4-fill-group is-pair${wrongHere.includes(c) ? ' is-wrong' : ''}`} role="group" aria-label="快表">
                <span>快表</span>
                <div class="seg">
                  {['命中', '未命中'].map((value) => (
                    <button key={value} type="button" aria-pressed={row[c] === value} onClick={() => edit(c, value)}>
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (title === '有效位') {
            return (
              <div key={c} class={`t4-fill-group is-pair${wrongHere.includes(c) ? ' is-wrong' : ''}`} role="group" aria-label="有效位">
                <span>有效位</span>
                <div class="seg">
                  {['1', '0', ...(columns.includes('快表') ? [DASH] : [])].map((value) => (
                    <button key={value} type="button" aria-pressed={row[c] === value} aria-label={value === DASH ? '不用查页表' : value} onClick={() => edit(c, value)}>
                      {value === DASH ? '不查' : value}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          return (
            <label key={c} class={wrongHere.includes(c) ? 'is-wrong' : ''}>
              <span>{title}</span>
              <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} value={row[c] ?? ''} onInput={(event) => edit(c, event.currentTarget.value)} />
            </label>
          );
        })}
      </div>
      <button
        type="button"
        class="btn is-quiet"
        onClick={() => {
          setRows(rows.map((r, i) => (i === line ? r.map((t, k) => (fault(k) ? '缺页' : t)) : r)));
          setResult(null);
        }}
      >
        这一行写缺页
      </button>
      <div class="t4-fill-foot">
        <button type="button" class="btn" disabled={line === 0} onClick={() => setLine(line - 1)}>
          上一行
        </button>
        <button type="button" class="btn" disabled={line === count - 1} onClick={() => setLine(line + 1)}>
          下一行
        </button>
        <button type="submit" class="btn is-primary">
          {line < count - 1 ? '填好了' : '交卷'}
        </button>
        {line < count - 1 ? (
          <button type="button" class="btn" onClick={check}>
            交卷
          </button>
        ) : null}
        <button type="button" class="btn is-quiet" onClick={reveal}>
          看答案
        </button>
      </div>
    </form>
  );

  let verdict = null;
  if (result && first < 0) {
    verdict = (
      <p class="t4-verdict" role="status">
        <span class="is-ok-text">{revealed ? '答案已填上' : '全对'}</span>
        缺页 {trace.result['缺页次数']} 次{trace.result['快表命中次数'] !== undefined ? `，快表命中 ${trace.result['快表命中次数']} 次` : ''}。
        <button type="button" class="btn" onClick={onNext}>
          换一道
        </button>
      </p>
    );
  } else if (result) {
    const bad = result[first] ?? [];
    const names = bad.map((c) => columns[c]).filter(Boolean);
    const tips: string[] = [];
    if (names.includes('逻辑页号') || names.includes('页内地址')) tips.push(`先写成二进制，低 ${Math.round(Math.log2(params.pageSize))} 位是页内地址，高位是逻辑页号。`);
    if (names.includes('有效位') || names.includes('快表')) tips.push('有快表先看快表；没命中再看页表那一项的有效位，没列出的页有效位按 0。');
    if (names.includes('物理页号') || names.includes('物理地址')) tips.push('有效位为 0 写缺页；否则物理页号放高位、页内地址照抄放低位，拼起来是物理地址。');
    verdict = (
      <p class="t4-verdict" role="status">
        <span class="is-bad-text">不对</span>
        第 {first + 1} 行（{trace.table.rows[first]?.cells[0]}）有错：{names.join('、')}。
        <Rich text={tips.join('')} />
        <button type="button" class="btn" onClick={() => demo(first)}>
          看这一行的演示
        </button>
      </p>
    );
  }

  return (
    <div class="t4-quiz">
      <p class="t4-task">按页表{params.tlb ? '和快表' : ''}把下面每个虚地址变成物理地址，按解题表的版式逐行填；不在主存的写「缺页」。</p>
      <dl class="pl-given">
        {trace.conditions.map((condition) => (
          <div key={condition.label}>
            <dt>
              <Rich text={condition.label} />
            </dt>
            <dd>
              <Rich text={condition.value} />
            </dd>
          </div>
        ))}
        <div>
          <dt>题号</dt>
          <dd>{seed}</dd>
        </div>
      </dl>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['paper', 'desk'] : ['paper']} panel={panel} wide={wide} compact />
      {verdict}
    </div>
  );
}
