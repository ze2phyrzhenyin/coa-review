/**
 * 练习：台面上一张答题纸，按例 3.11 的版式一列一列填。没有动画；判分只看引擎。
 * 宽屏是横表（一列一次访问）；窄屏横表放不下，转成一行一次访问，格子相同。
 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { circled, pageList, run } from '../../engines/vmreplace/model';
import type { Params } from '../../engines/vmreplace/model';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { useNarrow } from '../../app/media';
import { PaperStage, useDraft, useSeed, useWidePaper } from './kit';
import { answerColumns, blankColumn, grade, policyKeys, quizParams } from './setup';
import type { Column, Grade, Summary } from './setup';
import { slot } from './scene';

export function Paper() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<Params>(() => quizParams(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const pages = pageList(params);
  const n = params.frames;
  const count = pages.length;
  const narrow = useNarrow();
  const wide = useWidePaper();

  const isColumns = (value: unknown): value is { columns: Column[]; summary: Summary } =>
    !!value && typeof value === 'object' && Array.isArray((value as { columns?: unknown }).columns) && (value as { columns: unknown[] }).columns.length === count;
  const [draft, setDraft] = useDraft(`coa:3-vm-replace:quiz:${seed}`, () => ({ columns: pages.map(() => blankColumn(n)), summary: { ratio: '', evicted: '' } }), isColumns);
  const { columns, summary } = draft;
  const [col, setCol] = useState(0);
  const [result, setResult] = useState<Grade | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [, setTab] = useParam('t', '');
  const [, setPolicy] = useParam('p', 'fifo');
  const [, setFrames] = useParam('n', '3');
  const [, setKind] = useParam('k', 'page');
  const [, setSeq] = useParam('seq', '');
  const [, setInit] = useParam('init', '');
  const [, setStep] = useParam('s', '0');

  const scene = useMemo<SceneSpec>(() => {
    const rows = narrow ? pages.map(() => Array.from({ length: n + 1 }, () => '')) : Array.from({ length: n + 1 }, () => pages.map(() => ''));
    return {
      parts: [
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0],
          title: '答题纸',
          props: narrow
            ? { name: '答题纸', columns: [...Array.from({ length: n }, (_, i) => ({ title: slot(i), width: 0.9 })), { title: '命中', width: 1.1 }], rows, labels: pages.map((p) => `页 ${p}`) }
            : { name: '答题纸：页面访问序列', columns: pages.map((p) => ({ title: String(p), width: 0.98 })), rows, labels: [...Array.from({ length: n }, (_, i) => slot(i)), ''] },
        },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 3.6 + n * 0.3] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    };
  }, [narrow, wide, n, count]);

  const pose = useMemo<Pose>(() => {
    // 学生的一列：命中时把那一页加圈，最下一格写「命中」，跟考试的写法一样。
    const shown = columns.map((c, k) => {
      const page = pages[k];
      const cells = c.cells.map((text) => (c.result === '命中' && text.trim() !== '' && Number(text) === page ? circled(Number(text)) : text.trim()));
      return [...cells, c.result === '命中' ? '命中' : ''];
    });
    const rows = narrow ? shown : Array.from({ length: n + 1 }, (_, r) => shown.map((line) => line[r] ?? ''));
    // 只标第一处有错的那一列：后面的列可能是跟着它错的。
    const first = result?.first ?? -1;
    const wrongCells = first >= 0 ? (result?.wrong[first] ?? []).map((r) => (narrow ? `${first}.${r}` : `${r}.${first}`)) : [];
    return {
      parts: {
        paper: { ...scene.parts[0]!.props, rows, changedCells: wrongCells, ...(narrow ? { active: col } : { cell: `0.${col}` }) },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    };
  }, [scene, columns, result, col, narrow]);

  const edit = (patch: Partial<Column>) => {
    setDraft({ columns: columns.map((c, k) => (k === col ? { ...c, ...patch } : c)), summary });
    setResult(null);
  };
  const editSummary = (patch: Partial<Summary>) => {
    setDraft({ columns, summary: { ...summary, ...patch } });
    setResult(null);
  };
  const check = () => {
    const graded = grade(params, columns, summary);
    setResult(graded);
    if (graded.first >= 0) setCol(graded.first);
  };
  const reveal = () => {
    const answer = { columns: answerColumns(params), summary: { ratio: trace.result['命中率'] ?? '', evicted: trace.result['淘汰页号'] ?? '' } };
    setDraft(answer);
    setRevealed(true);
    setResult(grade(params, answer.columns, answer.summary));
  };
  /** 去试一试看这一列：同一组参数，停在这一列的比较步上。 */
  const demo = (k: number) => {
    setPolicy(policyKeys.find((item) => item.policy === params.policy)?.key ?? 'fifo');
    setFrames(String(n));
    setKind('page');
    setSeq(pages.join(','));
    setInit('');
    setStep(String(k * 2 + 1));
    setTab('try');
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (col < count - 1) setCol(col + 1);
    else check();
  };

  const current = columns[col] ?? blankColumn(n);
  const wrongHere = result?.wrong[col] ?? [];
  const policyName = params.policy;

  const panel = (style: Parameters<Parameters<typeof PaperStage>[0]['panel']>[0], ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`t4-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <p class="t4-fill-head">
        第 {col + 1} 列，访问页 {pages[col]}
      </p>
      <div class="t4-fill-grid">
        {current.cells.map((text, r) => (
          <label key={r} class={wrongHere.includes(r) ? 'is-wrong' : ''}>
            <span>{slot(r)} 格</span>
            <input
              class="input is-mono"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={text}
              aria-invalid={wrongHere.includes(r) ? 'true' : undefined}
              onInput={(event) => edit({ cells: current.cells.map((c, i) => (i === r ? event.currentTarget.value : c)) })}
            />
          </label>
        ))}
        <div class={`t4-fill-group${wrongHere.includes(n) ? ' is-wrong' : ''}`} role="group" aria-label="这一列">
          <span>这一列</span>
          <div class="seg">
            {(['命中', '缺页'] as const).map((value) => (
              <button key={value} type="button" aria-pressed={current.result === value} onClick={() => edit({ result: value })}>
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>
      {col > 0 ? (
        <button type="button" class="btn is-quiet" onClick={() => edit({ cells: [...(columns[col - 1]?.cells ?? current.cells)] })}>
          照抄上一列
        </button>
      ) : null}
      {col === count - 1 ? (
        <div class="t4-fill-grid">
          <label class={result && !result.ratioOk ? 'is-wrong' : ''}>
            <span>命中率</span>
            <input class="input is-mono" type="text" autoComplete="off" placeholder="如 3/9" value={summary.ratio} onInput={(event) => editSummary({ ratio: event.currentTarget.value })} />
          </label>
          <label class={result && !result.evictedOk ? 'is-wrong' : ''}>
            <span>依次淘汰的页</span>
            <input class="input is-mono" type="text" autoComplete="off" placeholder="如 3 5 4" value={summary.evicted} onInput={(event) => editSummary({ evicted: event.currentTarget.value })} />
          </label>
        </div>
      ) : null}
      <div class="t4-fill-foot">
        <button type="button" class="btn" disabled={col === 0} onClick={() => setCol(col - 1)}>
          上一列
        </button>
        <button type="button" class="btn" disabled={col === count - 1} onClick={() => setCol(col + 1)}>
          下一列
        </button>
        <button type="submit" class="btn is-primary">
          {col < count - 1 ? '填好了' : '交卷'}
        </button>
        {col < count - 1 ? (
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
  if (result) {
    const allCols = result.first < 0;
    if (allCols && result.ratioOk && result.evictedOk) {
      verdict = (
        <p class="t4-verdict" role="status">
          <span class="is-ok-text">{revealed ? '答案已填上' : '全对'}</span>
          命中 {trace.result['命中次数']} 次，命中率 {trace.result['命中率']}，淘汰 {trace.result['淘汰页号']}。
          <button type="button" class="btn" onClick={onNext}>
            换一道
          </button>
        </p>
      );
    } else if (!allCols) {
      const bad = result.wrong[result.first] ?? [];
      const page = pages[result.first];
      const names = bad.map((r) => (r === n ? '命中还是缺页' : `${slot(r)} 格`));
      verdict = (
        <p class="t4-verdict" role="status">
          <span class="is-bad-text">不对</span>
          第 {result.first + 1} 列（访问页 {page}）起有错：{names.join('、')}。
          {bad.includes(n) ? `先看上一列的各格里有没有页 ${page}。` : ''}
          {bad.some((r) => r < n) ? (policyName === 'FIFO' ? '缺页时新页进 a、各页下移；命中时各格不动。' : '缺页时新页进 a、各页下移；命中时把这一页提到 a，它上面的页各下移一格。') : ''}
          <button type="button" class="btn" onClick={() => demo(result.first)}>
            看这一列的演示
          </button>
        </p>
      );
    } else {
      verdict = (
        <p class="t4-verdict" role="status">
          <span class="is-bad-text">不对</span>
          表填对了，{!result.ratioOk ? '命中率是命中的列数除以访问次数' : ''}
          {!result.ratioOk && !result.evictedOk ? '；' : ''}
          {!result.evictedOk ? '淘汰的页按换出的先后写，没有就写「无」' : ''}。
        </p>
      );
    }
  }

  return (
    <div class="t4-quiz">
      <p class="t4-task">
        主存 {n} 个页面，开始时是空的，按 {policyName} 依次访问下面的页。逐列填出 a{n > 1 ? `～${slot(n - 1)}` : ''} 各格的页和这一列命中还是缺页，最后写命中率和依次淘汰的页。
      </p>
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
          <dt>访问序列</dt>
          <dd class="mono">{pages.join(' ')}</dd>
        </div>
        <div>
          <dt>题号</dt>
          <dd>{seed}</dd>
        </div>
      </dl>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['paper', 'desk'] : ['paper']} panel={panel} wide={wide} />
      {verdict}
    </div>
  );
}
