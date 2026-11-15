import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import type { DivParams } from '../../engines/div/model';
import type { Binding } from '../../scene';
import { formatValue, parseValue } from '../../lib/bits';
import type { Notation } from '../../lib/bits';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { CASES, breakMoves, breakTrace, breakWrong } from './break';
import { subScene } from '../2-mul/code';
import type { BreakState } from './break';
import { DIV_CONCLUSION, DIV_NEEDS, DIV_QUESTION, EXAMPLES, exampleParams, lesson } from './lesson';
import { Paper } from './Paper';
import { divScene } from './scene';
import '../2-mul/mul.css';

const TABS = [
  { id: 'learn', name: '讲解' },
  { id: 'try', name: '试一试' },
  { id: 'practice', name: '练习' },
  { id: 'break', name: '弄坏它' },
] as const;

const minus = (text: string) => text.replace(/^-/, '−');

export default function Page() {
  const [tab, setTab] = useParam('tab', 'learn', (raw) => (TABS.some((item) => item.id === raw) ? raw : 'learn'));
  const [, setStep] = useParam('s', '0');
  const current = TABS.find((item) => item.id === tab)?.id ?? 'learn';
  const choose = (id: string) => {
    if (id === current) return;
    setStep('0');
    setTab(id);
  };
  return (
    <div class="mul">
      <div class="tabs" role="tablist" aria-label="本页">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" id={`div-tab-${item.id}`} aria-selected={item.id === current} aria-controls="div-panel" onClick={() => choose(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      <div id="div-panel" role="tabpanel" aria-labelledby={`div-tab-${current}`}>
        {current === 'learn' && <Learn />}
        {current === 'try' && <Try />}
        {current === 'practice' && <Paper />}
        {current === 'break' && <BreakIt />}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <p class="mul-legend">
      机器不会估商，只能先做加减，看<Term k="部分余数" />的<Term k="符号位" />：和 ≥ 0 天平往余数一边沉，上商 1；和 &lt; 0 往除数一边沉，上商 0。减 y 用加 [−|y|]<sub>补</sub> 来做。竖式上方的两块砝码，下一轮要用的那块垫着深色纸。
    </p>
  );
}

function exampleName(i: number): string {
  const item = EXAMPLES[i]!;
  return `${item.notation === '整数' ? '整数 ' : ''}${minus(item.x)} ÷ ${minus(item.y)}`;
}

function Learn() {
  const [ex, setEx] = useParam('ex', '1', (raw) => String(Math.max(1, Math.min(EXAMPLES.length, Math.trunc(Number(raw)) || 1))));
  const [, setStep] = useParam('s', '0');
  const index = Math.max(0, Math.min(EXAMPLES.length - 1, Number(ex) - 1 || 0));
  const narrow = useNarrow();
  const made = useMemo(() => lesson(exampleParams(index), narrow), [index, narrow]);
  return (
    <>
      <div class="seg is-mono mul-examples" role="group" aria-label="例题">
        {EXAMPLES.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === index}
            onClick={() => {
              if (i === index) return;
              setStep('0');
              setEx(String(i + 1));
            }}
          >
            {exampleName(i)}
          </button>
        ))}
      </div>
      <Legend />
      {made.ok ? (
        <Player
          key={`learn-${index}-${narrow}`}
          trace={made.trace}
          scene={made.scene}
          bind={made.bind}
          moves={made.moves}
          names={made.names}
          values={made.values}
          onWrong={made.wrong}
          askFrame={made.askFrame}
          frame={made.frame}
          question={DIV_QUESTION}
          conclusion={DIV_CONCLUSION}
          needs={DIV_NEEDS}
          mistakes={made.mistakes}
        />
      ) : (
        <p class="field-error">{made.error}</p>
      )}
    </>
  );
}

const N_CHOICES = [2, 3, 4, 5, 6, 7, 8];

function rewrite(text: string, readN: number, readAs: Notation, writeN: number, writeAs: Notation): string {
  try {
    return formatValue(parseValue(text, readN, readAs), writeN, writeAs);
  } catch {
    return text;
  }
}

function Try() {
  const [x, setX] = useParam('x', '+0.1001');
  const [y, setY] = useParam('y', '-0.1011');
  const [nText, setN] = useParam('n', '4', (raw) => String(Math.max(2, Math.min(8, Math.trunc(Number(raw)) || 4))));
  const [ntText, setNt] = useParam('nt', '小数', (raw) => (raw === '整数' ? '整数' : '小数'));
  const n = Math.max(2, Math.min(8, Math.trunc(Number(nText)) || 4));
  const notation: Notation = ntText === '整数' ? '整数' : '小数';
  const [draft, setDraft] = useState<{ x: string; y: string } | null>(null);
  const shownX = draft?.x ?? x;
  const shownY = draft?.y ?? y;
  const params: DivParams = useMemo(() => ({ n, notation, x: { as: '真值', text: x }, y: { as: '真值', text: y } }), [x, y, n, notation]);
  const narrow = useNarrow();
  const made = useMemo(() => lesson(params, narrow), [params, narrow]);
  const commit = () => {
    if (!draft) return;
    setX(draft.x.trim());
    setY(draft.y.trim());
    setDraft(null);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    commit();
  };
  const edit = (key: 'x' | 'y', value: string) => setDraft({ x: shownX, y: shownY, [key]: value });
  const changeNotation = (to: Notation) => {
    if (to === notation) return;
    setX(rewrite(x, n, notation, n, to));
    setY(rewrite(y, n, notation, n, to));
    setDraft(null);
    setNt(to);
  };
  const changeN = (next: number) => {
    setX(rewrite(x, n, notation, next, notation));
    setY(rewrite(y, n, notation, next, notation));
    setDraft(null);
    setN(String(next));
  };
  const result = made.ok ? made.trace.result : null;
  return (
    <>
      <form class="mul-form" onSubmit={submit}>
        <div class="field mul-wide">
          <span class="field-label" id="div-nt">写法</span>
          <div class="seg" role="group" aria-labelledby="div-nt">
            {(['小数', '整数'] as const).map((item) => (
              <button key={item} type="button" aria-pressed={item === notation} onClick={() => changeNotation(item)}>
                定点{item}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <label for="div-n">数值位 n</label>
          <select id="div-n" class="select" value={String(n)} onChange={(e) => changeN(Number(e.currentTarget.value))}>
            {N_CHOICES.map((item) => (
              <option key={item} value={String(item)}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="div-x">被除数 x</label>
          <input id="div-x" class="input is-mono" value={shownX} autoComplete="off" spellcheck={false} onInput={(e) => edit('x', e.currentTarget.value)} onChange={commit} />
        </div>
        <div class="field">
          <label for="div-y">除数 y</label>
          <input id="div-y" class="input is-mono" value={shownY} autoComplete="off" spellcheck={false} onInput={(e) => edit('y', e.currentTarget.value)} onChange={commit} />
        </div>
        <button type="submit" class="mul-hidden-submit" tabIndex={-1} aria-hidden="true" />
      </form>
      <p class="field-help">
        <Rich text={notation === '小数' ? `二进制定点小数，${n} 位数值位，如 −0.1011；要求 |x| < |y|。` : `二进制定点整数，${n} 位数值位，如 −1011；先乘 2^-${n} 化成小数再除，要求 |x| < |y|。`} />
      </p>
      {!x.trim() || !y.trim() ? (
        <p class="field-error" role="alert">
          {!x.trim() ? 'x 还没填。' : 'y 还没填。'}
        </p>
      ) : made.ok && result ? (
        <>
          <dl class="mul-result">
            <div>
              <dt>
                [q]<sub>原</sub>
              </dt>
              <dd>{result['[q]原']}</dd>
            </div>
            <div>
              <dt>商</dt>
              <dd>{result['商的真值']}</dd>
            </div>
            <div>
              <dt>余数</dt>
              <dd>{result['余数']}</dd>
            </div>
          </dl>
          <p class="mul-legend">
            <Rich text={result['验证'] ?? ''} />
          </p>
          <Player key={`try-${JSON.stringify(params)}-${narrow}`} trace={made.trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} onWrong={made.wrong} askFrame={made.askFrame} frame={made.frame} />
        </>
      ) : (
        <p class="field-error" role="alert">
          {made.ok ? '' : <Rich text={made.error} />}
        </p>
      )}
    </>
  );
}

function BreakIt() {
  const [bx, setBx] = useParam('bx', '1', (raw) => (raw === '2' ? '2' : '1'));
  const [, setStep] = useParam('s', '0');
  const which = bx === '2' ? 1 : 0;
  const narrow = useNarrow();
  const trace = useMemo(() => breakTrace(which), [which]);
  const made = useMemo(() => {
    const base = divScene(trace, narrow);
    const bind: Binding<BreakState> = {
      props: (context) => {
        const out = base.bind.props(context);
        if (context.state.overflow === '1') {
          out['q-0'] = { ...out['q-0'], overflow: true, changed: true };
          out.rq = { value: `${context.state.q[0]}.？` };
        }
        return out;
      },
      partsFor: (path) => (path === 'overflow' ? ['q-0', 'rq'] : base.bind.partsFor(path)),
    };
    const names = (path: string) => (path === 'overflow' ? '商溢出' : base.names(path));
    return subScene<BreakState, { scene: typeof base.scene; bind: typeof bind; names: typeof names; values: typeof base.values; frame: typeof base.frame }>({ scene: base.scene, bind, names, values: base.values, frame: base.frame });
  }, [trace, narrow]);
  return (
    <>
      <div class="seg is-mono mul-examples" role="group" aria-label="例子">
        {CASES.map((item, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === which}
            onClick={() => {
              if (i === which) return;
              setStep('0');
              setBx(String(i + 1));
            }}
          >
            {item.x} ÷ {item.y}
          </button>
        ))}
      </div>
      <Player key={`break-${which}-${narrow}`} trace={trace} scene={made.scene} bind={made.bind} moves={breakMoves} names={made.names} values={made.values} frame={made.frame} onWrong={breakWrong} />
    </>
  );
}
