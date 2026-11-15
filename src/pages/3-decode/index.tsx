import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { run } from '../../engines/decode/model';
import type { Params, Region } from '../../engines/decode/model';
import { Player } from '../../player/Player';
import { Paper } from '../3-expand/Paper';
import { sub } from '../3-expand/scene';
import '../3-expand/expand.css';
import { breakTrace, breakage } from './break';
import type { BreakKind } from './break';
import { exerciseRows, exerciseTask, makeExercise } from './exercise';
import { decodeMistakes, decodeStage, polish } from './scene';
import { CHIP_CHOICES, EXAMPLES, TRY_DEFAULT, decodeRegions, encodeRegions, tryParams } from './setup';

const TABS = [
  { key: '', label: '讲解' },
  { key: 'try', label: '试一试' },
  { key: 'quiz', label: '练习' },
  { key: 'break', label: '弄坏它' },
] as const;

const NEEDS = [{ href: '/3-expand', text: '位扩展、字扩展和片选' }];

function useRun(params: Params) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    const trace = polish(run(params));
    const stage = decodeStage(params, narrow);
    return { trace, stage, mistakes: decodeMistakes(trace, stage) };
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

function Lead() {
  return (
    <p class="xp-lead">
      ROM、RAM 各占一段地址。<Term k="译码器">译码器</Term>的每个输出管一样长的一段，低电平有效；把每一段接到放在那里的芯片的片选 CS 上。存储器<Term k="按字编址" />。
    </p>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'a', (raw) => (EXAMPLES.some((item) => item.key === raw) ? raw : 'a'));
  const [, setStep] = useParam('s', '0');
  const example = EXAMPLES.find((item) => item.key === ex) ?? EXAMPLES[0]!;
  const { trace, stage, mistakes } = useRun(example.params);
  return (
    <>
      <Lead />
      <div class="seg xp-examples" role="group" aria-label="例题">
        {EXAMPLES.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.key === example.key}
            onClick={() => {
              if (item.key === example.key) return;
              setStep('0');
              setEx(item.key);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <Player
        key={example.key}
        trace={trace}
        scene={stage.scene}
        bind={stage.bind}
        moves={stage.moves}
        names={stage.names}
        values={stage.values}
        frame={stage.frame}
        askFrame={stage.askFrame}
        onWrong={stage.wrong}
        question={stage.question}
        conclusion={stage.conclusion}
        needs={NEEDS}
        mistakes={mistakes}
        wide
      />
    </>
  );
}

interface Draft {
  kind: 'ROM' | 'RAM';
  start: string;
  end: string;
  chip: string;
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
const toDraft = (r: Region): Draft => ({ kind: r.kind, start: hex4(r.start), end: hex4(r.end), chip: r.chip ? `${String(r.chip.words).toUpperCase()}x${r.chip.bits}` : '' });
const fromDraft = (list: Draft[]): string =>
  list.map((r) => `${r.kind}:${r.start.trim().toUpperCase().replace(/H$/, '')}-${r.end.trim().toUpperCase().replace(/H$/, '')}${r.chip ? `:${r.chip}` : ''}`).join(';');

function Try() {
  const [rg, setRg] = useParam('rg', TRY_DEFAULT.rg);
  const [db, setDb] = useParam('db', TRY_DEFAULT.db, (raw) => (raw === '16' ? '16' : '8'));
  const [dec, setDec] = useParam('dec', TRY_DEFAULT.dec, (raw) => (raw === '74138' || raw === '74139' ? raw : ''));
  const [a, setA] = useParam('a', TRY_DEFAULT.a);
  const [, setStep] = useParam('s', '0');
  const saved = useMemo(() => (decodeRegions(rg) ?? EXAMPLES[1]!.params.regions).map(toDraft), [rg]);
  const [draft, setDraft] = useState<{ list: Draft[]; a: string } | null>(null);
  const list = draft?.list ?? saved;
  const probe = draft?.a ?? a;
  const [problem, setProblem] = useState('');
  const result = useMemo(() => tryParams(rg, db, dec, a), [rg, db, dec, a]);

  const edit = (i: number, patch: Partial<Draft>) => setDraft({ list: list.map((r, k) => (k === i ? { ...r, ...patch } : r)), a: probe });
  const commit = (event?: TargetedEvent<HTMLFormElement>, over?: { db?: string; dec?: string }) => {
    event?.preventDefault();
    const text = fromDraft(list);
    const next = tryParams(text, over?.db ?? db, over?.dec ?? dec, probe);
    if (next.problems.length > 0) {
      setProblem(next.problems[0]!);
      return;
    }
    setProblem('');
    setStep('0');
    setRg(next.params ? encodeRegions(next.params.regions) : text);
    setA(probe.trim().toUpperCase().replace(/H$/, ''));
    if (over?.db) setDb(over.db);
    if (over?.dec !== undefined) setDec(over.dec);
    setDraft(null);
  };

  return (
    <>
      <form class="xp-regions" onSubmit={(e) => commit(e)}>
        {list.map((r, i) => (
          <div class="xp-region" key={i} role="group" aria-label={`第 ${i + 1} 个区域`}>
            <div class="field">
              <label class="field-label" for={`xd-k${i}`}>
                区域 {i + 1}
              </label>
              <select id={`xd-k${i}`} class="select" value={r.kind} onChange={(e) => edit(i, { kind: e.currentTarget.value as 'ROM' | 'RAM' })}>
                <option value="ROM">ROM</option>
                <option value="RAM">RAM</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for={`xd-s${i}`}>
                首地址
              </label>
              <input id={`xd-s${i}`} class="input is-mono" value={r.start} autoComplete="off" spellcheck={false} onInput={(e) => edit(i, { start: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label class="field-label" for={`xd-e${i}`}>
                尾地址
              </label>
              <input id={`xd-e${i}`} class="input is-mono" value={r.end} autoComplete="off" spellcheck={false} onInput={(e) => edit(i, { end: e.currentTarget.value })} />
            </div>
            <div class="field">
              <label class="field-label" for={`xd-c${i}`}>
                芯片
              </label>
              <select id={`xd-c${i}`} class="select" value={r.chip} onChange={(e) => edit(i, { chip: e.currentTarget.value })}>
                {CHIP_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c === '' ? '已有一整块' : `${c.replace('x', '×')} 位`}
                  </option>
                ))}
              </select>
            </div>
            {list.length > 1 ? (
              <button type="button" class="btn is-quiet" onClick={() => setDraft({ list: list.filter((_, k) => k !== i), a: probe })}>
                删掉
              </button>
            ) : null}
          </div>
        ))}
        <div class="xp-form">
          {list.length < 4 ? (
            <button type="button" class="btn" onClick={() => setDraft({ list: [...list, { kind: 'RAM', start: 'E000', end: 'EFFF', chip: '4Kx8' }], a: probe })}>
              加一个区域
            </button>
          ) : null}
          <div class="field">
            <label class="field-label" for="xd-db">
              数据线
            </label>
            <select id="xd-db" class="select" value={db} onChange={(e) => commit(undefined, { db: e.currentTarget.value })}>
              <option value="8">8 根</option>
              <option value="16">16 根</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="xd-dec">
              译码器
            </label>
            <select id="xd-dec" class="select" value={dec} onChange={(e) => commit(undefined, { dec: e.currentTarget.value })}>
              <option value="">按位数选</option>
              <option value="74138">74138</option>
              <option value="74139">74139</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="xd-a">
              要查的地址
            </label>
            <input id="xd-a" class="input is-mono xp-addr" value={probe} autoComplete="off" spellcheck={false} onInput={(e) => setDraft({ list, a: e.currentTarget.value })} />
          </div>
          <button type="submit" class="btn">
            换上
          </button>
        </div>
        <p class="field-help">16 根地址线，地址写十六进制，不写 H。</p>
      </form>
      {problem ? (
        <p class="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {result.params ? <TryRun params={result.params} /> : <p class="field-error">{result.problems[0]}</p>}
    </>
  );
}

function TryRun({ params }: { params: Params }) {
  const { trace, stage } = useRun(params);
  return <Player key={JSON.stringify(params)} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} askFrame={stage.askFrame} onWrong={stage.wrong} wide />;
}

function Practice() {
  const [seedText, setSeed] = useParam('q', '1', (raw) => String(Math.max(1, Math.min(99999, Math.trunc(Number(raw)) || 1))));
  const seed = Number(seedText);
  const [, setTab] = useParam('t', '');
  const [, setRg] = useParam('rg', TRY_DEFAULT.rg);
  const [, setDb] = useParam('db', TRY_DEFAULT.db);
  const [, setDec] = useParam('dec', TRY_DEFAULT.dec);
  const [, setA] = useParam('a', TRY_DEFAULT.a);
  const [, setStep] = useParam('s', '0');
  const params = useMemo(() => makeExercise(seed), [seed]);
  const rows = useMemo(
    () =>
      exerciseRows(params).map((row) => ({
        ...row,
        demo: () => {
          setRg(encodeRegions(params.regions));
          setDb(String(params.dataBits));
          setDec('');
          setA(params.probe === undefined ? '' : params.probe.toString(16).toUpperCase().padStart(4, '0'));
          setStep(String(Math.max(0, row.step - 1)));
          setTab('try');
        },
      })),
    // set* 来自 useParam，引用稳定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params],
  );
  const trace = useMemo(() => run(params), [params]);
  return (
    <Paper
      key={seed}
      storeKey={`coa:3-decode:quiz:${seed}`}
      seed={seed}
      task={exerciseTask(params)}
      conditions={trace.conditions.filter((c) => c.label !== '地址空间').map((c) => ({ label: c.label, value: sub(c.value) }))}
      rows={rows}
      onNext={() => setSeed(String(seed + 1))}
    />
  );
}

/** 弄坏它用变式（多一片小 RAM），查一个落在中间 RAM 区的地址。 */
const BREAK_PARAMS: Params = { ...EXAMPLES[1]!.params, probe: 0xa51c };

function Break() {
  const [kind, setKind] = useParam('bk', 'fight', (raw) => (raw === 'alias' ? 'alias' : 'fight'));
  const [, setStep] = useParam('s', '0');
  const { trace, stage } = useRun(BREAK_PARAMS);
  const short = useMemo(() => breakTrace(trace), [trace]);
  const breakIt = useMemo(
    () => (state: Parameters<typeof breakage>[1], part: string | null) => {
      if (part === null) return breakage(kind as BreakKind, state, stage);
      const chip = /^U(\d+)_/.exec(part) ?? /^gl(\d+)$/.exec(part);
      if (chip) {
        const r = Number(chip[1]);
        const g = stage.design.groups[r];
        if (g && g.words < stage.design.groupWords) return breakage('alias', state, stage);
        return breakage('fight', state, stage, r);
      }
      return null;
    },
    [kind, stage],
  );
  return (
    <>
      <p class="xp-lead">先走两步，把地址送出去、选中一组；再故意接错一处，看会怎样。也可以直接点台面上别的组的名牌。</p>
      <div class="seg xp-examples" role="group" aria-label="弄坏哪里">
        {(
          [
            ['fight', '一个 Y 接两组'],
            ['alias', '小芯片不做局部译码'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={kind === key}
            onClick={() => {
              setKind(key);
              setStep('2');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Player key="break" trace={short} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} breakIt={breakIt} wide />
    </>
  );
}

export default function Page() {
  const [tab, setTab] = useParam('t', '', (raw) => (TABS.some((item) => item.key === raw) ? raw : ''));
  const [step, setStep] = useParam('s', '0');
  const [memo] = useState(() => new Map<string, string>());
  return (
    <div class="xp">
      <div class="tabs" role="tablist" aria-label="这一页的部分">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`xd-tab-${item.key || 'learn'}`}
            aria-selected={item.key === tab}
            aria-controls="xd-panel"
            onClick={() => {
              if (item.key === tab) return;
              memo.set(tab, step);
              setTab(item.key);
              setStep(memo.get(item.key) ?? '0');
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id="xd-panel" class="xp-panel" role="tabpanel" aria-labelledby={`xd-tab-${tab || 'learn'}`}>
        {tab === '' && <Learn />}
        {tab === 'try' && <Try />}
        {tab === 'quiz' && <Practice />}
        {tab === 'break' && <Break />}
      </div>
    </div>
  );
}
