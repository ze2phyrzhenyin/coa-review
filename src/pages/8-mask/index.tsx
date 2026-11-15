import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { generate, masksFromOrder, run, simulate, validateParams } from '../../engines/mask/model';
import type { Arrival, Params } from '../../engines/mask/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { MASK_CONCLUSION, MASK_NEEDS, MASK_QUESTION, levelName, maskStage } from './scene';
import { Paper } from './Paper';
import type { Entry, PaperMiss } from './Paper';
import { PageTabs, plainAsks, useSeed } from './shared';
import './mask.css';

/** 讲解的两道例题：同样四个请求，先按缺省（处理次序就是响应次序），再只改屏蔽字。 */
const ARRIVALS: Arrival[] = [
  { level: 3, at: 0 },
  { level: 1, at: 2 },
  { level: 2, at: 2 },
  { level: 0, at: 4 },
];
const EXAMPLES: { id: string; label: string; params: Params }[] = [
  { id: 'a', label: '处理次序 = 响应次序', params: { levels: 4, arrivals: ARRIVALS, service: 3 } },
  { id: 'b', label: '改成 L2→L0→L3→L1', params: { levels: 4, arrivals: ARRIVALS, service: 3, order: [2, 0, 3, 1] } },
];

function useMask(params: Params) {
  const narrow = useNarrow();
  const key = JSON.stringify(params);
  return useMemo(() => {
    const trace = plainAsks(run(params));
    return { trace, stage: maskStage(trace, narrow) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

function Legend() {
  return (
    <p class="mk-terms">
      台面上：每一排翻片是一个处理程序的<Term k="屏蔽字" />，深色面 1 是屏蔽、白面 0 是允许；下面是<Term k="中断请求寄存器">请求寄存器</Term>、
      <Term k="中断屏蔽寄存器">屏蔽寄存器</Term>和<Term k="排队器" />；一叠<Term k="断点">程序卡</Term>记着谁打断了谁。
    </p>
  );
}

function MaskPlayer({ params, lesson }: { params: Params; lesson?: boolean }) {
  const { trace, stage } = useMask(params);
  return (
    <Player
      wide
      key={JSON.stringify(params)}
      trace={trace}
      scene={stage.scene}
      bind={stage.bind}
      moves={stage.moves}
      names={stage.names}
      values={stage.values}
      caption={stage.caption}
      flipPart={stage.flipPart}
      askFrame={stage.askFrame}
      frame={stage.frame}
      onWrong={stage.wrong}
      convention={stage.convention}
      {...(lesson ? { question: MASK_QUESTION, conclusion: MASK_CONCLUSION, needs: MASK_NEEDS, mistakes: stage.mistakes } : {})}
    />
  );
}

function Learn() {
  const ids = EXAMPLES.map((item) => item.id);
  const [ex, setEx] = useParam('ex', 'a', (raw) => (ids.includes(raw) ? raw : 'a'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const example = EXAMPLES.find((item) => item.id === ex) ?? EXAMPLES[0]!;
  const other = EXAMPLES.find((item) => item.id !== example.id)!;
  const done = useMemo(() => ({ mine: run(example.params).result, theirs: run(other.params).result }), [example, other]);
  return (
    <>
      <div class="mk-controls">
        <div class="seg" role="group" aria-label="例题">
          {EXAMPLES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === example.id}
              onClick={() => {
                if (item.id === example.id) return;
                setStep(0);
                setEx(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <MaskPlayer params={example.params} lesson />
      <div class="mk-controls">
        <p class="mk-note">
          两道例题的请求和运行时间完全相同，只有屏蔽字不同。完成次序：{example.label} 时 <span class="mono">{done.mine['完成次序']}</span>，{other.label} 时{' '}
          <span class="mono">{done.theirs['完成次序']}</span>。
        </p>
        <Legend />
      </div>
    </>
  );
}

/** 网址里的写法：处理次序「2031」，屏蔽字「1101.0100.1111.0101」，请求「3@0,1@2」。 */
const readOrder = (text: string, n: number): number[] | null => {
  const digits = (text.match(/\d/g) ?? []).map(Number);
  return digits.length === n && [...digits].sort((a, b) => a - b).every((d, i) => d === i) ? digits : null;
};
const readMasks = (text: string, n: number): string[] | null => {
  const rows = text.split(/[\s,，、/.;；]+/).filter(Boolean);
  return rows.length === n && rows.every((row) => new RegExp(`^[01]{${n}}$`).test(row)) ? rows : null;
};
const readArrivals = (text: string): Arrival[] | null => {
  const pairs = [...text.matchAll(/L?(\d+)\s*[@在:：\s]\s*(\d+)/gi)].map((m) => ({ level: Number(m[1]), at: Number(m[2]) }));
  return pairs.length ? pairs : null;
};
const showArrivals = (arrivals: Arrival[]) => arrivals.map((a) => `L${a.level} ${a.at}`).join('，');
const encodeArrivals = (arrivals: Arrival[]) => arrivals.map((a) => `${a.level}@${a.at}`).join(',');

interface TryForm {
  n: number;
  by: 'order' | 'masks';
  order: string;
  masks: string;
  arrivals: string;
  service: number;
}

function paramsOf(form: TryForm): { params: Params | null; problems: string[] } {
  const arrivals = readArrivals(form.arrivals);
  const problems: string[] = [];
  if (!arrivals) problems.push('请求写成「级 时刻」，例如 L3 0，L1 2');
  const params: Params = { levels: form.n, arrivals: arrivals ?? [], service: form.service };
  if (form.by === 'order') {
    const order = readOrder(form.order, form.n);
    if (!order) problems.push(`处理次序要把 L0–L${form.n - 1} 各写一次`);
    else params.order = order;
  } else {
    const masks = readMasks(form.masks, form.n);
    if (!masks) problems.push(`屏蔽字写 ${form.n} 个，每个 ${form.n} 位，用空格隔开`);
    else params.masks = masks;
  }
  if (problems.length) return { params: null, problems };
  const issues = validateParams(params);
  return issues.length ? { params: null, problems: issues } : { params, problems: [] };
}

function Try() {
  const [nText, setN] = useParam('n', '4', (raw) => String(Math.max(2, Math.min(6, Math.trunc(Number(raw)) || 4))));
  const [by, setBy] = useParam('by', 'order', (raw) => (raw === 'masks' ? 'masks' : 'order'));
  const [ord, setOrd] = useParam('ord', '2031');
  const [mk, setMk] = useParam('mk', '');
  const [arr, setArr] = useParam('arr', encodeArrivals(ARRIVALS));
  const [svText, setSv] = useParam('sv', '3', (raw) => String(Math.max(1, Math.min(9, Math.trunc(Number(raw)) || 3))));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const n = Number(nText);
  const service = Number(svText);
  const urlForm: TryForm = { n, by: by as TryForm['by'], order: (readOrder(ord, n) ?? []).map((l) => `L${l}`).join(' ') || ord, masks: mk.replace(/\./g, ' '), arrivals: showArrivals(readArrivals(arr) ?? []), service };
  const [draft, setDraft] = useState(urlForm);
  useEffect(() => setDraft(urlForm), [nText, by, ord, mk, arr, svText]);
  const read = useMemo(() => paramsOf(urlForm), [nText, by, ord, mk, arr, svText]);
  const [problems, setProblems] = useState<string[]>([]);

  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = paramsOf(draft);
    setProblems(checked.problems);
    if (!checked.params) return;
    const p = checked.params;
    setStep(0);
    if (p.order) setOrd(p.order.join(''));
    if (p.masks) setMk(p.masks.join('.'));
    setArr(encodeArrivals(p.arrivals));
  };
  const changeN = (next: number) => {
    setStep(0);
    setN(String(next));
    setOrd(Array.from({ length: next }, (_, i) => i).join(''));
    setMk(masksFromOrder(next, Array.from({ length: next }, (_, i) => i)).join('.'));
    setArr(Array.from({ length: next }, (_, i) => `${next - 1 - i}@${i * 2}`).join(','));
  };
  const changeBy = (next: 'order' | 'masks') => {
    if (next === by) return;
    setStep(0);
    if (next === 'masks' && !readMasks(mk.replace(/\./g, ' '), n)) {
      const order = readOrder(ord, n) ?? Array.from({ length: n }, (_, i) => i);
      setMk(masksFromOrder(n, order).join('.'));
    }
    setBy(next);
  };

  // 同一组请求，处理次序就是响应次序时的完成次序，和现在的比一比。
  const compare = useMemo(() => {
    if (!read.params) return null;
    const plain: Params = { levels: read.params.levels, arrivals: read.params.arrivals, service: read.params.service };
    return { plain: run(plain).result, mine: run(read.params).result };
  }, [read]);

  return (
    <>
      <form class="mk-form" onSubmit={submit}>
        <label class="field">
          <span class="field-label">级数</span>
          <select class="select" value={nText} onChange={(e) => changeN(Number(e.currentTarget.value))}>
            {[2, 3, 4, 5, 6].map((k) => (
              <option key={k} value={String(k)}>
                {k} 级（L0–L{k - 1}）
              </option>
            ))}
          </select>
        </label>
        <div class="field">
          <span class="field-label" id="mk-by">给出</span>
          <div class="seg" role="group" aria-labelledby="mk-by">
            <button type="button" aria-pressed={by === 'order'} onClick={() => changeBy('order')}>
              处理次序
            </button>
            <button type="button" aria-pressed={by === 'masks'} onClick={() => changeBy('masks')}>
              屏蔽字
            </button>
          </div>
        </div>
        {by === 'order' ? (
          <label class="field">
            <span class="field-label">处理次序，先到后</span>
            <input class="input is-mono" inputMode="numeric" autoComplete="off" spellcheck={false} placeholder="2 0 3 1" value={draft.order} onInput={(e) => setDraft({ ...draft, order: e.currentTarget.value })} />
          </label>
        ) : (
          <label class="field">
            <span class="field-label">屏蔽字，L0 程序起，左起 L0 位</span>
            <input class="input is-mono" inputMode="numeric" autoComplete="off" spellcheck={false} placeholder="1101 0100 1111 0101" value={draft.masks} onInput={(e) => setDraft({ ...draft, masks: e.currentTarget.value })} />
          </label>
        )}
        <label class="field mk-wide">
          <span class="field-label">请求：级 时刻</span>
          <input class="input is-mono" autoComplete="off" spellcheck={false} placeholder="L3 0，L1 2" value={draft.arrivals} onInput={(e) => setDraft({ ...draft, arrivals: e.currentTarget.value })} />
        </label>
        <label class="field">
          <span class="field-label">每级运行时间</span>
          <select
            class="select"
            value={svText}
            onChange={(e) => {
              setStep(0);
              setSv(e.currentTarget.value);
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((k) => (
              <option key={k} value={String(k)}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" class="btn is-primary mk-run">
          换上
        </button>
        {(problems[0] ?? read.problems[0]) ? (
          <p class="field-error mk-wide" role="alert">
            {problems[0] ?? read.problems[0]}
          </p>
        ) : null}
      </form>
      {read.params && compare ? (
        <>
          <dl class="mk-compare">
            <div>
              <dt>处理次序 = 响应次序</dt>
              <dd class="mono">
                完成 {compare.plain['完成次序']}，结束于 {compare.plain['结束时刻']}
              </dd>
            </div>
            <div>
              <dt>按这组屏蔽字</dt>
              <dd class="mono">
                完成 {compare.mine['完成次序']}，结束于 {compare.mine['结束时刻']}
              </dd>
            </div>
          </dl>
          <MaskPlayer params={read.params} />
        </>
      ) : null}
    </>
  );
}

/** 练习：按种子出题，在答题纸上填各级处理程序的屏蔽字。判分逐位对引擎的解题表。 */
function Practice() {
  const [seed, setSeed] = useSeed();
  const params = useMemo(() => generate(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const n = params.levels;
  const [, setTab] = useParam('t', 'learn');
  const [, setN] = useParam('n', '4');
  const [, setBy] = useParam('by', 'order');
  const [, setOrd] = useParam('ord', '');
  const [, setArr] = useParam('arr', '');
  const [, setSv] = useParam('sv', '3');
  const [, setStep] = useIntParam('s', 0, 0, 10_000);

  const expected = trace.table.rows.map((row) => row.cells.slice(1, 1 + n).join(''));
  const columns = useMemo(() => Array.from({ length: n }, (_, j) => ({ title: `L${j}`, width: 0.85 })), [n]);
  const labels = useMemo(() => Array.from({ length: n }, (_, i) => `L${i} 程序`), [n]);
  const answer: Entry[] = expected.map((mask) => ({ mask }));
  const order = params.order ?? [];

  const grade = (entries: Entry[]): PaperMiss[] => {
    const misses: PaperMiss[] = [];
    entries.forEach((entry, r) => {
      const bits = (entry.mask ?? '').replace(/[\s_]/g, '');
      const want = expected[r] ?? '';
      if (bits.length !== n || !/^[01]+$/.test(bits)) {
        misses.push({ row: r, field: 'mask', column: 0, message: `L${r} 程序的屏蔽字要写 ${n} 位 0 或 1，左起是 L0 位。` });
        return;
      }
      const j = [...want].findIndex((bit, k) => bits[k] !== bit);
      if (j < 0) return;
      const rule =
        j === r
          ? '自己那一位写 1：同一级不打断自己。'
          : order.indexOf(j) > order.indexOf(r)
            ? `处理次序里 L${j} 排在 L${r} 后面，L${r} 运行时要挡住它，写 1。`
            : `处理次序里 L${j} 排在 L${r} 前面，要能打断 L${r}，写 0。`;
      misses.push({ row: r, field: 'mask', column: j, message: `L${r} 程序的 L${j} 位不对。${rule}` });
    });
    return misses;
  };

  const demo = (row: number) => {
    setN(String(n));
    setBy('order');
    setOrd(order.join(''));
    setArr(encodeArrivals(params.arrivals));
    setSv(String(params.service));
    setStep(row + 1);
    setTab('try');
  };

  return (
    <Paper
      key={seed}
      draftKey={`coa:8-mask:quiz:${seed}`}
      seed={seed}
      task={
        <p>
          按要求的处理次序，填出每一级中断处理程序的屏蔽字（1 = 屏蔽，0 = 允许，左起 L0 位）。填好后可以去试一试，看这组请求按你的屏蔽字怎么运行。
        </p>
      }
      conditions={trace.conditions.filter((c) => ['级', '响应优先次序', '要求的处理次序', '屏蔽位'].includes(c.label))}
      title="屏蔽字表"
      columns={columns}
      labels={labels}
      heads={labels.map((label) => `${label}的屏蔽字`)}
      fields={() => [{ key: 'mask', label: `屏蔽字（${n} 位）`, mono: true, inputMode: 'numeric', placeholder: '0'.repeat(n) }]}
      cells={(entry) => {
        const bits = (entry.mask ?? '').replace(/[\s_]/g, '');
        return Array.from({ length: n }, (_, j) => bits[j] ?? '');
      }}
      columnOf={() => 0}
      answer={answer}
      grade={grade}
      done={`处理次序 ${trace.result['处理次序']}。这组请求的完成次序是 ${trace.result['完成次序']}，结束于 ${trace.result['结束时刻']}。`}
      onNext={() => setSeed(seed + 1)}
      onDemo={demo}
    />
  );
}

/** 弄坏它：把一级的屏蔽字里自己那一位写成 0，它在处理中又来请求就打断自己。 */
const BREAK_ORDER = [2, 0, 3, 1];
function breakParams(level: number): Params {
  const masks = masksFromOrder(4, BREAK_ORDER).map((row, i) => (i === level ? row.slice(0, level) + '0' + row.slice(level + 1) : row));
  const last = BREAK_ORDER.filter((l) => l !== level).at(-1)!;
  const arrivals: Arrival[] = [{ level: last, at: 1 }, ...Array.from({ length: 5 }, (_, k) => ({ level, at: k * 2 }))];
  return { levels: 4, masks, arrivals, service: 3 };
}

function Break() {
  const [lvText, setLv] = useParam('lv', '2', (raw) => (['0', '1', '2', '3'].includes(raw) ? raw : '2'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const level = Number(lvText);
  const params = useMemo(() => breakParams(level), [level]);
  const facts = useMemo(() => {
    const broken = simulate(params);
    const healthy = simulate({ ...params, masks: masksFromOrder(4, BREAK_ORDER) });
    const starved = BREAK_ORDER.filter((l) => l !== level).at(-1)!;
    const startOf = (segments: { who: number; from: number }[]) => segments.find((g) => g.who === starved)?.from ?? 0;
    return {
      starved,
      healthyStart: startOf(healthy.segments),
      brokenStart: startOf(broken.segments),
      depth: Math.max(...broken.segments.map((g) => g.depth)),
      healthyDepth: Math.max(...healthy.segments.map((g) => g.depth)),
    };
  }, [params, level]);
  return (
    <>
      <div class="mk-controls">
        <div class="seg" role="group" aria-label="弄坏哪一级的屏蔽字">
          {[0, 1, 2, 3].map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === level}
              onClick={() => {
                setStep(0);
                setLv(String(k));
              }}
            >
              L{k} 自己那一位写 0
            </button>
          ))}
        </div>
        <p class="mk-note">
          处理次序 {BREAK_ORDER.map(levelName).join('→')}。L{level} 从 0 起每隔 2 请求一次，每次要运行 3；{levelName(facts.starved)} 在 1 请求。屏蔽字正确时程序卡最多叠 {facts.healthyDepth + 1} 张，
          {levelName(facts.starved)} 在 {facts.healthyStart} 开始运行；L{level} 自己那一位写成 0 以后，它每来一次请求就打断自己，程序卡叠到 {facts.depth + 1} 张，{levelName(facts.starved)} 要等到 {facts.brokenStart}。
        </p>
        <p class="mk-note">
          真实机器里每叠一层就多存一份现场，同一个服务程序被重入，它用的缓冲区和计数会被后一次改掉。请求来得够快时栈一直长到溢出，排在后面的级一直轮不到。
        </p>
      </div>
      <MaskPlayer params={params} />
    </>
  );
}

export default function Page() {
  return (
    <PageTabs
      label="本页"
      tabs={[
        { id: 'learn', name: '讲解', render: () => <Learn /> },
        { id: 'try', name: '试一试', render: () => <Try /> },
        { id: 'quiz', name: '练习', render: () => <Practice /> },
        { id: 'break', name: '弄坏它', render: () => <Break /> },
      ]}
    />
  );
}
