import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import type { Operation, OverflowParams } from '../../engines/overflow/model';
import { formatValue, parseValue } from '../../lib/bits';
import type { Notation } from '../../lib/bits';
import { Player } from '../../player/Player';
import { breakScene, breakTrace } from './break';
import { EXAMPLES, exampleParams, lesson } from './lesson';
import { OVERFLOW_CONCLUSION, OVERFLOW_NEEDS, OVERFLOW_QUESTION } from './scene';
import { Sheet } from './Sheet';
import './overflow.css';

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
    <div class="ovf">
      <div class="ovf-tabs" role="tablist" aria-label="本页">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`ovf-tab-${item.id}`}
            aria-selected={item.id === current}
            aria-controls="ovf-panel"
            class={`ovf-tab${item.id === current ? ' is-on' : ''}`}
            onClick={() => choose(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div id="ovf-panel" role="tabpanel" aria-labelledby={`ovf-tab-${current}`}>
        {current === 'learn' && <Learn />}
        {current === 'try' && <Try />}
        {current === 'practice' && <Practice />}
        {current === 'break' && <Break />}
      </div>
    </div>
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', '1', (raw) => String(Math.max(1, Math.min(EXAMPLES.length, Math.trunc(Number(raw)) || 1))));
  const [, setStep] = useParam('s', '0');
  const index = Math.max(0, Math.min(EXAMPLES.length - 1, Number(ex) - 1 || 0));
  const narrow = useNarrow();
  const made = useMemo(() => lesson(exampleParams(index), narrow), [index, narrow]);
  return (
    <>
      <div class="ovf-choices" role="group" aria-label="例题">
        {EXAMPLES.map((item, i) => (
          <button
            key={i}
            type="button"
            class={`ovf-choice${i === index ? ' is-on' : ''}`}
            aria-pressed={i === index}
            onClick={() => {
              if (i === index) return;
              setStep('0');
              setEx(String(i + 1));
            }}
          >
            ({minus(item.x)}) {item.op === '减' ? '−' : '+'} ({minus(item.y)})
          </button>
        ))}
      </div>
      {made.ok ? (
        <Player
          key={`learn-${index}`}
          trace={made.trace}
          scene={made.scene}
          bind={made.bind}
          moves={made.moves}
          names={made.names}
          values={made.values}
          flipPart={made.flipPart}
          onWrong={made.wrong}
          askFrame={made.askFrame}
          frame={made.frame}
          question={OVERFLOW_QUESTION}
          conclusion={OVERFLOW_CONCLUSION}
          needs={OVERFLOW_NEEDS}
          mistakes={made.mistakes}
        />
      ) : (
        <p class="ovf-error">{made.error}</p>
      )}
    </>
  );
}

const N_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

/** 改了写法或位数时，按原来的写法读出数值，再按新的位数和写法写出来。读不出时原样保留，交给引擎报错。 */
function rewrite(text: string, readN: number, readAs: Notation, writeN: number, writeAs: Notation): string {
  try {
    return formatValue(parseValue(text, readN, readAs), writeN, writeAs);
  } catch {
    return text;
  }
}

function Try() {
  const [x, setX] = useParam('x', '+0101');
  const [y, setY] = useParam('y', '-1100');
  const [nText, setN] = useParam('n', '4', (raw) => String(Math.max(1, Math.min(8, Math.trunc(Number(raw)) || 4))));
  const [opText, setOp] = useParam('op', '减', (raw) => (raw === '加' ? '加' : '减'));
  const [ntText, setNt] = useParam('nt', '整数', (raw) => (raw === '小数' ? '小数' : '整数'));
  const n = Math.max(1, Math.min(8, Math.trunc(Number(nText)) || 4));
  const op: Operation = opText === '加' ? '加' : '减';
  const notation: Notation = ntText === '小数' ? '小数' : '整数';
  const [draft, setDraft] = useState<{ x: string; y: string } | null>(null);
  const shownX = draft?.x ?? x;
  const shownY = draft?.y ?? y;

  const params: OverflowParams = useMemo(() => ({ x: { as: '真值', text: x }, y: { as: '真值', text: y }, n, op, notation }), [x, y, n, op, notation]);
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
    setX(rewrite(x, next, notation, next, notation));
    setY(rewrite(y, next, notation, next, notation));
    setDraft(null);
    setN(String(next));
  };

  return (
    <>
      <form class="ovf-form" onSubmit={submit}>
        <label class="ovf-field">
          <span>x 的真值</span>
          <input class="ovf-input" value={shownX} inputMode="text" autoComplete="off" spellcheck={false} onInput={(e) => edit('x', e.currentTarget.value)} onChange={commit} />
        </label>
        <label class="ovf-field">
          <span>y 的真值</span>
          <input class="ovf-input" value={shownY} inputMode="text" autoComplete="off" spellcheck={false} onInput={(e) => edit('y', e.currentTarget.value)} onChange={commit} />
        </label>
        <div class="ovf-field">
          <span id="ovf-op">运算</span>
          <div class="ovf-seg" role="group" aria-labelledby="ovf-op">
            {(['加', '减'] as const).map((item) => (
              <button key={item} type="button" class={`ovf-choice${item === op ? ' is-on' : ''}`} aria-pressed={item === op} onClick={() => setOp(item)}>
                {item === '加' ? 'x + y' : 'x − y'}
              </button>
            ))}
          </div>
        </div>
        <label class="ovf-field">
          <span>数值位 n</span>
          <select class="ovf-input" value={String(n)} onChange={(e) => changeN(Number(e.currentTarget.value))}>
            {N_CHOICES.map((item) => (
              <option key={item} value={String(item)}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <div class="ovf-field">
          <span id="ovf-nt">写法</span>
          <div class="ovf-seg" role="group" aria-labelledby="ovf-nt">
            {(['整数', '小数'] as const).map((item) => (
              <button key={item} type="button" class={`ovf-choice${item === notation ? ' is-on' : ''}`} aria-pressed={item === notation} onClick={() => changeNotation(item)}>
                定点{item}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" class="ovf-hidden-submit" tabIndex={-1} aria-hidden="true" />
      </form>
      {[['x', x], ['y', y]].some(([, text]) => text && !/^[+\-−]/.test(text.trim())) ? (
        <p class="ovf-note">没写正负号的数按正数算。负数前面写 −。</p>
      ) : null}
      {!x.trim() || !y.trim() ? (
        <p class="ovf-error" role="alert">
          {!x.trim() ? 'x 的真值还没填。' : 'y 的真值还没填。'}
        </p>
      ) : made.ok ? (
        <>
          <dl class="ovf-formulas">
            <div>
              <dt>[x{op === '加' ? '+' : '−'}y]变补</dt>
              <dd>{made.trace.result['结果的变形补码']}</dd>
            </div>
            <div>
              <dt>
                V = S<sub>f1</sub> ⊕ S<sub>f2</sub>
              </dt>
              <dd>
                {made.solution.sf1} ⊕ {made.solution.sf2} = {made.solution.vBySign}
              </dd>
            </div>
            <div>
              <dt>
                V = C<sub>f</sub> ⊕ C<sub>0</sub>
              </dt>
              <dd>
                {made.solution.cf} ⊕ {made.solution.c0} = {made.solution.vByCarry}
              </dd>
            </div>
            <div>
              <dt>判定</dt>
              <dd>
                {made.trace.result['是否溢出']}
                {made.trace.result['真值'] ? `，${made.trace.result['真值']}` : ''}
              </dd>
            </div>
          </dl>
          <Player key={`try-${JSON.stringify(params)}`} trace={made.trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} flipPart={made.flipPart} onWrong={made.wrong} askFrame={made.askFrame} />
        </>
      ) : (
        <p class="ovf-error" role="alert">
          {made.error}
        </p>
      )}
    </>
  );
}

function Practice() {
  const [seedText, setSeed] = useParam('seed', '1', (raw) => String(Math.max(1, Math.trunc(Number(raw)) || 1)));
  const seed = Math.max(1, Math.trunc(Number(seedText)) || 1);
  return <Sheet key={seed} seed={seed} onNext={() => setSeed(String(seed + 1))} />;
}

function Break() {
  const narrow = useNarrow();
  const trace = useMemo(() => breakTrace(), []);
  const made = useMemo(() => breakScene(trace, narrow), [trace, narrow]);
  return <Player key={`break-${narrow}`} trace={trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} onWrong={made.wrong} />;
}
