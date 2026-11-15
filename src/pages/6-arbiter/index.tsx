import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { generate, run, validateParams } from '../../engines/arbiter/model';
import type { CounterFrom, Mode, Params, Request } from '../../engines/arbiter/model';
import { Player } from '../../player/Player';
import { Paper } from '../8-mask/Paper';
import type { Entry, PaperMiss } from '../8-mask/Paper';
import { PageTabs, plainAsks, useSeed } from '../8-mask/shared';
import { ARB_CONCLUSION, ARB_NEEDS, ARB_QUESTION, arbStage } from './scene';
import '../8-mask/mask.css';

/** 讲解用的四个请求：设备 2、3 同时请求，设备 1 稍后，设备 0 在别人占用总线时才来。 */
const REQUESTS: Request[] = [
  { device: 2, at: 0, hold: 2 },
  { device: 3, at: 0, hold: 1 },
  { device: 1, at: 1, hold: 2 },
  { device: 0, at: 3, hold: 1 },
];
const EXAMPLES: { id: string; label: string; params: Params }[] = [
  { id: 'chain', label: '链式查询', params: { mode: '链式查询', devices: 4, requests: REQUESTS } },
  { id: 'count', label: '计数器，从中止点计', params: { mode: '计数器定时查询', devices: 4, requests: REQUESTS, counterFrom: '中止点' } },
];

/**
 * 引擎把「这一轮谁得到总线」挂在登记请求的那一步上，那一屏还看不到谁在请求。
 * 挪到下一步出题：请求都举起来了，BG 还没出发。答案不变。
 */
function askAfterRequests<T extends { steps: { ask?: unknown }[] }>(trace: T): T {
  const steps = trace.steps.map((step) => ({ ...step }));
  for (let i = steps.length - 2; i >= 0; i--) {
    if (steps[i]!.ask && !steps[i + 1]!.ask) {
      steps[i + 1]!.ask = steps[i]!.ask;
      delete steps[i]!.ask;
    }
  }
  return { ...trace, steps };
}

function useArb(params: Params) {
  const narrow = useNarrow();
  const key = JSON.stringify(params);
  return useMemo(() => {
    const trace = askAfterRequests(plainAsks(run(params)));
    return { trace, stage: arbStage(trace, narrow) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

function ArbPlayer({ params, lesson }: { params: Params; lesson?: boolean }) {
  const { trace, stage } = useArb(params);
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
      askFrame={stage.askFrame}
      frame={stage.frame}
      onWrong={stage.wrong}
      convention={stage.convention}
      mistakes={stage.mistakes}
      {...(lesson ? { question: ARB_QUESTION, conclusion: ARB_CONCLUSION, needs: ARB_NEEDS } : {})}
    />
  );
}

function Legend() {
  return (
    <p class="mk-terms">
      台面上：<Term k="BR" />（总线请求）、<Term k="BS" />（总线忙，1 表示总线正被使用）是各接口共用的线；<Term k="BG" />（总线授权）在<Term k="链式查询" />时从仲裁器出发，一个接口一个接口往下传。下方的时间轴记着每台设备占用总线的时段。
    </p>
  );
}

function Learn() {
  const ids = EXAMPLES.map((item) => item.id);
  const [ex, setEx] = useParam('ex', 'chain', (raw) => (ids.includes(raw) ? raw : 'chain'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const example = EXAMPLES.find((item) => item.id === ex) ?? EXAMPLES[0]!;
  const results = useMemo(() => EXAMPLES.map((item) => ({ label: item.label, result: run(item.params).result })), []);
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
      <ArbPlayer params={example.params} lesson />
      <div class="mk-controls">
        <p class="mk-note">
          两道例题的请求完全相同，只换了仲裁方式。授权次序：
          {results.map((item, i) => (
            <span key={item.label}>
              {i > 0 ? '；' : ''}
              {item.label} <span class="mono">{item.result['授权次序']}</span>，等待合计 <span class="mono tnum">{item.result['等待合计']}</span> 个周期
            </span>
          ))}
          。
        </p>
        <Legend />
      </div>
    </>
  );
}

const MODES: { id: string; mode: Mode }[] = [
  { id: 'chain', mode: '链式查询' },
  { id: 'count', mode: '计数器定时查询' },
  { id: 'own', mode: '独立请求' },
];
/** 网址里的请求：设备@时刻x占用，逗号隔开，例如 2@0x2,3@0x1。 */
const encodeRequests = (rs: Request[]) => rs.map((r) => `${r.device}@${r.at}x${r.hold}`).join(',');
const readRequests = (text: string): Request[] | null => {
  const rs = [...text.matchAll(/(?:设备\s*)?(\d+)\s*[@在:：\s]\s*(\d+)\s*[x×*，,\s]\s*(?:占\s*)?(\d+)/g)].map((m) => ({ device: Number(m[1]), at: Number(m[2]), hold: Number(m[3]) }));
  return rs.length ? rs : null;
};
const showRequests = (rs: Request[]) => rs.map((r) => `${r.device} ${r.at} ${r.hold}`).join('；');
const readList = (text: string) => (text.match(/\d/g) ?? []).map(Number);

function Try() {
  const [modeId, setModeId] = useParam('m', 'chain', (raw) => (MODES.some((item) => item.id === raw) ? raw : 'chain'));
  const [nText, setN] = useParam('n', '4', (raw) => String(Math.max(2, Math.min(6, Math.trunc(Number(raw)) || 4))));
  const [req, setReq] = useParam('req', encodeRequests(REQUESTS));
  const [from, setFrom] = useParam('cf', 'stop', (raw) => (raw === '0' ? '0' : 'stop'));
  const [prio, setPrio] = useParam('pr', '');
  const [mask, setMask] = useParam('mask', '');
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const mode = MODES.find((item) => item.id === modeId)!.mode;
  const n = Number(nText);
  const [draft, setDraft] = useState({ req: showRequests(readRequests(req) ?? []), prio: readList(prio).join(' '), mask: readList(mask).join(' ') });
  useEffect(() => setDraft({ req: showRequests(readRequests(req) ?? []), prio: readList(prio).join(' '), mask: readList(mask).join(' ') }), [req, prio, mask]);
  const [problems, setProblems] = useState<string[]>([]);

  const build = (text: { req: string; prio: string; mask: string }): { params: Params | null; problems: string[] } => {
    const requests = readRequests(text.req.replace(/；/g, ','));
    if (!requests) return { params: null, problems: ['请求写成「设备 时刻 占用周期」，几组之间用分号隔开，例如 2 0 2；3 0 1'] };
    const params: Params = { mode, devices: n, requests };
    if (mode === '计数器定时查询') params.counterFrom = (from === '0' ? '0' : '中止点') as CounterFrom;
    if (mode === '独立请求') {
      const order = readList(text.prio);
      if (order.length) params.priority = order;
      const masked = readList(text.mask);
      if (masked.length) params.masked = masked;
    }
    const issues = validateParams(params);
    return issues.length ? { params: null, problems: issues } : { params, problems: [] };
  };
  const read = useMemo(() => build({ req: showRequests(readRequests(req) ?? []), prio, mask }), [req, prio, mask, mode, n, from]);
  const compare = useMemo(() => {
    if (!read.params) return null;
    const base = { devices: n, requests: read.params.requests };
    return [
      { label: '链式查询', result: run({ ...base, mode: '链式查询' }).result },
      { label: '计数器从 0', result: run({ ...base, mode: '计数器定时查询', counterFrom: '0' }).result },
      { label: '计数器从中止点', result: run({ ...base, mode: '计数器定时查询', counterFrom: '中止点' }).result },
    ];
  }, [read, n]);

  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = build(draft);
    setProblems(checked.problems);
    if (!checked.params) return;
    setStep(0);
    setReq(encodeRequests(checked.params.requests));
    setPrio((checked.params.priority ?? []).join(''));
    setMask((checked.params.masked ?? []).join(''));
  };

  return (
    <>
      <form class="mk-form" onSubmit={submit}>
        <div class="field mk-wide">
          <span class="field-label" id="ar-mode">方式</span>
          <div class="seg" role="group" aria-labelledby="ar-mode">
            {MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === modeId}
                onClick={() => {
                  if (item.id === modeId) return;
                  setStep(0);
                  setModeId(item.id);
                }}
              >
                {item.mode}
              </button>
            ))}
          </div>
        </div>
        <label class="field">
          <span class="field-label">设备数</span>
          <select
            class="select"
            value={nText}
            onChange={(e) => {
              setStep(0);
              setN(e.currentTarget.value);
            }}
          >
            {[2, 3, 4, 5, 6].map((k) => (
              <option key={k} value={String(k)}>
                {k} 台（接口 0–{k - 1}）
              </option>
            ))}
          </select>
        </label>
        {mode === '计数器定时查询' ? (
          <div class="field">
            <span class="field-label" id="ar-cf">计数起点</span>
            <div class="seg" role="group" aria-labelledby="ar-cf">
              <button type="button" aria-pressed={from === '0'} onClick={() => (setStep(0), setFrom('0'))}>
                每轮从 0
              </button>
              <button type="button" aria-pressed={from !== '0'} onClick={() => (setStep(0), setFrom('stop'))}>
                从中止点
              </button>
            </div>
          </div>
        ) : null}
        {mode === '独立请求' ? (
          <>
            <label class="field">
              <span class="field-label">优先次序，高到低</span>
              <input class="input is-mono" inputMode="numeric" autoComplete="off" placeholder="3 2 1 0" value={draft.prio} onInput={(e) => setDraft({ ...draft, prio: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="field-label">屏蔽的设备</span>
              <input class="input is-mono" inputMode="numeric" autoComplete="off" placeholder="1" value={draft.mask} onInput={(e) => setDraft({ ...draft, mask: e.currentTarget.value })} />
            </label>
          </>
        ) : null}
        <label class="field mk-wide">
          <span class="field-label">请求：设备 时刻 占用周期</span>
          <input class="input is-mono" autoComplete="off" spellcheck={false} placeholder="2 0 2；3 0 1" value={draft.req} onInput={(e) => setDraft({ ...draft, req: e.currentTarget.value })} />
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
      {compare ? (
        <dl class="mk-compare">
          {compare.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd class="mono">
                {item.result['授权次序']}，等待 {item.result['等待合计']}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {read.params ? <ArbPlayer params={read.params} /> : null}
    </>
  );
}

/** 练习：按种子出一串请求，在答题纸上逐轮填「时刻」和「获得总线」。判分对引擎的解题表。 */
function Practice() {
  const [seed, setSeed] = useSeed();
  const params = useMemo(() => generate(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const rows = trace.table.rows;
  const [, setTab] = useParam('t', 'learn');
  const [, setModeId] = useParam('m', 'chain');
  const [, setN] = useParam('n', '4');
  const [, setReq] = useParam('req', '');
  const [, setFrom] = useParam('cf', 'stop');
  const [, setPrio] = useParam('pr', '');
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const options = useMemo(() => [...Array.from({ length: params.devices }, (_, i) => `设备 ${i}`), '无'], [params]);
  const columns = useMemo(() => [{ title: '时刻', width: 1.1 }, { title: '获得总线', width: 1.6 }], []);
  const labels = useMemo(() => rows.map((row) => row.cells[0] ?? ''), [rows]);
  const answer: Entry[] = rows.map((row) => ({ at: row.cells[1] ?? '', who: row.cells[4] ?? '' }));

  const grade = (entries: Entry[]): PaperMiss[] => {
    const misses: PaperMiss[] = [];
    rows.forEach((row, r) => {
      const e = entries[r] ?? {};
      if ((e.at ?? '').trim() === '' || Number(e.at) !== Number(row.cells[1])) {
        misses.push({ row: r, field: 'at', message: `第 ${r + 1} 轮开始的时刻不对。上一个主方用完、BS 清 0 的那一刻，或者有请求到来的那一刻，取晚的。` });
      }
      if ((e.who ?? '') !== row.cells[4]) {
        const hint =
          params.mode === '链式查询'
            ? 'BG 从接口 0 往下传，第一个有请求的接口截住。'
            : params.mode === '计数器定时查询'
              ? params.counterFrom === '0'
                ? '每轮从 0 计，先数到的有请求的设备赢。'
                : '从上一轮停下的下一个值接着计，先数到的有请求的设备赢。'
              : '排队电路按优先次序选，被屏蔽的不参加。';
        misses.push({ row: r, field: 'who', message: `第 ${r + 1} 轮谁得到总线不对。先列出这一刻还在等的设备，再看：${hint}` });
      }
    });
    return misses;
  };

  const demo = (row: number) => {
    const target = rows[row]?.step;
    const at = target ? trace.steps.findIndex((step) => step.id === target) : 0;
    // 停在这一轮登记请求的那一步。
    let start = at;
    while (start > 0 && !trace.steps[start]!.title.startsWith('t=')) start--;
    setModeId(MODES.find((item) => item.mode === params.mode)!.id);
    setN(String(params.devices));
    setReq(encodeRequests(params.requests));
    if (params.counterFrom) setFrom(params.counterFrom === '0' ? '0' : 'stop');
    setPrio((params.priority ?? []).join(''));
    setStep(start + 1);
    setTab('try');
  };

  return (
    <Paper
      key={seed}
      draftKey={`coa:6-arbiter:quiz:${seed}`}
      seed={seed}
      task={<p>按下面的请求，逐轮写出这一轮仲裁的时刻和得到总线的设备。总线占用期间不被打断。</p>}
      conditions={trace.conditions}
      title="仲裁过程"
      columns={columns}
      labels={labels}
      heads={labels.map((label) => `第 ${label} 轮`)}
      fields={() => [
        { key: 'at', label: '时刻', mono: true, inputMode: 'numeric', placeholder: '0' },
        { key: 'who', label: '获得总线', kind: 'choice', options },
      ]}
      cells={(entry) => [entry.at ?? '', entry.who ?? '']}
      columnOf={(field) => (field === 'at' ? 0 : 1)}
      answer={answer}
      grade={grade}
      done={`授权次序 ${trace.result['授权次序']}，等待合计 ${trace.result['等待合计']} 个周期。`}
      onNext={() => setSeed(seed + 1)}
      onDemo={demo}
    />
  );
}

/** 弄坏它：链上一个接口传 BG 的电路坏了。 */
function Break() {
  const [bText, setB] = useParam('b', '1', (raw) => (['0', '1', '2'].includes(raw) ? raw : '1'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const broken = Number(bText);
  const params = useMemo<Params>(() => ({ mode: '链式查询', devices: 4, requests: REQUESTS, broken }), [broken]);
  const result = useMemo(() => run(params).result, [params]);
  return (
    <>
      <div class="mk-controls">
        <div class="seg" role="group" aria-label="弄坏哪个接口">
          {[0, 1, 2].map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === broken}
              onClick={() => {
                setStep(0);
                setB(String(k));
              }}
            >
              接口 {k} 传 BG 的电路坏了
            </button>
          ))}
        </div>
        <p class="mk-note">
          请求和讲解的例题相同。坏了以后授权次序是 <span class="mono">{result['授权次序']}</span>，得不到总线的是 <span class="mono">{result['得不到总线'] ?? '无'}</span>。真实机器里这些设备的 BR
          一直挂着，仲裁器每轮都发 BG，却总在坏点停下；这就是链式查询「对电路故障敏感」的意思（教材 p212）。
        </p>
      </div>
      <ArbPlayer params={params} />
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
