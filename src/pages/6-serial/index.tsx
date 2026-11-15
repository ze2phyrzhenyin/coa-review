import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useIntParam, useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { generate, run, validateParams } from '../../engines/serial/model';
import type { BusParams, FrameParams, FrameState, Params, Parity, State } from '../../engines/serial/model';
import type { Trace } from '../../engines/trace';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { Paper } from '../8-mask/Paper';
import type { Entry, PaperMiss } from '../8-mask/Paper';
import { PageTabs, plainAsks, useSeed } from '../8-mask/shared';
import { SERIAL_CONCLUSION, SERIAL_NEEDS, serialStage, slotName } from './scene';
import '../8-mask/mask.css';

/** 讲解：字符 m（7 位，偶校验，2 位停止位，每秒 200 个字符）；变式只把偶校验换成奇校验；再算一条并行总线的带宽。 */
const FRAME: FrameParams = { task: '串行帧', code: 0x6d, char: 'm', dataBits: 7, parity: '偶', stopBits: 2, charRate: 200 };
const BUS: BusParams = { task: '总线带宽', widthBits: 64, freqMHz: 100, clocksPerCycle: 2 };
const EXAMPLES: { id: string; label: string; params: Params }[] = [
  { id: 'even', label: '偶校验', params: FRAME },
  { id: 'odd', label: '只换成奇校验', params: { ...FRAME, parity: '奇' } },
  { id: 'bus', label: '总线带宽', params: BUS },
];

/** 引擎把带宽写成 Dr；页面上排成 D 带下标 r，和教材一致。 */
const sub = (text: string): string => text.replace(/\bDr\b/g, 'D_r');
function typeset<T extends Trace<Params, State>>(trace: T): T {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({ ...step, title: sub(step.title), why: sub(step.why) })),
    table: { ...trace.table, rows: trace.table.rows.map((row) => ({ ...row, cells: row.cells.map(sub) })) },
  };
}

function useSerial(params: Params, quiet = false) {
  const narrow = useNarrow();
  const key = JSON.stringify(params);
  return useMemo(() => {
    const full = typeset(plainAsks(run(params)));
    const trace = quiet ? { ...full, steps: full.steps.map(({ ask: _ask, ...step }) => step) } : full;
    return { trace, stage: serialStage(trace, narrow) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow, quiet]);
}

function SerialPlayer({ params, lesson, breakIt }: { params: Params; lesson?: boolean; breakIt?: (trace: Trace<Params, State>) => (state: State, part: string | null) => Breakage | null }) {
  const { trace, stage } = useSerial(params, !!breakIt);
  const broken = useMemo(() => breakIt?.(trace), [breakIt, trace]);
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
      breakIt={broken}
      {...(lesson ? { question: stage.question, conclusion: SERIAL_CONCLUSION, needs: SERIAL_NEEDS, mistakes: stage.mistakes } : {})}
    />
  );
}

function Legend() {
  return (
    <p class="mk-terms">
      台面上：波形的上一道是 1，下一道是 0，每一段占一个<Term k="位时间" />。<Term k="起始位" />是 0，<Term k="停止位" />是 1，中间是从最低位开始的数据位和<Term k="校验位" />。
      <Term k="波特率" />是每秒传的位数；<Term k="总线带宽" /> <Rich text="D_r = D ÷ T" />。
    </p>
  );
}

function Learn() {
  const ids = EXAMPLES.map((item) => item.id);
  const [ex, setEx] = useParam('ex', 'even', (raw) => (ids.includes(raw) ? raw : 'even'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const example = EXAMPLES.find((item) => item.id === ex) ?? EXAMPLES[0]!;
  const frames = useMemo(() => EXAMPLES.slice(0, 2).map((item) => ({ label: item.label, result: run(item.params).result })), []);
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
      <SerialPlayer params={example.params} lesson />
      <div class="mk-controls">
        <p class="mk-note">
          前两道只差校验方式。帧（发送次序）：
          {frames.map((item, i) => (
            <span key={item.label}>
              {i > 0 ? '；' : ''}
              {item.label} <span class="mono">{item.result['帧']}</span>
            </span>
          ))}
          ，只有校验位那一位不同，每帧位数和速率都不变。
        </p>
        <Legend />
      </div>
    </>
  );
}

const PARITIES: Parity[] = ['无', '奇', '偶'];

function Try() {
  const [task, setTask] = useParam('task', 'frame', (raw) => (raw === 'bus' ? 'bus' : 'frame'));
  const [ch, setCh] = useParam('ch', 'm');
  const [dbText, setDb] = useParam('db', '7', (raw) => String(Math.max(5, Math.min(8, Math.trunc(Number(raw)) || 7))));
  const [par, setPar] = useParam('par', '偶', (raw) => (PARITIES.includes(raw as Parity) ? raw : '偶'));
  const [sbText, setSb] = useParam('sb', '2', (raw) => (raw === '1' ? '1' : '2'));
  const [by, setBy] = useParam('by', 'char', (raw) => (raw === 'baud' ? 'baud' : 'char'));
  const [rateText, setRate] = useParam('rate', '200');
  const [wText, setW] = useParam('w', '64');
  const [fText, setF] = useParam('f', '100');
  const [cText, setC] = useParam('c', '2', (raw) => String(Math.max(1, Math.min(16, Math.trunc(Number(raw)) || 2))));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const [draft, setDraft] = useState({ ch, rate: rateText, f: fText });
  useEffect(() => setDraft({ ch, rate: rateText, f: fText }), [ch, rateText, fText]);

  const dataBits = Number(dbText) as 5 | 6 | 7 | 8;
  const params = useMemo((): { params: Params | null; problems: string[] } => {
    if (task === 'bus') {
      const p: BusParams = { task: '总线带宽', widthBits: Number(wText), freqMHz: Number(fText), clocksPerCycle: Number(cText) };
      const issues = validateParams(p);
      return issues.length ? { params: null, problems: issues } : { params: p, problems: [] };
    }
    const char = [...ch][0] ?? '';
    const code = char ? (char.codePointAt(0) ?? 0) : 0;
    if (!char) return { params: null, problems: ['写一个字符'] };
    if (code >= 2 ** dataBits) return { params: null, problems: [`「${char}」的编码 ${code} 放不进 ${dataBits} 位，换一个字符或加数据位`] };
    const p: FrameParams = { task: '串行帧', code, char, dataBits, parity: par as Parity, stopBits: sbText === '1' ? 1 : 2 };
    const rate = Number(rateText);
    if (rateText.trim() !== '') {
      if (by === 'baud') p.baud = rate;
      else p.charRate = rate;
    }
    const issues = validateParams(p);
    return issues.length ? { params: null, problems: issues } : { params: p, problems: [] };
  }, [task, ch, dataBits, par, sbText, by, rateText, wText, fText, cText]);

  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStep(0);
    setCh(draft.ch.trim());
    setRate(draft.rate.trim());
    setF(draft.f.trim());
  };
  const reset = (fn: () => void) => () => {
    setStep(0);
    fn();
  };

  return (
    <>
      <form class="mk-form" onSubmit={submit}>
        <div class="field mk-wide">
          <span class="field-label" id="sr-task">算什么</span>
          <div class="seg" role="group" aria-labelledby="sr-task">
            <button type="button" aria-pressed={task === 'frame'} onClick={reset(() => setTask('frame'))}>
              串行帧
            </button>
            <button type="button" aria-pressed={task === 'bus'} onClick={reset(() => setTask('bus'))}>
              总线带宽
            </button>
          </div>
        </div>
        {task === 'frame' ? (
          <>
            <label class="field">
              <span class="field-label">字符</span>
              <input class="input is-mono" autoComplete="off" spellcheck={false} maxLength={2} value={draft.ch} onInput={(e) => setDraft({ ...draft, ch: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="field-label">数据位</span>
              <select class="select" value={dbText} onChange={(e) => reset(() => setDb(e.currentTarget.value))()}>
                {[5, 6, 7, 8].map((k) => (
                  <option key={k} value={String(k)}>
                    {k} 位
                  </option>
                ))}
              </select>
            </label>
            <div class="field">
              <span class="field-label" id="sr-par">校验</span>
              <div class="seg" role="group" aria-labelledby="sr-par">
                {PARITIES.map((item) => (
                  <button key={item} type="button" aria-pressed={par === item} onClick={reset(() => setPar(item))}>
                    {item === '无' ? '无校验' : `${item}校验`}
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="field-label" id="sr-sb">停止位</span>
              <div class="seg" role="group" aria-labelledby="sr-sb">
                {['1', '2'].map((item) => (
                  <button key={item} type="button" aria-pressed={sbText === item} onClick={reset(() => setSb(item))}>
                    {item} 位
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="field-label" id="sr-by">给出</span>
              <div class="seg" role="group" aria-labelledby="sr-by">
                <button type="button" aria-pressed={by === 'char'} onClick={reset(() => setBy('char'))}>
                  字符速率
                </button>
                <button type="button" aria-pressed={by === 'baud'} onClick={reset(() => setBy('baud'))}>
                  波特率
                </button>
              </div>
            </div>
            <label class="field">
              <span class="field-label">{by === 'baud' ? '波特率（位/秒）' : '字符速率（字符/秒）'}</span>
              <input class="input is-mono" inputMode="decimal" autoComplete="off" value={draft.rate} onInput={(e) => setDraft({ ...draft, rate: e.currentTarget.value })} />
            </label>
          </>
        ) : (
          <>
            <label class="field">
              <span class="field-label">数据线宽</span>
              <select class="select" value={wText} onChange={(e) => reset(() => setW(e.currentTarget.value))()}>
                {[8, 16, 32, 64, 128].map((k) => (
                  <option key={k} value={String(k)}>
                    {k} 位
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span class="field-label">时钟频率（MHz）</span>
              <input class="input is-mono" inputMode="decimal" autoComplete="off" value={draft.f} onInput={(e) => setDraft({ ...draft, f: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="field-label">一个总线周期占</span>
              <select class="select" value={cText} onChange={(e) => reset(() => setC(e.currentTarget.value))()}>
                {[1, 2, 3, 4].map((k) => (
                  <option key={k} value={String(k)}>
                    {k} 个时钟周期
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="submit" class="btn is-primary mk-run">
          换上
        </button>
        {params.problems[0] ? (
          <p class="field-error mk-wide" role="alert">
            {params.problems[0]}
          </p>
        ) : null}
      </form>
      {params.params ? <SerialPlayer params={params.params} /> : null}
    </>
  );
}

/** 结果一格的读法：去掉单位、≈ 和空格；数按数值比。 */
const norm = (text: string): string => text.replace(/≈|波特|字符\/秒|位\/秒|MB\/s|ms|ns|B|位|\s/g, '');
const same = (written: string, want: string): boolean => {
  const a = norm(written);
  const b = norm(want);
  if (a === '' || b === '') return false;
  if (/^[01]+$/.test(b)) return a === b;
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) <= Math.max(1e-9, Math.abs(y) * 5e-4);
  return a === b;
};

function Practice() {
  const [seed, setSeed] = useSeed();
  // 三题里两题串行帧、一题总线带宽。
  const params = useMemo(() => generate(seed, seed % 3 === 0 ? '总线带宽' : '串行帧'), [seed]);
  const trace = useMemo(() => typeset(run(params)), [params]);
  const rows = trace.table.rows;
  const [, setTab] = useParam('t', 'learn');
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const [, setTask] = useParam('task', 'frame');
  const [, setCh] = useParam('ch', 'm');
  const [, setDb] = useParam('db', '7');
  const [, setPar] = useParam('par', '偶');
  const [, setSb] = useParam('sb', '2');
  const [, setBy] = useParam('by', 'char');
  const [, setRate] = useParam('rate', '200');
  const [, setW] = useParam('w', '64');
  const [, setF] = useParam('f', '100');
  const [, setC] = useParam('c', '2');
  const columns = useMemo(() => [{ title: '项目', width: 2.0 }, { title: '结果', width: 3.2 }], []);
  const labels = useMemo(() => rows.map((_, r) => String(r + 1)), [rows]);
  const answer: Entry[] = rows.map((row) => ({ value: row.cells[2] ?? '' }));
  const grade = (entries: Entry[]): PaperMiss[] =>
    rows.flatMap((row, r) => {
      const written = entries[r]?.value ?? '';
      if (same(written, row.cells[2] ?? '')) return [];
      const item = row.cells[0] ?? '';
      const hint: Record<string, string> = {
        字符编码: '把编码写成二进制，位数按数据位补足，高位在左。',
        校验位: '数一数编码里 1 的个数，再看总数要奇还是要偶。',
        发送次序: '起始位 0，数据从 D0 起，校验位，停止位 1；可以分组写。',
        每帧位数: '起始位、数据位、校验位、停止位都算。',
        波特率: '字符速率乘每帧位数。',
        字符速率: '波特率除以每帧位数。',
        每位时间: '波特率的倒数，写成 ms。',
        有效数据率: '字符速率乘数据位数。',
        D: '位数除以 8，单位字节。',
        T: '一个总线周期占几个时钟，乘时钟周期 1 ÷ f。',
      };
      const key = Object.keys(hint).find((k) => (k.length === 1 ? item === k : item.startsWith(k))) ?? '';
      return [{ row: r, field: 'value', message: `「${item}」不对。${hint[key] ?? 'D_r = D ÷ T，M 取 10^6。'}` }];
    });
  const demo = (row: number) => {
    const target = rows[row]?.step;
    const at = target ? trace.steps.findIndex((step) => step.id === target) : 0;
    if (params.task === '总线带宽') {
      setTask('bus');
      setW(String(params.widthBits));
      setF(String(params.freqMHz));
      setC(String(params.clocksPerCycle));
    } else {
      setTask('frame');
      setCh(params.char ?? String.fromCharCode(params.code));
      setDb(String(params.dataBits));
      setPar(params.parity);
      setSb(String(params.stopBits));
      setBy(params.baud !== undefined ? 'baud' : 'char');
      setRate(String(params.baud ?? params.charRate ?? ''));
    }
    setStep(Math.max(0, at));
    setTab('try');
  };
  const task =
    params.task === '总线带宽'
      ? '按条件逐行写出 D、总线周期 T 和带宽 D_r。数带单位，非整数写 4 位有效数字。'
      : `把字符${params.char ? `「${params.char}」` : ''}按下面的格式串行发送，逐行写出结果。位串高位在左（发送次序一行按发出的先后写）；数带单位，非整数写 4 位有效数字。`;
  return (
    <Paper
      key={seed}
      draftKey={`coa:6-serial:quiz:${seed}`}
      seed={seed}
      task={
        <p>
          <Rich text={task} />
        </p>
      }
      conditions={trace.conditions}
      title={params.task === '总线带宽' ? '带宽' : '串行帧'}
      columns={columns}
      labels={labels}
      heads={rows.map((row) => row.cells[0] ?? '')}
      fields={(r) => [{ key: 'value', label: rows[r]?.cells[0] ?? '结果', mono: true, inputMode: /编码|校验位|发送次序/.test(rows[r]?.cells[0] ?? '') ? 'numeric' : 'decimal' }]}
      cells={(entry, r) => [rows[r]?.cells[0] ?? '', entry.value ?? '']}
      columnOf={() => 1}
      answer={answer}
      grade={grade}
      done={Object.entries(trace.result)
        .map(([k, v]) => `${k} ${v}`)
        .join('，')}
      onNext={() => setSeed(seed + 1)}
      onDemo={demo}
    />
  );
}

/** 弄坏它：所有位都发出去之后，换一种错法看接收方收到什么。 */
const BREAKS = [
  { id: 'msb', label: '先发最高位' },
  { id: 'stop', label: '不发停止位' },
] as const;

function Break() {
  const [which, setWhich] = useParam('b', 'msb', (raw) => (BREAKS.some((item) => item.id === raw) ? raw : 'msb'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const full = useMemo(() => run(FRAME), []);
  const sentAll = full.steps.findIndex((step) => step.level === 'beat' && (step.state as FrameState).current === '停止位' && (step.state as FrameState).line.length === (full.steps.at(-1)!.state as FrameState).line.length) + 1;
  const breakIt = useMemo(
    () => (_t: Trace<Params, State>) => (state: State): Breakage | null => {
      const s = state as FrameState;
      const total = (full.steps.at(-1)!.state as FrameState).line.length;
      if (s.line.length !== total || s.frameLength !== null) return null;
      if (which === 'msb') {
        const sent = s.codeBits.split('');
        const got = [...sent].reverse().join('');
        const char = String.fromCharCode(parseInt(got, 2));
        const segments = s.line.map((bit, k) => {
          const data = k >= 1 && k <= FRAME.dataBits;
          const value = data ? Number(sent[k - 1]) : bit;
          return { lane: value === 1 ? 0 : 1, from: k, to: k + 1, ink: data ? ('accent' as const) : ('data' as const) };
        });
        const labels = Object.fromEntries(Array.from({ length: FRAME.dataBits }, (_, i) => [`n-${i + 1}`, { text: `D${FRAME.dataBits - 1 - i}` }]));
        return {
          label: '改成先发最高位',
          patch: { wave: { segments }, ...labels },
          moves: [{ value: sent[0]!, from: `c-${FRAME.dataBits - 1}`, to: 's-1', arc: true }],
          message: `发送方从 D${FRAME.dataBits - 1} 发起，接收方仍按低位在前拼回去，收到的是 ${got}，成了字符「${char}」。校验只数 1 的个数，个数没变，查不出这个错。`,
        };
      }
      // 停止位的第一个位置换成下一个字符的起始位 0，后面是下一个字符的数据，不画。
      const firstStop = s.line.findIndex((_, k) => slotName(FRAME, k) === '停');
      const segments = s.line.slice(0, firstStop + 1).map((bit, k) => {
        const stop = k === firstStop;
        return { lane: stop ? 1 : bit === 1 ? 0 : 1, from: k, to: k + 1, ink: stop ? ('accent' as const) : ('data' as const) };
      });
      const labels = Object.fromEntries(s.line.map((_, k) => [`n-${k}`, { text: k === firstStop ? '下一个起' : k > firstStop ? '' : slotName(FRAME, k) }]));
      return {
        label: '改成不发停止位',
        patch: { wave: { segments }, ...labels },
        moves: [{ value: '0', from: 'par', to: `s-${firstStop}`, arc: true }],
        message: '紧接着发下一个字符，停止位的位置上是下一个字符的起始位 0。接收方在该是 1 的地方读到 0，判为帧格式错，这个字符作废；线路也没有回到空闲，下一个字符的开头对不上。',
      };
    },
    [which, full],
  );
  return (
    <>
      <div class="mk-controls">
        <div class="seg" role="group" aria-label="弄坏哪里">
          {BREAKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === which}
              onClick={() => {
                setWhich(item.id);
                setStep(sentAll);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p class="mk-note">
          <Rich text={`讲解里的字符「m」，第 ${sentAll} 步整帧发完。点舞台下方的按钮，把这一帧换成错的发法，看接收方收到什么。`} />
        </p>
      </div>
      <SerialPlayer key={which} params={FRAME} breakIt={breakIt} />
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
