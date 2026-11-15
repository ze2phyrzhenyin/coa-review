import { useMemo } from 'preact/hooks';
import { useIntParam, useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { generate, hex, run } from '../../engines/intr/model';
import type { Device, Params, State } from '../../engines/intr/model';
import type { Trace } from '../../engines/trace';
import { Player } from '../../player/Player';
import type { Breakage } from '../../player/Player';
import { Paper } from '../8-mask/Paper';
import type { Entry, PaperMiss } from '../8-mask/Paper';
import { PageTabs, plainAsks, useSeed } from '../8-mask/shared';
import { INTR_CONCLUSION, INTR_NEEDS, INTR_QUESTION, intrStage } from './scene';
import '../8-mask/mask.css';

const NAMES = ['打印机', '扫描仪', '磁盘'];
const ENTRIES = [0x2400, 0x2a00, 0x3180];
const device = (i: number, rd: 0 | 1, ei: 0 | 1): Device => ({ name: NAMES[i]!, ei, rd, vector: 0x0020 + 2 * i, entry: ENTRIES[i]! });

/** 讲解：两台设备都准备好、都允许中断；第二道只把 IM 改成 1。 */
const base: Params = {
  devices: [device(0, 1, 1), device(1, 1, 1)],
  im: 0,
  pc: 0x0137,
  regs: [
    { name: 'R1', value: 0x0045 },
    { name: 'R2', value: 0x1c20 },
  ],
  data: 88,
};
const EXAMPLES: { id: string; label: string; params: Params }[] = [
  { id: 'a', label: 'IM = 0', params: base },
  { id: 'b', label: 'IM = 1（中断关着）', params: { ...base, im: 1 } },
];

function useIntr(params: Params, quiet = false) {
  const narrow = useNarrow();
  const key = JSON.stringify(params);
  return useMemo(() => {
    const raw = plainAsks(run(params));
    // 「由谁完成」的题出在这一步发生之前：题面写出问的是哪一步。
    const full = { ...raw, steps: raw.steps.map((step) => (step.ask?.options?.includes('硬件') ? { ...step, ask: { ...step.ask, prompt: `下一步是「${step.state.box}」，它由谁完成` } } : step)) };
    // 弄坏它不出题：舞台下方留给「跳过」按钮。
    const trace = quiet ? { ...full, steps: full.steps.map(({ ask: _ask, ...step }) => step) } : full;
    return { trace, stage: intrStage(trace, narrow) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow, quiet]);
}

function IntrPlayer({ params, lesson, breakIt }: { params: Params; lesson?: boolean; breakIt?: (trace: Trace<Params, State>) => (state: State, part: string | null) => Breakage | null }) {
  const { trace, stage } = useIntr(params, !!breakIt);
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
      askFrame={stage.askFrame}
      frame={stage.frame}
      onWrong={stage.wrong}
      convention={stage.convention}
      breakIt={broken}
      {...(lesson ? { question: INTR_QUESTION, conclusion: INTR_CONCLUSION, needs: INTR_NEEDS, mistakes: stage.mistakes } : {})}
    />
  );
}

function Legend() {
  return (
    <p class="mk-terms">
      台面上：一条指令执行完，CPU 在<Term k="公操作" />里查有没有中断请求。接口里的 <Term k="BS">BS</Term> 为 1 表示设备在工作（服务完和 RD 一起清 0）， <Term k="RD">RD</Term> 是准备就绪、<Term k="EI">EI</Term> 是允许中断；CPU 里的 <Term k="中断请求触发器">IR</Term> 收请求，<Term k="中断屏蔽触发器">IM</Term> 为 1 是关中断。
      <Term k="断点" />写在主程序那张卡的卡角上，<Term k="现场" />进堆栈。右下三栏按图 8.6 排，<Term k="中断周期" />一栏全是硬件。
    </p>
  );
}

function Learn() {
  const ids = EXAMPLES.map((item) => item.id);
  const [ex, setEx] = useParam('ex', 'a', (raw) => (ids.includes(raw) ? raw : 'a'));
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
      <IntrPlayer params={example.params} lesson />
      <div class="mk-controls">
        <p class="mk-note">
          两道例题只差请求到来时的 IM。断点：
          {results.map((item, i) => (
            <span key={item.label}>
              {i > 0 ? '；' : ''}
              {item.label} 时 <span class="mono">{item.result['断点']}</span>
            </span>
          ))}
          。IM=1 时要先执行一条开中断指令，断点跟着后移一条。
        </p>
        <Legend />
      </div>
    </>
  );
}

const bit = (raw: string, i: number): 0 | 1 => (raw[i] === '0' ? 0 : 1);

function Try() {
  const [dnText, setDn] = useParam('dn', '2', (raw) => String(Math.max(1, Math.min(3, Math.trunc(Number(raw)) || 2))));
  const [rd, setRd] = useParam('rd', '11');
  const [ei, setEi] = useParam('ei', '11');
  const [imText, setIm] = useParam('im', '0', (raw) => (raw === '1' ? '1' : '0'));
  const [rgText, setRg] = useParam('rg', '2', (raw) => String(Math.max(1, Math.min(3, Math.trunc(Number(raw)) || 2))));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const dn = Number(dnText);
  const params = useMemo<Params>(
    () => ({
      devices: Array.from({ length: dn }, (_, i) => device(i, bit(rd, i), bit(ei, i))),
      im: imText === '1' ? 1 : 0,
      pc: base.pc,
      regs: [
        { name: 'R1', value: 0x0045 },
        { name: 'R2', value: 0x1c20 },
        { name: 'R3', value: 0x0a0b },
      ].slice(0, Number(rgText)),
      data: base.data,
    }),
    [dn, rd, ei, imText, rgText],
  );
  const flip = (raw: string, i: number) => Array.from({ length: 3 }, (_, k) => (k === i ? (bit(raw, k) ? '0' : '1') : String(bit(raw, k)))).join('');
  const result = useMemo(() => run(params).result, [params]);
  return (
    <>
      <div class="mk-form">
        <label class="field">
          <span class="field-label">链上设备</span>
          <select class="select" value={dnText} onChange={(e) => (setStep(0), setDn(e.currentTarget.value))}>
            {[1, 2, 3].map((k) => (
              <option key={k} value={String(k)}>
                {k} 台
              </option>
            ))}
          </select>
        </label>
        <div class="field">
          <span class="field-label" id="it-im">请求到来时的 IM</span>
          <div class="seg" role="group" aria-labelledby="it-im">
            <button type="button" aria-pressed={imText === '0'} onClick={() => (setStep(0), setIm('0'))}>
              0 开中断
            </button>
            <button type="button" aria-pressed={imText === '1'} onClick={() => (setStep(0), setIm('1'))}>
              1 关中断
            </button>
          </div>
        </div>
        <label class="field">
          <span class="field-label">要保存的寄存器</span>
          <select class="select" value={rgText} onChange={(e) => (setStep(0), setRg(e.currentTarget.value))}>
            {[1, 2, 3].map((k) => (
              <option key={k} value={String(k)}>
                {['R1', 'R1、R2', 'R1、R2、R3'][k - 1]}
              </option>
            ))}
          </select>
        </label>
        {Array.from({ length: dn }, (_, i) => (
          <div class="field" key={i}>
            <span class="field-label" id={`it-d${i}`}>
              接口 {i}：{NAMES[i]}
            </span>
            <div class="seg" role="group" aria-labelledby={`it-d${i}`}>
              <button type="button" aria-pressed={bit(rd, i) === 1} onClick={() => (setStep(0), setRd(flip(rd, i)))}>
                RD={bit(rd, i)}
              </button>
              <button type="button" aria-pressed={bit(ei, i) === 1} onClick={() => (setStep(0), setEi(flip(ei, i)))}>
                EI={bit(ei, i)}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p class="mk-note">
        响应的设备 <span class="mono">{result['响应的设备']}</span>
        {result['断点'] ? (
          <>
            ，断点 <span class="mono">{result['断点']}</span>，入口 <span class="mono">{result['入口地址']}</span>
          </>
        ) : (
          <>，没有中断，PC 走到 <span class="mono">{result['PC']}</span></>
        )}
        {result['仍在请求'] ? `；${result['仍在请求']} 仍在请求` : ''}。
      </p>
      <IntrPlayer params={params} />
    </>
  );
}

/** 谁做：引擎的写法 → 答题纸上的三选一。 */
const whoOf = (text: string): string => (text.startsWith('硬件') ? '硬件' : text.startsWith('软件') ? '软件' : '接口');

function Practice() {
  const [seed, setSeed] = useSeed();
  const params = useMemo(() => generate(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const rows = trace.table.rows;
  const [, setTab] = useParam('t', 'learn');
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const columns = useMemo(() => [{ title: '操作', width: 4.9 }, { title: '谁做', width: 1.1 }, { title: 'IM', width: 0.7 }], []);
  const labels = useMemo(() => rows.map((row) => row.cells[0] ?? ''), [rows]);
  const answer: Entry[] = rows.map((row) => ({ who: whoOf(row.cells[2] ?? ''), im: row.cells[3] ?? '' }));
  const grade = (entries: Entry[]): PaperMiss[] => {
    const misses: PaperMiss[] = [];
    rows.forEach((row, r) => {
      const e = entries[r] ?? {};
      const who = whoOf(row.cells[2] ?? '');
      if (e.who !== who) {
        misses.push({
          row: r,
          field: 'who',
          message: `「${row.cells[1]}」由谁做不对。中断周期里的响应、关中断、找中断源、保存断点、转移是硬件；服务程序里的每一步是软件。`,
        });
      }
      if ((e.im ?? '') !== row.cells[3]) {
        misses.push({ row: r, field: 'im', message: `「${row.cells[1]}」做完时的 IM 不对。关中断那一步起 IM=1，直到服务程序末尾开中断。` });
      }
    });
    return misses;
  };
  const conditions = trace.conditions.filter((c) => c.label !== '缓冲寄存器');
  return (
    <Paper
      key={seed}
      draftKey={`coa:8-intr:quiz:${seed}`}
      seed={seed}
      task={<p>按图 8.6 的次序，给每一步填上由谁完成（硬件、软件，最后一行可能是接口），以及这一步做完时 IM 的值。</p>}
      conditions={conditions}
      title="一次中断的过程"
      columns={columns}
      labels={labels}
      heads={rows.map((row) => row.cells[1] ?? '')}
      fields={() => [
        { key: 'who', label: '谁做', kind: 'choice', options: ['硬件', '软件', '接口'] },
        { key: 'im', label: 'IM', kind: 'choice', options: ['0', '1'] },
      ]}
      cells={(entry, r) => [rows[r]?.cells[1] ?? '', entry.who ?? '', entry.im ?? '']}
      columnOf={(field) => (field === 'who' ? 1 : 2)}
      answer={answer}
      grade={grade}
      done={`响应 ${trace.result['响应的设备']}，断点 ${trace.result['断点'] ?? '—'}，返回后 PC = ${trace.result['返回后 PC'] ?? trace.result['PC']}。`}
      onNext={() => setSeed(seed + 1)}
      onDemo={(row) => {
        const target = rows[row]?.step;
        const at = target ? trace.steps.findIndex((step) => step.id === target) : 0;
        setStep(Math.max(0, at));
        setTab('learn');
      }}
    />
  );
}

/** 弄坏它：跳过一步硬件或软件的保护动作，看后果。 */
const BREAKS = [
  { id: 'im', label: '不关中断', box: '关中断' },
  { id: 'pc', label: '不保存断点', box: '保存断点' },
  { id: 'regs', label: '不保存现场', box: '保存现场' },
] as const;

function Break() {
  const [which, setWhich] = useParam('b', 'regs', (raw) => (BREAKS.some((item) => item.id === raw) ? raw : 'regs'));
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const chosen = BREAKS.find((item) => item.id === which)!;
  const trace = useMemo(() => run(base), []);
  const at = trace.steps.findIndex((step) => step.state.box === chosen.box);
  const breakIt = useMemo(
    () => (t: Trace<Params, State>) => (state: State, part: string | null): Breakage | null => {
      void part;
      // 停在这一步之前：学生跳过它。
      const k = t.steps.findIndex((step) => step.state.box === chosen.box);
      if (k < 1 || state.box !== t.steps[k - 1]!.state.box) return null;
      const final = t.steps.at(-1)!.state;
      const other = base.devices[1]!;
      if (chosen.id === 'im') {
        return {
          label: '不关中断，接着走',
          patch: {
            IM: { value: '0' },
            cards: { cards: [{ title: '主程序', note: '断点？' }, { title: `${other.name}服务程序` }] },
            stack: { rows: [['断点', hex(state.pc)], ['断点', hex(state.pc)], ['', '']] },
          },
          moves: [{ value: 'INTR', from: 'D1', to: 'CPU', arc: true, shape: 'level' }],
          message: `IM 还是 0，${other.name}的请求还挂在请求线上。服务程序还没开始，CPU 又一次响应，同一个断点进栈两次，${base.devices[0]!.name}的服务程序一条指令都没执行就被顶掉。关中断必须由硬件在中断周期里立刻做（教材 p266）。`,
        };
      }
      if (chosen.id === 'pc') {
        return {
          label: '不保存断点，接着走',
          patch: { stack: { rows: [['', ''], ['', ''], ['', '']] }, cards: { cards: [{ title: '主程序', note: '断点？' }] } },
          moves: [{ value: hex(base.devices[0]!.entry), from: 'CPU', to: 'PC', arc: true, ink: 'addr' }],
          message: `下一步 PC 就被换成入口 ${hex(base.devices[0]!.entry)}，${hex(state.pc)} 再也找不回来。中断返回时栈里弹出的是别的东西，主程序跳到一个随便的地址。`,
        };
      }
      return {
        label: '不保存现场，接着走',
        patch: {
          regs: { rows: [[hex(base.data)], [hex(final.regs['R2'] ?? 0)]], changedCells: ['0.0'] },
          stack: { rows: [['断点', hex(state.stack[0]?.value ?? 0)], ['', ''], ['', '']] },
        },
        moves: [{ value: String(base.data), from: 'D0', to: 'regs.0.0', arc: true }],
        message: `服务程序把数据 ${base.data} 读进 R1，主程序原来的 R1 = ${hex(base.regs[0]!.value)} 没有存，返回后也取不回来。主程序接着拿 R1 算，结果错了，而且没有任何报错。`,
      };
    },
    [chosen],
  );
  return (
    <>
      <div class="mk-controls">
        <div class="seg" role="group" aria-label="跳过哪一步">
          {BREAKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === which}
              onClick={() => {
                setWhich(item.id);
                setStep(trace.steps.findIndex((step) => step.state.box === item.box));
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p class="mk-note">停在「{chosen.box}」之前（第 {at} 步），点舞台下方的按钮跳过这一步，看接下来会怎样。</p>
      </div>
      <IntrPlayer key={which} params={base} breakIt={breakIt} />
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
