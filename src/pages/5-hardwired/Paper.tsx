/**
 * 练习：按题号出一个信号和一组指令，学生在答题栏里写逻辑表达式。判分用引擎的 runReverse 逐拍对照流程图，
 * 指出第一处漏掉或多出的节拍，并把学生的式子摆到台面的格子表上：亮的是式子为 1 的节拍，标「漏」「多发」的是错处。
 */
import { useMemo, useState } from 'preact/hooks';
import type { CSSProperties, TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { generate, run, runReverse } from '../../engines/hardwired/model';
import type { DeriveParams } from '../../engines/hardwired/model';
import type { Pose, SceneSpec } from '../../scene';
import { PaperStage, useDraft, useSeed, useWidePaper } from '../4-ea/shell';
import { cellOf, flowCells, gridDepth, gridOf, gridParts, gridPatch, gridView } from './scene';
import { Seg } from '../4-ea/shell';
import { DerivePlayer } from './play';

export function HardPaper() {
  const [seed, next] = useSeed();
  const [view, setView] = useParam('v', '');
  const [, setStep] = useParam('s', '0');
  const params = useMemo(() => generate(seed), [seed]);
  if (view === 'play') {
    return (
      <div class="ix-quiz">
        <button type="button" class="btn ix-back" onClick={() => setView('')}>
          回到答题纸
        </button>
        <DerivePlayer key={seed} params={params} lesson={false} />
      </div>
    );
  }
  return (
    <Sheet
      key={seed}
      seed={seed}
      params={params}
      onNext={next}
      onDemo={() => {
        setStep('0');
        setView('play');
      }}
    />
  );
}

type Verdict = { ok: true } | { ok: false; text: string; missing: string[]; extra: string[] } | { error: string };

function Sheet({ seed, params, onNext, onDemo }: { seed: number; params: DeriveParams; onNext: () => void; onDemo: () => void }) {
  const ops = params.instructions!;
  const narrow = useNarrow();
  const wide = useWidePaper();
  const answer = useMemo(() => run(params).result['表达式']!.split('=').slice(1).join('='), [params]);
  const base = useMemo(() => flowCells(ops, 'book'), [ops]);
  const [draft, setDraft] = useDraft<string>(`coa:5-hardwired:quiz:${seed}`, () => '', (v): v is string => typeof v === 'string');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [shown, setShown] = useState(false);
  const view = useMemo(() => gridView(ops, narrow), [ops, narrow]);
  // 手机上一次看一条指令的表，选哪条在网址参数 g。
  const [look, setLook] = useParam('g', '0', (raw) => (Number(raw) >= 0 && Number(raw) < ops.length ? String(Math.trunc(Number(raw))) : '0'));
  const ansZ = narrow ? -12.4 : 5.0;

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        ...gridParts(view, base, [0, 0]),
        { id: 'ANS', kind: 'register', position: [0, ansZ], props: { name: `${params.signal} =`, value: '', width: narrow ? 6.6 : 7.2, ink: 'ctrl' } },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 8.2 + gridDepth(view)] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    [view, base, params.signal, narrow, wide, ansZ],
  );

  const pose = useMemo<Pose>(() => {
    const cells = base.map((row) => [...row]);
    let tones: Record<string, 'accent'> = {};
    let changed: string[] = [];
    if (verdict && 'ok' in verdict && draft.trim()) {
      try {
        const rev = runReverse({ expression: draft.toUpperCase(), signal: params.signal, instructions: ops });
        const got = rev.steps.flatMap((s) => s.state.matches.flat());
        const last = rev.steps[rev.steps.length - 1]!.state;
        tones = Object.fromEntries([...new Set(got)].map((x) => [cellOf(x, ops), 'accent' as const]));
        for (const key of Object.keys(tones)) {
          const [r, c] = key.split('.').map(Number);
          if (cells[r!]![c!] === '') cells[r!]![c!] = '保持';
        }
        for (const x of last.extra ?? []) {
          const [r, c] = cellOf(x, ops).split('.').map(Number);
          if (cells[r!]![c!] === '保持') cells[r!]![c!] = '多发';
        }
        for (const x of last.missing ?? []) {
          const [r, c] = cellOf(x, ops).split('.').map(Number);
          cells[r!]![c!] = `漏：${cells[r!]![c!] || '保持'}`;
        }
        changed = [...(last.missing ?? []), ...(last.extra ?? [])].map((x) => cellOf(x, ops));
      } catch {
        // 式子写错了：格子表不亮。
      }
    }
    const patch = gridPatch(view, cells, Object.keys(tones), changed, -1);
    const parts: Record<string, Record<string, unknown>> = {};
    for (const part of scene.parts) parts[part.id] = { ...part.props, ...(patch[part.id] ?? {}) };
    parts.ANS = { ...parts.ANS, value: draft.trim() };
    return { parts, wires: {} };
  }, [scene, base, verdict, draft, params.signal, ops, view]);

  const check = (raw: string) => {
    const text = raw.toUpperCase();
    // 式子里出现了这台机器没有的指令：卷面上就是错的，不拿去和流程图比。
    const foreign = [...new Set(text.match(/[A-Z]{3}/g) ?? [])].filter((name) => !(ops as string[]).includes(name));
    if (foreign.length) {
      setVerdict({ error: `这台机器只有 ${ops.join('、')}，式子里不能出现 ${foreign.join('、')}。` });
      return;
    }
    try {
      const rev = runReverse({ expression: text, signal: params.signal, instructions: ops });
      if (rev.result['一致'] === '是') {
        setVerdict({ ok: true });
        return;
      }
      const last = rev.steps[rev.steps.length - 1]!.state;
      const missing = last.missing ?? [];
      const extra = last.extra ?? [];
      const what = (point: string) => {
        const [r, c] = cellOf(point, ops).split('.').map(Number);
        return base[r!]![c!] || '这一拍没有新的操作';
      };
      const text2 = missing.length
        ? `第一处漏掉的是 ${missing[0]}（那一拍做 ${what(missing[0]!)}），流程图上那里要发 ${params.signal}。`
        : `第一处多出的是 ${extra[0]}（${what(extra[0]!)}），流程图上那里不发 ${params.signal}；脉冲信号要与 T，两个周期的指令在 M3 空过。`;
      setVerdict({ ok: false, text: text2, missing, extra });
    } catch (error) {
      setVerdict({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim()) check(draft);
  };

  const panel = (style: CSSProperties | undefined, ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`ix-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={submit} data-no-orbit>
      <div class="ix-fill-grid">
        <label class={`is-span${verdict && 'ok' in verdict && !verdict.ok ? ' is-wrong' : ''}`}>
          <span>{params.signal} =（· 或 * 是与，+ 是或）</span>
          <input
            class="input is-mono"
            type="text"
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            placeholder={`如 M1·T3+M2·T4·${ops[0]}`}
            value={draft}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              setVerdict(null);
            }}
          />
        </label>
      </div>
      <div class="ix-fill-foot">
        <button type="submit" class="btn is-primary">
          判分
        </button>
        <button
          type="button"
          class="btn is-quiet"
          onClick={() => {
            setDraft(answer);
            setShown(true);
            check(answer);
          }}
        >
          看答案
        </button>
      </div>
    </form>
  );

  let line = null;
  if (verdict && 'error' in verdict) {
    line = (
      <p class="ix-verdict" role="status">
        <span class="is-bad-text">写法有误。</span>
        {verdict.error}
      </p>
    );
  } else if (verdict && verdict.ok) {
    line = (
      <p class="ix-verdict" role="status">
        <span class="is-ok-text">{shown ? '答案已填上。' : '对。'}</span>格子表上亮的正好是流程图上发 {params.signal} 的节拍。
        <button type="button" class="btn" onClick={onNext}>
          换一题
        </button>
      </p>
    );
  } else if (verdict) {
    line = (
      <p class="ix-verdict" role="status">
        <span class="is-bad-text">不对。</span>
        {verdict.text}共漏 {verdict.missing.length} 拍，多 {verdict.extra.length} 拍，格子表上标了「漏」「多发」。
        <button type="button" class="btn" onClick={onDemo}>
          看推导
        </button>
      </p>
    );
  }

  return (
    <div class="ix-quiz">
      <p class="ix-task">
        模型机只有 {ops.join('、')} 这 {ops.length} 条指令。照台面上的流程表，写出 {params.signal} 的逻辑表达式（教材的信号名，Rx、Ry 是指令里第一个、第二个寄存器）。
      </p>
      <p class="ix-note">题号 {seed}</p>
      {narrow ? <Seg label="看哪条指令的流程" items={ops.map((op, c) => ({ key: String(c), label: op }))} value={look} onChoose={setLook} mono /> : null}
      <PaperStage scene={scene} pose={pose} frame={narrow ? [gridOf(view, Number(look))] : wide ? ['G', 'ANS', 'desk'] : ['G', 'ANS']} panel={panel} wide={wide} />
      {line}
    </div>
  );
}
